import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSseChatResponse, HEARTBEAT_INTERVAL_MS } from '#server/utils/chat-sse-response'

interface ChatRunResolvers {
  resolve: (value: {
    answer: string
    citations: Array<{ citationId: string; sourceChunkId: string }>
    refused: boolean
    retrievalScore: number
  }) => void
  reject: (reason?: unknown) => void
}

function createControlledExecute() {
  const resolvers: ChatRunResolvers = {
    resolve: () => {},
    reject: () => {},
  }
  const promise = new Promise<{
    answer: string
    citations: Array<{ citationId: string; sourceChunkId: string }>
    refused: boolean
    retrievalScore: number
  }>((resolve, reject) => {
    resolvers.resolve = resolve
    resolvers.reject = reject
  })

  return {
    execute: () => promise,
    resolvers,
  }
}

function createNoopLog() {
  return {
    error: vi.fn(),
    set: vi.fn(),
  } as unknown as Parameters<typeof createSseChatResponse>[0]['log']
}

async function readAllText(response: Response): Promise<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

describe('chat route SSE heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits a keep-alive comment block during long idle gap before first answer-content event', async () => {
    const { execute, resolvers } = createControlledExecute()

    const response = createSseChatResponse({
      conversationCreated: true,
      conversationId: 'conv-1',
      execute: execute as Parameters<typeof createSseChatResponse>[0]['execute'],
      log: createNoopLog(),
    })

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let transcript = ''

    const readyChunk = await reader.read()
    transcript += decoder.decode(readyChunk.value!, { stream: true })

    expect(transcript).toContain('event: ready')

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)

    const heartbeatChunk = await reader.read()
    transcript += decoder.decode(heartbeatChunk.value!, { stream: true })

    expect(transcript).toContain(': keep-alive\n\n')

    resolvers.resolve({
      answer: 'done',
      citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
      refused: false,
      retrievalScore: 0.9,
    })

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      transcript += decoder.decode(value, { stream: true })
    }
    transcript += decoder.decode()

    expect(transcript).toContain('event: complete')
  })

  it('stops emitting keep-alive after the consumer cancels so heartbeat does not enqueue on a closed controller', async () => {
    const { execute, resolvers } = createControlledExecute()
    let capturedSignal: AbortSignal | undefined

    const response = createSseChatResponse({
      conversationCreated: true,
      conversationId: 'conv-cancel',
      execute: ((stream: { signal?: AbortSignal }) => {
        capturedSignal = stream.signal
        return (execute as () => Promise<unknown>)()
      }) as Parameters<typeof createSseChatResponse>[0]['execute'],
      log: createNoopLog(),
    })

    const reader = response.body!.getReader()

    await reader.read()

    await reader.cancel()

    expect(capturedSignal?.aborted).toBe(true)

    await expect(vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 5)).resolves.not.toThrow()

    resolvers.resolve({
      answer: 'never delivered',
      citations: [],
      refused: false,
      retrievalScore: 0,
    })

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
  })

  it('stops emitting keep-alive after the stream terminates so liveness is not enqueued on a closed controller', async () => {
    const { execute, resolvers } = createControlledExecute()

    const response = createSseChatResponse({
      conversationCreated: true,
      conversationId: 'conv-2',
      execute: execute as Parameters<typeof createSseChatResponse>[0]['execute'],
      log: createNoopLog(),
    })

    resolvers.resolve({
      answer: 'fast answer',
      citations: [],
      refused: false,
      retrievalScore: 0.8,
    })

    const transcript = await readAllText(response)

    expect(transcript).toContain('event: ready')
    expect(transcript).toContain('event: complete')

    const beforeAdvance = transcript

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 5)

    expect(beforeAdvance).toBe(transcript)

    const occurrences = (transcript.match(/: keep-alive/g) ?? []).length
    expect(occurrences).toBe(0)
  })
})
