import { AsyncLocalStorage } from 'node:async_hooks'

import type { H3Event } from 'h3'

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

/**
 * Minimal Durable Object storage surface we rely on. Declared locally so the
 * helpers remain consumable from test stubs without pulling full
 * `@cloudflare/workers-types` into the Nuxt typecheck graph.
 */
type SessionStorage = {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(key: string, value: T) => Promise<void>
  delete: (key: string | string[]) => Promise<boolean | number>
  list: <T>(options?: {
    prefix?: string
    start?: string
    end?: string
    limit?: number
  }) => Promise<Map<string, T>>
}

type DoEnv = Record<string, unknown>

export interface CreateDoMcpEventShimInput {
  auth: McpAuthContext
  doEnv: DoEnv
  request: Request
}

const doMcpEventStorage = new AsyncLocalStorage<H3Event>()

const SAFE_GLOBAL_ENV_KEYS = [
  'DB',
  'KV',
  'AI',
  'BLOB',
  'CLOUDFLARE_ACCOUNT_ID',
  'NUXT_MCP_AUTH_SIGNING_KEY',
  'NUXT_KNOWLEDGE_D1_DATABASE',
  'NUXT_KNOWLEDGE_DOCUMENTS_BUCKET',
  'NUXT_KNOWLEDGE_RATE_LIMIT_KV',
  'NUXT_KNOWLEDGE_AI_SEARCH_INDEX',
  'NUXT_KNOWLEDGE_ENVIRONMENT',
  'NUXT_KNOWLEDGE_FEATURE_MCP_SESSION',
  'NUXT_KNOWLEDGE_FEATURE_PASSKEY',
  'NUXT_KNOWLEDGE_AI_GATEWAY_ID',
  'NUXT_KNOWLEDGE_AI_GATEWAY_CACHE_ENABLED',
] as const

export function createDoMcpEventShim({ auth, doEnv, request }: CreateDoMcpEventShimInput): H3Event {
  const url = new URL(request.url)
  const headers = Object.fromEntries(request.headers.entries())

  return {
    context: {
      cloudflare: { env: doEnv },
      log: createDoNoopLogger(),
      mcpAuth: auth,
      params: {},
    },
    headers: request.headers,
    method: request.method,
    node: {
      req: {
        headers,
        method: request.method,
        url: `${url.pathname}${url.search}`,
      },
      res: {},
    },
    path: `${url.pathname}${url.search}`,
    web: {
      request,
    },
  } as unknown as H3Event
}

function createDoNoopLogger() {
  const context: Record<string, unknown> = {}

  // DO requests do not pass through evlog's Nitro request hook, so there is no
  // request-scoped drain to flush here. This keeps existing `useLogger(event)`
  // call sites non-fatal; DO log draining remains a follow-up integration item.
  return {
    debug: () => undefined,
    emit: () => null,
    error: () => undefined,
    getContext: () => ({ ...context }),
    info: () => undefined,
    set: (fields: Record<string, unknown>) => {
      Object.assign(context, fields)
    },
    warn: () => undefined,
  }
}

export function getActiveDoMcpEventShim(): H3Event | null {
  return doMcpEventStorage.getStore() ?? null
}

export async function runWithDoMcpEventShim<T>(
  event: H3Event,
  callback: () => T | Promise<T>,
): Promise<T> {
  return doMcpEventStorage.run(event, callback)
}

// SSE event queue helpers (spec 2025-11-25 §Streamable HTTP > Resumability).
// DO storage schema: `sse-event:<10-digit-counter>` rows + `sse-counter` cursor.
// Keeps event queue globally unique within a session and ordered by enqueue time;
// GET /mcp with `Last-Event-Id` replays missed events using counter > lastCounter.

export const SSE_EVENT_KEY_PREFIX = 'sse-event:'
const SSE_COUNTER_KEY = 'sse-counter'
const SSE_EVENT_ID_PREFIX = 'e-'
// 16 digits = up to 10^16 events per session (~317 million per second for one
// year). Lex order on the zero-padded key matches numeric order; storage cost
// is negligible vs. the 10-digit cap which is reachable in pathological cases.
const SSE_COUNTER_WIDTH = 16

