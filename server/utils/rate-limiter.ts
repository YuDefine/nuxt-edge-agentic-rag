const FIVE_MINUTES_MS = 5 * 60 * 1000

export interface FixedWindowRateLimitPreset {
  limit: number
  windowMs: number
}

export interface FixedWindowRateLimitRecord {
  count: number
  windowStart: number
}

export interface FixedWindowRateLimitStore {
  get(key: string): Promise<FixedWindowRateLimitRecord | null>
  set(key: string, value: FixedWindowRateLimitRecord): Promise<void>
}

export interface ConsumeFixedWindowRateLimitInput {
  key: string
  now?: number
  preset: FixedWindowRateLimitPreset
  store: FixedWindowRateLimitStore
}

export interface FixedWindowRateLimitResult {
  allowed: boolean
  count: number
  limit: number
  remaining: number
  resetAt: number
  retryAfterMs: number
}

export const FIXED_WINDOW_RATE_LIMIT_PRESETS = {
  askKnowledge: {
    limit: 30,
    windowMs: FIVE_MINUTES_MS,
  },
  chat: {
    limit: 30,
    windowMs: FIVE_MINUTES_MS,
  },
  getDocumentChunk: {
    limit: 120,
    windowMs: FIVE_MINUTES_MS,
  },
  listCategories: {
    limit: 120,
    windowMs: FIVE_MINUTES_MS,
  },
  searchKnowledge: {
    limit: 60,
    windowMs: FIVE_MINUTES_MS,
  },
} satisfies Record<string, FixedWindowRateLimitPreset>

export async function consumeFixedWindowRateLimit(
  input: ConsumeFixedWindowRateLimitInput,
): Promise<FixedWindowRateLimitResult> {
  assertValidPreset(input.preset)

  const now = input.now ?? Date.now()
  const windowStart = Math.floor(now / input.preset.windowMs) * input.preset.windowMs
  const resetAt = windowStart + input.preset.windowMs
  const existingRecord = await input.store.get(input.key)
  const activeRecord = existingRecord?.windowStart === windowStart ? existingRecord : null

  if (activeRecord && activeRecord.count >= input.preset.limit) {
    return {
      allowed: false,
      count: activeRecord.count,
      limit: input.preset.limit,
      remaining: 0,
      resetAt,
      retryAfterMs: Math.max(resetAt - now, 0),
    }
  }

  const nextCount = activeRecord ? activeRecord.count + 1 : 1

  await input.store.set(input.key, {
    count: nextCount,
    windowStart,
  })

  return {
    allowed: true,
    count: nextCount,
    limit: input.preset.limit,
    remaining: Math.max(input.preset.limit - nextCount, 0),
    resetAt,
    retryAfterMs: 0,
  }
}

function assertValidPreset(preset: FixedWindowRateLimitPreset): void {
  if (!Number.isInteger(preset.limit) || preset.limit <= 0) {
    throw new RangeError('Fixed-window limit must be a positive integer.')
  }

  if (!Number.isInteger(preset.windowMs) || preset.windowMs <= 0) {
    throw new RangeError('Fixed-window windowMs must be a positive integer.')
  }
}
