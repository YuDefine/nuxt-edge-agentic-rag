import type { Page } from '@playwright/test'

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3010'
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@test.local'
export const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL ?? 'member@test.local'

const PASSWORD = process.env.E2E_PASSWORD ?? 'testpass123'

interface DevLoginResult {
  body: unknown
  ok: boolean
  status: number
}

export interface DevLoginOptions {
  /**
   * Optional explicit role hint. Forwarded to `/api/_dev/login`. Omitted when
   * not provided, so the server falls back to ADMIN_EMAIL_ALLOWLIST-derived
   * role assignment. `as: 'admin'` still requires the email to be on the
   * allowlist; `as: 'guest'` is reserved for future scenarios.
   */
  as?: 'admin' | 'member' | 'guest'
}

export async function devLogin(
  page: Page,
  loginEmail: string,
  options: DevLoginOptions = {},
): Promise<void> {
  await page.goto(`${BASE_URL}/`)
  await page.waitForTimeout(1000)

  const result = (await page.evaluate(
    async ({ loginEmail: email, password, as }) => {
      const payload: Record<string, unknown> = { email, password }
      if (as !== undefined) {
        payload.as = as
      }
      const response = await fetch('/api/_dev/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => null)
      return { body, ok: response.ok, status: response.status }
    },
    { loginEmail, password: PASSWORD, as: options.as },
  )) as DevLoginResult

  if (!result.ok) {
    throw new Error(`Dev login failed: ${result.status} ${JSON.stringify(result.body)}`)
  }
}
