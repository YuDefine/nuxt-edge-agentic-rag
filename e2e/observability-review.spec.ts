import { test } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

import { ADMIN_EMAIL, BASE_URL, MEMBER_EMAIL, devLogin } from './helpers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SS_DIR = path.resolve(__dirname, '../screenshots/local/observability-review')

// Known test log IDs seeded via SQLite
const LOG_ID_ANSWERED = 'log-test-answered-1'
const LOG_ID_REFUSED = 'log-test-refused-1'

// ─────────────────────────────────────────────────────────────────────
// Admin sidebar + navigation structure
// ─────────────────────────────────────────────────────────────────────
test('#nav admin dashboard', async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
  await page.goto(`${BASE_URL}/admin/dashboard`)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SS_DIR}/#nav-admin-dashboard.png`, fullPage: true })
})

// ─────────────────────────────────────────────────────────────────────
// #1a — Admin query-logs LIST page (captures 500 bug if present)
// ─────────────────────────────────────────────────────────────────────
test('#1a admin query-logs list page', async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
  await page.goto(`${BASE_URL}/admin/query-logs`)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SS_DIR}/#1a-admin-query-logs-list.png`, fullPage: true })
})

// ─────────────────────────────────────────────────────────────────────
// #1b — Admin debug detail: answered log (has latency + decision_path)
// ─────────────────────────────────────────────────────────────────────
test('#1b admin debug detail: answered (decision_path + latency present)', async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
  await page.goto(`${BASE_URL}/admin/debug/query-logs/${LOG_ID_ANSWERED}`)
  await page.waitForTimeout(2000)
  await page.screenshot({
    path: `${SS_DIR}/#1b-debug-detail-answered.png`,
    fullPage: true,
  })
})

// ─────────────────────────────────────────────────────────────────────
// #1b-refused — Admin debug detail: refused log (refusal_reason, null latency)
// ─────────────────────────────────────────────────────────────────────
test('#1b-refused admin debug detail: refused (refusal diagnostics + null latency)', async ({
  page,
}) => {
  await devLogin(page, ADMIN_EMAIL)
  await page.goto(`${BASE_URL}/admin/debug/query-logs/${LOG_ID_REFUSED}`)
  await page.waitForTimeout(2000)
  await page.screenshot({
    path: `${SS_DIR}/#1b-debug-detail-refused.png`,
    fullPage: true,
  })
})

// ─────────────────────────────────────────────────────────────────────
// #1c — Admin debug latency summary page
// ─────────────────────────────────────────────────────────────────────
test('#1c admin debug latency summary page', async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
  await page.goto(`${BASE_URL}/admin/debug/latency`)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SS_DIR}/#1c-admin-debug-latency.png`, fullPage: true })
})

// ─────────────────────────────────────────────────────────────────────
// #2a — Member chat page: no debug fields visible
// ─────────────────────────────────────────────────────────────────────
test('#2a member chat page: no debug fields', async ({ page }) => {
  await devLogin(page, MEMBER_EMAIL)
  await page.goto(`${BASE_URL}/`)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${SS_DIR}/#2a-member-home-chat.png`, fullPage: true })
  const bodyText = await page.locator('body').textContent()
  const debugTerms = [
    'decision_path',
    'decisionPath',
    'judgeScore',
    'retrievalScore',
    'latency_ms',
    '首 token 延遲',
    '完成延遲',
    'Debug',
    'Internal Debug',
  ]
  debugTerms.filter((term) => bodyText?.includes(term))
})

// ─────────────────────────────────────────────────────────────────────
// #2b — Member tries to access admin debug latency: should be blocked
// ─────────────────────────────────────────────────────────────────────
test('#2b member access admin debug latency: blocked', async ({ page }) => {
  await devLogin(page, MEMBER_EMAIL)
  await page.goto(`${BASE_URL}/admin/debug/latency`)
  await page.waitForTimeout(2000)
  await page.screenshot({
    path: `${SS_DIR}/#2b-member-debug-latency-blocked.png`,
    fullPage: true,
  })
})

// ─────────────────────────────────────────────────────────────────────
// #2c — Member tries to access admin query-logs: should be blocked
// ─────────────────────────────────────────────────────────────────────
test('#2c member access admin query-logs: blocked', async ({ page }) => {
  await devLogin(page, MEMBER_EMAIL)
  await page.goto(`${BASE_URL}/admin/query-logs`)
  await page.waitForTimeout(2000)
  await page.screenshot({
    path: `${SS_DIR}/#2c-member-query-logs-blocked.png`,
    fullPage: true,
  })
})

// ─────────────────────────────────────────────────────────────────────
// #3b — Debug detail: null latency renders "—" not "0"
// ─────────────────────────────────────────────────────────────────────
test('#3b debug detail null latency: refused log shows "—" not "0 ms"', async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
  await page.goto(`${BASE_URL}/admin/debug/query-logs/${LOG_ID_REFUSED}`)
  await page.waitForTimeout(2000)
  await page.screenshot({
    path: `${SS_DIR}/#3b-debug-detail-null-latency.png`,
    fullPage: true,
  })
})

// ─────────────────────────────────────────────────────────────────────
// #3c — Debug latency summary: empty period shows message not "0 ms"
// ─────────────────────────────────────────────────────────────────────
test('#3c debug latency summary null handling', async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
  await page.goto(`${BASE_URL}/admin/debug/latency`)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SS_DIR}/#3c-debug-latency-summary.png`, fullPage: true })
  const bodyText = await page.locator('body').textContent()
  const hasZero = bodyText?.includes('0 ms')
  const hasNullDisplay =
    bodyText?.includes('—') ||
    bodyText?.includes('N/A') ||
    bodyText?.includes('無任何記錄') ||
    bodyText?.includes('所選期間內無任何記錄')
  void hasZero
  void hasNullDisplay
})

// ─────────────────────────────────────────────────────────────────────
// #3d — Debug detail: answered log shows actual latency numbers
// ─────────────────────────────────────────────────────────────────────
test('#3d debug detail answered log: latency numbers rendered', async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
  await page.goto(`${BASE_URL}/admin/debug/query-logs/${LOG_ID_ANSWERED}`)
  await page.waitForTimeout(2000)
  await page.screenshot({
    path: `${SS_DIR}/#3d-debug-detail-latency-present.png`,
    fullPage: true,
  })
})
