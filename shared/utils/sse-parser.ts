import { createAbortError } from './abort'

export interface SseBlock {
  raw: string
}

export interface ReadSseStreamInput {
  onBlock: (block: SseBlock) => Promise<'continue' | 'terminate'> | 'continue' | 'terminate'
  signal?: AbortSignal
}

export async function readSseStream(response: Response, input: ReadSseStreamInput): Promise<void> {
  if (!response.body) {
    throw new Error('SSE stream missing body')
  }

  const abortError = createAbortError()

  if (input.signal?.aborted) {
    throw abortError
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const abortReader = () => {
    void reader.cancel(abortError)
  }

  input.signal?.addEventListener('abort', abortReader, { once: true })

  try {
    let terminated = false

    while (!terminated) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''

      for (const block of blocks) {
        if (input.signal?.aborted) {
          throw abortError
        }

        const trimmed = block.trim()
        if (!trimmed) {
          continue
        }

        const lines = trimmed.split('\n')
        if (lines.every((line) => line.startsWith(':'))) {
          continue
        }

        const decision = await input.onBlock({ raw: trimmed })
        if (decision === 'terminate') {
          terminated = true
          break
        }

        if (input.signal?.aborted) {
          throw abortError
        }
      }
    }

    if (!terminated) {
      const trimmed = buffer.trim()
      if (trimmed) {
        const lines = trimmed.split('\n')
        const isCommentOnly = lines.every((line) => line.startsWith(':'))

        if (!isCommentOnly) {
          if (input.signal?.aborted) {
            throw abortError
          }

          await input.onBlock({ raw: trimmed })

          if (input.signal?.aborted) {
            throw abortError
          }
        }
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
}
