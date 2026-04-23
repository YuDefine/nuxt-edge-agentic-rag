import { describe, expect, it } from 'vitest'

import type { UsageRange, UsageTimelineBucket } from '~~/shared/types/usage'
import {
  OUTCOME_CATEGORY_ORDER,
  buildOutcomeBreakdownChartData,
  buildUsageTimelineChartData,
  formatUsageTimelineLabel,
} from '~~/app/utils/chart-series'

describe('formatUsageTimelineLabel', () => {
  it.each<[UsageRange, string, string]>([
    ['today', '2026-04-24T08:00:00.000Z', '08:00'],
    ['7d', '2026-04-24T00:00:00.000Z', '4/24'],
    ['30d', '2026-04-24T00:00:00.000Z', '4/24'],
  ])('formats %s buckets using the spec example label style', (range, iso, expectedLabel) => {
    expect(formatUsageTimelineLabel(iso, range)).toBe(expectedLabel)
  })

  it('returns em dash when the value is invalid', () => {
    expect(formatUsageTimelineLabel('not-a-date', 'today')).toBe('—')
  })
})

describe('buildUsageTimelineChartData', () => {
  it('returns an empty chart payload for an empty timeline', () => {
    expect(buildUsageTimelineChartData([], 'today')).toEqual({
      categories: {
        tokens: {
          color: '#2563eb',
          name: 'Tokens',
        },
      },
      data: [],
    })
  })

  it('maps timeline buckets into chart rows with derived labels', () => {
    const buckets: UsageTimelineBucket[] = [
      {
        timestamp: '2026-04-24T08:00:00.000Z',
        tokens: 1200,
        requests: 12,
        cacheHits: 4,
      },
      {
        timestamp: '2026-04-24T09:00:00.000Z',
        tokens: 840,
        requests: 9,
        cacheHits: 3,
      },
    ]

    expect(buildUsageTimelineChartData(buckets, 'today')).toEqual({
      categories: {
        tokens: {
          color: '#2563eb',
          name: 'Tokens',
        },
      },
      data: [
        {
          cacheHits: 4,
          label: '08:00',
          requests: 12,
          timestamp: '2026-04-24T08:00:00.000Z',
          tokens: 1200,
        },
        {
          cacheHits: 3,
          label: '09:00',
          requests: 9,
          timestamp: '2026-04-24T09:00:00.000Z',
          tokens: 840,
        },
      ],
    })
  })
})

describe('buildOutcomeBreakdownChartData', () => {
  it('keeps all governed categories in a stable order, including zero-count outcomes', () => {
    expect(
      buildOutcomeBreakdownChartData({
        answered: 12,
        refused: 3,
        forbidden: 0,
        error: 1,
      }),
    ).toEqual({
      categories: {
        answered: {
          color: '#16a34a',
          name: '已回答',
        },
        error: {
          color: '#475569',
          name: '錯誤',
        },
        forbidden: {
          color: '#dc2626',
          name: '阻擋',
        },
        refused: {
          color: '#d97706',
          name: '拒答',
        },
      },
      data: [
        {
          group: '結果分布',
          answered: 12,
          refused: 3,
          forbidden: 0,
          error: 1,
        },
      ],
      order: OUTCOME_CATEGORY_ORDER,
      rows: [
        { key: 'answered', label: '已回答', count: 12, color: '#16a34a' },
        { key: 'refused', label: '拒答', count: 3, color: '#d97706' },
        { key: 'forbidden', label: '阻擋', count: 0, color: '#dc2626' },
        { key: 'error', label: '錯誤', count: 1, color: '#475569' },
      ],
      total: 16,
    })
  })

  it('does not remove zero-only categories', () => {
    const outcomeChart = buildOutcomeBreakdownChartData({
      answered: 0,
      refused: 0,
      forbidden: 0,
      error: 5,
    })

    expect(outcomeChart.rows.map((row) => row.key)).toEqual([
      'answered',
      'refused',
      'forbidden',
      'error',
    ])
    expect(outcomeChart.data[0]).toEqual({
      group: '結果分布',
      answered: 0,
      refused: 0,
      forbidden: 0,
      error: 5,
    })
  })
})
