#!/usr/bin/env node
/**
 * Patch node_modules/better-call/dist/to-response.mjs to stop emitting
 * non-RFC statusText values like UNAUTHORIZED / BAD_REQUEST.
 *
 * Root cause:
 *   better-call's APIError branch sets `statusText: data.status.toString()`,
 *   which turns enum-style labels into outbound HTTP reason phrases.
 *   Node tolerates that, but edge runtimes like Cloudflare Workers reject
 *   underscores in status text and can surface a 500 before the real 4xx
 *   auth response reaches the client.
 *
 * Fix:
 *   Replace the custom statusText with `undefined` so the runtime emits no
 *   custom reason phrase. That preserves the HTTP status code and body while
 *   avoiding invalid status text in edge environments.
 *
 * Wired into:
 *   - `pnpm predev`
 *   - `pnpm prebuild`
 *   - `pnpm postprepare`
 *
 * Idempotent - safe to run repeatedly.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(__dirname)
const target = join(projectRoot, 'node_modules', 'better-call', 'dist', 'to-response.mjs')

const SEARCH = 'statusText: data.status.toString(),'
const REPLACE = 'statusText: undefined, // patched: invalid custom statusText breaks edge runtimes'

async function main() {
  try {
    const current = await readFile(target, 'utf-8')
    if (current.includes(REPLACE)) {
      console.log('[patch-better-call-status-text] already patched; skipping')
      return
    }
    if (!current.includes(SEARCH)) {
      throw new Error(`patch target not found in ${target}`)
    }

    const next = current.replace(SEARCH, REPLACE)
    await writeFile(target, next, 'utf-8')
    console.log('[patch-better-call-status-text] patched', target)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      console.log('[patch-better-call-status-text] better-call not installed yet; skipping')
      return
    }
    throw error
  }
}

main().catch((error) => {
  console.error('[patch-better-call-status-text] failed:', error)
  process.exit(1)
})
