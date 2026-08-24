#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/state-patch-write.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/state-patch-write.ts
// clade flow spine — state-patch-write (P1a)
//
// Read-merge-write-verify for `.clade/work-loop/state.json`. Derived from 16 baseline scripts
// that each hand-rolled a JSON patch and shelled out to `work-loop-state-write.ts` themselves
// (or, worse, skipped it and wrote the file directly — the exact drift
// `work-loop-state-write.ts`'s own header exists to stop). This node is a thin front:
//
//   - it reads the current state to support the optimistic-lock check and to report a
//     before/after round in the result,
//   - it MUST delegate the actual write to `work-loop-state-write.ts` — that script owns the
//     temp/verify/backup/rename dance and retention pass, and duplicating any of it here is
//     exactly the kind of copy that drifts,
//   - after the delegate reports success, it re-reads the file off disk and asserts every key
//     named in the patch took effect (idiom 2, zero-loss, applied to a JSON merge instead of a
//     text move).

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

import { defineNode, fatal, requireArg } from './lib/contract.ts'

const WRITE_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'work-loop-state-write.ts',
)

type State = Record<string, unknown>

function readJsonObject(path: string, what: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    fatal(`cannot read ${what} at ${path}: ${(e as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    fatal(`${what} at ${path} is not valid JSON: ${(e as Error).message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fatal(`${what} at ${path} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/** Shallow merge, mirroring `work-loop-state-write.ts`'s `mergePatch` — null deletes the key. */
function shallowMerge(base: State, patch: State): State {
  const out: State = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = v
  }
  return out
}

defineNode({
  name: 'state-patch-write',
  usage: `usage: state-patch-write --patch <json>|--patch-file <path> [--file <state.json>]
                          [--expect-round <n>] [--dry-run]

Read-merge-write-verify a patch into a work-loop state.json. The patch is a top-level shallow
merge: a value overwrites the key (arrays and objects are replaced whole, never deep-merged),
null deletes the key. Delegates the actual write to work-loop-state-write.ts.
`,
  options: {
    file: { type: 'string', default: '.clade/work-loop/state.json' },
    patch: { type: 'string' },
    'patch-file': { type: 'string' },
    'expect-round': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  run(args) {
    const filePath = resolve(requireArg(args, 'file'))
    const patchRaw = args.patch
    const patchFile = args['patch-file']
    const havePatch = typeof patchRaw === 'string' && patchRaw.length > 0
    const havePatchFile = typeof patchFile === 'string' && patchFile.length > 0
    if (havePatch === havePatchFile) fatal('exactly one of --patch or --patch-file is required')

    let patch: State
    if (havePatch) {
      try {
        patch = JSON.parse(patchRaw as string)
      } catch (e) {
        fatal(`--patch is not valid JSON: ${(e as Error).message}`)
      }
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        fatal('--patch must be a JSON object literal')
      }
    } else {
      patch = readJsonObject(resolve(patchFile as string), '--patch-file')
    }

    const before: State = existsSync(filePath) ? readJsonObject(filePath, '--file') : {}

    const expectRoundRaw = args['expect-round']
    if (typeof expectRoundRaw === 'string' && expectRoundRaw.length > 0) {
      const expectRound = Number(expectRoundRaw)
      if (!Number.isFinite(expectRound)) fatal(`--expect-round is not a number: ${expectRoundRaw}`)
      const actualRound = before.round
      if (actualRound !== expectRound) {
        fatal(
          `optimistic lock failed: state.round is ${JSON.stringify(actualRound)}, expected ${expectRound}`,
        )
      }
    }

    const merged = shallowMerge(before, patch)
    const patchedKeys = Object.keys(patch)
    const roundBefore = typeof before.round === 'number' ? before.round : null
    const roundAfter = typeof merged.round === 'number' ? merged.round : null

    if (args['dry-run'] === true) {
      return {
        summary: `[dry-run] would patch ${patchedKeys.length} key(s) in ${filePath}`,
        data: {
          keys: patchedKeys,
          round: { before: roundBefore, after: roundAfter },
          verified: false,
        },
      }
    }

    // Delegate the write itself — this node never touches the temp/backup/rename sequence.
    const tmpPatchPath = join(
      tmpdir(),
      `state-patch-write.${process.pid}.${Date.now().toString(36)}.json`,
    )
    writeFileSync(tmpPatchPath, JSON.stringify(patch))
    let stdout: string
    try {
      stdout = execFileSync('node', [WRITE_SCRIPT, '--patch', tmpPatchPath, '--state', filePath], {
        encoding: 'utf8',
      })
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string }
      fatal(
        `work-loop-state-write.ts failed: ${(err.stdout ?? '').trim()} ${(err.stderr ?? err.message).trim()}`.trim(),
      )
    } finally {
      rmSync(tmpPatchPath, { force: true })
    }
    if (!stdout.split('\n').some((l) => l.trim() === 'STATE_OK')) {
      fatal(`work-loop-state-write.ts did not report STATE_OK: ${stdout.trim()}`)
    }

    // Zero-loss verify: re-read off disk, not the `merged` object we computed above — a bug in
    // the delegate's own merge or retention pass must show up here.
    const after = readJsonObject(filePath, '--file (post-write)')
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) {
        if (k in after) fatal(`verify failed: key "${k}" was patched to null but is still present`)
      } else if (JSON.stringify(after[k]) !== JSON.stringify(v)) {
        fatal(`verify failed: key "${k}" did not take effect after write`)
      }
    }

    return {
      summary: `patched ${patchedKeys.length} key(s) in ${filePath} (round ${roundBefore ?? '?'} → ${
        typeof after.round === 'number' ? after.round : '?'
      })`,
      data: {
        keys: patchedKeys,
        round: {
          before: roundBefore,
          after: typeof after.round === 'number' ? after.round : roundAfter,
        },
        verified: true,
      },
    }
  },
})
