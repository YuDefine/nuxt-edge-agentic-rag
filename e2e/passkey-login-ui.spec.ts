import { expect, test } from '@playwright/test'

/**
 * passkey-authentication §8.4 — Login page renders the passkey UI
 * when and only when `public.knowledge.features.passkey` is true.
 *
 * Strategy: rather than relying on the spec to toggle env vars (which
 * would require a separate dev-server boot per case), we assert the
 * button visibility tracks the same `runtimeConfig.public` value the
 * UI reads via `useRuntimeConfig()`. The baseline dev env defaults to
 * `NUXT_KNOWLEDGE_FEATURE_PASSKEY=false` per `.env.example`, so the
 * "off" variant is the observed default; the "on" variant runs under
 * a route mock that intercepts `/_nuxt/runtime-config` is not feasible
 * in Nuxt 4 (config is compile-time for client), so we fall back to
 * documenting the expected UI via query param flags where the test
 * infrastructure supports toggling.
 *
 * This spec therefore asserts the **feature-flag-off** baseline always
 * holds. The feature-flag-on variant will be verified as part of the
 * manual-check step §17.9 once local env sets `NUXT_KNOWLEDGE_FEATURE_PASSKEY=true`.
 */

test('login page always shows Google button (baseline fallback)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: '知識問答系統' })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByRole('button', { name: /Google/ })).toBeVisible({
    timeout: 15000,
  })
})

test('passkey buttons follow feature flag (observed via window runtimeConfig)', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: '知識問答系統' })).toBeVisible({
    timeout: 15000,
  })

  // Read the actual client-side runtime config value the page is
  // deciding on, so the assertion adapts to whatever the dev server
  // was booted with. Prevents false positives if someone flips the
  // env var locally.
  const passkeyEnabled = await page.evaluate(() => {
    const nuxt = (
      window as unknown as {
        __NUXT__?: { config?: { public?: { knowledge?: { features?: { passkey?: boolean } } } } }
      }
    ).__NUXT__
    return nuxt?.config?.public?.knowledge?.features?.passkey === true
  })

  const passkeyLoginButton = page.getByRole('button', { name: '使用 Passkey 登入' })
  const passkeyRegisterButton = page.getByRole('button', { name: '使用 Passkey 註冊新帳號' })

  if (passkeyEnabled) {
    await expect(passkeyLoginButton).toBeVisible({ timeout: 5000 })
    await expect(passkeyRegisterButton).toBeVisible({ timeout: 5000 })
  } else {
    await expect(passkeyLoginButton).toHaveCount(0)
    await expect(passkeyRegisterButton).toHaveCount(0)
  }
})
