import { test, Page } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

import { ADMIN_EMAIL, BASE_URL, devLogin } from './helpers'

const __filename = fileURLToPath(import.meta.url)
const __dirname_compat = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(__dirname_compat, '../screenshots/local/manual-review')

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

async function goto(page: Page, route: string) {
  await page.goto(`${BASE_URL}${route}`)
  await page.waitForLoadState('networkidle')
}

async function ss(page: Page, name: string) {
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/${name}`,
    fullPage: true,
  })
}

test.beforeEach(async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
})

// ---- A: Token list + create + reveal ----
test('A - token list and create flow', async ({ page }) => {
  test.slow()
  await goto(page, '/admin/tokens')
  await ss(page, 'A1-token-list-initial.png')

  await page.getByRole('button', { name: '建立 Token' }).first().click()
  await page.waitForSelector('text=建立 MCP Token', { timeout: 5000 })
  await ss(page, 'A3-token-create-form.png')

  await page.getByPlaceholder('例如：CI token').fill('manual-review-test-1')
  await page.getByText('搜尋（knowledge.search）').click()
  await ss(page, 'A4-token-form-filled.png')

  await page.getByRole('button', { name: '建立 Token' }).last().click()
  await page.waitForSelector('text=僅顯示此一次', { timeout: 10000 })

  // A5: success modal with token reveal
  await ss(page, 'A5-token-reveal-modal.png')

  // Close modal
  const tokenDialog = page.getByRole('dialog', { name: '建立 MCP Token' })
  await tokenDialog.getByRole('button', { name: '關閉' }).last().click()
  await page.waitForTimeout(800)
  await ss(page, 'A6-token-list-after-create.png')

  // Reload - token plaintext must not be visible
  await page.reload()
  await page.waitForLoadState('networkidle')
  await ss(page, 'A7-token-list-after-reload.png')
})

// ---- B: Token revoke ----
test('B - token revoke', async ({ page }) => {
  await goto(page, '/admin/tokens')
  await ss(page, 'B1-tokens-before-revoke.png')

  // Find revoke button or dropdown action
  const revokeBtn = page.getByRole('button', { name: /撤銷|revoke/i }).first()
  const revokeVisible = await revokeBtn.isVisible().catch(() => false)
  if (!revokeVisible) {
    // try action menu button (3-dots)
    const actionBtn = page
      .locator('[data-testid*="action"], button[aria-label*="action"], button[aria-haspopup]')
      .first()
    await actionBtn.click().catch(() => {})
    await page.waitForTimeout(400)
    await ss(page, 'B2-action-menu-open.png')
    const revokeOption = page.getByRole('menuitem', { name: /撤銷|revoke/i }).first()
    await revokeOption.click().catch(() => {})
  } else {
    await revokeBtn.click()
  }
  await page.waitForTimeout(600)
  await ss(page, 'B3-revoke-confirm-modal.png')

  // Confirm
  const confirmBtn = page.getByRole('button', { name: /確認|confirm|是|yes|revoke/i }).last()
  await confirmBtn.click().catch(() => {})
  await page.waitForTimeout(1500)
  await ss(page, 'B4-token-list-revoked-badge.png')

  // B5: try revoking again (idempotency test)
  const revokeBtn2 = page.getByRole('button', { name: /撤銷|revoke/i }).first()
  const stillVisible = await revokeBtn2.isVisible().catch(() => false)
  if (stillVisible) {
    await revokeBtn2.click()
    await page.waitForTimeout(400)
    const confirmBtn2 = page.getByRole('button', { name: /確認|confirm|是|yes/i }).last()
    await confirmBtn2.click().catch(() => {})
    await page.waitForTimeout(800)
  }
  await ss(page, 'B5-revoke-idempotent-final.png')
})

// ---- C: Query logs list + filter + detail ----
test('C - query logs list and detail', async ({ page }) => {
  await goto(page, '/admin/query-logs')
  await ss(page, 'C3-query-logs-list.png')

  // Check if list is empty
  const bodyText = await page.locator('body').textContent()
  const isEmpty =
    bodyText?.includes('沒有') ||
    bodyText?.includes('empty') ||
    bodyText?.includes('no data') ||
    bodyText?.includes('暫無')

  if (isEmpty) {
    await page.locator('tbody tr').count()
  }

  // Try channel filter - look for select or tabs
  const filterEl = page.locator('select, [role="combobox"]').first()
  const filterVisible = await filterEl.isVisible().catch(() => false)
  if (filterVisible) {
    await filterEl.selectOption({ label: /web/i }).catch(async () => {
      await filterEl.click()
      await page.waitForTimeout(300)
      const webOpt = page.getByRole('option', { name: /web/i }).first()
      await webOpt.click().catch(() => {})
    })
    await page.waitForTimeout(800)
    await ss(page, 'C4-query-logs-channel-filtered.png')
  } else {
    await ss(page, 'C4-query-logs-filter-unavailable.png')
  }

  // Click first row to go to detail
  const firstLink = page.locator('a[href*="/admin/query-logs/"]').first()
  const linkVisible = await firstLink.isVisible().catch(() => false)
  if (linkVisible) {
    await firstLink.click()
    await page.waitForLoadState('networkidle')
    await ss(page, 'C5-query-log-detail.png')
  } else {
    const firstRow = page.locator('tbody tr').first()
    const rowVisible = await firstRow.isVisible().catch(() => false)
    if (rowVisible) {
      await firstRow.click()
      await page.waitForLoadState('networkidle')
      await ss(page, 'C5-query-log-detail.png')
    } else {
      await ss(page, 'C5-query-log-no-data.png')
    }
  }
})

// ---- D: Redaction safe rendering ----
test('D - redaction safe rendering', async ({ page }) => {
  // get a query log id from API
  const resp = await page.request.get(`${BASE_URL}/api/admin/query-logs?limit=5`)
  let detailUrl = `${BASE_URL}/admin/query-logs`
  try {
    const json = await resp.json()
    const items =
      json?.data?.items || json?.data || json?.items || (Array.isArray(json) ? json : [])
    if (items.length > 0) {
      const id = items[0].id
      detailUrl = `${BASE_URL}/admin/query-logs/${id}`
    }
  } catch {}

  await page.goto(detailUrl)
  await page.waitForLoadState('networkidle')
  await ss(page, 'D1-detail-redaction-check.png')
})

// ---- E: Dashboard nav + feature gate ----
test('E - dashboard nav and feature gate', async ({ page }) => {
  await goto(page, '/admin/dashboard')
  await ss(page, 'E1-dashboard-page.png')

  // Check nav has 管理摘要 entry
  await page.locator('nav, [role="navigation"], aside').first().textContent()
})

// ---- F: Debug latency + debug query detail ----
test('F - debug latency and query detail', async ({ page }) => {
  await goto(page, '/admin/debug/latency')
  await ss(page, 'F1-debug-latency.png')

  // Get a query log id
  const resp = await page.request.get(`${BASE_URL}/api/admin/query-logs?limit=1`)
  let debugDetailUrl = ''
  try {
    const json = await resp.json()
    const items =
      json?.data?.items || json?.data || json?.items || (Array.isArray(json) ? json : [])
    if (items.length > 0) {
      debugDetailUrl = `${BASE_URL}/admin/debug/query-logs/${items[0].id}`
    }
  } catch {}

  if (debugDetailUrl) {
    await page.goto(debugDetailUrl)
    await page.waitForLoadState('networkidle')
    await ss(page, 'F2-debug-query-log-detail.png')
  } else {
    await ss(page, 'F2-debug-query-no-data.png')
  }
})

// ---- G: Latency 4 outcomes + null safety ----
test('G - latency 4 outcomes', async ({ page }) => {
  test.slow()
  await goto(page, '/admin/debug/latency')

  // G2: full page with summary cards
  await ss(page, 'G2-latency-full-page.png')

  // look for outcome breakdown section
  const outcomeSec = page
    .locator('[data-testid*="outcome"], section')
    .filter({ hasText: /answered|refused|forbidden|error|拒絕|答覆|禁止/ })
    .first()
  const outcomeVisible = await outcomeSec.isVisible().catch(() => false)
  if (outcomeVisible) {
    await outcomeSec.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
  }
  await ss(page, 'G3-outcome-breakdown.png')

  await ss(page, 'G4a-period-7day.png')

  const periodTrigger = page.locator('button').filter({ hasText: '近 7 天' }).first()
  const hasPeriodTrigger = (await periodTrigger.count()) > 0
  if (!hasPeriodTrigger) {
  } else {
    await periodTrigger.click()
    await page.waitForTimeout(300)

    const option30 = page.getByText('近 30 天', { exact: true }).last()
    const hasOption30 = await option30.isVisible({ timeout: 3000 }).catch(() => false)
    if (!hasOption30) {
    } else {
      await option30.click()
      await page.waitForTimeout(600)
      await ss(page, 'G4b-period-30day.png')
    }
  }
})
