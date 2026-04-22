/* eslint-disable no-console */
import { execFileSync } from 'node:child_process'

import { findLegacyTestRootPaths, formatLegacyTestRootReport } from './lib/legacy-test-roots.mts'

function loadTrackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  return output.split('\0').filter(Boolean)
}

function run() {
  const trackedFiles = loadTrackedFiles()
  const legacyPaths = findLegacyTestRootPaths(trackedFiles)

  if (legacyPaths.length > 0) {
    console.error(formatLegacyTestRootReport(legacyPaths))
    process.exitCode = 1
    return
  }

  console.log('✅ Legacy test root check passed')
}

run()
