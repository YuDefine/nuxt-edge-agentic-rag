#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/cmd.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/cmd.ts
// clade flow spine — cmd (P3)
//
// Runs one project command and records it as a span. Every other node in the library wraps a
// *clade* discipline; this one is the door for a consumer's own dev task — `pnpm gen:types`,
// `supabase db push`, `pnpm test`. Without it a spec cannot express anything a consumer actually
// does, because `run.ts` steps take nodes and nothing else. It is the node counterpart of the
// CLI's `flow step <label> -- <cmd>`, which specs have no way to reach.
//
// `--each <glob>` runs the command once per matching file, with `{}` replaced by the path. That
// is the mechanical answer to the literal-compliance failure the rules keep having to spell out
// ("**every** migration file, not just the last one"): the fan-out is a property of the node, so
// there is nothing left for a reader to under-apply. Fan-out lives here and NEVER in the engine —
// the engine stays serial / parallel / retry / on-fail with no expressions.
//
// Matching is `git ls-files` over tracked **and** untracked-not-ignored paths: a migration written
// two minutes ago is not committed yet, and a glob that skipped it would fan out over exactly the
// wrong set.
//
// The glob is a **git pathspec**, so `*` crosses directory separators: `db/*.sql` also matches
// `db/archive/old.sql`. Write `--each` patterns that survive that (anchor the directory, or accept
// the descendants deliberately) — it is git's semantics, not something this node can narrow
// without inventing a second glob dialect.

import { execFileSync, spawnSync } from 'node:child_process'

import { defineNode, fatal, nothingToShow, requireArg } from './lib/contract.ts'

function matchFiles(glob: string, repo: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', glob],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return [
      ...new Set(
        out
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    ].toSorted()
  } catch (err) {
    fatal(`git ls-files failed for glob ${glob}: ${(err as Error).message}`)
  }
}

function runOnce(command: string, repo: string) {
  const start = Date.now()
  const r = spawnSync(command, { cwd: repo, shell: true, encoding: 'utf8' })
  const duration_ms = Date.now() - start
  if (r.error) fatal(`failed to spawn: ${r.error.message}`)
  return { exit_code: r.status ?? 1, duration_ms, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function tail(text: string, lines = 20) {
  return text.trim().split('\n').slice(-lines).join('\n')
}

defineNode({
  name: 'cmd',
  usage: `usage: cmd --run "<command>" [--each <glob>] [--repo <path>] [--label <name>]

Runs a project command and records it on the spine.

  --run    the command, executed through the shell in --repo (default: cwd)
  --each   run it once per file matching this glob, substituting {} for the path
  --label  display name (defaults to the command)

Exit: 0 all runs passed, 1 the first failing run (stdout/stderr tail included),
      2 --each matched nothing (a fan-out over zero files is not a failure).
`,
  options: {
    run: { type: 'string' },
    each: { type: 'string' },
    repo: { type: 'string', default: '.' },
    label: { type: 'string' },
  },
  run(args) {
    const command = requireArg(args, 'run')
    const repo = typeof args.repo === 'string' && args.repo.length > 0 ? args.repo : '.'
    const label = typeof args.label === 'string' && args.label.length > 0 ? args.label : command
    const glob = typeof args.each === 'string' && args.each.length > 0 ? args.each : null

    if (!glob) {
      const r = runOnce(command, repo)
      if (r.exit_code !== 0) {
        fatal(
          `${label} failed (exit ${r.exit_code}) in ${r.duration_ms}ms:\n${tail(r.stderr) || tail(r.stdout)}`,
        )
      }
      return {
        summary: `${label} passed in ${r.duration_ms}ms`,
        data: { label, command, exit_code: 0, duration_ms: r.duration_ms, runs: 1 },
      }
    }

    const files = matchFiles(glob, repo)
    if (files.length === 0) nothingToShow(`--each ${glob} matched no files`)

    const runs = []
    let total = 0
    for (const file of files) {
      const expanded = command.split('{}').join(file)
      const r = runOnce(expanded, repo)
      total += r.duration_ms
      runs.push({ file, exit_code: r.exit_code, duration_ms: r.duration_ms })
      if (r.exit_code !== 0) {
        fatal(
          `${label} failed on ${file} (exit ${r.exit_code}), ${runs.length}/${files.length} done:\n` +
            `${tail(r.stderr) || tail(r.stdout)}`,
        )
      }
    }

    return {
      summary: `${label} passed on ${files.length} file(s) in ${total}ms`,
      data: { label, command, each: glob, runs, files: files.length, duration_ms: total },
    }
  },
})
