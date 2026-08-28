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
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { readActiveClaims } from '../claim-helper.ts'
import {
  lastWriterByPath,
  liveSessionIds,
  readJournal,
  writerLiveness,
} from '../ownership-journal.ts'

export type WhoVerdict =
  | 'mine'
  | 'other-live'
  | 'orphan'
  | 'unknown'
  | 'locked'
  | 'claimed'
  /** 證據來自 Claude transcript 而非 ownership journal —— 比 journal 弱，但遠強於 unknown。 */
  | 'transcript-evidence'

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

/**
 * Journal 之外的第二證據來源：Claude 自己的 transcript。
 *
 * ## 為什麼需要它
 *
 * ownership journal 的 Bash 分支是**時間窗代理**——它把「某個 Bash 指令執行期間變動的檔」
 * 歸給那個 session，而不是解析指令實際寫了什麼。兩個後果：
 *
 * 1. **漏**：cwd 在別的 repo、用絕對路徑或 `cd` 跨進來寫的 session，那棵樹根本沒被掃，
 *    於是完全不留紀錄 → verdict 是 `unknown`
 * 2. **錯**：commit 密集的 session 窗口很寬，別人在同一窗口內的寫入會掛到它頭上
 *
 * transcript 沒有這兩個問題：它記的是**這個 session 實際下過的 tool call**，
 * 與 cwd 無關、與時間窗無關。代價是它只涵蓋 Claude（Codex / 人手編輯仍為 unknown）。
 *
 * ## NEVER
 *
 * ## 殘餘限制
 *
 * 一條**引用**了寫入指令的訊息（例：在協商訊息裡貼「對方跑了 `cat > X`」）與**執行**它
 * 在 transcript 裡同形。取最早那筆可以壓掉大部分（討論必然晚於寫入），但不是零誤判。
 * 所以 verdict 標的是 `transcript-evidence`，不是 `other-live`。
 *
 * NEVER 拿它的結果去 sweep 或代 commit —— 它證明「誰寫的」，不證明「誰現在還要它」。
 * verdict 名稱刻意叫 `transcript-evidence` 而不是 `other-live`，就是要讀的人看見這個差別。
 */
export interface TranscriptWriter {
  session_id: string
  cwd_hint: string
  ts: string
}

