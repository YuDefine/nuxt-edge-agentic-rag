import type { RefusalReason } from '#shared/types/observability'
import { createAbortError, isAbortError } from '#shared/utils/abort'

/**
 * Minimum logger surface used by the SSE machinery.
 *
 * `set` is included because callers (e.g. `recordChatResult` in `chat.post.ts`)
 * write the final `result` field via `log.set` from inside `onResult`, which
 * runs while the stream is still live. The caller is expected to pass a
 * **child / fork logger** (see `chat.post.ts`) so these post-handler-return
 * mutations land on a wide event whose lifecycle is bound to the stream's
 * completion, not to the request handler's return — see TD-057.
 */
interface SseChatLogger {
  error: (error: Error, context?: Record<string, unknown>) => void
  set: (context: Record<string, unknown>) => void
}

/**
 * Heartbeat interval for SSE keep-alive comments. 15 seconds gives ~2x margin
 * below the typical Cloudflare / proxy idle threshold of ~30 seconds. Sent as
 * an SSE comment line (`: keep-alive\n\n`) so conformant clients ignore it
 * without surfacing it as application content. See `web-chat-sse-streaming`
 * spec — liveness signal MUST NOT be counted as a first-token event.
 */
export const HEARTBEAT_INTERVAL_MS = 15000

const CHAT_STREAM_CONTENT_TYPE = 'text/event-stream; charset=utf-8'

export interface SseChatRunResult {
  answer: string | null
  citations: ReadonlyArray<{ citationId: string; sourceChunkId: string }>
  refused: boolean
  /**
   * persist-refusal-and-label-new-chat: specific reason populated when
   * `refused === true` so the SSE refusal event can carry it to the
   * client for reason-specific RefusalMessage copy. `null` for accepted
   * answers.
   */
  refusalReason: RefusalReason | null
}

export interface CreateSseChatResponseInput<TResult extends SseChatRunResult> {
  conversationCreated: boolean
  conversationId: string
  execute: (stream: {
    onTextDelta?: (delta: string) => Promise<void> | void
    signal?: AbortSignal
  }) => Promise<TResult>
  log: SseChatLogger
  onResult?: (result: TResult) => void
  /**
   * Called exactly once after the stream is fully settled (success, refusal,
   * abort, or error). The caller uses this to emit the SSE-scoped wide event
   * whose lifecycle is bound to the stream's completion rather than the HTTP
   * handler's return. `error` is `null` on success/refusal/abort and the
   * captured `Error` on unexpected stream failure (already passed to
   * `log.error`). See TD-057.
   */
  onStreamSettled?: (info: { error: Error | null }) => void | Promise<void>
}

export function createSseChatResponse<TResult extends SseChatRunResult>(
  input: CreateSseChatResponseInput<TResult>,
): Response {
  const encoder = new TextEncoder()
  const abortController = new AbortController()

  let closed = false
  let heartbeatHandle: ReturnType<typeof setInterval> | null = null
  // TD-057: capture the unexpected error (if any) so `onStreamSettled` can
  // forward it to the caller after the stream is fully closed. Aborts and
  // refusals are not errors — they leave this `null`.
  let streamError: Error | null = null
  let settled = false

  const stopHeartbeat = () => {
    if (heartbeatHandle !== null) {
      clearInterval(heartbeatHandle)
      heartbeatHandle = null
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (!closed) {
          stopHeartbeat()
          closed = true
          controller.close()
        }
      }

      const enqueue = (event: string, data: Record<string, unknown>) => {
        if (closed) {
          return
        }
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      heartbeatHandle = setInterval(() => {
        if (closed) {
          return
        }
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'))
        } catch {
          stopHeartbeat()
        }
      }, HEARTBEAT_INTERVAL_MS)

      try {
        enqueue('ready', {
          conversationCreated: input.conversationCreated,
          conversationId: input.conversationId,
        })

        const result = await input.execute({
          onTextDelta: (delta) => {
            enqueue('delta', { content: delta })
          },
          signal: abortController.signal,
        })

        input.onResult?.(result)

        if (result.refused) {
          enqueue('refusal', {
            answer: null,
            citations: [],
            conversationCreated: input.conversationCreated,
            conversationId: input.conversationId,
            refused: true,
            // persist-refusal-and-label-new-chat: forward the specific
            // RefusalReason so the client can render reason-specific copy
            // immediately. Fall back to `no_citation` when the run did not
            // surface telemetry (defensive — chatWithKnowledge should
            // always populate this field for refusal results).
            reason: result.refusalReason ?? 'no_citation',
          })
        } else {
          enqueue('complete', {
            answer: result.answer,
            citations: result.citations,
            conversationCreated: input.conversationCreated,
            conversationId: input.conversationId,
            refused: false,
          })
        }
      } catch (error) {
        if (!isAbortError(error)) {
          streamError = error as Error
          input.log.error(error as Error, { operation: 'web-chat-stream' })
          enqueue('error', { message: '發生錯誤，請稍後再試' })
        }
      } finally {
        close()
        // TD-057: emit the SSE-scoped wide event after the stream is fully
        // closed. Idempotent — `settled` guards against double-emit if both
        // `start` finally and `cancel` race.
        if (!settled) {
          settled = true
          try {
            await input.onStreamSettled?.({ error: streamError })
          } catch {
            // onStreamSettled failures must not break the response; they are
            // already a logging-pipeline issue and not user-visible.
          }
        }
      }
    },
    async cancel() {
      stopHeartbeat()
      closed = true
      abortController.abort(createAbortError())
      if (!settled) {
        settled = true
        try {
          await input.onStreamSettled?.({ error: streamError })
        } catch {
          // see above
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': CHAT_STREAM_CONTENT_TYPE,
    },
  })
}
