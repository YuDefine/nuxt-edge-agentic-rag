import { describe, expect, it } from 'vitest'

import { decideExitCode } from '../../scripts/run-eval-with-exit.mjs'

describe('run-eval-with-exit decideExitCode', () => {
  it('returns 0 when child exited cleanly without regression banner', () => {
    expect(
      decideExitCode({
        childExitCode: 0,
        hasRegressionBanner: false,
      }),
    ).toBe(0)
  })

  it('returns 1 when child exited cleanly but stderr printed regression banner', () => {
    expect(
      decideExitCode({
        childExitCode: 0,
        hasRegressionBanner: true,
      }),
    ).toBe(1)
  })

  it('preserves child exit code when child failed without banner', () => {
    expect(
      decideExitCode({
        childExitCode: 1,
        hasRegressionBanner: false,
      }),
    ).toBe(1)
  })

  it('preserves non-zero child exit code even when banner is present', () => {
    expect(
      decideExitCode({
        childExitCode: 2,
        hasRegressionBanner: true,
      }),
    ).toBe(2)
  })
})
