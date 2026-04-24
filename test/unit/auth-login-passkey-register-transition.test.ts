import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const loginPageSource = readFileSync(resolve('app/pages/auth/login.vue'), 'utf8')

describe('auth login passkey registration transition', () => {
  it('renders the OAuth-style processing screen before navigating after passkey registration', () => {
    expect(loginPageSource).toContain('const authTransitionLoading = shallowRef(false)')
    expect(loginPageSource).toContain('authTransitionLoading.value = true')
    expect(loginPageSource).toContain('await nextTick()')
    expect(loginPageSource).toContain('requestAnimationFrame')
    expect(loginPageSource).toContain('v-if="authTransitionLoading"')
    expect(loginPageSource).toContain('正在處理登入...')

    const handlerStart = loginPageSource.indexOf('async function handlePasskeyRegistered()')
    const loadingStart = loginPageSource.indexOf('authTransitionLoading.value = true', handlerStart)
    const paintWait = loginPageSource.indexOf('requestAnimationFrame', loadingStart)
    const navigation = loginPageSource.indexOf('await navigateTo', paintWait)

    expect(handlerStart).toBeGreaterThanOrEqual(0)
    expect(loadingStart).toBeGreaterThan(handlerStart)
    expect(paintWait).toBeGreaterThan(loadingStart)
    expect(navigation).toBeGreaterThan(paintWait)
  })
})
