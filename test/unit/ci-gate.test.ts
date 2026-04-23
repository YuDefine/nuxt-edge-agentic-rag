import { describe, expect, it } from 'vitest'

import { evaluateCiGate, waitForCiGate } from '../../scripts/check-ci-gate.mjs'

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

  it('marks status as pending when the only CI run is still running', () => {
    const result = evaluateCiGate({
      currentRunId: '910',
      expectedSha: 'abc123',
      runs: [
        {
          conclusion: null,
          event: 'push',
          head_sha: 'abc123',
          id: 200,
          name: 'CI',
          path: '.github/workflows/ci.yml',
          status: 'in_progress',
          workflow_id: 1,
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('pending')
  })

  it('marks status as failed when CI completed but did not succeed', () => {
    const result = evaluateCiGate({
      currentRunId: '911',
      expectedSha: 'abc123',
      runs: [
        {
          conclusion: 'failure',
          event: 'push',
          head_sha: 'abc123',
          id: 201,
          name: 'CI',
          path: '.github/workflows/ci.yml',
          status: 'completed',
          workflow_id: 1,
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.reason).toMatch(/已失敗|未成功/i)
  })

  it('marks status as missing when no CI run exists for the sha', () => {
    const result = evaluateCiGate({
      currentRunId: '912',
      expectedSha: 'abc123',
      runs: [
        {
          conclusion: 'success',
          event: 'push',
          head_sha: 'def456',
          id: 202,
          name: 'CI',
          path: '.github/workflows/ci.yml',
          status: 'completed',
          workflow_id: 1,
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('missing')
  })
})

function createClock() {
  let nowMs = 0
  return {
    now: () => nowMs,
    sleep: (ms: number) => {
      nowMs += ms
      return Promise.resolve()
    },
    advance: (ms: number) => {
      nowMs += ms
    },
  }
}

describe('waitForCiGate polling', () => {
  const baseRun = {
    event: 'push',
    head_sha: 'abc123',
    name: 'CI',
    path: '.github/workflows/ci.yml',
    workflow_id: 1,
  }

  it('returns ok immediately when CI is already green on first poll', async () => {
    const clock = createClock()
    const fetchRuns = async () => [
      {
        ...baseRun,
        id: 1,
        status: 'completed',
        conclusion: 'success',
      },
    ]

    const result = await waitForCiGate({
      currentRunId: '999',
      expectedSha: 'abc123',
      fetchRuns,
      intervalMs: 1000,
      timeoutMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(result.ok).toBe(true)
  })

  it('keeps polling while CI is pending and resolves ok when it turns green', async () => {
    const clock = createClock()
    const responses = [
      [
        {
          ...baseRun,
          id: 1,
          status: 'queued',
          conclusion: null,
        },
      ],
      [
        {
          ...baseRun,
          id: 1,
          status: 'in_progress',
          conclusion: null,
        },
      ],
      [
        {
          ...baseRun,
          id: 1,
          status: 'completed',
          conclusion: 'success',
        },
      ],
    ]
    const fetchRuns = async () => responses.shift() ?? []

    const result = await waitForCiGate({
      currentRunId: '999',
      expectedSha: 'abc123',
      fetchRuns,
      intervalMs: 1000,
      timeoutMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(result.ok).toBe(true)
    expect(responses.length).toBe(0)
  })

  it('short-circuits and fails immediately when CI completed with failure', async () => {
    const clock = createClock()
    let calls = 0
    const fetchRuns = async () => {
      calls += 1
      return [
        {
          ...baseRun,
          id: 1,
          status: 'completed',
          conclusion: 'failure',
        },
      ]
    }

    const result = await waitForCiGate({
      currentRunId: '999',
      expectedSha: 'abc123',
      fetchRuns,
      intervalMs: 1000,
      timeoutMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('failed')
    expect(calls).toBe(1)
  })

  it('times out when CI stays pending past the deadline', async () => {
    const clock = createClock()
    const fetchRuns = async () => [
      {
        ...baseRun,
        id: 1,
        status: 'in_progress',
        conclusion: null,
      },
    ]

    const result = await waitForCiGate({
      currentRunId: '999',
      expectedSha: 'abc123',
      fetchRuns,
      intervalMs: 1000,
      timeoutMs: 3000,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('timeout')
  })
})
