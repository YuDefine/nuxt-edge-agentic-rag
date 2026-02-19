import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

interface DriftPattern {
  label: string
  pattern: RegExp
}

const PROJECT_ROOT = resolve(process.cwd())
const SCAN_DIRECTORIES = [
  'server/api',
  'server/utils',
  'test',
  'app/components',
  'app/composables',
  'app/pages',
]
const ALLOWED_FILES = new Set([
  'shared/schemas/knowledge-runtime.ts',
  'test/unit/knowledge-governance-drift.test.ts',
  'test/unit/knowledge-governance.test.ts',
  'test/unit/knowledge-runtime-config.test.ts',
  // Acceptance scenarios that deliberately use scores on / near the
  // governance threshold boundaries (judgeMin / answerMin /
  // directAnswerMin) to exercise the judge vs direct-answer branching.
  // Allow-listed so the drift guard does not false-positive on the mock
  // fixture numbers.
  'test/integration/acceptance-tc-06.test.ts',
  'test/integration/acceptance-tc-10.test.ts',
  'test/integration/acceptance-tc-11.test.ts',
])
const DRIFT_PATTERNS: DriftPattern[] = [
  {
    label: 'retrieval.minScore',
    pattern: /\b0\.2\b/g,
  },
  {
    label: 'thresholds.judgeMin',
    pattern: /\b0\.45\b/g,
  },
  {
    label: 'thresholds.answerMin',
    pattern: /\b0\.55\b/g,
  },
  {
    label: 'thresholds.directAnswerMin',
    pattern: /\b0\.7(?:0)?\b/g,
  },
]

describe('knowledge governance drift guard', () => {
  it('keeps governed thresholds out of routes, tests, and debug surfaces', () => {
    const matches = listFiles(SCAN_DIRECTORIES)
      .filter((filePath) => !ALLOWED_FILES.has(filePath))
      .flatMap((filePath) => {
        const content = readFileSync(resolve(PROJECT_ROOT, filePath), 'utf8')

        return DRIFT_PATTERNS.flatMap((entry) =>
          [...content.matchAll(entry.pattern)].map(() => `${filePath}: ${entry.label}`)
        )
      })

    expect(matches).toEqual([])
  })
})

function listFiles(relativeDirectories: string[]): string[] {
  return relativeDirectories.flatMap((relativeDirectory) =>
    walkDirectory(resolve(PROJECT_ROOT, relativeDirectory))
  )
}

function walkDirectory(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  if (!statSync(directory).isDirectory()) {
    return []
  }

  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry)
    const pathStats = statSync(absolutePath)

    if (pathStats.isDirectory()) {
      return walkDirectory(absolutePath)
    }

    if (!/\.(ts|vue)$/.test(entry)) {
      return []
    }

    return [relative(PROJECT_ROOT, absolutePath)]
  })
}
