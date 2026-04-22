#!/usr/bin/env node

const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'

export function evaluateCiGate({ currentRunId, expectedSha, runs }) {
  const matchingRun = runs.find((run) => {
    if (String(run.id) === String(currentRunId)) {
      return false
    }

    return (
      run.head_sha === expectedSha &&
      run.path === CI_WORKFLOW_PATH &&
      run.status === 'completed' &&
      run.conclusion === 'success'
    )
  })

  if (matchingRun) {
    return {
      ok: true,
      matchingRun,
    }
  }

  const sameShaRuns = runs.filter(
    (run) =>
      String(run.id) !== String(currentRunId) &&
      run.head_sha === expectedSha &&
      run.path === CI_WORKFLOW_PATH,
  )

  if (sameShaRuns.length > 0) {
    return {
      ok: false,
      reason: `找到 ${sameShaRuns.length} 個同 SHA 的 CI run，但尚未成功；請先讓 CI workflow 對 ${expectedSha} 轉綠後再部署。`,
    }
  }

  return {
    ok: false,
    reason: `找不到 SHA ${expectedSha} 的成功 CI run；請先執行 .github/workflows/ci.yml 並確認成功。`,
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

async function main() {
  const githubToken = process.env.GITHUB_TOKEN
  const repository = process.env.GITHUB_REPOSITORY
  const currentRunId = process.env.GITHUB_RUN_ID
  const expectedSha = process.env.GITHUB_SHA

  if (!githubToken || !repository || !currentRunId || !expectedSha) {
    throw new Error('Missing required GitHub Actions env vars for CI gate verification.')
  }

  const runs = await fetchWorkflowRuns({
    githubToken,
    repository,
    sha: expectedSha,
  })

  const result = evaluateCiGate({
    currentRunId,
    expectedSha,
    runs,
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
