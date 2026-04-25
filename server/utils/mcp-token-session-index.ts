/**
 * KV-backed best-effort index from MCP token id → active DO sessionId list.
 *
 * Used by the token revoke cascade-cleanup path: when an admin revokes a
 * token, we look up its active sessions here and fan out invalidate requests
 * to each `MCPSessionDurableObject` so storage is cleared synchronously
 * (instead of waiting up to ~30 minutes for the DO TTL alarm).
 *
 * Helpers accept a `KvBindingLike` directly (no H3Event dependency) so they
 * can be called from both Nitro server routes (`getRequiredKvBinding(event,
 * ...)` then pass) and inside the Durable Object (pass `this.env.KV`). This
 * sidesteps the need for a DO → admin-endpoint round-trip in the absence of
 * Cloudflare service bindings — see `design.md` `### KV Upsert 寫入點`.
 *
 * This is a **best-effort** signal, not a source of truth:
 *   - DO TTL alarm remains the safety net for missed writes / failures
 *   - KV reads / writes that throw must NOT block the revoke main flow
 *   - Stale entries (e.g. session naturally expired) are harmless — fanning
 *     an invalidate request at an already-empty DO is a no-op
 */

import type { KvBindingLike } from '#server/utils/cloudflare-bindings'

const KEY_PREFIX = 'mcp:session-by-token:'

export interface SessionIndexEntry {
  sessionIds: string[]
  updatedAt: string
}

/**
 * Read-modify-write on KV without CAS. Two concurrent `initialize` requests
 * for the same `tokenId` race: both read empty list, both write a single-
 * element list, last-write wins, the other sessionId is silently dropped.
 *
 * Acceptable per the file's "best-effort" doc — the DO TTL alarm (~30 min)
 * is the safety net for any session that slips out of the index. The race
 * window is in practice small (initialize is the slowest path for the
 * client; concurrent initialize from one token is rare outside automated
 * burst connects).
 */
export async function appendSessionId(
  kv: KvBindingLike,
  tokenId: string,
  sessionId: string,
): Promise<void> {
  if (!tokenId || !sessionId) {
    return
  }

  const key = makeKey(tokenId)
  const existing = await readEntry(kv, key)
  const sessionIds = existing?.sessionIds ?? []

  if (!sessionIds.includes(sessionId)) {
    sessionIds.push(sessionId)
  }

  const entry: SessionIndexEntry = {
    sessionIds,
    updatedAt: new Date().toISOString(),
  }
  await kv.put(key, JSON.stringify(entry))
}

export async function readSessionIds(kv: KvBindingLike, tokenId: string): Promise<string[]> {
  if (!tokenId) {
    return []
  }

  const entry = await readEntry(kv, makeKey(tokenId))
  return entry?.sessionIds ?? []
}

export async function clearTokenIndex(kv: KvBindingLike, tokenId: string): Promise<void> {
  if (!tokenId) {
    return
  }

  await kv.delete(makeKey(tokenId))
}

function makeKey(tokenId: string): string {
  return `${KEY_PREFIX}${tokenId}`
}

async function readEntry(kv: KvBindingLike, key: string): Promise<SessionIndexEntry | null> {
  const raw = await kv.get(key)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SessionIndexEntry>
    if (!Array.isArray(parsed.sessionIds)) {
      return null
    }

    const sessionIds = parsed.sessionIds.filter((id): id is string => typeof id === 'string')
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''

    return { sessionIds, updatedAt }
  } catch {
    return null
  }
}
