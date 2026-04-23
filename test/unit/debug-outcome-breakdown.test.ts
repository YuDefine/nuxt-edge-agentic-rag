import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { h } from 'vue'
import { mountSuspended, mockComponent } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildOutcomeBreakdownChartData } from '~~/app/utils/chart-series'

const barChartSpy = vi.fn()
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

const barChartStub = {
  props: {
    categories: {
      type: Object,
      required: true,
    },
    data: {
      type: Array,
      required: true,
    },
    xAxis: {
      type: String,
      required: false,
      default: undefined,
    },
    yAxis: {
      type: Array,
      required: true,
    },
  },
  setup(props) {
    barChartSpy(props)
    return {}
  },
  template: '<div data-testid="bar-chart-stub" />',
}

describe('DebugOutcomeBreakdown', () => {
  beforeEach(() => {
    barChartSpy.mockReset()
  })

  afterEach(() => {
    vi.doUnmock(nuxtChartsRuntimePath)
  })

  async function loadOutcomeBreakdown() {
    vi.doMock(nuxtChartsRuntimePath, async (importOriginal) => {
      const actual = await importOriginal()
      return {
        ...actual,
        BarChart: barChartStub,
      }
    })

    const module = await import('~~/app/components/debug/OutcomeBreakdown.vue')
    return module.default
  }

  it('renders a BarChart with governed outcome order and visible text labels', async () => {
    const wrapper = await mountSuspended(await loadOutcomeBreakdown(), {
      props: {
        channel: 'web',
        outcomes: {
          answered: 12,
          refused: 3,
          forbidden: 0,
          error: 1,
        },
      },
    })

    expect(wrapper.text()).toContain('web 結果分布')
    expect(wrapper.text()).toContain('總數：16')
    expect(wrapper.find('[data-testid="bar-chart-stub"]').exists()).toBe(true)
    expect(barChartSpy).toHaveBeenCalledTimes(1)

    const chartProps = barChartSpy.mock.calls[0]?.[0]
    const expected = buildOutcomeBreakdownChartData({
      answered: 12,
      refused: 3,
      forbidden: 0,
      error: 1,
    })

    expect(chartProps.data).toEqual(expected.data)
    expect(chartProps.categories).toEqual(expected.categories)
    expect(chartProps.xAxis).toBe('group')
    expect(chartProps.yAxis).toEqual(expected.order)
    expect(wrapper.text()).toContain('已回答')
    expect(wrapper.text()).toContain('拒答')
    expect(wrapper.text()).toContain('阻擋')
    expect(wrapper.text()).toContain('錯誤')
  })

  it('keeps zero-count categories visible in the supporting text list', async () => {
    const wrapper = await mountSuspended(await loadOutcomeBreakdown(), {
      props: {
        channel: 'mcp',
        outcomes: {
          answered: 0,
          refused: 0,
          forbidden: 0,
          error: 5,
        },
      },
    })

    expect(wrapper.find('[data-testid="bar-chart-stub"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('已回答')
    expect(wrapper.text()).toContain('拒答')
    expect(wrapper.text()).toContain('阻擋')
    expect(wrapper.text()).toContain('錯誤')
    expect(wrapper.text()).toContain('0 (0%)')
  })
})
