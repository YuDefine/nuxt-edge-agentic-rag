import { expect, test } from '@playwright/test'

import { devLogin, MEMBER_EMAIL } from './helpers'

/**
 * passkey-authentication §12.4 — Delete account dialog reauth gating.
 *
 * The ceremony side of reauth (passkey / Google) cannot be exercised
 * end-to-end in CI without a virtual authenticator or a real Google
 * browser session. This spec asserts the UI contract that the reauth
 * step actually gates the confirm button — the functional reauth
 * paths are covered in manual check §17.8.
 *
 *   - Confirm button starts DISABLED
 *   - Cancel button always enabled
 *   - Dialog opens and closes cleanly without side effects
 */

test('delete dialog confirm button starts disabled until reauth completes', async ({ page }) => {
  await devLogin(page, MEMBER_EMAIL)
  await page.goto('/account/settings')

  await expect(page.getByRole('heading', { level: 1, name: '帳號設定' })).toBeVisible({
    timeout: 15000,
  })

  await page.getByRole('button', { name: '刪除我的帳號' }).click()

  // Dialog should render with the destructive warning.
  await expect(page.getByRole('heading', { name: '刪除帳號' })).toBeVisible()
  await expect(page.getByText('此操作無法復原')).toBeVisible()

  // Confirm button present but disabled — reauth step must complete
  // first.
  const confirmButton = page.getByRole('button', { name: '確認刪除' })
  await expect(confirmButton).toBeVisible()
  await expect(confirmButton).toBeDisabled()

  // Cancel closes without touching the account.
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('heading', { name: '刪除帳號' })).not.toBeVisible()
})
