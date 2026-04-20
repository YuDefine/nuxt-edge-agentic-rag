import { expect, test } from '@playwright/test'

/**
 * passkey-authentication §10.3 — Passkey sign-in happy path UI flow.
 *
 * Uses Playwright's CDP virtual authenticator to avoid needing a real
 * fingerprint / TouchID device in CI. The test exercises the UI wiring:
 *
 *   1. Navigate to `/`
 *   2. If feature flag is off → skip (recorded but no assertion)
 *   3. If on → click "使用 Passkey 登入" → expect no unhandled error
 *      thrown at the UI layer (the actual success path needs a
 *      registered credential, which requires §10 manual check §17.5).
 *
 * The ceremony itself is exercised end-to-end in the manual check list
 * at §17.5 with a real authenticator.
 */

test('passkey login button triggers authClient.signIn.passkey when feature flag on', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: '知識問答系統' })).toBeVisible({
    timeout: 15000,
  })

  const passkeyEnabled = await page.evaluate(() => {
    const nuxt = (
      window as unknown as {
        __NUXT__?: {
          config?: { public?: { knowledge?: { features?: { passkey?: boolean } } } }
        }
      }
    ).__NUXT__
    return nuxt?.config?.public?.knowledge?.features?.passkey === true
  })

  if (!passkeyEnabled) {
    test.skip(true, 'passkey feature flag is off; covered in manual check §17.9')
    return
  }

  // Set up a virtual authenticator via CDP so
  // `navigator.credentials.get()` doesn't hang waiting for real
  // hardware.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  })

  const passkeyLoginButton = page.getByRole('button', { name: '使用 Passkey 登入' })
  await expect(passkeyLoginButton).toBeVisible()
  await passkeyLoginButton.click()

  // With no credential registered on the virtual authenticator, the
  // plugin returns an error payload rather than succeeding. The UI
  // MUST show the error alert rather than crashing or looping.
  const errorAlert = page.getByText(/Passkey.*失敗|改用 Google/)
  await expect(errorAlert).toBeVisible({ timeout: 15000 })
})
