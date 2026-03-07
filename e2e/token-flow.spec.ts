import { test, Page } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

import { ADMIN_EMAIL, BASE_URL, devLogin } from './helpers'

const __filename = fileURLToPath(import.meta.url)
const __dirname_compat = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(__dirname_compat, '../screenshots/local/manual-review')

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

test.beforeEach(async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
})

async function ss(page: Page, name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}`, fullPage: true })
}

test('A - create token and reveal', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/tokens`)
  await page.waitForSelector('text=MCP Token 管理', { timeout: 10000 })
  await ss(page, 'A1-token-list-empty.png')

  // Click create button (top right header)
  await page.getByRole('button', { name: '建立 Token' }).first().click()
  await page.waitForSelector('text=建立 MCP Token', { timeout: 5000 })
  await ss(page, 'A3-token-create-form.png')

  // Fill name field
  await page.getByPlaceholder('例如：CI token').fill('test-token-1')

  // Click the label of the first UCheckbox (knowledge.ask)
  // UCheckbox renders a label span, not a raw input — click the label text
  await page.getByText('問答（knowledge.ask）').click()
  await ss(page, 'A4-token-form-filled.png')

  // Click submit button inside the modal footer
  await page.getByRole('button', { name: '建立 Token' }).last().click()

  // Wait for reveal state
  await page.waitForSelector('text=僅顯示此一次', { timeout: 10000 })
  await ss(page, 'A5-token-reveal-modal.png')

  // Close the modal
  const tokenDialog = page.getByRole('dialog', { name: '建立 MCP Token' })
  await tokenDialog.getByRole('button', { name: '關閉' }).last().click()
  await page.waitForTimeout(800)
  await ss(page, 'A6-token-list-after-create.png')

  // Reload - token plaintext must not be visible
  await page.reload()
  await page.waitForSelector('text=MCP Token 管理', { timeout: 10000 })
  await ss(page, 'A7-token-list-reloaded-no-plaintext.png')
})

test('B - revoke token', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/tokens`)
  await page.waitForSelector('text=MCP Token 管理', { timeout: 10000 })
  await ss(page, 'B1-tokens-list.png')

  // Check if there is at least one active token with revoke button
  const revokeBtn = page.getByRole('button', { name: /撤銷/ }).first()
  const hasRevoke = await revokeBtn.isVisible({ timeout: 3000 }).catch(() => false)

  if (!hasRevoke) {
    await ss(page, 'B-no-revoke-available.png')
    return
  }

  // Click revoke on the first active token
  await revokeBtn.click()
  await page.waitForTimeout(400)
  await ss(page, 'B3-revoke-confirm-modal.png')

  // Click the confirm revoke button (last "撤銷" or "確認")
  const confirmBtn = page.getByRole('button', { name: /撤銷/ }).last()
  await confirmBtn.click()
  await page.waitForTimeout(1500)
  await ss(page, 'B4-token-list-revoked-badge.png')

  // B5: try to revoke same token again (idempotency) — revoke button should be gone
  const revokeBtn2 = page.getByRole('button', { name: /撤銷/ }).first()
  await revokeBtn2.isVisible({ timeout: 1500 }).catch(() => false)
  await ss(page, 'B5-final-state-after-revoke.png')
})

test('G - latency period select', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/debug/latency`)
  await page.waitForSelector('text=Debug', { timeout: 10000 })
  await ss(page, 'G2-latency-full-page.png')

  // The period selector is a USelectMenu — it renders as a button with the label text
  // Try clicking the button that shows "近 7 天"
  const periodBtn = page.getByRole('button', { name: '近 7 天' }).first()
  const hasPeriodBtn = await periodBtn.isVisible({ timeout: 3000 }).catch(() => false)
  if (hasPeriodBtn) {
    await periodBtn.click()
    await page.waitForTimeout(400)
    await ss(page, 'G4-period-dropdown-open.png')
    // Select 近 30 天
    const opt30 = page.getByRole('option', { name: '近 30 天' })
    await opt30.click().catch(async () => {
      await page.getByText('近 30 天').click()
    })
    await page.waitForTimeout(800)
    await ss(page, 'G4b-period-30day.png')

    // Switch back to 7 days
    await page.getByRole('button', { name: '近 30 天' }).first().click()
    await page.waitForTimeout(300)
    const opt7 = page.getByRole('option', { name: '近 7 天' })
    await opt7.click().catch(async () => {
      await page.getByText('近 7 天').click()
    })
    await page.waitForTimeout(800)
    await ss(page, 'G4a-period-7day.png')
  } else {
    await ss(page, 'G4-period-selector-not-found.png')
  }
})
