import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { BASE_URL, MEMBER_EMAIL, devLogin } from './helpers'

const AUTHORIZE_PATH =
  '/auth/mcp/authorize?client_id=claude-remote&redirect_uri=https%3A%2F%2Fclaude.example%2Fcallback&scope=knowledge.ask%20knowledge.search%20knowledge.category.list&state=playwright-state'

const VIEWPORTS = [
  { label: 'xs', width: 360, height: 760 },
  { label: 'md', width: 768, height: 960 },
  { label: 'xl', width: 1280, height: 960 },
] as const

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
}

test.describe('Remote MCP connector authorization UI', () => {
  test('signed-out users see local-account login guidance', async ({ page }) => {
    await page.goto(`${BASE_URL}${AUTHORIZE_PATH}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: '先登入以授權連接器' })).toBeVisible()
    await expect(page.getByRole('button', { name: '使用 Google 帳號登入' })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withRules(['button-name', 'link-name', 'label', 'page-has-heading-one'])
      .analyze()

    expect(
      results.violations,
      `Violations: ${JSON.stringify(results.violations, null, 2)}`,
    ).toEqual([])
  })

  for (const viewport of VIEWPORTS) {
    test(`signed-in consent flow is usable at ${viewport.label} breakpoint`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await devLogin(page, MEMBER_EMAIL)
      await page.goto(`${BASE_URL}${AUTHORIZE_PATH}`)
      await page.waitForLoadState('networkidle')

      await expect(page.getByRole('heading', { name: '授權 Claude Remote' })).toBeVisible()
      await expect(page.getByRole('button', { name: '允許並繼續' })).toBeVisible()
      await expect(page.getByRole('button', { name: '拒絕' })).toBeVisible()

      await assertNoHorizontalOverflow(page)
    })
  }

  test('keyboard navigation reaches consent actions with visible focus ring', async ({ page }) => {
    await devLogin(page, MEMBER_EMAIL)
    await page.goto(`${BASE_URL}${AUTHORIZE_PATH}`)
    await page.waitForLoadState('networkidle')

    const approveButton = page.getByRole('button', { name: '允許並繼續' })
    const denyButton = page.getByRole('button', { name: '拒絕' })
    await expect(approveButton).toBeVisible()

    let approveFocused = false
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab')
      approveFocused = await approveButton.evaluate((element) => element === document.activeElement)
      if (approveFocused) {
        break
      }
    }

    expect(approveFocused, '允許按鈕可透過 Tab 抵達').toBe(true)

    const focusStyle = await approveButton.evaluate((element) => {
      const style = window.getComputedStyle(element)
      return {
        boxShadow: style.boxShadow,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      }
    })
    const hasVisibleFocus =
      (focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth !== '0px') ||
      (focusStyle.boxShadow !== 'none' && focusStyle.boxShadow !== '')
    expect(hasVisibleFocus, '允許按鈕有可見 focus ring').toBe(true)

    let denyFocused = false
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      denyFocused = await denyButton.evaluate((element) => element === document.activeElement)
      if (denyFocused) {
        break
      }
    }

    expect(denyFocused, '拒絕按鈕可透過後續 Tab 抵達').toBe(true)
  })
})
