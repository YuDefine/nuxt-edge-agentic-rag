#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/git-provenance.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/git-provenance.ts
// clade flow spine — git-provenance (P1a)
//
// Answers the three provenance questions that recur across `wt-facts.mjs`, `wt-facts2.mjs`,
// `td423-pollution.mjs` and others: did a commit land on main, is one ref an ancestor of
// another, and what changed since a point in time. Those scripts each hand-rolled a
// `spawnSync('git', …)` + string-slice around one of these questions; this node is the same
// three git invocations promoted into one place so the next round doesn't re-derive them.

import { spawnSync } from 'node:child_process'

import { defineNode, fatal, listArg, nothingToShow, requireArg } from './lib/contract.ts'

type Question = 'landed' | 'ancestor' | 'since'
const VALID_QUESTIONS: Question[] = ['landed', 'ancestor', 'since']

function git(repo: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout.trim(), stderr: r.stderr.trim() }
}

defineNode({
  name: 'git-provenance',
  usage: `usage: git-provenance --question <${VALID_QUESTIONS.join('|')}> [--repo <path>] [--commit <sha>] [--of <ref>] [--since <ISO>] [--paths <comma>]

landed:   is --commit an ancestor of origin/main
ancestor: is --commit an ancestor of --of (default origin/main)
since:    what changed since --since, optionally scoped to --paths
`,
  options: {
    repo: { type: 'string', default: '.' },
    question: { type: 'string' },
    commit: { type: 'string' },
    of: { type: 'string', default: 'origin/main' },
    since: { type: 'string' },
    paths: { type: 'string' },
  },
  run(args) {
    const repo = requireArg(args, 'repo')
    const question = requireArg(args, 'question') as Question
    if (!VALID_QUESTIONS.includes(question)) {
      fatal(`--question must be one of: ${VALID_QUESTIONS.join(', ')}`)
    }

    if (question === 'landed') {
      const commit = requireArg(args, 'commit')
      const r = git(repo, ['merge-base', '--is-ancestor', commit, 'origin/main'])
      // merge-base --is-ancestor: exit 0 = true, 1 = false, anything else = git-level FATAL.
      if (r.status !== 0 && r.status !== 1) fatal(`git merge-base failed: ${r.stderr}`)
      const landed = r.status === 0
      return {
        summary: `${commit} ${landed ? 'has' : 'has NOT'} landed on origin/main`,
        data: { question, answer: landed, detail: { commit, of: 'origin/main' } },
      }
    }

    if (question === 'ancestor') {
      const commit = requireArg(args, 'commit')
      const of = typeof args.of === 'string' && args.of.length > 0 ? args.of : 'origin/main'
      const r = git(repo, ['merge-base', '--is-ancestor', commit, of])
      if (r.status !== 0 && r.status !== 1) fatal(`git merge-base failed: ${r.stderr}`)
      const isAncestor = r.status === 0
      return {
        summary: `${commit} ${isAncestor ? 'is' : 'is NOT'} an ancestor of ${of}`,
        data: { question, answer: isAncestor, detail: { commit, of } },
      }
    }

    // question === 'since'
    const since = requireArg(args, 'since')
    const paths = listArg(args, 'paths')
    const logArgs = ['log', `--since=${since}`, '--format=%H %h %cI %s']
    if (paths.length > 0) logArgs.push('--', ...paths)
    const r = git(repo, logArgs)
    if (r.status !== 0) fatal(`git log failed: ${r.stderr}`)
    if (r.stdout.length === 0)
      nothingToShow(
        `no commits since ${since}${paths.length > 0 ? ` touching ${paths.join(', ')}` : ''}`,
      )
    const lines = r.stdout.split('\n')
    return {
      summary: `${lines.length} commit(s) since ${since}${paths.length > 0 ? ` touching ${paths.join(', ')}` : ''}`,
      data: { question, answer: r.stdout, detail: { since, paths, count: lines.length } },
    }
  },
})
