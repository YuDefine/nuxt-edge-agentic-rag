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
  const drainPromise = runChildLogDrain(event, emitted)

  // Workers per-stream flush
  const waitUntil = event.context.cloudflare?.context?.waitUntil ?? event.context.waitUntil
  if (typeof waitUntil === 'function') {
    waitUntil(drainPromise)
  } else {
    await drainPromise
  }
}

// ── runChildLogDrain：手動跑 enricher / drain hook chain ──────────────────
// 不是 evlog 公開 API；nitro 不會自動對 child wide event 跑 hooks，
// 所以要自己呼叫 enricher / drain（與 nitro plugin 用的同一條 pipeline）
async function runChildLogDrain(event: H3Event, emittedEvent: unknown) {
  const nitroApp = (event.context as { nitroApp?: unknown }).nitroApp as
    | {
        hooks: {
          callHook: (name: string, ctx: unknown) => Promise<void>
        }
      }
    | undefined

  if (!nitroApp) {
    // eslint-disable-next-line no-console
    console.warn('[evlog] child log drain skipped — no nitroApp in event.context')
    return
  }

  try {
    await nitroApp.hooks.callHook('evlog:enrich', { event: emittedEvent, h3Event: event })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[evlog] enrich failed (child):', error)
  }

  try {
    await nitroApp.hooks.callHook('evlog:drain', { event: emittedEvent, h3Event: event })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[evlog] drain failed (child):', error)
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
