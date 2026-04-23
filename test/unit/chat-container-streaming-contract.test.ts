import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('chat container streaming contract', () => {
  it('drives streaming from SSE events without synthetic timers or shadow cancellation state', async () => {
    const source = await readFile('app/components/chat/Container.vue', 'utf8')

    expect(source).toContain('readChatStream')
    expect(source).not.toContain('simulateStreaming')
    expect(source).not.toContain('setTimeout')
    expect(source).not.toContain('setInterval')
    expect(source).not.toContain('streamingCancelled')
  })
})
