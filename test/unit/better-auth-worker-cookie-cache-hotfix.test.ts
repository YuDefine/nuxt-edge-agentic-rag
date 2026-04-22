import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('better-auth worker cookie-cache hotfix', () => {
  it('disables session cookie cache in server auth config', () => {
    const authConfigSource = readFileSync(resolve('server/auth.config.ts'), 'utf8')

    expect(authConfigSource).toContain('cookieCache:')
    expect(authConfigSource).toContain('enabled: false')
  })
})
