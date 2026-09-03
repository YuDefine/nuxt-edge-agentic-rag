// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/spine.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/spine.ts
// clade flow spine — the one projection every view reads (P2)
//
// P0-min put this fold inside `flow.ts` because there was exactly one view. P2 adds four more
// (`serve`, `status --stalled`, `viz --md`, `viz --fleet`), and a second copy of "how events
// become spans" would be a second data model: two views could then disagree about whether the
// same work item is in flight, and neither would be wrong about its own copy.
//
// Everything here is derived. There is NEVER a stored span, a cache, or a second file — the
// events stream is the only state, and every function below is a pure function of it.

import { artifactsOf, dedupeArtifacts, type SpanArtifact } from './nodes/lib/artifacts.ts'

export interface FlowEvent {
  /** Null for `session_summary` only — a session is not a work item. See `foldSpans`. */
  work_id: string | null
  span_id: string
  parent_span?: string | null
  phase: 'start' | 'end' | 'point'
  kind: string
  actor: string
  substrate: string
  ts_utc: string
  session_id?: string
  payload?: Record<string, unknown>
  outcome?: string | null
}

export interface Span {
  span_id: string
  work_id: string
  parent_span: string | null
  kind: string
  actor: string
  substrate: string
  start_ts: string | null
  end_ts: string | null
  outcome: string | null
  duration_ms: number | null
  /**
   * True when the span was built from a `phase: 'point'` event — an instant, not an interval.
   * Views render these as markers: a zero-width bar reads as a suspiciously fast span, and
   * `work.open` would otherwise look like a piece of work that took 0ms.
   */
  is_point: boolean
  payload: Record<string, unknown>
}

/**
 * Six states, in the priority the fold applies them: a human verdict outranks an agent's claim,
 * which outranks anything still moving.
 *
 * `settled` is deliberately kept and is deliberately NOT a synonym for `done`. It means "no span is
 * running and nobody claimed completion" — the ambiguous state that the four questions this layer
 * exists to answer (progress / blocked / finished / accepted) keep landing on. Collapsing it into
 * `done` would answer "is it finished?" with "nothing is running", which is the wrong answer given
 * confidently.
 */
export type WorkState = 'in-flight' | 'failed' | 'settled' | 'done' | 'accepted' | 'dropped'

