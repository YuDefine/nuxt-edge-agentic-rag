#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/commit-only.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/commit-only.ts
// clade flow spine — commit-only (P1a)
//
// `git commit --only -- <paths>` plus the three verify layers from
// `clade-role-and-todo-discipline.md` § Ad-hoc commit hard rule. Those three layers are an
// existing, hand-run discipline (scope / content / line-count); this node makes layers 1 and 2
// postconditions that FATAL the node instead of postconditions a human remembers to check.
// Layer 3 (line count) has no reliable automatic threshold — per the rule doc, it is a number a
// human eyeballs against what they meant to write — so this node surfaces it in `data` rather
// than pass/fail it.
//
// NEVER `git add` / `-A` / `-a` here: the entire point of `--only` is that it commits exactly
// the given pathspec off the *working tree at exec time*, without touching whatever else may be
// staged by a concurrent session (per pitfall-consumer-ad-hoc-commit-eats-other-session-staged).

import { spawnSync } from 'node:child_process'

import { defineNode, fatal, listArg, requireArg } from './lib/contract.ts'

function git(repo: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

defineNode({
  name: 'commit-only',
  usage: `usage: commit-only --message <text> --paths <comma> --needle <text> --needle-path <path> [--repo <path>] [--expect-files <n>]

git commit --only -- <paths>, then three verify layers: scope (file count),
content (--needle must appear in the committed --needle-path), line count (reported only).
`,
  options: {
    repo: { type: 'string', default: '.' },
    message: { type: 'string' },
    paths: { type: 'string' },
    needle: { type: 'string' },
    'needle-path': { type: 'string' },
    'expect-files': { type: 'string' },
  },
  run(args) {
    const repo = requireArg(args, 'repo')
    const message = requireArg(args, 'message')
    const paths = listArg(args, 'paths')
    if (paths.length === 0) fatal('--paths is required')
    const needle = requireArg(args, 'needle')
    const needlePath = requireArg(args, 'needle-path')
    const expectFiles =
      typeof args['expect-files'] === 'string' && args['expect-files'].length > 0
        ? Number(args['expect-files'])
        : paths.length

    const commitResult = git(repo, ['commit', '--only', '-m', message, '--', ...paths])
    if (commitResult.status !== 0) {
      fatal(`git commit --only failed: ${commitResult.stderr.trim() || commitResult.stdout.trim()}`)
    }

    const shaResult = git(repo, ['rev-parse', 'HEAD'])
    if (shaResult.status !== 0) fatal(`git rev-parse HEAD failed: ${shaResult.stderr}`)
    const sha = shaResult.stdout.trim()

    // Layer 1: scope. File count in the commit must match what we asked for.
    const statResult = git(repo, ['show', '--stat', '--format=', 'HEAD'])
    if (statResult.status !== 0) fatal(`git show --stat failed: ${statResult.stderr}`)
    const statLines = statResult.stdout
      .split('\n')
      .filter((l) => l.trim().length > 0 && !l.includes('changed,'))
    const committedFiles = statLines.map((l) => l.split('|')[0].trim())
    if (committedFiles.length !== expectFiles) {
      fatal(
        `scope check failed: commit ${sha} touched ${committedFiles.length} file(s) (${committedFiles.join(', ')}), expected ${expectFiles}`,
      )
    }

    // Layer 2: content. --needle must appear verbatim in the committed version of --needle-path
    // — a zero here means the commit landed someone else's version, not the content this run
    // wrote (per clade-role-and-todo-discipline § Commit 後 verify).
    const contentResult = git(repo, ['show', `HEAD:${needlePath}`])
    if (contentResult.status !== 0)
      fatal(`git show HEAD:${needlePath} failed: ${contentResult.stderr}`)
    if (!contentResult.stdout.includes(needle)) {
      fatal(
        `content check failed: "${needle}" not found in committed ${needlePath} — commit ${sha} landed someone else's version, your content was overwritten`,
      )
    }

    // Layer 3: line count. Reported, not judged — there is no reliable automatic threshold.
    const numstatResult = git(repo, ['show', '--numstat', '--format=', 'HEAD'])
    let insertions = 0
    let deletions = 0
    if (numstatResult.status === 0) {
      for (const line of numstatResult.stdout.split('\n')) {
        const [ins, del] = line.split('\t')
        if (/^\d+$/.test(ins) && /^\d+$/.test(del)) {
          insertions += Number(ins)
          deletions += Number(del)
        }
      }
    }

    return {
      summary: `committed ${sha.slice(0, 12)}: ${committedFiles.length} file(s), +${insertions}/-${deletions}, needle found in ${needlePath}`,
      data: { sha, files: committedFiles, insertions, deletions, needle_found: true },
    }
  },
})
