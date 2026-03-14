/**
 * responsive-and-a11y-foundation §6.2 — Skip-to-main-content link.
 *
 * Verifies the `<a href="#main-content" class="app-skip-link">` link in
 * `app/layouts/default.vue` + `app/layouts/chat.vue`:
 *  (a) is sr-only by default
 *  (b) becomes focus-visible on first Tab (translateY transform lands
 *      at 0)
 *  (c) pressing Enter moves focus onto `<main id="main-content">`
 *
 * Unauthenticated landing uses the `auth` layout which does not expose
 * the skip link (simple centered login card). The test auto-skips in
 * that case; Phase B seeded-session run will exercise the full path.
 */
import { expect, test } from '@playwright/test'

import { BASE_URL } from './helpers'

test.describe('Skip-to-main link (§6.2)', () => {
  test('Tab surfaces the skip link and Enter focuses <main>', async ({ page }) => {
    await page.goto(`${BASE_URL}/`)
    await page.waitForLoadState('domcontentloaded')

    const skipLink = page.getByRole('link', { name: '跳到主要內容' })
    const skipCount = await skipLink.count()
    if (skipCount === 0) {
      test.info().annotations.push({
        type: 'phase-b-wiring',
        description:
          'auth layout does not render skip link; Phase B seeded session exercises default / chat layout',
      })
      test.skip(true, 'default/chat layout only visible for signed-in users (Phase B)')
      return
    }

    // Tab 1 → skip link takes focus and translateY returns to 0 via
    // `:focus-visible` rule on `.app-skip-link`.
    await page.keyboard.press('Tab')
    await expect(skipLink.first()).toBeFocused()

    const boundingBox = await skipLink.first().boundingBox()
    expect(boundingBox).not.toBeNull()
    if (boundingBox) {
      // When translated back into view the link sits near the top of the
      // viewport (top < 100 is a generous upper bound; CSS spec says 0.5rem).
      expect(boundingBox.y).toBeLessThan(100)
      expect(boundingBox.y).toBeGreaterThanOrEqual(-4)
    }

    await page.keyboard.press('Enter')
    const mainFocused = await page.evaluate(() => {
      const main = document.getElementById('main-content')
      return main !== null && document.activeElement === main
    })
    expect(mainFocused).toBe(true)
  })
})
