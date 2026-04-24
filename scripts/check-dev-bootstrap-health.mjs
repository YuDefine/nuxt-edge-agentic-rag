#!/usr/bin/env node
// Pre-dev bootstrap health check. Non-blocking — prints warnings only.
// TD-045 narrow scope: surface common local bootstrap failures before the
// dev server silently 503s on /api/chat or FK-fails on first login.
//
// Checks:
//   1. NUXT_KNOWLEDGE_AI_SEARCH_INDEX empty while ENVIRONMENT=local
//      → /api/chat will 503 "Knowledge AI Search index is not configured"
//   2. .data/db/sqlite.db containing stale `*_new(…)` FK refs
//      → any INSERT into the affected tables will FK-fail; only reachable
//        when someone has run migrations via raw `sqlite3 <` instead of
//        letting NuxtHub apply them automatically (still worth detecting).
//
// Always exits 0; output goes to stderr so it does not pollute stdout
// consumers. See docs/tech-debt.md TD-045 for the full story.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function parseDotenv(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf8')
  const out = {}
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function countStaleNewRefs(dbPath) {
  try {
    const stdout = execFileSync(
      'sqlite3',
      [dbPath, "SELECT count(*) FROM sqlite_master WHERE sql LIKE '%_new(%';"],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return Number(stdout.toString().trim()) || 0
  } catch {
    // sqlite3 CLI missing or DB unreadable — treat as unknown, skip.
    return null
  }
}

const env = {
  ...parseDotenv(path.join(ROOT, '.env')),
  ...process.env,
}
const warnings = []

const envName = env.NUXT_KNOWLEDGE_ENVIRONMENT ?? 'local'
const aiSearchIndex = env.NUXT_KNOWLEDGE_AI_SEARCH_INDEX ?? ''

if (envName === 'local' && !aiSearchIndex) {
  warnings.push({
    key: 'NUXT_KNOWLEDGE_AI_SEARCH_INDEX',
    msg: 'Empty while NUXT_KNOWLEDGE_ENVIRONMENT=local. /api/chat will 503 "Knowledge AI Search index is not configured".',
    fix: 'Set NUXT_KNOWLEDGE_AI_SEARCH_INDEX in .env (staging index is documented on the Notion Secret page → "Local chat / AutoRAG 驗證指引").',
  })
}

const dbPath = path.join(ROOT, '.data', 'db', 'sqlite.db')
if (fs.existsSync(dbPath)) {
  const stale = countStaleNewRefs(dbPath)
  if (stale !== null && stale > 0) {
    warnings.push({
      key: 'DB-STALE-FK-REFS',
      msg: `Found ${stale} table definition(s) still referencing *_new(…). Any INSERT into those tables will FK-fail (seen as "no such table: …_new" or FK violations on login / message send).`,
      fix: 'Rebuild local DB so NuxtHub re-applies migrations cleanly: rm -rf .data/db .wrangler/state/v3/d1/miniflare-D1DatabaseObject && pnpm dev',
    })
  }
}

if (warnings.length === 0) {
  process.exit(0)
}

const ESC = String.fromCharCode(27)
const yellow = (s) => `${ESC}[33m${s}${ESC}[0m`
const cyan = (s) => `${ESC}[36m${s}${ESC}[0m`
const bold = (s) => `${ESC}[1m${s}${ESC}[0m`

process.stderr.write('\n')
process.stderr.write(yellow(bold('⚠  Dev bootstrap health check — warnings\n')))
for (const w of warnings) {
  process.stderr.write(`\n  ${cyan('●')} ${bold(w.key)}\n`)
  process.stderr.write(`      ${w.msg}\n`)
  process.stderr.write(`      ${cyan('Fix:')} ${w.fix}\n`)
}
process.stderr.write(
  yellow(
    '\n(Warnings only — dev server will continue. Suppress by resolving the items above.)\n\n',
  ),
)

process.exit(0)