export interface WorkItem {
  work_id: string
  spans: number
  in_flight: number
  /**
   * 尚未 end 的 `session_transport` span 數 —— 亦即「派出去的 pane 還沒回報」。
   *
   * 與 `in_flight` 分開數，因為兩者回答的不是同一個問題。`in_flight` 對**任何**沒 end 的 span
   * 計數，包含一個沒人答的 `decision.request`；用它當「dispatch 還沒回來」的閘門，會讓一件工作
   * 因為底下掛著一題沒人回的拍板題而**永久**從驗收列消失（2026-09-03 實測：
   * `W-2026-09-02-tech-debt-td-474-811-849` 的唯一 open span 是 TD-474 那題）。
   */
  transport_in_flight: number
  failed: number
  first_ts: string
  last_ts: string
  state: WorkState
  /** Slug from the `work.open` point event, when the work item was opened through `flow open`. */
  slug: string | null
  /**
   * Where this work item was born, as `<scheme>:<id>` — the join key back to the prose world
   * (a Notion page, a TD entry, a `tasks/` file). Null for anything opened without one, which
   * includes every work item minted before origins existed: absent is not a defect here.
   */
  origin_ref: string | null
  /** Scheme half of `origin_ref`, split once at the fold so no reader has to re-parse it. */
  origin_kind: string | null
  /** One human line naming the problem. Views prefer it over the slug when both are present. */
  title: string | null
  /** When completion was claimed, and with what evidence — the row a human accepts or rejects. */
  done_ts: string | null
  verification: string | null
  verified_by: string | null
  /**
   * When the last `work.reopened` withdrew a claim of completion, or null if none ever did.
   *
   * A row can carry BOTH this and `done_ts` / `terminal_ts`: those record that the claim was made,
   * this records that it was taken back. Which one holds is `state`'s job, decided by order in the
   * stream rather than by comparing these two timestamps — see `buildWorkItems`.
   */
  reopened_ts: string | null
  /** The human verdict, once given. Terminal: nothing after it changes the state. */
  terminal: 'accepted' | 'dropped' | null
  terminal_ts: string | null
  terminal_reason: string | null
  /** Prose carrier this work stopped at (`/handoff park`), when it did. Not a state — a pointer. */
  parked_at: string | null
  /**
   * The work item this one belongs under, from `work.link`. Null means no parent was ever
   * registered, OR that one was and it was detached — the two are the same fact about the
   * present, and the stream keeps the difference for anyone who needs the history.
   *
   * LAST-WRITE-WINS, unlike `origin_ref`'s first-origin-wins: a work item is born once, but where
   * it belongs is a judgement that gets revised. The id is kept RAW — a parent living in another
   * repo's spine is normal on a 12-repo fleet, so an unresolvable parent is a fact to render, not
   * a defect to null out. `rootWorkItems` treats it as a root; a view MUST say that it did.
   */
  parent_work_id: string | null
  /**
   * Everything this work item's spans recorded leaving behind, deduped, in span order.
   *
   * AGGREGATED, never written: the same `artifactsOf` the dossier has always used, applied one
   * level up. A `work.artifact` kind was considered and rejected — a work item's output is the
   * union of what its spans produced, and a second place to record it is a second thing to keep in
   * sync. Hand-registered output (a PR opened from another machine, a cross-repo landing) rides on
   * `work.done`'s payload, because the moment somebody registers output by hand IS the moment they
   * claim to be finished.
   */
  artifacts: SpanArtifact[]
  /**
   * Why a `work.done` was allowed to stand with no artifact at all, from `payload.artifact_waiver`.
   *
   * The waived case and the "nobody has taught this path to record artifacts yet" case are the same
   * empty list, and only this field separates them. A reader MUST be able to tell "there is nothing
   * to show and here is why" from "there is nothing to show" — the second is what makes a board
   * unreadable.
   */
  artifact_waiver: string | null
  /**
   * 最後一次 `work.done` 登記的 `commit` artifact 在本機驗不出「已經 push 到 origin」。
   *
   * 由 `flow done` 當下量（`git cat-file -e` ＋ `git branch -r --contains`），量不到就標記——
   * **NEVER** 擋下 `work.done` 本身：telemetry 的硬契約是它 NEVER 改變被觀測工作的 outcome，
   * 而一個「憑證還沒推上去」的完成宣稱仍然是一個真的完成宣稱。
   *
   * 讀者只有兩個，而且都不是把它當錯誤看：驗收佇列據此不排那一列（沒有東西可驗），
   * `stall.ts` 的 `done-unverified` 在它躺過 24 小時之後出聲。
   */
  unverified_artifact: boolean
  /**
   * The DECLARED delivery estimate (`work.eta`), last write wins. Null when nobody declared one —
   * the derived fallback is computed by whoever renders, and NEVER stored here: a percentile over
   * comparable work is stale the moment the next work item finishes, and a stale number that looks
   * like a promise is worse than no number.
   */
  eta_target: string | null
  eta_basis: 'human' | 'agent-estimate' | null
  eta_declared_ts: string | null
  eta_note: string | null
}

/**
 * Fold start/end pairs into spans. An unmatched start stays visible as in-flight: that is a
 * reportable state (the pane died, the dispatch never came back), not a defect to be tidied away.
 */
