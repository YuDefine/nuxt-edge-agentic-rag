#!/usr/bin/env node

/**
 * Wrapper for `evalite run …` that translates a `Eval regression:` banner on
 * stderr into a non-zero exit code.
 *
 * Background:
 *   evalite (v0.19) / vitest swallows `process.exit()`, `throw` and
 *   `process.exitCode = 1` issued from inside `afterAll`. This means the
 *   regression check in `test/evals/mcp-tool-selection.eval.ts` cannot
 *   propagate Decision 5's overall-score < baseline − 5pp threshold to
 *   `pnpm eval`'s shell exit code.
 *
 * Strategy:
 *   - Spawn evalite as a child process, forwarding any extra CLI args.
 *   - Pipe stdout/stderr through to the parent in real time so users still
 *     see eval progress and the regression banner.
 *   - In parallel, accumulate stdout+stderr into a buffer.
 *   - When the child exits:
 *       * If child failed (non-zero exit) → propagate that exit code as-is.
 *       * If child exited 0 but the buffer contains "Eval regression:" → exit 1.
 *       * Otherwise → exit 0.
 *   - Forward SIGINT / SIGTERM to the child so Ctrl-C does not orphan it.
 *
 * The decision logic itself is exposed as `decideExitCode` so it can be
 * unit-tested without spawning a real evalite process.
 */

import { spawn } from 'node:child_process'

export const REGRESSION_BANNER_NEEDLE = 'Eval regression:'

/**
 * Decide the wrapper's exit code from the child process outcome and whether
 * the regression banner was observed in stdio.
 *
 * Rules:
 *   - Non-zero child exit code → preserve it (caller's failure wins, even if
 *     a banner was also present — we never mask a real failure).
 *   - Zero child exit + banner observed → 1 (banner-driven regression).
 *   - Zero child exit + no banner → 0.
 *
 * @param {{ childExitCode: number | null, hasRegressionBanner: boolean }} input
 * @returns {number}
 */
export function decideExitCode({ childExitCode, hasRegressionBanner }) {
  const normalized = typeof childExitCode === 'number' ? childExitCode : 1

  if (normalized !== 0) {
    return normalized
  }

  return hasRegressionBanner ? 1 : 0
}

function containsRegressionBanner(buffer) {
  return buffer.includes(REGRESSION_BANNER_NEEDLE)
}

async function main() {
  const args = process.argv.slice(2)
  const evaliteArgs = ['evalite', 'run', 'test/evals/mcp-tool-selection.eval.ts', ...args]

  const child = spawn('pnpm', ['exec', ...evaliteArgs], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  let combined = ''

  child.stdout.on('data', (chunk) => {
    combined += chunk.toString('utf8')
    process.stdout.write(chunk)
  })

  child.stderr.on('data', (chunk) => {
    combined += chunk.toString('utf8')
    process.stderr.write(chunk)
  })

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal)
    }
  }

  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))

  const exitInfo = await new Promise((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ code, signal })
    })
    child.on('error', (error) => {
      // eslint-disable-next-line no-console -- wrapper diagnostic for spawn failures
      console.error(`run-eval-with-exit: failed to spawn evalite — ${error.message}`)
      resolve({ code: 1, signal: null })
    })
  })

  // If the child died via signal (no exit code), surface that as a generic 1
  // unless a regression banner was already printed (still 1).
  const childExitCode = exitInfo.code ?? (exitInfo.signal ? 1 : 0)

  const exitCode = decideExitCode({
    childExitCode,
    hasRegressionBanner: containsRegressionBanner(combined),
  })

  process.exit(exitCode)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // eslint-disable-next-line no-console -- top-level unexpected error
    console.error('run-eval-with-exit crashed', error)
    process.exit(1)
  })
}
