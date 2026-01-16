import { describe, expect, it } from 'vitest'

/**
 * Streaming message states
 */
type StreamingState = 'idle' | 'waiting' | 'streaming' | 'complete' | 'error'

/**
 * Get display configuration for streaming state
 */
function getStreamingStateConfig(state: StreamingState): {
  showLoader: boolean
  showContent: boolean
  showCursor: boolean
} {
  switch (state) {
    case 'idle':
      return { showLoader: false, showContent: false, showCursor: false }
    case 'waiting':
      return { showLoader: true, showContent: false, showCursor: false }
    case 'streaming':
      return { showLoader: false, showContent: true, showCursor: true }
    case 'complete':
      return { showLoader: false, showContent: true, showCursor: false }
    case 'error':
      return { showLoader: false, showContent: true, showCursor: false }
    default: {
      const _exhaustive: never = state
      throw new Error(`Unhandled state: ${_exhaustive}`)
    }
  }
}

/**
 * Determine streaming state from message data
 */
function determineStreamingState(message: {
  content: string
  isStreaming: boolean
  hasError: boolean
}): StreamingState {
  if (message.hasError) {
    return 'error'
  }
  if (message.isStreaming && message.content.length === 0) {
    return 'waiting'
  }
  if (message.isStreaming && message.content.length > 0) {
    return 'streaming'
  }
  if (!message.isStreaming && message.content.length > 0) {
    return 'complete'
  }
  return 'idle'
}

describe('streaming state configuration', () => {
  it('idle state shows nothing', () => {
    const config = getStreamingStateConfig('idle')
    expect(config.showLoader).toBe(false)
    expect(config.showContent).toBe(false)
    expect(config.showCursor).toBe(false)
  })

  it('waiting state shows loader only', () => {
    const config = getStreamingStateConfig('waiting')
    expect(config.showLoader).toBe(true)
    expect(config.showContent).toBe(false)
    expect(config.showCursor).toBe(false)
  })

  it('streaming state shows content with cursor', () => {
    const config = getStreamingStateConfig('streaming')
    expect(config.showLoader).toBe(false)
    expect(config.showContent).toBe(true)
    expect(config.showCursor).toBe(true)
  })

  it('complete state shows content without cursor', () => {
    const config = getStreamingStateConfig('complete')
    expect(config.showLoader).toBe(false)
    expect(config.showContent).toBe(true)
    expect(config.showCursor).toBe(false)
  })

  it('error state shows content without cursor', () => {
    const config = getStreamingStateConfig('error')
    expect(config.showLoader).toBe(false)
    expect(config.showContent).toBe(true)
    expect(config.showCursor).toBe(false)
  })
})

describe('streaming state determination', () => {
  it('returns waiting when streaming with no content', () => {
    const state = determineStreamingState({
      content: '',
      isStreaming: true,
      hasError: false,
    })
    expect(state).toBe('waiting')
  })

  it('returns streaming when streaming with content', () => {
    const state = determineStreamingState({
      content: '正在回答...',
      isStreaming: true,
      hasError: false,
    })
    expect(state).toBe('streaming')
  })

  it('returns complete when not streaming with content', () => {
    const state = determineStreamingState({
      content: '完整的回答',
      isStreaming: false,
      hasError: false,
    })
    expect(state).toBe('complete')
  })

  it('returns error when hasError is true', () => {
    const state = determineStreamingState({
      content: '部分內容',
      isStreaming: false,
      hasError: true,
    })
    expect(state).toBe('error')
  })

  it('returns idle when not streaming with no content', () => {
    const state = determineStreamingState({
      content: '',
      isStreaming: false,
      hasError: false,
    })
    expect(state).toBe('idle')
  })

  it('error takes precedence over streaming', () => {
    const state = determineStreamingState({
      content: '部分內容',
      isStreaming: true,
      hasError: true,
    })
    expect(state).toBe('error')
  })
})