export function foldSpans(events: FlowEvent[]): Span[] {
  const spans = new Map<string, Span>()
  for (const e of events) {
    // A work-id-less event is a fact about a SESSION (`session_summary`), not about a work item.
    // Dropping it here rather than filtering downstream is what keeps it out of every projection at
    // once: it never becomes a card, never lands in the orphan numerator, never crosses the board
    // threshold. Readers that want it — the governance join — read the raw stream and join on
    // `session_id`, which is the only correct attribution anyway.
    if (!e.work_id) continue
    const cur: Span = spans.get(e.span_id) ?? {
      span_id: e.span_id,
      work_id: e.work_id,
      parent_span: e.parent_span ?? null,
      kind: e.kind,
      actor: e.actor,
      substrate: e.substrate,
      start_ts: null,
      end_ts: null,
      outcome: null,
      duration_ms: null,
      is_point: false,
      payload: {},
    }
    cur.payload = { ...cur.payload, ...e.payload }
    if (e.phase === 'start') cur.start_ts = e.ts_utc
    else if (e.phase === 'end') {
      cur.end_ts = e.ts_utc
      cur.outcome = e.outcome ?? null
      cur.duration_ms = (e.payload?.duration_ms as number) ?? null
    } else {
      cur.is_point = true
      cur.start_ts = cur.start_ts ?? e.ts_utc
      cur.end_ts = cur.end_ts ?? e.ts_utc
      cur.outcome = e.outcome ?? null
      cur.duration_ms = cur.duration_ms ?? 0
    }
    spans.set(e.span_id, cur)
  }
  return [...spans.values()].toSorted((a, b) =>
    String(a.start_ts).localeCompare(String(b.start_ts)),
  )
}

export function latestWorkId(events: FlowEvent[]): string | null {
  return events.length > 0 ? events[events.length - 1].work_id : null
}

/**
 * Depth by `parent_span`, so a herdr pane under a pi dispatch reads as nested rather than as a
 * peer. Cycle-guarded: the id is generated, but a malformed line on the stream must not hang a view.
 */
export function spanDepth(span: Span, byId: Map<string, Span>, seen = new Set<string>()): number {
  if (!span.parent_span || seen.has(span.span_id)) return 0
  const parent = byId.get(span.parent_span)
  if (!parent) return 0
  seen.add(span.span_id)
  return 1 + spanDepth(parent, byId, seen)
}

export function indexById(spans: Span[]): Map<string, Span> {
  return new Map(spans.map((s) => [s.span_id, s]))
}

/** Children of one span, in start order. The DAG the views draw is exactly this relation. */
export function childrenOf(spans: Span[], spanId: string): Span[] {
  return spans.filter((s) => s.parent_span === spanId)
}

