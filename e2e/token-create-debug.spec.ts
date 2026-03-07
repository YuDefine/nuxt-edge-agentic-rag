import { test, Page } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

import { ADMIN_EMAIL, BASE_URL, devLogin } from './helpers'

const __filename = fileURLToPath(import.meta.url)
const __dirname_compat = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(__dirname_compat, '../screenshots/local/manual-review')
const LOG_FILE = path.resolve(__dirname_compat, '../screenshots/local/manual-review/csrf-debug.log')

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

function log(msg: string) {
  fs.appendFileSync(LOG_FILE, msg + '\n')
}

test.beforeEach(async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
})

async function ss(page: Page, name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}`, fullPage: true })
  log(`[ss] ${name}`)
}

test('A - create token via Nuxt $fetch', async ({ page }) => {
  fs.writeFileSync(LOG_FILE, '=== CSRF Debug Log v2 ===\n')

  await page.goto(`${BASE_URL}/admin/tokens`)
  await page.waitForSelector('text=MCP Token 管理', { timeout: 10000 })

  // Use Nuxt's $fetch which should handle CSRF automatically via useNuxtApp plugin
  const apiResult = await page.evaluate(async () => {
    try {
      // Access Nuxt app's $fetch which has the CSRF plugin hooked in
      const nuxtApp = useNuxtApp()
      const result = await nuxtApp.$fetch('/api/admin/mcp-tokens', {
        method: 'POST',
        body: { name: 'test-token-1', scopes: ['knowledge.search'] },
      })
      return { ok: true, data: JSON.stringify(result ?? null).slice(0, 300) }
    } catch (e: unknown) {
      const err = e as { data?: unknown; message?: string; status?: number }
      return {
        ok: false,
        message: err?.message,
        status: err?.status,
        data: JSON.stringify(err?.data ?? null).slice(0, 200),
      }
    }
  })

  log('Nuxt $fetch result: ' + JSON.stringify(apiResult))
})

test('A - full create flow via UI + page.evaluate $fetch', async ({ page }) => {
  fs.appendFileSync(LOG_FILE, '\n=== Full create flow ===\n')

  await page.goto(`${BASE_URL}/admin/tokens`)
  await page.waitForSelector('text=MCP Token 管理', { timeout: 10000 })
  await ss(page, 'A1-token-list-empty.png')

  // Open create modal via UI
  await page.getByRole('button', { name: '建立 Token' }).first().click()
  await page.waitForSelector('text=建立 MCP Token', { timeout: 5000 })
  await ss(page, 'A3-token-create-form.png')

  // Fill name
  await page.getByPlaceholder('例如：CI token').fill('test-token-1')
  // Click scope label
  await page.getByText('搜尋（knowledge.search）').click()
  await ss(page, 'A4-token-form-filled.png')

  // Use page.evaluate to call $fetch directly — this is what the Vue component does
  const createResult = await page.evaluate(async () => {
    try {
      const nuxtApp = useNuxtApp()
      const result = await nuxtApp.$fetch('/api/admin/mcp-tokens', {
        method: 'POST',
        body: { name: 'test-token-1', scopes: ['knowledge.search'] },
      })
      return { ok: true, data: JSON.stringify(result ?? null).slice(0, 400) }
    } catch (e: unknown) {
      const err = e as { data?: unknown; message?: string; statusCode?: number }
      return {
        ok: false,
        message: String(err?.message),
        statusCode: err?.statusCode,
        data: JSON.stringify(err?.data ?? null).slice(0, 200),
      }
    }
  })
  log('createResult: ' + JSON.stringify(createResult))

  if (createResult.ok) {
    // Parse and display token for screenshot — inject into DOM temporarily
    await page.evaluate((data) => {
      const token = JSON.parse(data).token
      const div = document.createElement('div')
      div.id = 'debug-token'
      div.style.cssText =
        'position:fixed;top:0;left:0;right:0;background:yellow;padding:8px;z-index:9999;word-break:break-all;font-size:12px'
      div.textContent = 'TEST TOKEN (debug): ' + token
      document.body.appendChild(div)
    }, createResult.data)
    await ss(page, 'A-token-created-debug.png')
  }
})
