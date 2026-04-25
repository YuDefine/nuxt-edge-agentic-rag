import { describe, expect, it } from 'vitest'

import type { KvBindingLike } from '#server/utils/cloudflare-bindings'

interface InMemoryKv extends KvBindingLike {
  _store: Map<string, string>
}

function createInMemoryKv(): InMemoryKv {
  const store = new Map<string, string>()
  return {
    _store: store,
    async delete(key: string) {
      store.delete(key)
    },
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
  }
}

describe('mcp token session index (KV-backed best-effort)', () => {
  it('readSessionIds returns empty list when key missing', async () => {
    const { readSessionIds } = await import('#server/utils/mcp-token-session-index')
    const kv = createInMemoryKv()

    await expect(readSessionIds(kv, 'token-1')).resolves.toEqual([])
  })

  it('appendSessionId creates a new entry with updatedAt timestamp', async () => {
    const { appendSessionId, readSessionIds } =
      await import('#server/utils/mcp-token-session-index')
    const kv = createInMemoryKv()

    await appendSessionId(kv, 'token-1', 'sess-A')

    await expect(readSessionIds(kv, 'token-1')).resolves.toEqual(['sess-A'])

    const raw = kv._store.get('mcp:session-by-token:token-1')
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw!) as { sessionIds: string[]; updatedAt: string }
    expect(parsed.sessionIds).toEqual(['sess-A'])
    expect(parsed.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('appendSessionId appends without duplicating existing sessionIds', async () => {
    const { appendSessionId, readSessionIds } =
      await import('#server/utils/mcp-token-session-index')
    const kv = createInMemoryKv()

    await appendSessionId(kv, 'token-1', 'sess-A')
    await appendSessionId(kv, 'token-1', 'sess-B')
    await appendSessionId(kv, 'token-1', 'sess-A')

    await expect(readSessionIds(kv, 'token-1')).resolves.toEqual(['sess-A', 'sess-B'])
  })

  it('clearTokenIndex removes the entry', async () => {
    const { appendSessionId, clearTokenIndex, readSessionIds } =
      await import('#server/utils/mcp-token-session-index')
    const kv = createInMemoryKv()

    await appendSessionId(kv, 'token-1', 'sess-A')
    await clearTokenIndex(kv, 'token-1')

    await expect(readSessionIds(kv, 'token-1')).resolves.toEqual([])
    expect(kv._store.has('mcp:session-by-token:token-1')).toBe(false)
  })

  it('clearTokenIndex on missing key does not throw', async () => {
    const { clearTokenIndex } = await import('#server/utils/mcp-token-session-index')
    const kv = createInMemoryKv()

    await expect(clearTokenIndex(kv, 'never-existed')).resolves.toBeUndefined()
  })

  it('readSessionIds tolerates malformed JSON (returns empty)', async () => {
    const { readSessionIds } = await import('#server/utils/mcp-token-session-index')
    const kv = createInMemoryKv()
    kv._store.set('mcp:session-by-token:token-1', 'not-json{{{')

    await expect(readSessionIds(kv, 'token-1')).resolves.toEqual([])
  })

  it('readSessionIds tolerates missing sessionIds field (returns empty)', async () => {
    const { readSessionIds } = await import('#server/utils/mcp-token-session-index')
    const kv = createInMemoryKv()
    kv._store.set(
      'mcp:session-by-token:token-1',
      JSON.stringify({ updatedAt: '2026-04-26T00:00:00.000Z' }),
    )

    await expect(readSessionIds(kv, 'token-1')).resolves.toEqual([])
  })

  it('appendSessionId is no-op when tokenId or sessionId is empty', async () => {
    const { appendSessionId } = await import('#server/utils/mcp-token-session-index')
    const kv = createInMemoryKv()

    await appendSessionId(kv, '', 'sess-A')
    await appendSessionId(kv, 'token-1', '')

    expect(kv._store.size).toBe(0)
  })

  it('keys are namespaced under mcp:session-by-token: prefix', async () => {
    const { appendSessionId } = await import('#server/utils/mcp-token-session-index')
    const kv = createInMemoryKv()

    await appendSessionId(kv, 'token-xyz', 'sess-A')

    expect([...kv._store.keys()]).toEqual(['mcp:session-by-token:token-xyz'])
  })
})
