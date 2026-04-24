import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const settingsPagePath = fileURLToPath(
  new URL('../../app/pages/account/settings.vue', import.meta.url),
)

describe('account settings heading order', () => {
  it('renders the account-load error title as the next level after the page h1', () => {
    const source = readFileSync(settingsPagePath, 'utf8')

    expect(source).toContain('<h1 class="text-2xl font-bold text-default">帳號設定</h1>')
    expect(source).toContain(
      '<h2 class="mb-2 text-lg font-semibold text-default">無法載入帳號資訊</h2>',
    )
    expect(source).not.toContain(
      '<h3 class="mb-2 text-lg font-semibold text-default">無法載入帳號資訊</h3>',
    )
  })
})
