/**
 * TD-005 a11y verification spec — axe-core scan of the four admin pages
 * that TD-005 targets. This spec is a low-risk regression guard to keep
 * the fixes honest across future refactors.
 *
 * Pages covered:
 *   - /admin/query-logs       (button-name / label / empty-table-header)
 *   - /admin/documents        (empty-table-header)
 *   - /admin/tokens           (empty-table-header)
 *   - /admin/debug/latency    (heading-order)
 *
 * Requires an admin session — uses devLogin helper with E2E_ADMIN_EMAIL.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { ADMIN_EMAIL, BASE_URL, devLogin } from './helpers'

const TARGETED_RULES = ['button-name', 'label', 'empty-table-header', 'heading-order']

const ROUTES = [
  '/admin/query-logs',
  '/admin/documents',
  '/admin/tokens',
  '/admin/debug/latency',
] as const

test.describe('TD-005 admin a11y (button-name / label / empty-table-header / heading-order)', () => {
  test.beforeEach(async ({ page }) => {
    await devLogin(page, ADMIN_EMAIL)
  })

  for (const route of ROUTES) {
    test(`${route} has no targeted a11y violations`, async ({ page }) => {
      await page.goto(`${BASE_URL}${route}`)
      await page.waitForLoadState('networkidle')

      const results = await new AxeBuilder({ page }).withRules(TARGETED_RULES).analyze()

      expect(
        results.violations,
        `Violations: ${JSON.stringify(results.violations, null, 2)}`,
      ).toEqual([])
    })
  }
})
