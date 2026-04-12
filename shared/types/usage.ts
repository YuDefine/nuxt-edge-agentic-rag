export const USAGE_RANGE_VALUES = ['today', '7d', '30d'] as const
export type UsageRange = (typeof USAGE_RANGE_VALUES)[number]

export const WORKERS_AI_FREE_QUOTA_PER_DAY = 10_000

export interface UsageTokens {
  input: number
  output: number
  total: number
}

export interface UsageNeurons {
  used: number
  freeQuotaPerDay: number
  remaining: number
}

export interface UsageRequests {
  total: number
  cached: number
  cacheHitRate: number
}

export interface UsageTimelineBucket {
  timestamp: string
  tokens: number
  requests: number
  cacheHits: number
}

export interface UsageSnapshot {
  tokens: UsageTokens
  neurons: UsageNeurons
  requests: UsageRequests
  timeline: UsageTimelineBucket[]
  lastUpdatedAt: string
}

export interface UsageResponse {
  data: UsageSnapshot
}
