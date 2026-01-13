import {
  consumeFixedWindowRateLimit,
  FIXED_WINDOW_RATE_LIMIT_PRESETS,
  type FixedWindowRateLimitResult,
  type FixedWindowRateLimitStore,
} from './rate-limiter'

export class McpRateLimitExceededError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterMs: number
  ) {
    super(message)
    this.name = 'McpRateLimitExceededError'
  }
}

interface KvLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export function createKvRateLimitStore(kv: KvLike): FixedWindowRateLimitStore {
  return {
    async get(key) {
      const value = await kv.get(key)

      if (!value) {
        return null
      }

      return JSON.parse(value) as { count: number; windowStart: number }
    },
    async set(key, value) {
      await kv.put(key, JSON.stringify(value), {
        expirationTtl: Math.ceil(FIXED_WINDOW_RATE_LIMIT_PRESETS.askKnowledge.windowMs / 1000),
      })
    },
  }
}

export async function consumeMcpToolRateLimit(input: {
  environment: string
  now?: number
  store: FixedWindowRateLimitStore
  tokenId: string
  tool: keyof typeof FIXED_WINDOW_RATE_LIMIT_PRESETS
}): Promise<FixedWindowRateLimitResult> {
  const preset = FIXED_WINDOW_RATE_LIMIT_PRESETS[input.tool]
  const result = await consumeFixedWindowRateLimit({
    key: `mcp:${input.environment}:${input.tool}:${input.tokenId}`,
    now: input.now,
    preset,
    store: input.store,
  })

  if (!result.allowed) {
    throw new McpRateLimitExceededError(
      `Rate limit exceeded for ${input.tool}`,
      429,
      result.retryAfterMs
    )
  }

  return result
}
