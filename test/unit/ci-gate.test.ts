import { describe, expect, it } from 'vitest'

import { evaluateCiGate } from '../../scripts/check-ci-gate.mjs'

describe('ci gate verification', () => {
  it('passes when the same sha already has a successful CI workflow run', () => {
    const result = evaluateCiGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          conclusion: 'success',
          event: 'push',
          head_sha: 'abc123',
          id: 100,
          name: 'Anything',
          path: '.github/workflows/ci.yml',
          status: 'completed',
          workflow_id: 1,
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.matchingRun?.id).toBe(100)
  })

  it('fails when the only CI run for the sha is still in progress', () => {
    const result = evaluateCiGate({
      currentRunId: '901',
      expectedSha: 'abc123',
      runs: [
        {
          conclusion: null,
          event: 'workflow_dispatch',
          head_sha: 'abc123',
          id: 101,
          name: 'Anything',
          path: '.github/workflows/ci.yml',
          status: 'in_progress',
          workflow_id: 1,
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/尚未成功/i)
  })

  it('fails when CI success belongs to another sha', () => {
    const result = evaluateCiGate({
      currentRunId: '902',
      expectedSha: 'abc123',
      runs: [
        {
          conclusion: 'success',
          event: 'push',
          head_sha: 'def456',
          id: 102,
          name: 'Anything',
          path: '.github/workflows/ci.yml',
          status: 'completed',
          workflow_id: 1,
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/找不到/i)
  })

  it('ignores the current deploy workflow run even if it is named differently', () => {
    const result = evaluateCiGate({
      currentRunId: '903',
      expectedSha: 'abc123',
      runs: [
        {
          conclusion: 'success',
          event: 'workflow_dispatch',
          head_sha: 'abc123',
          id: 903,
          name: 'Deploy',
          path: '.github/workflows/deploy.yml',
          status: 'completed',
          workflow_id: 2,
        },
        {
          conclusion: 'success',
          event: 'workflow_dispatch',
          head_sha: 'abc123',
          id: 104,
          name: 'Renamed CI Workflow',
          path: '.github/workflows/ci.yml',
          status: 'completed',
          workflow_id: 1,
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.matchingRun?.id).toBe(104)
  })
})
