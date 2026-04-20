import { test } from '@playwright/test'
import { fileURLToPath } from 'url'
import * as path from 'path'
import { devLogin, BASE_URL } from './helpers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const OUT = path.resolve(__dirname, '../screenshots/local/passkey-authentication')

const BREAKPOINTS = [
  { name: 'xs', width: 360, height: 812 },
  { name: 'md', width: 768, height: 1024 },
  { name: 'xl', width: 1280, height: 900 },
]

// ── Page 1: Login page (unauthenticated) ──────────────────────────────────────
for (const bp of BREAKPOINTS) {
  test(`login-page @ ${bp.name} (${bp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: bp.height })
    await page.context().clearCookies()
    await page.goto(`${BASE_URL}/`)
    await page.waitForSelector('button', { timeout: 15000 })
    await page.waitForTimeout(1200)
    await page.screenshot({
      path: `${OUT}/login-${bp.name}.png`,
      fullPage: true,
    })
  })
}

// ── Page 2: Account Settings (member) ────────────────────────────────────────
for (const bp of BREAKPOINTS) {
  test(`account-settings @ ${bp.name} (${bp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: bp.height })
    await devLogin(page, 'member@test.local')
    await page.goto(`${BASE_URL}/account/settings`)
    await page.waitForTimeout(2000)
    await page.screenshot({
      path: `${OUT}/account-settings-${bp.name}.png`,
      fullPage: true,
    })
  })
}

// ── Page 3: Admin Members list ────────────────────────────────────────────────
for (const bp of BREAKPOINTS) {
  test(`admin-members @ ${bp.name} (${bp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: bp.height })
    await devLogin(page, 'admin@test.local')
    await page.goto(`${BASE_URL}/admin/members`)
    await page.waitForTimeout(2500)
    await page.screenshot({
      path: `${OUT}/admin-members-${bp.name}.png`,
      fullPage: true,
    })
  })
}

// ── Page 4: NicknameInput dialog (Passkey register) ───────────────────────────
for (const bp of BREAKPOINTS) {
  test(`passkey-register-dialog @ ${bp.name} (${bp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: bp.height })
    await page.context().clearCookies()
    await page.goto(`${BASE_URL}/`)
    await page.waitForSelector('button', { timeout: 15000 })
    await page.waitForTimeout(1000)

    // Find and click the Passkey register button
    const registerBtn = page.getByText('使用 Passkey 註冊新帳號')
    await registerBtn.click({ timeout: 10000 })

    // Wait for dialog/modal to appear
    await page.waitForTimeout(1200)

    await page.screenshot({
      path: `${OUT}/passkey-register-dialog-${bp.name}.png`,
      fullPage: true,
    })
  })
}
