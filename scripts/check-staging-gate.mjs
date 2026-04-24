#!/usr/bin/env node

const DEPLOY_WORKFLOW_PATH = '.github/workflows/deploy.yml'
const REQUIRED_STAGING_JOBS = ['deploy-staging', 'smoke-test-staging']

const DEFAULT_INTERVAL_MS = 15_000
const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000

export function evaluateStagingGate({ currentRunId, expectedSha, runs }) {
  const sameShaRuns = runs.filter(
    (run) =>
      String(run.id) !== String(currentRunId) &&
      run.head_sha === expectedSha &&
      run.path === DEPLOY_WORKFLOW_PATH,
  )

  if (sameShaRuns.length === 0) {
    return {
      ok: false,
      status: 'missing',
      reason: `找不到 SHA ${expectedSha} 的 staging deploy run；請先 push main 或 workflow_dispatch target=staging 讓 staging 通過。`,
    }
  }

  const matchingRun = sameShaRuns.find((run) => {
    if (run.status !== 'completed') return false
    // Guard against a completed run with no jobs materialised (race between
    // run completion and jobs endpoint). `Array.prototype.every` on `[]`
    // vacuously returns true; without this check a jobless run would
    // greenlight production deploy.
    if (!Array.isArray(run.jobs) || run.jobs.length === 0) return false
    return REQUIRED_STAGING_JOBS.every((jobName) => {
      const job = run.jobs.find((item) => item.name === jobName)
      return job?.status === 'completed' && job?.conclusion === 'success'
    })
  })

  if (matchingRun) {
    return {
      ok: true,
      status: 'success',
      matchingRun,
    }
  }

  const hasPending = sameShaRuns.some((run) => {
    if (run.status !== 'completed') return true
    return REQUIRED_STAGING_JOBS.some((jobName) => {
      const job = run.jobs?.find((item) => item.name === jobName)
      return job && job.status !== 'completed'
    })
  })

  if (hasPending) {
    return {
      ok: false,
      status: 'pending',
      reason: `找到 ${sameShaRuns.length} 個同 SHA 的 deploy run，staging jobs 尚未全部綠燈；等待中。`,
    }
  }

  const summary = sameShaRuns
    .map((run) => {
      const conclusions = REQUIRED_STAGING_JOBS.map((jobName) => {
        const job = run.jobs?.find((item) => item.name === jobName)
        return `${jobName}=${job?.conclusion ?? 'missing'}`
      }).join(', ')
      return `run #${run.id}(${conclusions})`
    })
    .join('; ')

  return {
    ok: false,
    status: 'failed',
    reason: `SHA ${expectedSha} 的 staging jobs 未成功：${summary}；請修復後重新 push main 或 dispatch staging。`,
  }
}

async function fetchWorkflowRuns({ githubToken, repository, perPage = 100, sha }) {
  const workflowPath = encodeURIComponent(DEPLOY_WORKFLOW_PATH)
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/${workflowPath}/runs?head_sha=${sha}&per_page=${perPage}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${githubToken}`,
        'user-agent': 'codex-staging-gate-check',
        'x-github-api-version': '2022-11-28',
      },
    },
  )

  if (!response.ok) {
    // Cap body so a misbehaving proxy returning multi-MB payloads doesn't
    // flood CI logs, and to narrow the surface if bearer tokens ever echo.
    const body = (await response.text()).slice(0, 500)
    throw new Error(`GitHub API ${response.status}: ${body}`)
  }

  const payload = await response.json()
  return payload.workflow_runs ?? []
}

async function fetchRunJobs({ githubToken, repository, runId, perPage = 100 }) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?per_page=${perPage}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${githubToken}`,
        'user-agent': 'codex-staging-gate-check',
        'x-github-api-version': '2022-11-28',
      },
    },
  )

  if (!response.ok) {
    // Cap body so a misbehaving proxy returning multi-MB payloads doesn't
    // flood CI logs, and to narrow the surface if bearer tokens ever echo.
    const body = (await response.text()).slice(0, 500)
    throw new Error(`GitHub API ${response.status}: ${body}`)
  }

  const payload = await response.json()
  return payload.jobs ?? []
}

const MAX_RUNS_TO_INSPECT = 10

async function fetchDeployRunsWithJobs({ githubToken, repository, sha }) {
  const runs = await fetchWorkflowRuns({ githubToken, repository, sha })
  // Inspect only the most recent runs to avoid N-concurrent job fetches
  // under rerun storms tripping GitHub's secondary rate limit. Staging
  // gate only needs the latest completed run.
  const recent = runs.slice(0, MAX_RUNS_TO_INSPECT)
  return Promise.all(
    recent.map(async (run) => ({
      ...run,
      jobs: await fetchRunJobs({ githubToken, repository, runId: run.id }),
    })),
  )
}

export async function waitForStagingGate({
  currentRunId,
  expectedSha,
  fetchRuns,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProgress = () => {},
}) {
  const deadline = now() + timeoutMs
  let attempt = 0
  let lastReason = '未知'

  while (true) {
    attempt += 1

    // Swallow transient fetch errors and keep polling until deadline; a
    // single GitHub blip shouldn't kill a 25-minute wait window. Hard-fail
    // only on 401/403 which won't resolve by retrying.
    let runs
    try {
      runs = await fetchRuns()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/GitHub API 40[13]/.test(message)) {
        throw error
      }
      lastReason = `fetch failed: ${message}`
      onProgress({ attempt, status: 'error', reason: lastReason })
      if (now() >= deadline) {
        return {
          ok: false,
          status: 'timeout',
          reason: `等待 staging 綠燈逾時（${Math.round(timeoutMs / 1000)}s）：${lastReason}`,
        }
      }
      await sleep(intervalMs)
      continue
    }

    const result = evaluateStagingGate({ currentRunId, expectedSha, runs })

    if (result.ok) {
      return result
    }

    if (result.status === 'failed') {
      return result
    }

    lastReason = result.reason
    onProgress({ attempt, status: result.status, reason: result.reason })

    if (now() >= deadline) {
      return {
        ok: false,
        status: 'timeout',
        reason: `等待 staging 綠燈逾時（${Math.round(timeoutMs / 1000)}s）：${lastReason}`,
      }
    }

    await sleep(intervalMs)
  }
}

async function main() {
  const githubToken = process.env.GITHUB_TOKEN
  const repository = process.env.GITHUB_REPOSITORY
  const currentRunId = process.env.GITHUB_RUN_ID
  const expectedSha = process.env.GITHUB_SHA

  if (!githubToken || !repository || !currentRunId || !expectedSha) {
    throw new Error('Missing required GitHub Actions env vars for staging gate verification.')
  }

  const intervalMs = Number(process.env.STAGING_GATE_INTERVAL_MS) || DEFAULT_INTERVAL_MS
  const timeoutMs = Number(process.env.STAGING_GATE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS

  const result = await waitForStagingGate({
    currentRunId,
    expectedSha,
    fetchRuns: () =>
      fetchDeployRunsWithJobs({
        githubToken,
        repository,
        sha: expectedSha,
      }),
    intervalMs,
    timeoutMs,
    onProgress: ({ attempt, status, reason }) => {
      console.log(`[staging-gate] attempt #${attempt} status=${status} — ${reason}`)
    },
  })

  if (!result.ok) {
    console.error(`::error::${result.reason}`)
    process.exit(1)
  }

  console.log(
    `Staging gate passed via run #${result.matchingRun.id} (${result.matchingRun.event}, ${result.matchingRun.conclusion})`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      `::error::Staging gate check crashed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
}
