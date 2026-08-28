// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/serve.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/serve.ts
// clade flow spine — snapshot builder
//
// 這個檔曾經同時是 viewer（`flow serve`：`node:http` + 一頁自帶樣式的 HTML + 2s 輪詢）。
// 2026-08-25 Phase 3 起 viewer 是 review-gui 的 `/flow` 頁，資料由
// `vendor/review-gui-web/server/api/flow/spine.get.ts` 呼叫下面的 `buildServeSnapshot()` 供給。
//
// 退場的理由不是「少一個 process 比較整齊」：`flow serve` 要求使用者記得另外開一個 server，
// 而它沒開的時候畫面上是「讀不到」——那與「沒有工作在跑」長得一樣，意思卻相反。
//
// 保留下來的一條硬性質，測試盯著：
//   READ-ONLY。這裡 NEVER 寫回 spine。能被 viewer 改動的軌跡就是一份自己記自己的紀錄。
//
// NEVER 把它長成 canvas editor（n8n / Flowise 那種形狀）：可以手畫的圖不再是「發生過什麼」
// 的投影。畫面上的每一個東西都由 events.jsonl 導出。

import { basename } from 'node:path'

import { findConsumerRoot } from '../claim-helper.ts'
import { eventsPath, readEvents } from './emit.ts'
import { buildFleetSnapshot } from './fleet.ts'
import { buildWorkItems, foldSpans } from './spine.ts'
import { DEFAULT_STALL_MINUTES, findOwnershipStalls, findStalls } from './stall.ts'
import { buildWhoRows } from './who.ts'

export interface ServeOptions {
  port?: number
  host?: string
  cwd?: string
  stallMinutes?: number
  /** Read every repo on the roster instead of just this one (`flow serve --all`). */
  fleet?: boolean
  /** Where `consumers.local` lives. Only meaningful with `fleet`. */
  cladeRoot?: string
}

/** 5180: clear of review-gui (5174) and of the consumer dev-port block (3000–3110). */
export const DEFAULT_PORT = 5180

/**
 * One repo's projection.
 *
 * It carries `repos` / `unreadable` / a `repo` tag on every row even though there is exactly one
 * repo here, so that the page has ONE rendering path. Fleet mode is then a snapshot with more
 * rows, not a second page — and a second page is how two views end up disagreeing about whether
 * the same work item is in flight.
 */
/**
 * 所有權投影 —— 逐字就是 `flow who` 給 agent 的那一份。
 *
 * Phase 3 的整個要點是**人看的與 agent 查的是同一份 JSON**：TD-664 § Problem 的死結，
 * 成因是每個參與者手上的「誰持有這個檔」都不一樣，而每一份在自己的資訊條件下都說得通。
 * 所以這裡 NEVER 重新推導、NEVER 過濾、NEVER 改寫 `action` 字串 —— 呼叫同一個
 * `buildWhoRows`，原樣端出去。頁面要換句話說的時候，改的是 who.ts，不是這裡。
 *
 * 所有權是 main working tree 的性質，所以 `findConsumerRoot` 把任何 worktree 內的 cwd
 * 解析回同一個 root（`flow.ts` 的 `who` 分支同一個理由）。
 */
function buildOwnership(cwd: string) {
  const root = findConsumerRoot(cwd) ?? cwd
  // NEVER 在這裡打開 `transcriptEvidence`：這條路徑跑在 review-gui 的單一 event loop 上，
  // 而那個掃描是全 corpus 的（2026-08-28 實測 1:42，期間整個 GUI 每一條路由都不回應）。
  // 取證是 `flow who` 的事；該列的 action 字串會告訴讀者去哪裡拿。
  return { root, rows: buildWhoRows(root) }
}

export function buildSnapshot(cwd = process.cwd(), stallMinutes = DEFAULT_STALL_MINUTES) {
  const events = readEvents(cwd)
  const spans = foldSpans(events)
  const spinePath = eventsPath(cwd)
  const name = basename(cwd) || 'this repo'
  const ownership = buildOwnership(cwd)
  return {
    mode: 'repo' as const,
    generated_at: new Date().toISOString(),
    spine_path: spinePath,
    repos: [
      {
        name,
        path: cwd,
        spine_path: spinePath,
        state: 'ok' as const,
        events: events.length,
      },
    ],
    unreadable: [],
    events: events.length,
    work_items: buildWorkItems(spans).map((w) => ({ ...w, repo: name })),
    spans: spans.map((s) => ({ ...s, repo: name })),
    ownership: { ...ownership, scope: 'this-repo' as const },
    // Ownership stalls 併進**同一個** stalls 陣列，不另開第二個清單 —— `flow status --stalled`
    // 已經是這個形狀（flow.ts 的 status 分支），而兩份「卡住了」清單就是兩份會互相不同意
    // 的現況。頁面既有的那一段因此零改動就顯示 dead-holder / stash-residue。
    stalls: [
      ...findStalls(spans, { thresholdMinutes: stallMinutes }),
      ...findOwnershipStalls(ownership.rows),
    ].map((s) => ({
      ...s,
      repo: name,
    })),
  }
}

/**
 * What the endpoint serves. Fleet mode reads every repo on the roster; when the roster is absent
 * (a consumer checkout, where this file exists because it is propagated) it says so instead of
 * pretending the fleet is empty.
 */
export function buildServeSnapshot({
  cwd = process.cwd(),
  stallMinutes = DEFAULT_STALL_MINUTES,
  fleet = false,
  cladeRoot = cwd,
}: ServeOptions = {}) {
  if (!fleet) return buildSnapshot(cwd, stallMinutes)
  const snapshot = buildFleetSnapshot({ cladeRoot, stallMinutes })
  if (!snapshot) {
    return {
      ...buildSnapshot(cwd, stallMinutes),
      fleet_error: `找不到 ${cladeRoot}/consumers.local，只能看這一個 repo`,
    }
  }
  return {
    mode: 'fleet' as const,
    spine_path: snapshot.roster_path,
    ...snapshot,
    // Fleet 模式只帶 clade 自己這一棵的所有權，且**明說**只有這一棵。所有權要走 14 棵
    // working tree 才答得出來，那是另一個問題、另一個成本（flow.ts 的 status 分支同一個
    // 判斷）。但「省略」與「沒有爭用」在畫面上長得一樣、意思相反 —— 所以標 scope，
    // NEVER 靜默把這個欄位拿掉。
    ownership: { ...buildOwnership(cladeRoot), scope: 'this-repo-only' as const },
  }
}
