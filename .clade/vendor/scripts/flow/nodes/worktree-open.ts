#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/worktree-open.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/worktree-open.ts
// clade flow spine — worktree-open (P1a)
//
// Turns the § 開工判定 table in `clade-home-worktree.md` into a precondition instead of
// something a session remembers to check before writing the first file:
//   - >=2 files expected, or this work will end in publish/propagate  -> MUST use a worktree
//   - a single file and no publish                                    -> NEVER open a worktree
// The "not sure -> default to worktree" guidance in that doc is a human judgment call for the
// ambiguous middle; this node only implements the two ends that ARE mechanically decidable, and
// delegates the actual creation to `wt-helper.ts add` rather than re-deriving worktree setup.

import { spawnSync } from 'node:child_process'

import { defineNode, fatal, nothingToShow, requireArg } from './lib/contract.ts'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const WT_HELPER = resolve(SCRIPT_DIR, '../../wt-helper.ts')

defineNode({
  name: 'worktree-open',
  usage: `usage: worktree-open --slug <name> --files-expected <n> [--will-publish <true|false>] [--repo <path>] [--dry-run]

Precondition: files-expected >= 2 OR will-publish=true -> delegates to wt-helper.ts add.
Otherwise: NEVER opens a worktree, exits 2 (nothing-to-show) with the single-file guidance.
`,
  options: {
    slug: { type: 'string' },
    repo: { type: 'string', default: '.' },
    'files-expected': { type: 'string' },
    'will-publish': { type: 'string', default: 'false' },
    'dry-run': { type: 'boolean', default: false },
  },
  run(args) {
    const slug = requireArg(args, 'slug')
    const repo = requireArg(args, 'repo')
    const filesExpectedRaw = requireArg(args, 'files-expected')
    const filesExpected = Number(filesExpectedRaw)
    if (!Number.isFinite(filesExpected))
      fatal(`--files-expected must be a number, got "${filesExpectedRaw}"`)
    const willPublish = args['will-publish'] === 'true'
    const dryRun = args['dry-run'] === true

    const mustOpen = filesExpected >= 2 || willPublish
    const reason =
      filesExpected >= 2 && willPublish
        ? `files-expected=${filesExpected} (>=2) and will-publish=true`
        : filesExpected >= 2
          ? `files-expected=${filesExpected} (>=2)`
          : willPublish
            ? 'will-publish=true'
            : `files-expected=${filesExpected} (<2) and will-publish=false`

    if (!mustOpen) {
      nothingToShow(
        `single-file and not publishing (${reason}): stay on main, write, then commit --only immediately — NEVER open a worktree for this`,
      )
    }

    if (dryRun) {
      return {
        summary: `[dry-run] would open worktree "${slug}" via wt-helper.ts add (${reason})`,
        data: { slug, created: false, reason },
      }
    }

    const r = spawnSync('node', ['--experimental-strip-types', WT_HELPER, 'add', slug], {
      cwd: repo,
      encoding: 'utf8',
    })
    if (r.error) fatal(`failed to spawn wt-helper.ts: ${r.error.message}`)
    if (r.status !== 0)
      fatal(
        `wt-helper.ts add ${slug} failed (exit ${r.status}): ${r.stderr.trim() || r.stdout.trim()}`,
      )

    // wt-helper.ts prints the created path; recover it rather than re-deriving the naming
    // convention (~/offline/<consumer>-wt/<slug>/) here.
    const pathMatch = r.stdout.match(/(\S*-wt\/\S+)/)
    const branchMatch = r.stdout.match(/session\/\S+/)

    return {
      summary: `opened worktree "${slug}" (${reason})`,
      data: {
        slug,
        created: true,
        path: pathMatch?.[1],
        branch: branchMatch?.[0],
        reason,
      },
    }
  },
})
