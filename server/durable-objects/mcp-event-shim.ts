import { AsyncLocalStorage } from 'node:async_hooks'

import type { H3Event } from 'h3'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

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
