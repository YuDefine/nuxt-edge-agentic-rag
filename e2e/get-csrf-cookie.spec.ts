import { test } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

import { ADMIN_EMAIL, BASE_URL, devLogin } from './helpers'

const __filename = fileURLToPath(import.meta.url)
const __dirname_compat = path.dirname(__filename)
const LOG_FILE = path.resolve(
  __dirname_compat,
  '../screenshots/local/manual-review/csrf-cookie.log',
)

test.beforeEach(async ({ page }) => {
  await devLogin(page, ADMIN_EMAIL)
})

test('extract csrf cookie and create token', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/tokens`)
  await page.waitForSelector('text=MCP Token 管理', { timeout: 10000 })

  // Get all cookies including httpOnly
  const cookies = await page.context().cookies()
  const csrfCookie = cookies.find((c) => c.name === 'csrf' || c.name.includes('csrf'))
  const csrfMeta = await page
    .locator('meta[name="csrf-token"]')
    .getAttribute('content')
    .catch(() => null)

  fs.writeFileSync(
    LOG_FILE,
    [
      'csrf cookie: ' + JSON.stringify(csrfCookie),
      'csrf meta: ' + csrfMeta,
      'all cookie names: ' + cookies.map((c) => c.name).join(', '),
    ].join('\n'),
  )

  // Now try API call using page.request which has all browser cookies
  const response = await page.request.post(`${BASE_URL}/api/admin/mcp-tokens`, {
    headers: {
      'Content-Type': 'application/json',
      'csrf-token': csrfMeta || '',
    },
    data: { name: 'test-token-1', scopes: ['knowledge.search'] },
  })

  const body = await response.text()
  fs.appendFileSync(LOG_FILE, '\nAPI response status: ' + response.status() + '\nbody: ' + body)
})