export const SSE_MAX_EVENTS_PER_SESSION = 100
export const SSE_EVENT_TTL_MS = 5 * 60 * 1000

export interface SseEventRow {
  counter: number
  message: JSONRPCMessage
  eventType?: string
  timestamp: number
}

function padCounter(counter: number): string {
  return String(counter).padStart(SSE_COUNTER_WIDTH, '0')
}

function eventKey(counter: number): string {
  return `${SSE_EVENT_KEY_PREFIX}${padCounter(counter)}`
}

export function encodeEventId(counter: number): string {
  return `${SSE_EVENT_ID_PREFIX}${padCounter(counter)}`
}

export function decodeEventId(id: string): number | null {
  if (!id.startsWith(SSE_EVENT_ID_PREFIX)) return null
  const digits = id.slice(SSE_EVENT_ID_PREFIX.length)
  if (!digits || !/^\d+$/.test(digits)) return null
  const n = Number.parseInt(digits, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

async function readCounter(storage: SessionStorage): Promise<number> {
  return (await storage.get<number>(SSE_COUNTER_KEY)) ?? 0
}

export async function enqueueSseEvent(
  storage: SessionStorage,
  message: JSONRPCMessage,
  now: number,
  eventType?: string,
): Promise<{ counter: number; eventId: string }> {
  const counter = (await readCounter(storage)) + 1
  const row: SseEventRow = eventType
    ? { counter, message, eventType, timestamp: now }
    : { counter, message, timestamp: now }
  await storage.put(eventKey(counter), row)
  await storage.put(SSE_COUNTER_KEY, counter)
  return { counter, eventId: encodeEventId(counter) }
}

export async function listEventsAfter(
  storage: SessionStorage,
  lastCounter: number,
): Promise<SseEventRow[]> {
  const rows = await storage.list<SseEventRow>({ prefix: SSE_EVENT_KEY_PREFIX })
  const result: SseEventRow[] = []
  for (const row of rows.values()) {
    if (row.counter > lastCounter) {
      result.push(row)
    }
  }
  result.sort((a, b) => a.counter - b.counter)
  return result
}

export async function enforceEventQuota(
  storage: SessionStorage,
  max: number = SSE_MAX_EVENTS_PER_SESSION,
): Promise<void> {
  const rows = await storage.list<SseEventRow>({ prefix: SSE_EVENT_KEY_PREFIX })
  if (rows.size <= max) return

  const sorted = [...rows.entries()].toSorted(([, a], [, b]) => a.counter - b.counter)
  const toDelete = sorted.slice(0, rows.size - max).map(([key]) => key)
  await storage.delete(toDelete)
}

export async function cleanupExpiredEvents(
  storage: SessionStorage,
  maxAgeMs: number,
  now: number,
): Promise<void> {
  const rows = await storage.list<SseEventRow>({ prefix: SSE_EVENT_KEY_PREFIX })
  const cutoff = now - maxAgeMs
  const toDelete: string[] = []
  for (const [key, row] of rows.entries()) {
    if (row.timestamp < cutoff) {
      toDelete.push(key)
    }
  }
  if (toDelete.length > 0) {
    await storage.delete(toDelete)
  }
}

export async function clearAllSseEvents(storage: SessionStorage): Promise<void> {
  const rows = await storage.list<SseEventRow>({ prefix: SSE_EVENT_KEY_PREFIX })
  if (rows.size > 0) {
    await storage.delete([...rows.keys()])
  }
  await storage.delete(SSE_COUNTER_KEY)
}

export function installEnumerableSafeDoEnv(doEnv?: DoEnv): void {
  if (!doEnv) {
    return
  }

  const safeEnv: DoEnv = Object.create(null)
  for (const key of SAFE_GLOBAL_ENV_KEYS) {
    try {
      const value = doEnv[key]
      if (value !== undefined) {
        safeEnv[key] = value
      }
    } catch {
      // Cloudflare env bindings are proxies; skip bindings that cannot be read.
    }
  }

  ;(globalThis as typeof globalThis & { __env__?: DoEnv }).__env__ = safeEnv
}
