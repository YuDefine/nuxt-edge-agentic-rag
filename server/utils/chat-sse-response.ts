import { createAbortError, isAbortError } from '#shared/utils/abort'

interface SseChatLogger {
  error: (error: Error, context?: Record<string, unknown>) => void
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
}

export function createSseChatResponse<TResult extends SseChatRunResult>(
  input: CreateSseChatResponseInput<TResult>,
): Response {
  const encoder = new TextEncoder()
  const abortController = new AbortController()

  let closed = false
  let heartbeatHandle: ReturnType<typeof setInterval> | null = null

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
          input.log.error(error as Error, { operation: 'web-chat-stream' })
          enqueue('error', { message: '發生錯誤，請稍後再試' })
        }
      } finally {
        close()
      }
    },
    cancel() {
      stopHeartbeat()
      closed = true
      abortController.abort(createAbortError())
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