/** Spans with no parent present in the same set — the roots each view starts drawing from. */
export function rootsOf(spans: Span[]): Span[] {
  const ids = new Set(spans.map((s) => s.span_id))
  return spans.filter((s) => !s.parent_span || !ids.has(s.parent_span))
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** One row per work item. `state` is derived, never stored: the stream is the only authority. */
export function buildWorkItems(spans: Span[]): WorkItem[] {
  const byWork = new Map<string, WorkItem>()
  // Latest real (non-point) span start per work item. A `done` claim is invalidated by work that
  // starts AFTER it — that is how "sent back for rework" is expressed, with no reopen event to
  // forget to emit. Points are excluded on purpose: a park note or a second verdict is not rework.
  const lastRealStart = new Map<string, string>()
  /** When each work item's parentage was last set — the tiebreak for last-write-wins re-parenting. */
  const lastLinkTs = new Map<string, string>()
  /** Same tiebreak for the delivery estimate, and a local map for the same reason. */
  const lastEtaTs = new Map<string, string>()
  /**
   * Which came last on each work item: the claim of completion, or the reopen that withdrew it.
   *
   * ORDER in the stream, not a timestamp comparison, and for the reason the control plane's own
   * admission gate documents: a reopen and the `work.done` it withdraws legitimately land in the
   * same millisecond, and two readers disagreeing about that instant is how a work item ends up
   * with no consistent state at all. Tracked separately for the `work.done` claim and for the
   * human verdict, because a reopen after `work.accept` withdraws a different claim than a reopen
   * after `work.done` and only the matching one should fall.
   */
  const lastDoneClaim = new Map<string, 'done' | 'reopened'>()
  const lastTerminalClaim = new Map<string, 'terminal' | 'reopened'>()
  for (const s of spans) {
    if (s.is_point || !s.start_ts) continue
    if ((lastRealStart.get(s.work_id) ?? '') < s.start_ts) lastRealStart.set(s.work_id, s.start_ts)
  }

  for (const s of spans) {
    const cur: WorkItem = byWork.get(s.work_id) ?? {
      work_id: s.work_id,
      spans: 0,
      in_flight: 0,
      transport_in_flight: 0,
      failed: 0,
      first_ts: s.start_ts ?? '',
      last_ts: '',
      state: 'settled',
      slug: null,
      origin_ref: null,
      origin_kind: null,
      title: null,
      done_ts: null,
      verification: null,
      verified_by: null,
      reopened_ts: null,
      terminal: null,
      terminal_ts: null,
      terminal_reason: null,
      parked_at: null,
      parent_work_id: null,
      artifacts: [],
      artifact_waiver: null,
      unverified_artifact: false,
      eta_target: null,
      eta_basis: null,
      eta_declared_ts: null,
      eta_note: null,
    }
    cur.spans += 1
    if (!s.end_ts) cur.in_flight += 1
    if (!s.end_ts && !s.is_point && s.kind === 'session_transport') cur.transport_in_flight += 1
    if (s.outcome === 'fail') cur.failed += 1
    if (s.kind === 'work.open') {
      if (typeof s.payload?.slug === 'string') cur.slug = s.payload.slug
      // First origin wins. A work item is born once; a later `work.open` on the same id is a
      // collision or a replay, and letting it rewrite the origin would silently re-parent the
      // history of everything already folded under it.
      if (cur.origin_ref === null && typeof s.payload?.origin_ref === 'string') {
        cur.origin_ref = s.payload.origin_ref
        cur.origin_kind =
          typeof s.payload?.origin_kind === 'string'
            ? s.payload.origin_kind
            : (s.payload.origin_ref.split(':')[0] ?? null)
      }
      if (cur.title === null && typeof s.payload?.title === 'string') cur.title = s.payload.title
    }
    const at = s.start_ts ?? ''
    // Last write wins on each of these: re-doing a work item after rework, or a human overriding
    // their own earlier verdict, both read naturally as "the most recent one is the one that holds".
    if (s.kind === 'work.reopened') {
      cur.reopened_ts = at
      lastDoneClaim.set(s.work_id, 'reopened')
      lastTerminalClaim.set(s.work_id, 'reopened')
    }
    if (s.kind === 'work.done') lastDoneClaim.set(s.work_id, 'done')
    if (s.kind === 'work.accept' || s.kind === 'work.drop')
      lastTerminalClaim.set(s.work_id, 'terminal')
    if (s.kind === 'work.done' && at >= (cur.done_ts ?? '')) {
      cur.done_ts = at
      cur.verification = str(s.payload?.verification)
      cur.verified_by = str(s.payload?.verified_by)
      // Read off the LATEST claim only. A waiver explains one claim of completion; carrying an old
      // one forward would let a superseded excuse stand in for output the current claim never had.
      cur.artifact_waiver = str(s.payload?.artifact_waiver)
      // 同一個 last-write-wins：一次新的完成宣稱帶著自己的憑證狀態，把舊的那次帶過來會讓
      // 「上次推不上去、這次推上去了」讀成仍然推不上去。
      cur.unverified_artifact = s.payload?.unverified_artifact === true
    }
    // Every span, not just the terminal ones: output is produced by the work, and the claim that
    // the work is finished is a different event from the work that produced anything.
    cur.artifacts.push(...artifactsOf([s]))
    // LAST-WRITE-WINS, exactly like `work.link`: an estimate is a judgement that gets revised, and
    // the revision is the one that holds. `target_ts` with no `basis` is refused at the emitter,
    // so a row here either has both or has neither.
    if (s.kind === 'work.eta' && at >= (lastEtaTs.get(s.work_id) ?? '')) {
      const target = str(s.payload?.target_ts)
      const basis = str(s.payload?.basis)
      if (target && (basis === 'human' || basis === 'agent-estimate')) {
        lastEtaTs.set(s.work_id, at)
        cur.eta_target = target
        cur.eta_basis = basis
        cur.eta_declared_ts = at
        cur.eta_note = str(s.payload?.note)
      }
    }
    if ((s.kind === 'work.accept' || s.kind === 'work.drop') && at >= (cur.terminal_ts ?? '')) {
      cur.terminal = s.kind === 'work.accept' ? 'accepted' : 'dropped'
      cur.terminal_ts = at
      cur.terminal_reason = str(s.payload?.reason)
    }
    if (s.kind === 'work.park' && typeof s.payload?.carrier === 'string') {
      cur.parked_at = s.payload.carrier
    }
    // Last write wins. `lastLinkTs` is a local map rather than a row field on purpose: a reader
    // wants the parent, never the timestamp at which someone decided it, and a field nothing
    // renders is a field that drifts. Same reason `lastRealStart` above is not on the row.
    if (s.kind === 'work.link' && Object.hasOwn(s.payload ?? {}, 'parent_work_id')) {
      if (at >= (lastLinkTs.get(s.work_id) ?? '')) {
        lastLinkTs.set(s.work_id, at)
        cur.parent_work_id = str(s.payload.parent_work_id)
      }
    }
    // `work.link` is the ONE kind that does not touch the clock. Every other event on a work item
    // records that something HAPPENED to it; a link records where it BELONGS, which is a statement
    // about the board's shape and not about the work. Counting it as activity means one afternoon
    // of filing 32 cards under their initiatives resets `最後活動` to "just now" on all 32 — and
    // `age_minutes` is what the board sorts by and what every stall reads. Measured 2026-08-29:
    // that is exactly what the first real run did, wiping the fleet's age information with a
    // metadata operation.
    //
    // `work.eta` is excluded on the same grounds and only those grounds: it states when the work is
    // EXPECTED to land, which is a statement about the future rather than a thing that happened to
    // the work. An afternoon spent filing estimates across the board would otherwise reset 「最後
    // 活動」on every card it touched — the identical wipe measured for `work.link` above.
    //
    // NEVER widen this to the other point kinds. `work.park` records that the work stopped
    // somewhere, `work.done` that someone claimed it finished — those are things that happened.
    if (s.kind !== 'work.link' && s.kind !== 'work.eta') {
      const ts = s.end_ts ?? s.start_ts ?? ''
      if (ts > cur.last_ts) cur.last_ts = ts
      if (s.start_ts && (!cur.first_ts || s.start_ts < cur.first_ts)) cur.first_ts = s.start_ts
    }
    byWork.set(s.work_id, cur)
  }
  for (const item of byWork.values()) {
    // Deduped once here rather than on every push: the same commit legitimately lands on a retry
    // span and on the `work.done` that registered it by hand, and a card listing one coordinate
    // twice reads as two deliveries.
    item.artifacts = dedupeArtifacts(item.artifacts)
    // A claim of completion that real work outlived is no longer a claim about the current state.
    // `done_ts` and `verification` stay on the row regardless: they record that the claim WAS made,
    // which is exactly what a reviewer needs to see when asking why the work came back.
    const claimStands =
      item.done_ts !== null &&
      (lastRealStart.get(item.work_id) ?? '') <= item.done_ts &&
      lastDoneClaim.get(item.work_id) !== 'reopened'
    // A verdict a reopen came after is no longer the verdict on the current state either. It stays
    // on the row (`terminal`, `terminal_ts`, `terminal_reason`) for the same reason `done_ts` does:
    // a reviewer asking why the work came back needs to see what was accepted.
    const verdictStands =
      item.terminal !== null && lastTerminalClaim.get(item.work_id) !== 'reopened'
    item.state = verdictStands
      ? item.terminal
      : claimStands
        ? 'done'
        : item.in_flight > 0
          ? 'in-flight'
          : item.failed > 0
            ? 'failed'
            : 'settled'
  }
  return [...byWork.values()].toSorted((a, b) => a.last_ts.localeCompare(b.last_ts))
}

export function indexWorkItems(items: WorkItem[]): Map<string, WorkItem> {
  return new Map(items.map((w) => [w.work_id, w]))
}

/**
 * What a work item's `parent_work_id` actually resolves to, in the set being rendered.
 *
 * Four outcomes rather than a boolean, because three of them look identical on a page that only
 * asks "does it have a parent I can draw":
 *
 * - `none`      — nothing was ever registered, or it was detached. Genuinely a root.
 * - `resolved`  — the parent is right here. The only case that nests.
 * - `dangling`  — a parent id we do not hold. NORMAL on a 12-repo fleet where each repo keeps its
 *                 own spine, and also exactly what a typo looks like. Drawn as a root, but a view
 *                 MUST say so: a silent root makes a typo permanently invisible, since nothing
 *                 local will ever resolve it and no later signal mentions it again.
 * - `cycle`     — the chain returns to where it started. Reachable through ordinary use, not just
 *                 malformed data: re-parenting is last-write-wins, so A→B followed by B→A is two
 *                 legal writes. NEVER silently break it by electing one member the root — the
 *                 members must be visible as members, or nobody will ever fix it.
 */
export type WorkParentState = 'none' | 'resolved' | 'dangling' | 'cycle'

export function workParentState(item: WorkItem, byId: Map<string, WorkItem>): WorkParentState {
  if (!item.parent_work_id) return 'none'
  const seen = new Set<string>([item.work_id])
  let cur = byId.get(item.parent_work_id)
  if (!cur) return 'dangling'
  while (cur) {
    if (seen.has(cur.work_id)) return 'cycle'
    seen.add(cur.work_id)
    if (!cur.parent_work_id) return 'resolved'
    const next = byId.get(cur.parent_work_id)
    if (!next) return 'resolved'
    cur = next
  }
  return 'resolved'
}

/**
 * Depth by `parent_work_id`. An unresolvable or CYCLIC parent is depth 0 — the same 0 that says
 * "root", because `workParentState` is what tells a renderer which kind of root it is looking at.
 *
 * This is deliberately stricter than `spanDepth`, whose `seen` guard only stops the recursion and
 * still returns whatever it counted on the way in. Two spans cannot legally point at each other;
 * two WORK ITEMS can, because re-parenting is last-write-wins and A→B followed by B→A is two valid
 * writes. Counting a depth for that would indent a card under a parent that is in fact its child —
 * a hierarchy drawn confidently upside down, which is worse than one that declines to nest.
 */
export function workDepth(item: WorkItem, byId: Map<string, WorkItem>): number {
  const seen = new Set<string>([item.work_id])
  let depth = 0
  let cur = item
  while (cur.parent_work_id) {
    const parent = byId.get(cur.parent_work_id)
    if (!parent) return depth
    if (seen.has(parent.work_id)) return 0
    seen.add(parent.work_id)
    depth += 1
    cur = parent
  }
  return depth
}

/** Work items with no drawable parent in the same set — where a hierarchy view starts drawing. */
export function rootWorkItems(items: WorkItem[]): WorkItem[] {
  const byId = indexWorkItems(items)
  return items.filter((w) => workParentState(w, byId) !== 'resolved')
}

/** Exactly what `resolveWorkId` mints with no ambient id: `W-<date>-orphan-<6 hex>`. */
const ORPHAN_WORK_ID = /^W-\d{4}-\d{2}-\d{2}-orphan-[0-9a-f]{6}$/

/** True only for a minted orphan id. A named work whose slug contains the word is not one. */
export function isOrphanWorkId(workId: string | null | undefined): boolean {
  return ORPHAN_WORK_ID.test(String(workId ?? ''))
}

/**
 * How much of the recent stream cannot say which work item it belongs to.
 *
 * The `orphan-` prefix exists so an unattributed span stays countable instead of invisible, and
 * this is the thing that counts it. Only RECENT events are measured: the backlog is not
 * retroactively fixable, and folding it in would keep the ratio pinned high long after the
 * entry points were fixed — a number that cannot move is a number nobody acts on.
 *
 * Deliberately a ratio and not a count: the fleet emits more events every week, so a count
 * crosses any fixed threshold eventually through growth alone.
 *
 * Recent events are NOT the same as recently minted work ids, and only the second one answers
 * the question this signal is asked (TD-684, measured 2026-08-27). `workIdFromLabel` is
 * ambient-first by design, so a pane holding an orphan id passes that same id to every pane it
 * dispatches: one work id minted at 01:38 rode four dispatches under four different labels to
 * 07:30. A bloodline like that does not heal — it ends when those pre-fix panes retire — so
 * folding it into the warned number reproduces exactly the pinned-high ratio the window was
 * added to avoid. `minted` counts only events whose work id was first seen INSIDE the window;
 * that is the one that moves when an entry point regresses, and it is the one thresholded.
 *
 * The predicate is anchored (`isOrphanWorkId`), not a substring: a named work whose label
 * happens to contain the word — `W-2026-08-27-td-684-orphan-work-id`, the work item that
 * investigated this very signal — matched `includes('orphan-')` and was counted against itself.
 */
export interface OrphanRatio {
  window_days: number
  total: number
  orphan: number
  /** Orphan events whose work id was first seen inside the window — the entry-point signal. */
  minted: number
  /** Orphan events inheriting a work id minted before the window — pre-existing bloodlines. */
  inherited: number
  ratio: number
  over_threshold: boolean
  threshold: number
  /** Minted orphans bucketed by the entry point that minted them, biggest first. */
  by_entry: OrphanEntry[]
}

/**
 * One minting entry point's share of the window.
 *
 * The warning's whole ask is "which entry point regressed", and the answer is derivable from the
 * stream the warning already reads: an orphan id is minted by whatever emitted its FIRST event,
 * and every later event under that id is a descendant of that one mint. Leaving it out made every
 * reader re-derive it by hand — measured 2026-08-28, that is a `python3` pass over the JSONL and
 * about twenty minutes, per reader, for a fact the counter had in front of it.
 *
 * `newest_mint` is what separates "this entry is regressing right now" from "this entry was fixed
 * and its pre-fix mints have not aged out of the window yet". Without it the two are the same
 * number: the window is 7 days, so a fix lands with a week of its own backlog still inside.
 */
export interface OrphanEntry {
  /** `<kind>|<actor>|<substrate>` of the first event under each id this entry minted. */
  entry: string
  /** Distinct orphan work ids minted here inside the window. */
  ids: number
  /** Events carried by those ids inside the window — the bloodline, not just the mint. */
  events: number
  /** `ts_utc` of the most recent mint here. */
  newest_mint: string
  /**
   * Distinct ids this entry minted in the last `RECENT_MINT_HOURS`, out of `ids`.
   *
   * `newest_mint` alone cannot separate "regressing now" from "fixed, backlog still in window"
   * whenever the fix landed INSIDE the window — and a 7-day window means a fix always does, for
   * its first week. Measured 2026-08-28: `workIdFromLabel` was fixed 2026-08-27T04:04Z, and the
   * bucket still read 359 events / 49 ids with `newest_mint` 19.5h ago, which reads as active
   * degradation. 48 of those 49 mints predate the fix; `ids_recent` was 0.
   *
   * A rate, not a date, and it needs no knowledge of when anything was fixed: an entry that is
   * still regressing keeps minting, a fixed one stops. NEVER "fix" a stuck ratio by raising the
   * threshold or muting a bucket — that hides the entries that ARE regressing, which is the only
   * thing this signal exists to show.
   */
  ids_recent: number
  /** Hours `ids_recent` looks back — reported so a reader never has to guess the denominator. */
  recent_hours: number
}

/** The "is it still happening" window. Short on purpose: it answers rate, not history. */
const RECENT_MINT_HOURS = 24

export function orphanRatio(
  events: FlowEvent[],
  {
    days = 7,
    threshold = 0.25,
    now = new Date(),
  }: { days?: number; threshold?: number; now?: Date } = {},
): OrphanRatio {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
  // First sighting is taken over the WHOLE stream, not the window: an id first seen at the
  // window's edge is only distinguishable from a pre-fix bloodline by what came before it.
  const firstSeen = new Map<string, string>()
  for (const e of events) {
    if (!e.work_id || !e.ts_utc) continue
    const prev = firstSeen.get(e.work_id)
    if (prev === undefined || e.ts_utc < prev) firstSeen.set(e.work_id, e.ts_utc)
  }
  // The event that OPENED each id — the mint site. Taken over the whole stream for the same
  // reason `firstSeen` is: an id whose first event predates the window was not minted here.
  const mintEvent = new Map<string, FlowEvent>()
  for (const e of events) {
    if (!e.work_id || !e.ts_utc) continue
    const held = mintEvent.get(e.work_id)
    if (held === undefined || e.ts_utc < held.ts_utc) mintEvent.set(e.work_id, e)
  }
  let total = 0
  let minted = 0
  let inherited = 0
  const recentCutoff = new Date(now.getTime() - RECENT_MINT_HOURS * 3_600_000).toISOString()
  const buckets = new Map<
    string,
    { ids: Set<string>; recent: Set<string>; events: number; newest_mint: string }
  >()
  for (const e of events) {
    if (!e.ts_utc || e.ts_utc < cutoff) continue
    // Out of the DENOMINATOR too, not just the numerator. A `session_summary` has no work id by
    // design, so counting it as a measured event would make the ratio improve for free every time
    // the sweep runs — the one way a governance signal can be corrupted by its own instrumentation.
    if (!e.work_id) continue
    total += 1
    if (!isOrphanWorkId(e.work_id)) continue
    if ((firstSeen.get(e.work_id as string) ?? e.ts_utc) < cutoff) {
      inherited += 1
      continue
    }
    minted += 1
    const mint = mintEvent.get(e.work_id)
    if (!mint) continue
    const entry = `${mint.kind}|${mint.actor}|${mint.substrate}`
    const held = buckets.get(entry) ?? {
      ids: new Set<string>(),
      recent: new Set<string>(),
      events: 0,
      newest_mint: '',
    }
    held.ids.add(e.work_id)
    if (mint.ts_utc >= recentCutoff) held.recent.add(e.work_id)
    held.events += 1
    if (mint.ts_utc > held.newest_mint) held.newest_mint = mint.ts_utc
    buckets.set(entry, held)
  }
  const by_entry: OrphanEntry[] = [...buckets]
    .map(([entry, held]) => ({
      entry,
      ids: held.ids.size,
      events: held.events,
      newest_mint: held.newest_mint,
      ids_recent: held.recent.size,
      recent_hours: RECENT_MINT_HOURS,
    }))
    .toSorted((a, b) => b.events - a.events || a.entry.localeCompare(b.entry))
  const orphan = minted + inherited
  const ratio = total > 0 ? minted / total : 0
  // An empty window is not a clean window. With nothing to measure the honest answer is "no
  // signal", and reporting that as 0% would read as a passing grade nobody earned.
  return {
    window_days: days,
    total,
    orphan,
    minted,
    inherited,
    ratio,
    threshold,
    over_threshold: total > 0 && ratio > threshold,
    by_entry,
  }
}
