import type {
  ChatStreamEvent,
  ChatStreamReadyEvent,
  ChatStreamTerminalEvent,
} from '#shared/types/chat-stream'
import { createAbortError } from '#shared/utils/abort'
import { assertNever } from '#shared/utils/assert-never'
import type { ChatCitation, ChatMessage } from '~/types/chat'

export class ChatStreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatStreamError'
  }
}

export interface ReadChatStreamInput {
  onTextDelta: (delta: string) => Promise<void> | void
  /**
   * Called when the server confirms a conversation has been persisted (DB row
   * created or updated). Fires once, before any `delta` / `complete` /
   * `refusal` / `error` events on the same stream. Container-level callers
   * MUST capture the payload so that downstream error paths (AutoRAG /
   * Workers AI / judge failures emitted as `error` events after `ready`) can
   * still emit `conversation-persisted` upward — otherwise the sidebar /
   * active id never refreshes and the next user message creates an orphan
   * conversation.
   */
  onReady?: (data: ChatStreamReadyEvent['data']) => Promise<void> | void
  signal?: AbortSignal
}

export async function readChatStream(
  response: Response,
  input: ReadChatStreamInput,
): Promise<ChatStreamTerminalEvent> {
  if (!response.body) {
    throw new ChatStreamError('串流回應缺少內容')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const abortError = createAbortError()
  let buffer = ''

  const abortReader = () => {
    void reader.cancel(abortError)
  }

  if (input.signal?.aborted) {
    abortReader()
    throw abortError
  }

  input.signal?.addEventListener('abort', abortReader, { once: true })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''

      for (const block of blocks) {
        const result = await handleEventBlock(block, input)
        if (result) {
          return result
        }
        if (input.signal?.aborted) {
          throw abortError
        }
      }
    }

    const trailingBlock = buffer.trim()
    if (trailingBlock) {
      const result = await handleEventBlock(trailingBlock, input)
      if (result) {
        return result
      }
      if (input.signal?.aborted) {
        throw abortError
      }
    }
  } catch (error) {
    if (input.signal?.aborted) {
      throw abortError
    }
    throw error
  } finally {
    input.signal?.removeEventListener('abort', abortReader)
    reader.releaseLock()
  }

  throw new ChatStreamError('串流在完成前意外中斷')
}

export function createAssistantMessageFromTerminalEvent(
  terminalEvent: ChatStreamTerminalEvent,
  input: {
    createdAt: string
    id: string
  },
): ChatMessage {
  if (terminalEvent.event === 'refusal') {
    return {
      id: input.id,
      role: 'assistant',
      content: '抱歉，我無法回答這個問題。',
      refused: true,
      createdAt: input.createdAt,
    }
  }

  return {
    id: input.id,
    role: 'assistant',
    content: terminalEvent.data.answer,
    refused: false,
    citations: terminalEvent.data.citations as ChatCitation[],
    createdAt: input.createdAt,
  }
}

function parseChatStreamEvent(block: string): ChatStreamEvent | null {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const event = lines.find((line) => line.startsWith('event: '))?.slice(7)
  const data = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .join('\n')

  if (!event || !data) {
    return null
  }

  try {
    return {
      event,
      data: JSON.parse(data),
    } as ChatStreamEvent
  } catch {
    return null
  }
}

async function handleEventBlock(
  block: string,
  input: ReadChatStreamInput,
): Promise<ChatStreamTerminalEvent | null> {
  const event = parseChatStreamEvent(block)
  if (!event) {
    return null
  }

  switch (event.event) {
    case 'ready':
      await input.onReady?.(event.data)
      return null
    case 'delta':
      await input.onTextDelta(event.data.content)
      return null
    case 'complete':
      return event
    case 'refusal':
      return event
    case 'error':
      throw new ChatStreamError(event.data.message)
    default:
      return assertNever(event, 'handleEventBlock')
  }
}
