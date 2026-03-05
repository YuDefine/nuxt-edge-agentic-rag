import { describe, expect, it } from 'vitest'

/**
 * Unit tests for Admin Dashboard UI pure logic:
 * - Trend bar percentage calculation
 * - Navigation link list gating on `adminDashboardEnabled`
 *
 * These mirror the display logic in
 * `app/components/admin/dashboard/QueryTrendList.vue` and
 * `app/layouts/default.vue` without touching Vue runtime.
 */

interface TrendPoint {
  count: number
  date: string
}

function computeMaxCount(points: TrendPoint[]): number {
  if (points.length === 0) return 0
  return points.reduce((acc, p) => (p.count > acc ? p.count : acc), 0)
}

function computeBarPercent(count: number, maxCount: number): number {
  if (maxCount === 0) return 0
  return Math.round((count / maxCount) * 100)
}

describe('trend bar percentage', () => {
  it('returns 0 when max count is zero', () => {
    expect(computeBarPercent(0, 0)).toBe(0)
  })

  it('returns 100 for the max count point', () => {
    expect(computeBarPercent(50, 50)).toBe(100)
  })

  it('proportionally scales smaller counts', () => {
    expect(computeBarPercent(25, 100)).toBe(25)
    expect(computeBarPercent(1, 4)).toBe(25)
  })

  it('rounds to nearest integer', () => {
    expect(computeBarPercent(1, 3)).toBe(33)
    expect(computeBarPercent(2, 3)).toBe(67)
  })
})

describe('computeMaxCount', () => {
  it('returns 0 for empty list', () => {
    expect(computeMaxCount([])).toBe(0)
  })

  it('finds the largest count across points', () => {
    const points: TrendPoint[] = [
      { date: '2026-04-17', count: 5 },
      { date: '2026-04-18', count: 30 },
      { date: '2026-04-19', count: 12 },
    ]
    expect(computeMaxCount(points)).toBe(30)
  })
})

interface NavLink {
  label: string
  to: string
}

function buildAdminNavLinks(input: { dashboardEnabled: boolean; isAdmin: boolean }): NavLink[] {
  const items: NavLink[] = [{ label: '問答', to: '/' }]

  if (input.isAdmin) {
    items.push(
      { label: '文件管理', to: '/admin/documents' },
      { label: 'Token 管理', to: '/admin/tokens' },
      { label: '查詢日誌', to: '/admin/query-logs' }
    )
    if (input.dashboardEnabled) {
      items.push({ label: '管理摘要', to: '/admin/dashboard' })
    }
  }

  return items
}

describe('admin navigation link list', () => {
  it('hides all admin entries for non-admin users', () => {
    const links = buildAdminNavLinks({ dashboardEnabled: true, isAdmin: false })
    expect(links.map((l) => l.to)).toEqual(['/'])
  })

  it('includes documents/tokens/query-logs when admin', () => {
    const links = buildAdminNavLinks({ dashboardEnabled: false, isAdmin: true })
    const paths = links.map((l) => l.to)
    expect(paths).toContain('/admin/documents')
    expect(paths).toContain('/admin/tokens')
    expect(paths).toContain('/admin/query-logs')
    // Dashboard should be hidden when flag is off.
    expect(paths).not.toContain('/admin/dashboard')
  })

  it('includes dashboard entry only when feature flag is enabled', () => {
    const links = buildAdminNavLinks({ dashboardEnabled: true, isAdmin: true })
    expect(links.map((l) => l.to)).toContain('/admin/dashboard')
  })
})
