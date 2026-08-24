#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/worktree-close.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/worktree-close.ts
// clade flow spine — worktree-close (P1a)
//
// Turns the five-column lifecycle gate from `clade-home-worktree.md` § 收工前 worktree
// lifecycle gate into a postcondition: path / branch / dirty / merged_to_main / locked, judged
// into `removable` or `blocked`. This node ONLY observes and judges — it NEVER removes the
// worktree or branch itself. Removal needs explicit authorization; that is not this node's call
// to make (per the source doc: "MUST 當下實跑並在完成訊息列出五欄" is an observation
// requirement, not a delete permission).
//
// Fails closed: any signal we can't establish makes the verdict `blocked`, never `removable`.

import { spawnSync } from 'node:child_process'

import { defineNode, fatal, requireArg } from './lib/contract.ts'

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout.trim(), stderr: r.stderr.trim() }
}

defineNode({
  name: 'worktree-close',
  usage: `usage: worktree-close --slug <name> [--repo <path>]

Observes path / branch / dirty / merged_to_main / locked for a session worktree and judges
closure: 'removable' (dirty=0 AND merged_to_main) or 'blocked' (with listed blockers).
NEVER removes anything itself.
`,
  options: {
    slug: { type: 'string' },
    repo: { type: 'string', default: '.' },
  },
  run(args) {
    const slug = requireArg(args, 'slug')
    const repo = requireArg(args, 'repo')

    const listResult = git(repo, ['worktree', 'list', '--porcelain'])
    if (listResult.status !== 0) fatal(`git worktree list failed: ${listResult.stderr}`)

    const blockers: string[] = []
    const entries = listResult.stdout.split('\n\n')
    const entry = entries.find(
      (e) => e.includes(`-wt/${slug}`) || e.includes(`/${slug}\n`) || e.endsWith(`/${slug}`),
    )
    if (!entry) fatal(`no worktree found matching slug "${slug}" in git worktree list`)

    const pathMatch = entry.match(/^worktree (.+)$/m)
    const branchMatch = entry.match(/^branch refs\/heads\/(.+)$/m)
    const locked = /^locked\b/m.test(entry)
    const path = pathMatch?.[1]
    const branch = branchMatch?.[1]

    if (!path) fatal(`could not parse worktree path for slug "${slug}" from: ${entry}`)
    if (!branch) blockers.push('could not determine branch (detached HEAD?) — fail closed')

    const statusResult = git(path, ['status', '--porcelain'])
    if (statusResult.status !== 0) fatal(`git status failed in ${path}: ${statusResult.stderr}`)
    const dirty =
      statusResult.stdout.length === 0 ? 0 : statusResult.stdout.split('\n').filter(Boolean).length
    if (dirty > 0) blockers.push(`${dirty} uncommitted change(s) in worktree`)

    let mergedToMain = false
    if (branch) {
      const ancestorResult = git(repo, ['merge-base', '--is-ancestor', branch, 'origin/main'])
      if (ancestorResult.status !== 0 && ancestorResult.status !== 1) {
        fatal(`git merge-base --is-ancestor failed: ${ancestorResult.stderr}`)
      }
      mergedToMain = ancestorResult.status === 0
      if (!mergedToMain) blockers.push(`branch ${branch} is not an ancestor of origin/main`)
    }

    if (locked) blockers.push('worktree is locked')

    const closure = blockers.length === 0 ? 'removable' : 'blocked'

    return {
      summary: `worktree "${slug}" at ${path}: dirty=${dirty}, merged_to_main=${mergedToMain}, locked=${locked} -> ${closure}${blockers.length > 0 ? ` (${blockers.join('; ')})` : ''}`,
      data: { path, branch, dirty, merged_to_main: mergedToMain, locked, closure, blockers },
    }
  },
})