export function whoWroteFromTranscripts(path: string): TranscriptWriter[] {
  const projects = join(homedir(), '.claude', 'projects')
  if (!existsSync(projects)) return []
  const needle = basename(path)
  // 檔名而非全路徑：跨 repo 寫入者用的是絕對路徑，用 repo-relative 去比對必然落空。
  let out = ''
  try {
    out = execFileSync('grep', ['-rl', '--include=*.jsonl', needle, projects], {
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch {
    return [] // grep 無命中時 exit 1，不是錯誤
  }
  // 每個 session 保留它最新的一筆，最後整份依時間新到舊排序。
  // 這支回答的是「這個 dirty 檔現在可能屬於誰」——一個長壽的檔被別人剛改過時，
  // 只回最初作者是主動誤導；而只回一個候選、把其餘藏起來，是同一個錯的另一半。
  const bySession = new Map<string, TranscriptWriter>()
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 寫入目標必須**就是**這個檔：redirect / tee / sed -i 後面接的路徑要以 needle 收尾。
  // NEVER 放寬成「指令裡同時出現檔名與 `cat >`」—— 那會把「在訊息裡引用某條指令」
  // 判成「執行了那條指令」，實測會把調查者自己判成作者。
  const bashWrites = new RegExp(
    String.raw`(?:>>?|\btee\s+(?:-a\s+)?|\bsed\s+-i(?:\s+\S+)?\s+)\s*\S*` + esc,
  )
  for (const file of out.split('\n').filter(Boolean)) {
    let body = ''
    try {
      body = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of body.split('\n')) {
      if (!line.includes(needle)) continue
      let rec: Record<string, unknown>
      try {
        rec = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      const ts = typeof rec.timestamp === 'string' ? rec.timestamp : ''
      if (!ts) continue
      const msg = rec.message as { content?: unknown } | undefined
      const content = Array.isArray(msg?.content) ? msg.content : []
      for (const block of content) {
        const b = block as { type?: string; name?: string; input?: unknown }
        if (b.type !== 'tool_use') continue
        const input = (b.input ?? {}) as { file_path?: unknown; command?: unknown }
        let isWrite = false
        if (b.name === 'Write' || b.name === 'Edit' || b.name === 'NotebookEdit') {
          isWrite = typeof input.file_path === 'string' && input.file_path.endsWith(needle)
        } else if (b.name === 'Bash') {
          const cmd = typeof input.command === 'string' ? input.command : ''
          // 唯一已知的假陽性來源：在協商訊息裡**引用**一條寫入指令，與**執行**它同形。
          // 引用一定發生在送訊息的指令裡，所以排除它就排除掉這一類，而不影響任何真實寫入。
          if (cmd.includes('herdr agent prompt')) continue
          // 三種 Bash 寫入，缺一就漏掉整類作者：
          //   (a) redirect / tee / sed -i —— 目標路徑就在指令裡
          //   (b) 直譯器 heredoc（python3 - <<PY … p='<path>' … open(p, 'w')）——**沒有 redirect**。
          //       bypass permissions 模式下這是最常見的寫法，只掃 (a) 對它完全盲
          //   (c) node -e / writeFileSync 同型
          //
          // (b)/(c) MUST 用**行級**比對：一條複合指令裡「某處有寫入動詞」與「某處提到這個檔名」
          // 是兩件無關的事，把它們當成同一件會把「內容剛好提到該檔名」的指令判成寫入
          // ——實測會讓一個**根本不存在的檔**查出作者，那正是本檔要消滅的假訊號型態。
          const writesSomething =
            /open\([^)]*,\s*['"][wa]/.test(cmd) || cmd.includes('writeFileSync')
          const needleOnWriteLine =
            writesSomething &&
            cmd
              .split('\n')
              .some(
                (l) =>
                  new RegExp(String.raw`open\(\s*['"]\S*` + esc).test(l) ||
                  new RegExp(
                    String.raw`^\s*[\w.\[\]]+\s*=\s*['"]\S*` + esc + String.raw`['"]\s*$`,
                  ).test(l),
              )
          isWrite = bashWrites.test(cmd) || needleOnWriteLine
        }
        if (!isWrite) continue
        const sid = basename(file, '.jsonl')
        const prev = bySession.get(sid)
        if (!prev || ts > prev.ts) {
          bySession.set(sid, { session_id: sid, cwd_hint: basename(dirname(file)), ts })
        }
      }
    }
  }
  // 回**清單**而不是單一答案：這個方法的解析度就到「這幾個 session 碰過它」為止。
  // 硬挑一個當作者，是拿一個看起來精確的數字掩蓋方法本身的不確定——那正是本檔在修的東西。
  return [...bySession.values()].toSorted((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 3)
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
 *
 * `transcriptEvidence` 預設 **false**：transcript 取證是取證動作，不是投影動作。它對每一個
 * journal 查不到作者的 path 掃一次 `~/.claude/projects` 全 corpus（2026-08-28 實測 4.3 GB /
 * 6465 檔）再逐檔回讀命中檔，`flow who` 全程 1:42。而它原本無條件執行，於是被三個非取證的
 * 呼叫端一起付掉：`flow status --stalled`（每個 attended session 開頭都跑）、review-gui 的
 * `/api/flow/spine`（`/board` 的資料源）。後者跑在 Nitro 的單一 event loop 上 —— 那 100 秒
 * 期間整個 GUI 的每一條路由都不回應，`ops/review-gui-service.sh deploy` 的 client render
 * 檢查因此連新舊兩份 release 都判失敗，印出「線上現在是壞的」。
 *
 * **NEVER 在 server / hook 路徑上把它打開。** 只有人明確問「這個檔是誰寫的」時才值得付這個
 * 代價，也就是 `flow who --transcripts`。預設關掉還讓 CLI 的預設輸出與 review-gui 的
 * ownership 投影逐字相同 —— TD-664 Phase 3 的「人看的與 agent 查的是同一份」不因這條而破。
 * 關掉時該列 **NEVER** 假裝沒有證據可查 —— action 字串明寫去哪裡拿，否則「沒查」與
 * 「查過沒有」在畫面上同形。
 */
export function buildWhoRows(
  consumerRoot: string,
  {
    selfSessionId = null,
    liveSessions,
    transcriptEvidence = false,
  }: {
    selfSessionId?: string | null
    liveSessions?: Set<string> | null
    transcriptEvidence?: boolean
  } = {},
): WhoRow[] {
  const rows: WhoRow[] = []
  const byPath = lastWriterByPath(readJournal(consumerRoot), { tree: consumerRoot })
  // One probe for every row — see claim-helper.ts for why this is hoisted.
  let sessions = liveSessions
  if (sessions === undefined) {
    try {
      sessions = liveSessionIds()
    } catch {
      sessions = null
    }
  }
  let claims: ReturnType<typeof readActiveClaims>
  try {
    claims = readActiveClaims(consumerRoot)
  } catch {
    claims = []
  }

  for (const path of dirtyPaths(consumerRoot)) {
    const writer = byPath.get(path)
    if (!writer) {
      // Journal 沒有它 —— 在放棄之前先問 transcript。這一步存在的理由是：
      // 「去問還在跑的 session」這個 action 會產生廣播，而廣播打不到 cwd 在別 repo 的作者
      // （實測兩次），所以它把使用者推向一個結構上答不出來的動作。
      //
      // 只在 `transcriptEvidence` 打開時付這個代價（見函式頂 doc）。
      const cands = transcriptEvidence ? whoWroteFromTranscripts(path) : []
      const top = cands[0] ?? null
      rows.push({
        kind: 'dirty-path',
        resource: path,
        verdict: top ? 'transcript-evidence' : 'unknown',
        session_id: top?.session_id ?? null,
        pane_id: null,
        written_at: null,
        // The dangerous direction is unknown → orphan; say so at the point of reading,
        // not in a doc the reader would have to already know to go find.
        action: top
          ? `transcript candidates (newest first): ${cands.map((c) => `${c.session_id}@${c.cwd_hint}`).join(', ')} — weaker than the journal and NOT proof of ownership; NEVER sweep. Ask them point-to-point, NEVER broadcast`
          : transcriptEvidence
            ? `no write-time evidence (Codex / hand edit / predates the journal) — NEVER sweep. Verify by hand: grep -rl '${basename(path)}' ~/.claude/projects`
            : // 「沒查」與「查過沒有」在畫面上同形，所以這裡逐字說是哪一個。
              `no journal entry — transcript 取證沒跑（這個呼叫端不付全 corpus 掃描的代價）。NEVER sweep. 要候選作者就跑: node vendor/scripts/flow/flow.ts who --transcripts`,
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
    const liveness = writerLiveness(writer, { sessions })
    // A Bash write is attributed by an mtime window, so a concurrent writer inside that window
    // reads as this session. Say so on the row rather than in a doc the reader would have to
    // already know to go find.
    const weak =
      writer.attribution === 'mtime-diff'
        ? ' (attributed by mtime window — a concurrent write in that window can land on the wrong session)'
        : ''
    if (liveness.verdict === 'alive') {
      rows.push({
        kind: 'dirty-path',
        resource: path,
        verdict: 'other-live',
        session_id: writer.session_id,
        pane_id: writer.pane_id,
        written_at: writer.ts,
        action: writer.pane_id
          ? `held by a live session${weak} — talk to it first: herdr agent prompt ${writer.pane_id} "<who I am / what I am blocked on / what I plan / handoff>"`
          : `held by a live session (${writer.session_id}) with no pane — wait or negotiate; NEVER stash or commit on its behalf`,
      })
      continue
    }
    if (liveness.verdict === 'dead') {
      rows.push({
        kind: 'dirty-path',
        resource: path,
        verdict: 'orphan',
        session_id: writer.session_id,
        pane_id: writer.pane_id,
        written_at: writer.ts,
        action: `writer process is gone (last write ${writer.ts})${weak} — adjudicate: land it yourself with git commit --only -- ${path}, or stash it. NEVER wait on it.`,
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
      action: `writer ${writer.session_id} recorded${weak}, ${liveness.why} — treat as held; NEVER sweep`,
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

  // `%ct` is the stash commit's own timestamp — real evidence, unlike the ISO string some
  // stash *names* happen to carry. A name is written by whoever made the stash and can be
  // absent, stale, or copied; the commit time cannot.
  const stashes = git(consumerRoot, ['stash', 'list', '--format=%gd|%ct|%gs'])
    .split('\n')
    .filter(Boolean)
  for (const line of stashes) {
    const [ref, epoch, ...rest] = line.split('|')
    const seconds = Number(epoch)
    const at = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null
    rows.push({
      kind: 'stash',
      resource: ref,
      verdict: 'unknown',
      session_id: null,
      pane_id: null,
      written_at: at,
      // Stash entries carry no session identity at all — that is exactly why the
      // "30 minutes old means residue" rule had to be written as prose. Retiring that
      // prose rule needs stash provenance, which is TD-664 Phase 3, not this one.
      action: `${rest.join('|')} — stashes carry no session identity; ${at ? `created ${at}` : 'creation time unreadable'}, judge against clade-role-and-todo-discipline § 30 分鐘殘骸`,
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
