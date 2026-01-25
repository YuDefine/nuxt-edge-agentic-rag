import { expect, test } from '@playwright/test'

test('home page renders login when not authenticated', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: '知識問答系統' })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByRole('button', { name: /Google/ })).toBeVisible({
    timeout: 15000,
  })
})
