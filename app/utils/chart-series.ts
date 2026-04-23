import { assertNever } from '~~/shared/utils/assert-never'
import type { OutcomeBreakdown } from '~~/shared/types/observability'
import type { UsageRange, UsageTimelineBucket } from '~~/shared/types/usage'

export interface UsageTimelineChartPoint extends UsageTimelineBucket {
  label: string
}

export type OutcomeCategoryKey = keyof OutcomeBreakdown

export interface OutcomeBreakdownRow {
  key: OutcomeCategoryKey
  label: string
  count: number
  color: string
}

export const USAGE_TIMELINE_CATEGORIES = {
  tokens: {
    color: '#2563eb',
    name: 'Tokens',
  },
} as const

export const OUTCOME_CATEGORY_ORDER = ['answered', 'refused', 'forbidden', 'error'] as const

export const OUTCOME_CHART_CATEGORIES = {
  answered: {
    color: '#16a34a',
    name: '已回答',
  },
  refused: {
    color: '#d97706',
    name: '拒答',
  },
  forbidden: {
    color: '#dc2626',
    name: '阻擋',
  },
  error: {
    color: '#475569',
    name: '錯誤',
  },
} as const satisfies Record<OutcomeCategoryKey, { color: string; name: string }>

export function formatUsageTimelineLabel(iso: string, range: UsageRange): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }

  switch (range) {
    case 'today':
      return `${date.getUTCHours().toString().padStart(2, '0')}:00`
    case '7d':
    case '30d':
      return `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}/${date
        .getUTCDate()
        .toString()
        .padStart(2, '0')}`
    default:
      return assertNever(range, 'formatUsageTimelineLabel')
  }
}

export function buildUsageTimelineChartData(
  buckets: UsageTimelineBucket[],
  range: UsageRange,
): {
  categories: typeof USAGE_TIMELINE_CATEGORIES
  data: UsageTimelineChartPoint[]
} {
  return {
    categories: USAGE_TIMELINE_CATEGORIES,
    data: buckets.map((bucket) => ({
      ...bucket,
      label: formatUsageTimelineLabel(bucket.timestamp, range),
    })),
  }
}

export function buildOutcomeBreakdownChartData(outcomes: OutcomeBreakdown): {
  categories: typeof OUTCOME_CHART_CATEGORIES
  data: Array<{ group: string } & OutcomeBreakdown>
  order: typeof OUTCOME_CATEGORY_ORDER
  rows: OutcomeBreakdownRow[]
  total: number
} {
  const rows = OUTCOME_CATEGORY_ORDER.map((key) => ({
    key,
    label: OUTCOME_CHART_CATEGORIES[key].name,
    count: outcomes[key],
    color: OUTCOME_CHART_CATEGORIES[key].color,
  }))

  return {
    categories: OUTCOME_CHART_CATEGORIES,
    data: [{ group: '結果分布', ...outcomes }],
    order: OUTCOME_CATEGORY_ORDER,
    rows,
    total: rows.reduce((sum, row) => sum + row.count, 0),
  }
}
