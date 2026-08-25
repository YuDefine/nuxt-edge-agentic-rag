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

import { eventsPath, readEvents } from './emit.ts'
import { buildFleetSnapshot } from './fleet.ts'
import { buildWorkItems, foldSpans } from './spine.ts'
import { DEFAULT_STALL_MINUTES, findStalls } from './stall.ts'

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
export function buildSnapshot(cwd = process.cwd(), stallMinutes = DEFAULT_STALL_MINUTES) {
  const events = readEvents(cwd)
  const spans = foldSpans(events)
  const spinePath = eventsPath(cwd)
  const name = basename(cwd) || 'this repo'
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
    stalls: findStalls(spans, { thresholdMinutes: stallMinutes }).map((s) => ({
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
  return { mode: 'fleet' as const, spine_path: snapshot.roster_path, ...snapshot }
}
