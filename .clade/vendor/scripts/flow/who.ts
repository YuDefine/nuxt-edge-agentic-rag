// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/who.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/who.ts
/**
 * who.ts — `flow who`: 一行一資源，回答「這個 repo 現在的每一份 contended state 屬於誰」
 *
 * ## 這支在替代什麼
 *
 * 2026-08-26 之前這個問題沒有單一答案來源，只有四個各自不可信的反推訊號（herdr pane 掃描
 * 對已 commit 完的工作零訊號、terminal title 繼承上一棒、`agent_status` 只反映 tab 有沒有被
 * 人看過、stash 名稱有殘骸）。三個 session 因此互等約兩小時，其中一個把 01:52 已落地的
 * 12 個檔判成「孤兒、永遠不會 land」並據此通知了兩個 sibling session。
 *
 * `flow who` 把那四個訊號**連同寫入時證據**（`.clade/ownership/journal.jsonl`）join 起來，
 * 每列給一個 verdict 與一個具名 `action` —— action 契約沿用 `stall.ts`：讀的人拿到的是
 * 可以直接跑的下一步，不是一個需要再判一次的狀態字。
 *
 * ## READ-ONLY
 *
 * 本模組不寫任何東西。verdict 是 derived 值，回寫成 store 就是 drift 的起點
 * （同 `serve.ts` 的鐵律）。唯一的寫入面是 provenance hook。
 */

import { execFileSync } from 'node:child_process'
import { readActiveClaims } from '../claim-helper.ts'
import { isWriterAlive, lastWriterByPath, readJournal } from '../ownership-journal.ts'

export type WhoVerdict = 'mine' | 'other-live' | 'orphan' | 'unknown' | 'locked' | 'claimed'

export interface WhoRow {
  kind: 'dirty-path' | 'worktree' | 'stash'
  resource: string
  verdict: WhoVerdict
  session_id: string | null
  pane_id: string | null
  written_at: string | null
  /** What a reader should do about it — same contract stall.ts's `action` column carries. */
  action: string
}

