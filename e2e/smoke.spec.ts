import { expect, test } from '@playwright/test'

test('auth smoke renders public entry points', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.getByRole('heading', { level: 1, name: '登入' })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 15000 })
  await expect(page.getByLabel('密碼')).toBeVisible({ timeout: 15000 })

  await page.getByRole('link', { name: '還沒有帳號？註冊' }).click()
  await expect(page).toHaveURL(/\/auth\/register$/)
  await expect(page.getByRole('heading', { level: 1, name: '註冊' })).toBeVisible()

  await page.goto('/auth/login')
  await page.getByRole('link', { name: '忘記密碼' }).click()
  await expect(page).toHaveURL(/\/auth\/forgot-password$/)
  await expect(page.getByRole('heading', { level: 1, name: '忘記密碼' })).toBeVisible()
})
