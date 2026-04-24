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

  // TODO(remove-debug-do-logger): temporarily route log.error / log.warn /
  // log.info to console.* so DO tool handler throws surface in `wrangler tail`
  // (the noop variant ate the stack and left only `Tool execution failed.
  // Please retry later.`). Restore the original noop body once
  // `wire-do-tool-dispatch` immediate validation prints real handler errors and
  // the root cause is fixed. See HANDOFF.md → wire-do-tool-dispatch.
  // DO requests do not pass through evlog's Nitro request hook, so there is no
  // request-scoped drain to flush here; keeping this debug variant
  // request-scoped (no module-level state) so concurrent DO requests do not
  // cross-contaminate context.
  function formatFields(fields?: Record<string, unknown>): string {
    try {
      return JSON.stringify({ ...context, ...fields })
    } catch {
      return '(unserialisable fields)'
    }
  }

  return {
    debug: (message: unknown, fields?: Record<string, unknown>) => {
      // eslint-disable-next-line no-console -- TODO(remove-debug-do-logger)
      console.debug('[mcp-do debug]', message, formatFields(fields))
    },
    emit: () => null,
    error: (error: unknown, fields?: Record<string, unknown>) => {
      const asError = error instanceof Error ? error : new Error(String(error))
      // eslint-disable-next-line no-console -- TODO(remove-debug-do-logger)
      console.error(
        '[mcp-do error]',
        asError.name,
        '-',
        asError.message,
        asError.stack ?? '(no stack)',
        formatFields(fields),
      )
    },
    getContext: () => ({ ...context }),
    info: (message: unknown, fields?: Record<string, unknown>) => {
      // eslint-disable-next-line no-console -- TODO(remove-debug-do-logger)
      console.info('[mcp-do info]', message, formatFields(fields))
    },
    set: (fields: Record<string, unknown>) => {
      Object.assign(context, fields)
    },
    warn: (message: unknown, fields?: Record<string, unknown>) => {
      // eslint-disable-next-line no-console -- TODO(remove-debug-do-logger)
      console.warn('[mcp-do warn]', message, formatFields(fields))
    },
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
