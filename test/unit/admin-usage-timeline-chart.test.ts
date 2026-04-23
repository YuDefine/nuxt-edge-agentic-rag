import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { h } from 'vue'
import { mountSuspended, mockComponent } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UsageTimelineBucket } from '~~/shared/types/usage'
import { USAGE_TIMELINE_CATEGORIES, buildUsageTimelineChartData } from '~~/app/utils/chart-series'

const lineChartSpy = vi.fn()
const nuxtChartsRuntimePath = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.resolve('nuxt-charts'))), 'runtime/vue-chrts.js'),
)

mockComponent('UCard', {
  setup(_, { slots }) {
    return () =>
      h('section', { 'data-testid': 'card' }, [
        h('div', { 'data-testid': 'card-header' }, slots.header?.()),
        h('div', { 'data-testid': 'card-body' }, slots.default?.()),
      ])
  },
})

const lineChartStub = {
  props: {
    categories: {
      type: Object,
      required: true,
    },
    data: {
      type: Array,
      required: true,
    },
    xFormatter: {
      type: Function,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    lineChartSpy(props)
    return {}
  },
  template: '<div data-testid="line-chart-stub" />',
}

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

describe('AdminUsageTimelineChart', () => {
  beforeEach(() => {
    lineChartSpy.mockReset()
  })

  afterEach(() => {
    vi.doUnmock(nuxtChartsRuntimePath)
  })

  async function loadTimelineChart() {
    vi.doMock(nuxtChartsRuntimePath, async (importOriginal) => {
      const actual = await importOriginal()
      return {
        ...actual,
        LineChart: lineChartStub,
      }
    })

    const module = await import('~~/app/components/admin/usage/TimelineChart.vue')
    return module.default
  }

  it('renders a LineChart using mapped timeline data and range-derived labels', async () => {
    const wrapper = await mountSuspended(await loadTimelineChart(), {
      props: {
        buckets,
        range: 'today',
      },
    })

    expect(wrapper.text()).toContain('Tokens 時間分佈')
    expect(wrapper.find('[data-testid="line-chart-stub"]').exists()).toBe(true)
    expect(lineChartSpy).toHaveBeenCalledTimes(1)

    const chartProps = lineChartSpy.mock.calls[0]?.[0]
    const expectedChartData = buildUsageTimelineChartData(buckets, 'today')

    expect(chartProps.data).toEqual(expectedChartData.data)
    expect(chartProps.categories).toEqual(USAGE_TIMELINE_CATEGORIES)
    expect(chartProps.xFormatter(0)).toBe('08:00')
    expect(chartProps.xFormatter(1)).toBe('09:00')
  })

  it('keeps the existing empty copy when there are no timeline buckets', async () => {
    const wrapper = await mountSuspended(await loadTimelineChart(), {
      props: {
        buckets: [],
        range: 'today',
      },
    })

    expect(wrapper.text()).toContain('所選範圍尚無呼叫紀錄。')
    expect(wrapper.find('[data-testid="line-chart-stub"]').exists()).toBe(false)
  })
})
