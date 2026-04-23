#!/usr/bin/env node

const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'

const DEFAULT_INTERVAL_MS = 15_000
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

export function evaluateCiGate({ currentRunId, expectedSha, runs }) {
  const sameShaRuns = runs.filter(
    (run) =>
      String(run.id) !== String(currentRunId) &&
      run.head_sha === expectedSha &&
      run.path === CI_WORKFLOW_PATH,
  )

  const matchingRun = sameShaRuns.find(
    (run) => run.status === 'completed' && run.conclusion === 'success',
  )

  if (matchingRun) {
    return {
      ok: true,
      status: 'success',
      matchingRun,
    }
  }

  if (sameShaRuns.length === 0) {
    return {
      ok: false,
      status: 'missing',
      reason: `找不到 SHA ${expectedSha} 的成功 CI run；請先執行 .github/workflows/ci.yml 並確認成功。`,
    }
  }

  const hasRunning = sameShaRuns.some((run) => run.status !== 'completed')
  if (hasRunning) {
    return {
      ok: false,
      status: 'pending',
      reason: `找到 ${sameShaRuns.length} 個同 SHA 的 CI run，但尚未成功；等待 CI workflow 對 ${expectedSha} 轉綠。`,
    }
  }

  const conclusions = sameShaRuns.map((run) => run.conclusion).join(', ')
  return {
    ok: false,
    status: 'failed',
    reason: `SHA ${expectedSha} 的 CI workflow 已失敗（conclusion: ${conclusions}）；請修復後重新觸發。`,
  }
}

async function fetchWorkflowRuns({ githubToken, repository, perPage = 100, sha }) {
  const workflowPath = encodeURIComponent(CI_WORKFLOW_PATH)
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/${workflowPath}/runs?head_sha=${sha}&per_page=${perPage}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${githubToken}`,
        'user-agent': 'codex-ci-gate-check',
        'x-github-api-version': '2022-11-28',
      },
    },
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub API ${response.status}: ${body}`)
  }

  const payload = await response.json()
  return payload.workflow_runs ?? []
}

export async function waitForCiGate({
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
    const runs = await fetchRuns()
    const result = evaluateCiGate({ currentRunId, expectedSha, runs })

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
        reason: `等待 CI 轉綠逾時（${Math.round(timeoutMs / 1000)}s）：${lastReason}`,
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
    throw new Error('Missing required GitHub Actions env vars for CI gate verification.')
  }

  const intervalMs = Number(process.env.CI_GATE_INTERVAL_MS) || DEFAULT_INTERVAL_MS
  const timeoutMs = Number(process.env.CI_GATE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS

  const result = await waitForCiGate({
    currentRunId,
    expectedSha,
    fetchRuns: () =>
      fetchWorkflowRuns({
        githubToken,
        repository,
        sha: expectedSha,
      }),
    intervalMs,
    timeoutMs,
    onProgress: ({ attempt, status, reason }) => {
      console.log(`[ci-gate] attempt #${attempt} status=${status} — ${reason}`)
    },
  })

  if (!result.ok) {
    console.error(`::error::${result.reason}`)
    process.exit(1)
  }

  console.log(
    `CI gate passed via run #${result.matchingRun.id} (${result.matchingRun.event}, ${result.matchingRun.conclusion})`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      `::error::CI gate check crashed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
}
