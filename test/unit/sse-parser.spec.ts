import { describe, expect, it, vi } from 'vitest'

import { isAbortError } from '#shared/utils/abort'
import { readSseStream, type SseBlock } from '#shared/utils/sse-parser'

function createSseResponse(chunks: string[], options?: { withBody?: boolean }): Response {
  if (options?.withBody === false) {
    return new Response(null, {
      headers: { 'content-type': 'text/event-stream' },
    })
  }

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
      headers: { 'content-type': 'text/event-stream' },
    },
  )
}

describe('shared/utils/sse-parser', () => {
  it('emits a single onBlock call for one normal block and resolves when the stream ends', async () => {
    const blocks: SseBlock[] = []
    await readSseStream(createSseResponse(['event: ready\ndata: {"ok":true}\n\n']), {
      onBlock: async (block) => {
        blocks.push(block)
        return 'continue'
      },
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.raw).toBe('event: ready\ndata: {"ok":true}')
  })

  it('splits a multi-block buffer correctly when chunks arrive together', async () => {
    const blocks: SseBlock[] = []
    await readSseStream(
      createSseResponse([
        'event: ready\ndata: {"a":1}\n\nevent: delta\ndata: {"b":2}\n\nevent: complete\ndata: {"c":3}\n\n',
      ]),
      {
        onBlock: async (block) => {
          blocks.push(block)
          return 'continue'
        },
      },
    )

    expect(blocks.map((b) => b.raw)).toEqual([
      'event: ready\ndata: {"a":1}',
      'event: delta\ndata: {"b":2}',
      'event: complete\ndata: {"c":3}',
    ])
  })

  it('handles a partial trailing block that completes after another chunk arrives', async () => {
    const blocks: SseBlock[] = []
    await readSseStream(
      createSseResponse([
        'event: ready\ndata: {"conv":',
        '"abc"}\n\n',
        'event: delta\ndata: {"x":1}\n\n',
      ]),
      {
        onBlock: async (block) => {
          blocks.push(block)
          return 'continue'
        },
      },
    )

    expect(blocks.map((b) => b.raw)).toEqual([
      'event: ready\ndata: {"conv":"abc"}',
      'event: delta\ndata: {"x":1}',
    ])
  })

  it('emits the final trailing block even if the stream ends without a closing newline pair', async () => {
    const blocks: SseBlock[] = []
    await readSseStream(
      createSseResponse(['event: ready\ndata: {"a":1}\n\n', 'event: complete\ndata: {"b":2}']),
      {
        onBlock: async (block) => {
          blocks.push(block)
          return 'continue'
        },
      },
    )

    expect(blocks.map((b) => b.raw)).toEqual([
      'event: ready\ndata: {"a":1}',
      'event: complete\ndata: {"b":2}',
    ])
  })

  it('throws AbortError when the signal is already aborted before reading starts', async () => {
    const controller = new AbortController()
    controller.abort()

    const onBlock = vi.fn(() => 'continue' as const)
    await expect(
      readSseStream(createSseResponse(['event: ready\ndata: {"a":1}\n\n']), {
        onBlock,
        signal: controller.signal,
      }),
    ).rejects.toSatisfy((error) => isAbortError(error))

    expect(onBlock).not.toHaveBeenCalled()
  })

  it('stops reading additional events when the signal is aborted mid-stream', async () => {
    const encoder = new TextEncoder()
    const abortController = new AbortController()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: ready\ndata: {"conv":"a"}\n\n'))
          controller.enqueue(encoder.encode('event: delta\ndata: {"x":1}\n\n'))
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )

    const seen: string[] = []

    await expect(
      readSseStream(response, {
        onBlock: async (block) => {
          seen.push(block.raw)
          abortController.abort()
          return 'continue'
        },
        signal: abortController.signal,
      }),
    ).rejects.toSatisfy((error) => isAbortError(error))

    expect(seen).toEqual(['event: ready\ndata: {"conv":"a"}'])
  })

  it('decodes UTF-8 multi-byte characters split across chunks', async () => {
    const encoder = new TextEncoder()
    const fullBlock = 'event: delta\ndata: {"content":"中文測試"}\n\n'
    const fullBytes = encoder.encode(fullBlock)
    const splitAt = 18

    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(fullBytes.slice(0, splitAt))
          controller.enqueue(fullBytes.slice(splitAt))
          controller.close()
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )

    const blocks: SseBlock[] = []
    await readSseStream(response, {
      onBlock: async (block) => {
        blocks.push(block)
        return 'continue'
      },
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.raw).toBe('event: delta\ndata: {"content":"中文測試"}')
  })

  it('skips comment-only blocks (e.g. ": keep-alive") so they are not forwarded to onBlock', async () => {
    const blocks: SseBlock[] = []
    await readSseStream(
      createSseResponse([
        'event: ready\ndata: {"a":1}\n\n',
        ': keep-alive\n\n',
        'event: complete\ndata: {"b":2}\n\n',
      ]),
      {
        onBlock: async (block) => {
          blocks.push(block)
          return 'continue'
        },
      },
    )

    expect(blocks.map((b) => b.raw)).toEqual([
      'event: ready\ndata: {"a":1}',
      'event: complete\ndata: {"b":2}',
    ])
  })

  it('exits the loop without further onBlock calls when handler returns "terminate"', async () => {
    const blocks: SseBlock[] = []
    await readSseStream(
      createSseResponse([
        'event: ready\ndata: {"a":1}\n\nevent: complete\ndata: {"b":2}\n\nevent: extra\ndata: {"c":3}\n\n',
      ]),
      {
        onBlock: async (block) => {
          blocks.push(block)
          if (block.raw.startsWith('event: complete')) {
            return 'terminate'
          }
          return 'continue'
        },
      },
    )

    expect(blocks.map((b) => b.raw)).toEqual([
      'event: ready\ndata: {"a":1}',
      'event: complete\ndata: {"b":2}',
    ])
  })

  it('throws when response.body is missing', async () => {
    await expect(
      readSseStream(createSseResponse([], { withBody: false }), {
        onBlock: () => 'continue',
      }),
    ).rejects.toThrow('SSE stream missing body')
  })
})
