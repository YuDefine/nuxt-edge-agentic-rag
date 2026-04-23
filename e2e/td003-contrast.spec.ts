/**
 * TD-003 color-contrast regression guard.
 *
 * Goal: ensure the batch replacement of `text-dimmed` → `text-muted` across
 * admin debug / auth callback / upload wizard stays honest. axe-core's
 * `color-contrast` rule is stricter than WCAG AA (4.5:1 body, 3:1 large
 * text) — if any future refactor reintroduces `text-dimmed` on `bg-default`
 * this spec will flag it.
 *
 * Coverage mirrors the acceptance criteria in docs/tech-debt.md TD-003:
 *   - /admin/debug/latency            (LatencySummaryCards + OutcomeBreakdown)
 *   - /admin/debug/query-logs/[id]    (latency fields + EvidencePanel + ScorePanel)
 *   - /admin/query-logs               (list) — sanity check
 *   - /admin/tokens                   (list) — sanity check
 *   - /admin/documents/upload         (UploadWizard step indicator + hints)
 *   - /auth/callback                  (loader text + icon)
 *
 * The auth/callback page is visited unauthenticated; all others use the
 * admin dev-login helper.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { ADMIN_EMAIL, BASE_URL, devLogin } from './helpers'

const CONTRAST_RULE = ['color-contrast']

const ADMIN_ROUTES = [
  '/admin/usage',
  '/admin/debug/latency',
  '/admin/query-logs',
  '/admin/tokens',
  '/admin/documents/upload',
] as const

// Seeded log ID (matches observability-review.spec.ts fixtures) — has both
// answered path with latency present AND null-latency refusal neighbours.
const DETAIL_LOG_IDS = ['log-test-answered-1', 'log-test-refused-1'] as const

test.describe('TD-003 color-contrast (admin pages)', () => {
  test.beforeEach(async ({ page }) => {
    await devLogin(page, ADMIN_EMAIL)
  })

  for (const route of ADMIN_ROUTES) {
    test(`${route} has no color-contrast violations`, async ({ page }) => {
      await page.goto(`${BASE_URL}${route}`)
      await page.waitForLoadState('networkidle')

      const results = await new AxeBuilder({ page }).withRules(CONTRAST_RULE).analyze()

      expect(
        results.violations,
        `color-contrast violations on ${route}: ${JSON.stringify(results.violations, null, 2)}`,
      ).toEqual([])
    })
  }

  for (const id of DETAIL_LOG_IDS) {
    test(`/admin/debug/query-logs/${id} has no color-contrast violations`, async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/debug/query-logs/${id}`)
      await page.waitForLoadState('networkidle')

      // Historically excluded tonal-badge selectors (.text-warning /
      // .bg-{warning,error,success}/10) are now AA-compliant via
      // TD-006 per-component `compoundVariants` overrides in
      // `app/app.config.ts` (text shade shifted to `-700` / `dark:-200`).
      // The `<p class="text-warning-700 ...">` redaction notice also
      // uses the darker shade directly since it's a raw element, not a
      // component variant.
      const results = await new AxeBuilder({ page }).withRules(CONTRAST_RULE).analyze()

      expect(
        results.violations,
        `color-contrast violations on detail ${id}: ${JSON.stringify(results.violations, null, 2)}`,
      ).toEqual([])
    })
  }
})

test.describe('TD-003 color-contrast (public pages)', () => {
  test('/auth/callback has no color-contrast violations', async ({ page }) => {
    // No login — callback is a public route that renders the loader until
    // either `?error=` arrives or a timeout kicks in at 10s. We scan the
    // initial loader state (text-muted + spinner icon).
    await page.goto(`${BASE_URL}/auth/callback`)
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page }).withRules(CONTRAST_RULE).analyze()

    expect(
      results.violations,
      `color-contrast violations on /auth/callback: ${JSON.stringify(results.violations, null, 2)}`,
    ).toEqual([])
  })
})
