/**
 * Responsive baseline screenshots for spectra changes:
 *   - responsive-and-a11y-foundation §5.6, §9.4, §10.5, §10.8
 *   - member-and-permission-management §10.6 (admin pages deferred — needs admin OAuth session)
 *
 * Pages: /, /auth/login, /chat (unauthenticated → GuestAccessGate)
 * Breakpoints: xs 360×800, md 768×1024, xl 1280×800
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { test } from '@playwright/test'

import { BASE_URL } from './helpers'

const __filename = fileURLToPath(import.meta.url)
const __dirname_compat = path.dirname(__filename)
const OUT_DIR = path.resolve(__dirname_compat, '../screenshots/local/responsive-baseline')

fs.mkdirSync(OUT_DIR, { recursive: true })

const BREAKPOINTS = [
  { name: 'xs', width: 360, height: 800 },
  { name: 'md', width: 768, height: 1024 },
  { name: 'xl', width: 1280, height: 800 },
]

const PAGES = [
  { slug: 'landing', path: '/' },
  { slug: 'login', path: '/auth/login' },
  { slug: 'chat', path: '/chat' },
]

for (const bp of BREAKPOINTS) {
  for (const pg of PAGES) {
    test(`${pg.slug} @ ${bp.name} (${bp.width}x${bp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height })
      await page.goto(`${BASE_URL}${pg.path}`)
      await page.waitForLoadState('networkidle')
      // Extra wait for any animations/transitions to settle
      await page.waitForTimeout(500)
      await page.screenshot({
        path: path.join(OUT_DIR, `${pg.slug}-${bp.name}.png`),
        fullPage: true,
      })
    })
  }
}
