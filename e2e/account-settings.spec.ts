import { expect, test } from '@playwright/test'

import { devLogin, MEMBER_EMAIL } from './helpers'

/**
 * passkey-authentication §11.5 — Account settings page renders
 * personal info, passkey section, and danger zone for a logged-in user.
 *
 * Full credential-binding flows (Google ⇄ passkey, cross-account 409)
 * require live provider OAuth and virtual authenticator setup — those
 * are covered in the manual check list (§17.2 / §17.3 / §17.4).
 * This spec guards the read-path rendering so the surface doesn't
 * silently regress.
 */

test('signed-in user can reach /account/settings and sees key sections', async ({ page }) => {
  await devLogin(page, MEMBER_EMAIL)
  await page.goto('/account/settings')

  await expect(page.getByRole('heading', { level: 1, name: '帳號設定' })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByRole('heading', { level: 2, name: '個人資料' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Passkey' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '危險區域' })).toBeVisible()
  await expect(page.getByRole('button', { name: '刪除我的帳號' })).toBeVisible()
})

test('display_name field is disabled (永久不可改)', async ({ page }) => {
  await devLogin(page, MEMBER_EMAIL)
  await page.goto('/account/settings')

  await expect(page.getByRole('heading', { level: 1, name: '帳號設定' })).toBeVisible({
    timeout: 15000,
  })

  // The immutable contract: the UI must not present an editable path.
  const nicknameField = page.getByLabel('暱稱')
  await expect(nicknameField).toBeDisabled()
})
