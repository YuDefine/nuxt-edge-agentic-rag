import { describe, expect, it } from 'vitest'

import {
  findLegacyTestRootPaths,
  formatLegacyTestRootReport,
} from '../../scripts/checks/lib/legacy-test-roots.mts'

describe('legacy test root guard', () => {
  it('flags files nested under the deprecated tests root', () => {
    expect(
      findLegacyTestRootPaths([
        'test/unit/example.test.ts',
        'e2e/example.spec.ts',
        'tests/e2e/screenshots/passkey-auth-review.spec.ts',
        'tests/unit/legacy.test.ts',
      ]),
    ).toEqual(['tests/e2e/screenshots/passkey-auth-review.spec.ts', 'tests/unit/legacy.test.ts'])
  })

  it('formats a stable report with migration guidance', () => {
    expect(
      formatLegacyTestRootReport(['tests/e2e/screenshots/passkey-auth-review.spec.ts']),
    ).toContain('請改放到 test/ 或 e2e/')
  })
})
