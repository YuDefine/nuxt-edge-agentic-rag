#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/control-plane-projection-validate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/control-plane-projection-validate.ts

/**
 * Commit-gate 用的 control-plane 投影校驗 CLI。
 *
 * **這支不自己判定。** digest / cursor 的推導只有一份，住在 `ai-control-plane.ts` 的
 * `validateControlPlaneProjections()`；本檔只負責解析出那份 library 的位置、呼叫它、
 * 把 violation 印成 gate 讀得懂的形狀。
 *
 * 成因（TD-843，2026-09-02 <consumer-c> 實測）：本檔原本自己重算 `input_digest` 與
 * `through_cursor`，是 library 判定的第二份 matcher。Phase 3.5 把 library 的 inputFacts
 * 加上 `runtime_events`、cursor 加上 `runtime:` 段之後，這一份沒跟上 —— 於是對**每一份
 * 正確的**投影都判 drift，任何 consumer 只要 working tree 有 control-plane 生成的
 * tasks.md，所有 `git commit` 一律被擋。**NEVER 在這裡再寫一次 canonical / sha256 /
 * cursor 的推導**：兩份判定只要能各自演化，就會再漂一次。
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

interface ProjectionViolation {
  path: string
  reason: string
}

const repoRoot = resolve(process.argv[2] ?? process.cwd())
const here = dirname(fileURLToPath(import.meta.url))

// clade 端：本檔住 `vendor/scripts/`，library 是同層 sibling。
// consumer 端：本檔投影到 `scripts/`，library 投影到 `.clade/vendor/scripts/`
// （`scripts/lib/vendor-targets.ts` 的 flow closure 那一組）。
const candidates = [
  join(here, 'ai-control-plane.ts'),
  join(here, '..', '.clade', 'vendor', 'scripts', 'ai-control-plane.ts'),
]
const libraryPath = candidates.find((candidate) => existsSync(candidate))

if (!libraryPath) {
  // **NEVER 靜默 exit 0**：判定器不在，代表這個 repo 的投影根本沒被驗過，
  // 而那與「驗過且乾淨」在 gate 眼中完全同形。
  process.stderr.write('control-plane projection validator cannot resolve its judgement library\n')
  for (const candidate of candidates) process.stderr.write(`  missing: ${candidate}\n`)
  process.exit(2)
}

const library = (await import(pathToFileURL(libraryPath).href)) as {
  validateControlPlaneProjections?: (root: string) => ProjectionViolation[]
}

if (typeof library.validateControlPlaneProjections !== 'function') {
  process.stderr.write(
    `control-plane judgement library does not export validateControlPlaneProjections: ${libraryPath}\n`,
  )
  process.exit(2)
}

const violations = library.validateControlPlaneProjections(repoRoot)

if (violations.length === 0) {
  process.stdout.write('control-plane projections current\n')
  process.exit(0)
}

for (const violation of violations) {
  process.stderr.write(`${violation.path}: ${violation.reason}\n`)
}
process.exit(1)
