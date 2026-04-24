import { describe, expect, it } from 'vitest'

import { evaluateStagingGate, waitForStagingGate } from '../../scripts/check-staging-gate.mjs'

const DEPLOY_PATH = '.github/workflows/deploy.yml'

const baseRun = {
  event: 'push',
  head_sha: 'abc123',
  name: 'Deploy',
  path: DEPLOY_PATH,
  workflow_id: 2,
}

function successJob(name: string) {
  return { name, status: 'completed', conclusion: 'success' }
}

function skippedJob(name: string) {
  return { name, status: 'completed', conclusion: 'skipped' }
}

function failureJob(name: string) {
  return { name, status: 'completed', conclusion: 'failure' }
}

function pendingJob(name: string) {
  return { name, status: 'in_progress', conclusion: null }
}

describe('staging gate verification', () => {
  it('passes when the same sha has a deploy run with deploy-staging and smoke-test-staging success', () => {
    const result = evaluateStagingGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 100,
          status: 'completed',
          conclusion: 'success',
          jobs: [
            successJob('deploy-staging'),
            successJob('smoke-test-staging'),
            skippedJob('deploy-production'),
          ],
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.matchingRun?.id).toBe(100)
  })

  it('fails when deploy-staging was skipped (e.g. tag push run)', () => {
    const result = evaluateStagingGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 101,
          event: 'push',
          status: 'completed',
          conclusion: 'success',
          jobs: [
            skippedJob('deploy-staging'),
            skippedJob('smoke-test-staging'),
            successJob('deploy-production'),
          ],
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.reason).toMatch(/staging jobs 未成功/i)
  })

  it('fails when smoke-test-staging failed even if deploy-staging succeeded', () => {
    const result = evaluateStagingGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 102,
          status: 'completed',
          conclusion: 'failure',
          jobs: [successJob('deploy-staging'), failureJob('smoke-test-staging')],
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('failed')
  })

  it('reports pending when the run is still in progress', () => {
    const result = evaluateStagingGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 103,
          status: 'in_progress',
          conclusion: null,
          jobs: [successJob('deploy-staging'), pendingJob('smoke-test-staging')],
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('pending')
  })

  it('reports pending when run is completed but staging jobs still queued', () => {
    const result = evaluateStagingGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 104,
          status: 'completed',
          conclusion: 'success',
          jobs: [pendingJob('deploy-staging'), pendingJob('smoke-test-staging')],
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('pending')
  })

  it('reports missing when no deploy run exists for the sha', () => {
    const result = evaluateStagingGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 105,
          head_sha: 'def456',
          status: 'completed',
          conclusion: 'success',
          jobs: [successJob('deploy-staging'), successJob('smoke-test-staging')],
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('missing')
  })

  it('ignores the current deploy workflow run (self)', () => {
    const result = evaluateStagingGate({
      currentRunId: '200',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 200,
          status: 'in_progress',
          conclusion: null,
          jobs: [skippedJob('deploy-staging'), skippedJob('smoke-test-staging')],
        },
        {
          ...baseRun,
          id: 201,
          status: 'completed',
          conclusion: 'success',
          jobs: [successJob('deploy-staging'), successJob('smoke-test-staging')],
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.matchingRun?.id).toBe(201)
  })

  it('does not greenlight a completed run whose jobs list is empty', () => {
    // Guards against a race where run.status === 'completed' but the jobs
    // endpoint has not yet materialised entries. Without the empty-array
    // check, `every` on `[]` returns true and vacuously passes the gate.
    const result = evaluateStagingGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 106,
          status: 'completed',
          conclusion: 'success',
          jobs: [],
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('failed')
  })

  it('does not greenlight a completed run missing the jobs field entirely', () => {
    const result = evaluateStagingGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 107,
          status: 'completed',
          conclusion: 'success',
          // jobs field omitted on purpose
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('failed')
  })

  it('ignores runs from other workflow paths', () => {
    const result = evaluateStagingGate({
      currentRunId: '900',
      expectedSha: 'abc123',
      runs: [
        {
          ...baseRun,
          id: 300,
          path: '.github/workflows/ci.yml',
          status: 'completed',
          conclusion: 'success',
          jobs: [successJob('deploy-staging'), successJob('smoke-test-staging')],
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

describe('waitForStagingGate polling', () => {
  it('returns ok immediately when staging is already green on first poll', async () => {
    const clock = createClock()
    const fetchRuns = async () => [
      {
        ...baseRun,
        id: 1,
        status: 'completed',
        conclusion: 'success',
        jobs: [successJob('deploy-staging'), successJob('smoke-test-staging')],
      },
    ]

    const result = await waitForStagingGate({
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

  it('keeps polling while staging is pending and resolves ok when it turns green', async () => {
    const clock = createClock()
    const responses = [
      [
        {
          ...baseRun,
          id: 1,
          status: 'in_progress',
          conclusion: null,
          jobs: [pendingJob('deploy-staging')],
        },
      ],
      [
        {
          ...baseRun,
          id: 1,
          status: 'in_progress',
          conclusion: null,
          jobs: [successJob('deploy-staging'), pendingJob('smoke-test-staging')],
        },
      ],
      [
        {
          ...baseRun,
          id: 1,
          status: 'completed',
          conclusion: 'success',
          jobs: [successJob('deploy-staging'), successJob('smoke-test-staging')],
        },
      ],
    ]
    const fetchRuns = async () => responses.shift() ?? []

    const result = await waitForStagingGate({
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

  it('short-circuits and fails immediately when staging run completed with failure', async () => {
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
          jobs: [successJob('deploy-staging'), failureJob('smoke-test-staging')],
        },
      ]
    }

    const result = await waitForStagingGate({
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

  it('retries transient fetch errors and resolves when service recovers', async () => {
    // A transient network blip on one attempt should not kill the 25-min
    // poll window. Expect the loop to retry and eventually see the run.
    const clock = createClock()
    let call = 0
    const fetchRuns = async () => {
      call += 1
      if (call === 1) {
        throw new Error('GitHub API 502: bad gateway')
      }
      return [
        {
          ...baseRun,
          id: 1,
          status: 'completed',
          conclusion: 'success',
          jobs: [successJob('deploy-staging'), successJob('smoke-test-staging')],
        },
      ]
    }

    const result = await waitForStagingGate({
      currentRunId: '999',
      expectedSha: 'abc123',
      fetchRuns,
      intervalMs: 1000,
      timeoutMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(result.ok).toBe(true)
    expect(call).toBe(2)
  })

  it('hard-fails on 401 even mid-poll (no point retrying bad token)', async () => {
    const clock = createClock()
    let attempts = 0
    const fetchRuns = async () => {
      attempts += 1
      throw new Error('GitHub API 401: bad credentials')
    }

    await expect(
      waitForStagingGate({
        currentRunId: '999',
        expectedSha: 'abc123',
        fetchRuns,
        intervalMs: 1000,
        timeoutMs: 60_000,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toThrow(/GitHub API 401/)
    expect(attempts).toBe(1)
  })

  it('times out when staging stays pending past the deadline', async () => {
    const clock = createClock()
    const fetchRuns = async () => [
      {
        ...baseRun,
        id: 1,
        status: 'in_progress',
        conclusion: null,
        jobs: [pendingJob('deploy-staging')],
      },
    ]

    const result = await waitForStagingGate({
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
