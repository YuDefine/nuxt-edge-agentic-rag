#!/usr/bin/env node
/**
 * Patch node_modules/@nuxthub/db/db.mjs to use libsql for local dev.
 *
 * Root cause:
 *   @nuxthub/core's setupDatabase() has a check at module.mjs:229 that
 *   selects driver='d1' whenever `hub.hosting.includes('cloudflare') &&
 *   !nuxt.options.dev`. This branch does NOT test `nuxt.options._prepare`,
 *   so when husky runs `nuxt prepare` on install (dev=false, _prepare=true,
 *   preset=cloudflare_module), the physical db.mjs gets written with a
 *   D1-only template. Starting `pnpm dev` rewrites it to libsql, but any
 *   subsequent `nuxt prepare` invocation (e.g. husky post-commit hooks,
 *   typecheck, or re-running `pnpm prepare` in another terminal) reverts
 *   it to D1 — breaking better-auth's local drizzle adapter.
 *
 * Fix:
 *   Write a libsql-only db.mjs that ignores the D1 binding and reads the
 *   SQLite file URL from NUXT_HUB_LIBSQL_URL or defaults to .data/db/sqlite.db.
 *   This file only matters for LOCAL dev — on Cloudflare deploy, wrangler
 *   bundles its own generated code path and this patch isn't loaded.
 *
 * Wired into:
 *   - `pnpm predev` (runs before `nuxt dev`)
 *   - `pnpm prepare` postscript (optional hardening)
 *
 * Idempotent — safe to run repeatedly.
 */
import { readFile, writeFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(__dirname)
const target = join(projectRoot, 'node_modules', '@nuxthub', 'db', 'db.mjs')

const PATCHED_CONTENT = `// Patched for local dev to use libsql with file:.data/db/sqlite.db.
// See scripts/patch-hub-db-dev.mjs for the full rationale.
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema.mjs'

let _db
function getDb() {
  if (_db) return _db

  const libsqlUrl =
    process.env.NUXT_HUB_LIBSQL_URL ||
    process.env.TURSO_DATABASE_URL ||
    process.env.LIBSQL_URL ||
    process.env.DATABASE_URL ||
    'file:.data/db/sqlite.db'

  _db = drizzle({
    connection: {
      url: libsqlUrl,
      authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN,
    },
    schema,
  })
  return _db
}

const db = new Proxy(
  {},
  {
    get(_, prop) {
      return getDb()[prop]
    },
  }
)
export { db, schema }
`

const PATCH_MARKER = '// Patched for local dev to use libsql'

async function main() {
  try {
    const current = await readFile(target, 'utf-8')
    if (current.startsWith(PATCH_MARKER)) {
      console.log('[patch-hub-db-dev] db.mjs already patched; skipping')
      return
    }
    await writeFile(target, PATCHED_CONTENT, 'utf-8')
    console.log('[patch-hub-db-dev] patched', target)
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('[patch-hub-db-dev] db.mjs not found yet (run `nuxt prepare` first); skipping')
      return
    }
    throw err
  }
}

main().catch((err) => {
  console.error('[patch-hub-db-dev] failed:', err)
  process.exit(1)
})