function git(consumerRoot: string, argv: string[]): string {
  try {
    return execFileSync('git', argv, {
      cwd: consumerRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
}

export function dirtyPaths(consumerRoot: string): string[] {
  const out = git(consumerRoot, ['status', '--porcelain', '--untracked-files=all'])
  return (
    out
      .split('\n')
      .filter((l) => l.length > 3)
      // Rename lines are "R  old -> new"; the contended resource is the new path.
      .map((l) => {
        const p = l.slice(3).trim()
        const arrow = p.indexOf(' -> ')
        return arrow === -1 ? p : p.slice(arrow + 4)
      })
      .filter((p) => p.length > 0)
  )
}

/**
 * Build one row per contended resource.
 *
 * `selfSessionId` is the caller's own session, so its own writes read as `mine` rather than
 * as a stranger holding the file. NEVER default it to something the model supplies by hand:
 * the whole point of the journal is that it is evidence the model cannot author.
 */
export function buildWhoRows(
  consumerRoot: string,
  { selfSessionId = null }: { selfSessionId?: string | null } = {},
): WhoRow[] {
  const rows: WhoRow[] = []
  const byPath = lastWriterByPath(readJournal(consumerRoot), { tree: consumerRoot })
  let claims: ReturnType<typeof readActiveClaims>
  try {
    claims = readActiveClaims(consumerRoot)
  } catch {
    claims = []
  }

  for (const path of dirtyPaths(consumerRoot)) {
    const writer = byPath.get(path)
    if (!writer) {
      rows.push({
        kind: 'dirty-path',
        resource: path,
        verdict: 'unknown',
        session_id: null,
        pane_id: null,
        written_at: null,
        // The dangerous direction is unknown → orphan; say so at the point of reading,
        // not in a doc the reader would have to already know to go find.
        action:
          'no write-time evidence (Bash / Codex / hand edit / predates the journal) — NEVER sweep; ask in-flight sessions before touching it',
      })
      continue
    }
    if (selfSessionId && writer.session_id === selfSessionId) {
      rows.push({
        kind: 'dirty-path',
        resource: path,
        verdict: 'mine',
        session_id: writer.session_id,
        pane_id: writer.pane_id,
        written_at: writer.ts,
        action: `yours — land it: git commit --only -- ${path}`,
      })
      continue
    }
    let alive: boolean | null
    try {
      alive = isWriterAlive(writer)
    } catch {
      alive = null
    }
    if (alive === true) {
      rows.push({
        kind: 'dirty-path',
        resource: path,
        verdict: 'other-live',
        session_id: writer.session_id,
        pane_id: writer.pane_id,
        written_at: writer.ts,
        action: writer.pane_id
          ? `held by a live session — talk to it first: herdr agent prompt ${writer.pane_id} "<who I am / what I am blocked on / what I plan / handoff>"`
          : `held by a live session (${writer.session_id}) with no pane — wait or negotiate; NEVER stash or commit on its behalf`,
      })
      continue
    }
    if (alive === false) {
      rows.push({
        kind: 'dirty-path',
        resource: path,
        verdict: 'orphan',
        session_id: writer.session_id,
        pane_id: writer.pane_id,
        written_at: writer.ts,
        action: `writer process is gone (last write ${writer.ts}) — adjudicate: land it yourself with git commit --only -- ${path}, or stash it. NEVER wait on it.`,
      })
      continue
    }
    rows.push({
      kind: 'dirty-path',
      resource: path,
      verdict: 'unknown',
      session_id: writer.session_id,
      pane_id: writer.pane_id,
      written_at: writer.ts,
      action: `writer ${writer.session_id} recorded, liveness not verifiable — treat as held; NEVER sweep`,
    })
  }

  for (const claim of claims) {
    if (!claim.worktree_path) continue
    const mine = selfSessionId !== null && claim.session_id === selfSessionId
    rows.push({
      kind: 'worktree',
      resource: claim.worktree_path,
      verdict: mine ? 'mine' : 'claimed',
      session_id: claim.session_id,
      pane_id: null,
      written_at: claim.last_heartbeat,
      action: mine
        ? `yours — close it out: node vendor/scripts/wt-helper.ts merge-back (per clade-home-worktree § 收工前 worktree lifecycle gate)`
        : `claimed by ${claim.session_id} on ${claim.branch ?? '(no branch)'} — NEVER remove another session's worktree`,
    })
  }

  const stashes = git(consumerRoot, ['stash', 'list']).split('\n').filter(Boolean)
  for (const line of stashes) {
    const ref = line.split(':')[0]
    rows.push({
      kind: 'stash',
      resource: ref,
      verdict: 'unknown',
      session_id: null,
      pane_id: null,
      written_at: null,
      // Stash entries carry no session identity at all — that is exactly why the
      // "30 minutes old means residue" rule had to be written as prose. Retiring that
      // prose rule needs stash provenance, which is TD-664 Phase 3, not this one.
      action: `${line} — stashes carry no session identity; check its ISO timestamp against clade-role-and-todo-discipline § 30 分鐘殘骸`,
    })
  }

  return rows
}

export function renderWho(rows: WhoRow[]): string {
  if (rows.length === 0)
    return 'flow who: nothing contended (clean tree, no worktrees, no stashes)\n'
  const lines: string[] = []
  for (const r of rows) {
    const owner = r.session_id ? ` ${r.session_id}${r.pane_id ? `@${r.pane_id}` : ''}` : ''
    lines.push(`${r.verdict.padEnd(11)} ${r.kind.padEnd(11)} ${r.resource}${owner}`)
    lines.push(`    → ${r.action}`)
  }
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1)
  lines.push('')
  lines.push([...counts].map(([k, v]) => `${k}=${v}`).join('  '))
  return `${lines.join('\n')}\n`
}
