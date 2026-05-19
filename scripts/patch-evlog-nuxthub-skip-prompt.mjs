#!/usr/bin/env node
/**
 * Patch @evlog/nuxthub/dist/module.mjs to short-circuit the interactive
 * `consola.prompt(...)` for "create vercel.json with cron schedule".
 *
 * Root cause:
 *   `@evlog/nuxthub@2.x` onInstall hook calls
 *     `await consola.prompt("Do you want to create a vercel.json...", { type: "confirm", initial: false })`
 *   In CI without TTY, consola fails to auto-detect non-interactive mode and
 *   blocks forever waiting on stdin. The `nuxt prepare` step hangs 5-7
 *   minutes until CI cancellation. `initial: false` would be the right
 *   default in non-TTY but consola never reaches the fallback path.
 *
 * Fix:
 *   Replace the awaited prompt with `false` directly so onInstall always
 *   skips vercel.json creation. We don't deploy via Vercel (project targets
 *   Cloudflare Workers via NuxtHub), so the prompt is a no-op anyway.
 *
 * Wired into:
 *   - `pnpm postinstall` (chained after clade bootstrap)
 *
 * Idempotent — safe to run repeatedly. Scans all pnpm-virtualized copies
 * under `.pnpm/@evlog+nuxthub@<hash>/node_modules/@evlog/nuxthub/dist/module.mjs`
 * since peer-dep variations can create multiple hashed copies.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(__dirname)
const pnpmRoot = join(projectRoot, 'node_modules', '.pnpm')

const SEARCH = `const shouldSetup = await consola.prompt(
      "Do you want to create a vercel.json with a cron schedule for evlog cleanup?",
      { type: "confirm", initial: false }
    );`
const REPLACE = `// patched: skip interactive prompt to avoid CI hang (consola fails to detect non-TTY)
    const shouldSetup = false;`

async function findTargets() {
  let entries
  try {
    entries = await readdir(pnpmRoot, { withFileTypes: true })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      console.log('[patch-evlog-nuxthub-skip-prompt] .pnpm not present; skipping')
      return []
    }
    throw error
  }

  const targets = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('@evlog+nuxthub@')) continue
    targets.push(
      join(pnpmRoot, entry.name, 'node_modules', '@evlog', 'nuxthub', 'dist', 'module.mjs'),
    )
  }
  return targets
}

async function patchOne(target) {
  let current
  try {
    current = await readFile(target, 'utf-8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      console.log(`[patch-evlog-nuxthub-skip-prompt] not present: ${target}`)
      return
    }
    throw error
  }
  if (current.includes(REPLACE)) {
    console.log(`[patch-evlog-nuxthub-skip-prompt] already patched: ${target}`)
    return
  }
  if (!current.includes(SEARCH)) {
    console.log(
      `[patch-evlog-nuxthub-skip-prompt] target pattern not found (already different version?): ${target}`,
    )
    return
  }
  const next = current.replace(SEARCH, REPLACE)
  await writeFile(target, next, 'utf-8')
  console.log(`[patch-evlog-nuxthub-skip-prompt] patched: ${target}`)
}

async function main() {
  const targets = await findTargets()
  if (targets.length === 0) {
    console.log('[patch-evlog-nuxthub-skip-prompt] no @evlog/nuxthub copies found')
    return
  }
  for (const target of targets) {
    await patchOne(target)
  }
}

main().catch((error) => {
  console.error('[patch-evlog-nuxthub-skip-prompt] failed:', error)
  process.exit(1)
})
