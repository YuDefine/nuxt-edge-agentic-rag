export interface AutoRagClientConfig {
  accountId: string
  apiToken: string
  instanceName: string
}

export interface AutoRagSyncJob {
  jobId: string
}

export type AutoRagJobRunStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface AutoRagJobStatus {
  error?: string
  jobId: string
  status: AutoRagJobRunStatus
}

interface ClientOptions {
  fetch?: typeof fetch
}

function jobsEndpoint(config: AutoRagClientConfig): string {
  return `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instanceName}/jobs`
}

function authorizationHeader(config: AutoRagClientConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiToken}` }
}

export async function triggerAutoRagSync(
  config: AutoRagClientConfig,
  options: ClientOptions = {}
): Promise<AutoRagSyncJob> {
  const response = await (options.fetch ?? fetch)(jobsEndpoint(config), {
    headers: authorizationHeader(config),
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`AutoRAG sync trigger failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    result?: { job_id?: string }
    success?: boolean
  }

  if (!payload.success || !payload.result?.job_id) {
    throw new Error('AutoRAG sync response missing job_id')
  }

  return { jobId: payload.result.job_id }
}

export async function getAutoRagJobStatus(
  config: AutoRagClientConfig,
  jobId: string,
  options: ClientOptions = {}
): Promise<AutoRagJobStatus> {
  const response = await (options.fetch ?? fetch)(`${jobsEndpoint(config)}/${jobId}`, {
    headers: authorizationHeader(config),
    method: 'GET',
  })

  if (!response.ok) {
    throw new Error(`AutoRAG job lookup failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    result?: { error?: string; id?: string; status?: string }
    success?: boolean
  }

  if (!payload.success || !payload.result) {
    throw new Error('AutoRAG job response missing result')
  }

  const status: AutoRagJobStatus = {
    jobId: payload.result.id ?? jobId,
    status: normalizeJobStatus(payload.result.status),
  }
  if (payload.result.error) {
    status.error = payload.result.error
  }
  return status
}

function normalizeJobStatus(raw: string | undefined): AutoRagJobRunStatus {
  switch (raw) {
    case 'completed':
    case 'succeeded':
      return 'completed'
    case 'failed':
    case 'error':
      return 'failed'
    case 'running':
    case 'in_progress':
      return 'running'
    default:
      return 'pending'
  }
}
