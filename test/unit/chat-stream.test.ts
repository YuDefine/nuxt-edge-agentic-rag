import { describe, expect, it, vi } from 'vitest'

import {
  ChatStreamError,
  createAssistantMessageFromTerminalEvent,
  readChatStream,
} from '~/utils/chat-stream'

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    {
      headers: {
        'content-type': 'text/event-stream',
      },
    },
  )
}

describe('chat stream reader', () => {
  it('appends streamed delta events and returns the accepted terminal payload', async () => {
    const onTextDelta = vi.fn()

    const result = await readChatStream(
      createSseResponse([
        'event: ready\ndata: {"conversationCreated":true,"conversationId":"conv-1"}\n\n',
        'event: delta\ndata: {"content":"Launch moved "}\n\n',
        'event: delta\ndata: {"content":"to Tuesday."}\n\n',
        'event: complete\ndata: {"answer":"Launch moved to Tuesday.","citations":[{"citationId":"citation-1","sourceChunkId":"chunk-1"}],"conversationCreated":true,"conversationId":"conv-1","refused":false}\n\n',
      ]),
      { onTextDelta },
    )

    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Launch moved ')
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'to Tuesday.')
    expect(result).toEqual({
      event: 'complete',
      data: {
        answer: 'Launch moved to Tuesday.',
        citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
        conversationCreated: true,
        conversationId: 'conv-1',
        refused: false,
      },
    })
  })

  it('supports refusal terminal events without a separate fallback fetch', async () => {
    const result = await readChatStream(
      createSseResponse([
        'event: ready\ndata: {"conversationCreated":false,"conversationId":"conv-2"}\n\n',
        'event: refusal\ndata: {"answer":null,"citations":[],"conversationCreated":false,"conversationId":"conv-2","refused":true,"reason":"restricted_scope"}\n\n',
      ]),
      { onTextDelta: vi.fn() },
    )

    expect(result).toEqual({
      event: 'refusal',
      data: {
        answer: null,
        citations: [],
        conversationCreated: false,
        conversationId: 'conv-2',
        refused: true,
        reason: 'restricted_scope',
      },
    })
  })

  it('throws explicit error outcomes from the stream contract', async () => {
    await expect(
      readChatStream(
        createSseResponse([
          'event: ready\ndata: {"conversationCreated":true,"conversationId":"conv-3"}\n\n',
          'event: error\ndata: {"message":"發生錯誤，請稍後再試"}\n\n',
        ]),
        { onTextDelta: vi.fn() },
      ),
    ).rejects.toThrow(new ChatStreamError('發生錯誤，請稍後再試'))
  })

  it('invokes onReady callback with conversation metadata before later events resolve', async () => {
    const onReady = vi.fn()
    const onTextDelta = vi.fn()

    const result = await readChatStream(
      createSseResponse([
        'event: ready\ndata: {"conversationCreated":true,"conversationId":"conv-ready-1"}\n\n',
        'event: delta\ndata: {"content":"hi"}\n\n',
        'event: complete\ndata: {"answer":"hi","citations":[],"conversationCreated":true,"conversationId":"conv-ready-1","refused":false}\n\n',
      ]),
      { onTextDelta, onReady },
    )

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith({
      conversationCreated: true,
      conversationId: 'conv-ready-1',
    })
    expect(result.event).toBe('complete')
  })

  it('still invokes onReady before a later error event throws', async () => {
    const onReady = vi.fn()

    await expect(
      readChatStream(
        createSseResponse([
          'event: ready\ndata: {"conversationCreated":true,"conversationId":"conv-ready-2"}\n\n',
          'event: error\ndata: {"message":"AutoRAG 失敗"}\n\n',
        ]),
        { onTextDelta: vi.fn(), onReady },
      ),
    ).rejects.toThrow(new ChatStreamError('AutoRAG 失敗'))

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith({
      conversationCreated: true,
      conversationId: 'conv-ready-2',
    })
  })

  it('parses event blocks even when chunk boundaries split the SSE frame', async () => {
    const onTextDelta = vi.fn()

    const result = await readChatStream(
      createSseResponse([
        'event: ready\ndata: {"conversationCreated":true,',
        '"conversationId":"conv-4"}\n\n',
        'event: delta\ndata: {"content":"第一段"}\n\n',
        'event: complete\ndata: {"answer":"第一段","citations":[],"conversationCreated":true,"conversationId":"conv-4","refused":false}\n\n',
      ]),
      { onTextDelta },
    )

    expect(onTextDelta).toHaveBeenCalledWith('第一段')
    expect(result.event).toBe('complete')
  })

  it('stops reading additional events when the active stream is aborted', async () => {
    const encoder = new TextEncoder()
    const abortController = new AbortController()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: ready\ndata: {"conversationCreated":true,"conversationId":"conv-5"}\n\n',
            ),
          )
          controller.enqueue(encoder.encode('event: delta\ndata: {"content":"第一段"}\n\n'))
        },
      }),
      {
        headers: {
          'content-type': 'text/event-stream',
        },
      },
    )

    await expect(
      readChatStream(response, {
        onTextDelta: async () => {
          abortController.abort()
        },
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('maps accepted terminal events to assistant messages with citation data', () => {
    expect(
      createAssistantMessageFromTerminalEvent(
        {
          event: 'complete',
          data: {
            answer: 'Launch moved to Tuesday.',
            citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
            conversationCreated: true,
            conversationId: 'conv-1',
            refused: false,
          },
        },
        {
          createdAt: '2026-04-24T00:00:00.000Z',
          id: 'msg-1',
        },
      ),
    ).toEqual({
      id: 'msg-1',
      role: 'assistant',
      content: 'Launch moved to Tuesday.',
      refused: false,
      refusalReason: null,
      citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
      createdAt: '2026-04-24T00:00:00.000Z',
    })
  })

  it('maps refusal terminal events to explicit refused assistant messages with reason', () => {
    // persist-refusal-and-label-new-chat: refusal event payload now carries
    // `reason` so RefusalMessage.vue can render reason-specific copy. The
    // mapper forwards the reason onto ChatMessage.refusalReason.
    expect(
      createAssistantMessageFromTerminalEvent(
        {
          event: 'refusal',
          data: {
            answer: null,
            citations: [],
            conversationCreated: false,
            conversationId: 'conv-2',
            refused: true,
            reason: 'restricted_scope',
          },
        },
        {
          createdAt: '2026-04-24T00:00:00.000Z',
          id: 'msg-2',
        },
      ),
    ).toEqual({
      id: 'msg-2',
      role: 'assistant',
      content: '抱歉，我無法回答這個問題。',
      refused: true,
      refusalReason: 'restricted_scope',
      createdAt: '2026-04-24T00:00:00.000Z',
    })
  })

  it('accepted answer mapping carries refusalReason: null', () => {
    expect(
      createAssistantMessageFromTerminalEvent(
        {
          event: 'complete',
          data: {
            answer: 'Field A means …',
            citations: [{ citationId: 'cit-1', sourceChunkId: 'chunk-1' }],
            conversationCreated: false,
            conversationId: 'conv-3',
            refused: false,
          },
        },
        {
          createdAt: '2026-04-24T01:00:00.000Z',
          id: 'msg-3',
        },
      ),
    ).toMatchObject({
      role: 'assistant',
      refused: false,
      refusalReason: null,
    })
  })
})
