#!/usr/bin/env node
// clade improvement-loop: aggregate consumer-local signal ledgers into clade home.
//
// Root cause (TD-189): `vendor/signals/ledger-writer.mjs` resolves
// `CLADE_ROOT = resolve(__dirname, '..', '..')` relative to its own file. When a
// consumer runs the projected `.clade/bin/clade-gate`, it imports
// `<consumer>/.clade/vendor/signals/ledger-writer.mjs`, so signals get appended to
// `<consumer>/.clade/vendor/ledger/signals.jsonl` — which never reaches clade home,
// where `improvement-digest.mjs` reads `vendor/ledger/signals.jsonl`. The entire
// signal dimension of the loop ran on clade-home-only data.
//
// This script pulls each consumer's local ledger back into the clade home ledger,
// dedup by `event_id`, re-validating redaction. It is registry-driven (per
// `rules/local/improvement-loop.md`: aggregation MUST resolve consumer identity via
// `registry/consumers.json`, never hard-coded paths). `runDigest()` calls it before
// reading signals so every digest run sees fresh consumer signals.
//
// Usage:
//   node vendor/scripts/aggregate-signals.mjs            # pull + write home ledger
//   node vendor/scripts/aggregate-signals.mjs --dry-run  # report only, no write

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateRecord } from '../signals/redact.mts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CLADE_ROOT = resolve(__dirname, '..', '..')

interface SignalRecord {
  event_id?: string
  ts_utc?: string
  [key: string]: unknown
}

interface ConsumerSignalSummary {
  ledgerPresent: boolean
  localRecords: number
  added: number
}

function parseJsonl(path): SignalRecord[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

// Consumer `.clade/` base: starter (monorepo) projects under `template/`, others at
// repo root. Detected from registry `projection_paths.rules` (`template/.claude/...`
// → base = `<root>/template`). offlineRoot lets tests point elsewhere.
function consumerLedgerPath(consumer, offlineRoot) {
  const root = join(offlineRoot, consumer.consumer_id)
  const rules = consumer.projection_paths?.rules ?? ''
  const base = rules.startsWith('template/') ? join(root, 'template') : root
  return join(base, '.clade', 'vendor', 'ledger', 'signals.jsonl')
}

export function aggregateConsumerSignals({
  cladeRoot = DEFAULT_CLADE_ROOT,
  offlineRoot = join(homedir(), 'offline'),
  dryRun = false,
} = {}) {
  const homeLedger = join(cladeRoot, 'vendor', 'ledger', 'signals.jsonl')
  const registryPath = join(cladeRoot, 'registry', 'consumers.json')
  if (!existsSync(registryPath)) {
    return { ok: false, reason: 'registry-missing', pulled: 0, perConsumer: {} }
  }

  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  const consumers = registry.consumers.filter((c) => c.role === 'consumer')

  const seen = new Map(parseJsonl(homeLedger).map((r) => [r.event_id, r]))
  const before = seen.size

  let pulled = 0
  let skippedDup = 0
  let skippedInvalid = 0
  const perConsumer: Record<string, ConsumerSignalSummary> = {}

  for (const c of consumers) {
    const path = consumerLedgerPath(c, offlineRoot)
    const present = existsSync(path)
    const records = parseJsonl(path)
    let added = 0
    for (const r of records) {
      if (!r.event_id) {
        skippedInvalid++
        continue
      }
      if (seen.has(r.event_id)) {
        skippedDup++
        continue
      }
      const { ok } = validateRecord(r)
      if (!ok) {
        skippedInvalid++
        continue
      }
      seen.set(r.event_id, r)
      added++
      pulled++
    }
    perConsumer[c.consumer_id] = { ledgerPresent: present, localRecords: records.length, added }
  }

  const merged = [...seen.values()].toSorted((a, b) =>
    String(a.ts_utc ?? '').localeCompare(String(b.ts_utc ?? '')),
  )

  if (!dryRun && pulled > 0) {
    writeFileSync(
      homeLedger,
      merged.length ? merged.map((r) => JSON.stringify(r)).join('\n') + '\n' : '',
    )
  }

  return {
    ok: true,
    before,
    after: merged.length,
    pulled,
    skippedDup,
    skippedInvalid,
    perConsumer,
    wrote: !dryRun && pulled > 0,
  }
}

function report(
  result: ReturnType<typeof aggregateConsumerSignals> & {
    perConsumer: Record<string, ConsumerSignalSummary>
  },
) {
  if (!result.ok) {
    console.log(`[aggregate-signals] skipped: ${result.reason}`)
    return
  }
  console.log(
    `[aggregate-signals] home ledger: ${result.before} -> ${result.after} (+${result.pulled})${result.wrote ? '' : ' (dry-run / nothing new)'}`,
  )
  for (const [id, s] of Object.entries(result.perConsumer)) {
    console.log(
      s.ledgerPresent
        ? `  ${id}: ${s.localRecords} local, +${s.added} new`
        : `  ${id}: no local ledger`,
    )
  }
  if (result.skippedDup) console.log(`  dedup skipped: ${result.skippedDup}`)
  if (result.skippedInvalid) console.log(`  invalid skipped: ${result.skippedInvalid}`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const dryRun = process.argv.includes('--dry-run')
  report(aggregateConsumerSignals({ dryRun }))
}
