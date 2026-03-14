import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('acceptance command surface', () => {
  it('adds local and CI entrypoints for acceptance verification and contracts', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['test:integration']).toBeDefined()
    expect(packageJson.scripts['test:acceptance']).toBeDefined()
    expect(packageJson.scripts['test:contracts']).toBeDefined()
    expect(packageJson.scripts['verify:acceptance']).toBe(
      'pnpm test:acceptance && pnpm test:contracts',
    )
  })
})
