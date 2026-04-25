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

  it('captures conversation metadata from the SSE ready event into a pending slot (TD-047)', async () => {
    const source = await readFile('app/components/chat/Container.vue', 'utf8')

    // Ready data must be captured so post-ready failures still know the
    // conversation id to bubble up.
    expect(source).toMatch(/let pendingConversation/u)
    expect(source).toMatch(/onReady:\s*\(data\)\s*=>/u)
    expect(source).toMatch(/pendingConversation\s*=\s*\{/u)
  })

  it('emits conversation-persisted fallback when stream errors after ready (TD-047)', async () => {
    const source = await readFile('app/components/chat/Container.vue', 'utf8')

    // The catch branch must emit conversation-persisted using the pending
    // metadata so the sidebar refreshes and the active id locks even when
    // AutoRAG / Workers AI / judge throws after the DB row was created.
    const catchSection = source.split('} catch (error) {')[1]
    expect(catchSection, 'Container.vue is expected to have a catch block').toBeDefined()

    // emit('conversation-persisted', ...) must be guarded by a non-null check
    // on the captured ready data and reference its conversationId / created
    // flag. We accept either direct `pendingConversation.*` access or an
    // alias (e.g. `const persistedFallback = pendingConversation`).
    expect(catchSection).toMatch(/pendingConversation/u)
    expect(catchSection).toMatch(/emit\(\s*['"]conversation-persisted['"]/u)
    expect(catchSection).toMatch(/conversationId:\s*[A-Za-z_$][\w$]*\.conversationId/u)
    expect(catchSection).toMatch(/conversationCreated:\s*[A-Za-z_$][\w$]*\.conversationCreated/u)
  })

  it('resets pendingConversation between submissions to avoid stale fallback emits (TD-047)', async () => {
    const source = await readFile('app/components/chat/Container.vue', 'utf8')

    // Must reset pendingConversation either on submit start or in finally —
    // otherwise a successful submission could leave stale metadata that fires
    // on a later unrelated error.
    expect(source).toMatch(/pendingConversation\s*=\s*null/u)
  })
})
