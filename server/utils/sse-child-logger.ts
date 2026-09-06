/**
 * SSE / MCP child request logger（基於 evlog createRequestLogger）
 *
 * Source: clade docs/evlog-master-plan.md § 8.4 (agentic-rag T3)
 *         agentic-rag TD-057 已實證 pattern
 *
 * 使用：
 *   cp vendor/snippets/evlog-mcp-sse-child-logger/child-logger.ts \
 *      server/utils/sse-child-logger.ts
 *
 * 為什麼需要 child logger：
 * - SSE / MCP / Durable Object 的 lifecycle 跨越 Nitro `afterResponse` hook
 * - parent useLogger(event) 在 Response 構造時就 emit，stream / tool call 後
 *   再 log.set 會撞 "called after the wide event was emitted" warning
 * - 解法：fork 出獨立 child request logger，stream settle 時再 emit + drain
 *
 * 應用場景：
 * - SSE chat stream（agentic-rag TD-057 已實作）
 * - MCP tool session（多輪 tool call 跨 stream）
 * - Durable Object alarm callback（lifecycle 與 fetch 分離）
 */

import { createRequestLogger, useLogger } from 'evlog'

import type { H3Event } from 'h3'
import type { RequestLogger } from 'evlog'

interface ForkChildLoggerOptions {
  operation: string // 'web-chat-sse-stream' | 'mcp-tool-session' | ...
  user?: { id: string | null }
  metadata?: Record<string, unknown>
}

/**
 * 從 parent request log 建獨立 child logger
 *
 * 約定：
 * - child 帶 `operation` 區分自己（與 parent 不同 operation）
 * - child 帶 `_parentRequestId` 對應 parent，跨 wide event JOIN 用
 * - child 用 `_deferDrain: true` — 不自動 emit，由呼叫端手動 emit + drain
 */
export function forkChildLogger<T extends object = Record<string, unknown>>(
  event: H3Event,
  options: ForkChildLoggerOptions,
): RequestLogger<T> {
  const parent = useLogger(event)
  const parentCtx = parent.getContext()

  const child = createRequestLogger<T>(
    {
      method: typeof parentCtx.method === 'string' ? parentCtx.method : event.method,
      path: typeof parentCtx.path === 'string' ? parentCtx.path : event.path,
      requestId: crypto.randomUUID(),
    },
    { _deferDrain: true }, // 不自動 emit；由呼叫端負責
  )

  // Cast to `unknown` first because the child's typed `T` parameter is
  // chosen by the caller (e.g. `ChatLogFields`) and TS can't prove the
  // helper's generic shape (`operation` / `_parentRequestId` / `user` +
  // free-form metadata) is assignable to it. Runtime shape is correct —
  // the typed surface is just narrower than this generic helper.
  child.set({
    operation: options.operation,
    _parentRequestId: typeof parentCtx.requestId === 'string' ? parentCtx.requestId : undefined,
    user: options.user,
    ...options.metadata,
  } as unknown as Parameters<typeof child.set>[0])

  return child
}

/**
 * Stream settled handler（SSE / MCP 完成後的 emit + drain wiring）
 *
 * 用法：在 SSE stream end / MCP session close 時呼叫
 */
export async function emitChildLogger(
  event: H3Event,
  child: RequestLogger<Record<string, unknown>>,
  options: {
    error?: unknown // 有錯時 forceKeep，避免被 sampling 丟
  } = {},
) {
  const emitted = child.emit({ _forceKeep: options.error !== undefined })
  if (!emitted) return // 已 emit 過（重複呼叫）

  // 對 child 跑 enricher → drain pipeline（手動觸發 evlog hook chain）
  // agentic-rag 自家 `runStreamLogDrain` 是 nitro hook 的 wrapper；
  // 不同 consumer 可能命名不同
  const drainPromise = runWideEventDrain(emitted, event)

  // Workers per-stream flush
  const waitUntil = event.context.cloudflare?.context?.waitUntil ?? event.context.waitUntil
  if (typeof waitUntil === 'function') {
    waitUntil(drainPromise)
  } else {
    await drainPromise
  }
}

// ── runWideEventDrain：手動跑 enricher / drain hook chain ─────────────────
// 不是 evlog 公開 API；nitro 的 evlog plugin 只對 request-scope 的 wide event
// 跑 hooks（`initLogger` 那裡刻意不帶 drain，drain 由 plugin 自己 callHook），
// 所以任何 `createRequestLogger` 出來的獨立 event 都要自己走這條 pipeline，
// 否則 emit 只會印到 console、進不了 NuxtHub D1 drain。
//
// `h3Event` 可省略：SSE / MCP child 帶得出來，cron task 沒有。
//
// ⚠️ 這個 `?? useNitroApp()` 是行為變更，不只是為了 cron 加的參數：nitropack
// 只設 `event.context.nitro`，**從不設 `context.nitroApp`**，repo 也沒有任何
// plugin 設它——所以這個函式在改之前，每一次都走下面那個 `console.warn` 直接
// return，`chat.post.ts` 的 SSE child event 從來沒有進過 D1。加上 fallback 之後
// 它們才真的落地（每條 chat stream 一筆 row；info 走 50% 抽樣、error forceKeep）。
//
// `h3Event` 目前只往下傳給 hook context，pipeline 內沒有任何一處讀它——built-in
// enricher 讀的是 `ctx.headers`，缺了也有 guard。
export async function runWideEventDrain(emittedEvent: unknown, h3Event?: H3Event) {
  const nitroApp = ((h3Event?.context as { nitroApp?: unknown } | undefined)?.nitroApp ??
    useNitroApp()) as
    | {
        hooks: {
          callHook: (name: string, ctx: unknown) => Promise<void>
        }
      }
    | undefined

  if (!nitroApp) {
    // eslint-disable-next-line no-console
    console.warn('[evlog] wide event drain skipped — no nitroApp available')
    return
  }

  try {
    await nitroApp.hooks.callHook('evlog:enrich', { event: emittedEvent, h3Event })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[evlog] enrich failed (standalone):', error)
  }

  try {
    await nitroApp.hooks.callHook('evlog:drain', { event: emittedEvent, h3Event })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[evlog] drain failed (standalone):', error)
  }
}

/**
 * 使用範例（SSE chat stream，agentic-rag 風格）
 *
 * export default defineEventHandler(async (event) => {
 *   const log = useLogger(event)  // parent request log
 *   log.set({ user: { id: user.id }, conversation: { id: convId } })
 *
 *   if (wantsSseResponse(event)) {
 *     const streamLog = forkChildLogger<ChatLogFields>(event, {
 *       operation: 'web-chat-sse-stream',
 *       user: { id: user.id },
 *     })
 *
 *     return createSseChatResponse({
 *       log: streamLog,
 *       onResult: (result) => streamLog.set({ result }),
 *       onStreamSettled: ({ error }) => emitChildLogger(event, streamLog, { error }),
 *     })
 *   }
 *
 *   const result = await runChatRequest()
 *   log.set({ result })  // parent log，afterResponse 自動 emit
 *   return { data: result }
 * })
 */

/**
 * MCP tool session 範例
 *
 * const sessionLog = forkChildLogger(event, {
 *   operation: 'mcp-tool-session',
 *   metadata: { sessionId, mcpTransport: 'sse' },
 * })
 *
 * for await (const toolCall of mcpSession) {
 *   sessionLog.info('mcp.tool_invoke', { tool: toolCall.name, ... })
 * }
 *
 * await emitChildLogger(event, sessionLog)
 */
