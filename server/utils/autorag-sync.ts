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

export class AutoRagCooldownError extends Error {
  constructor() {
    super('AutoRAG sync is in cooldown')
    this.name = 'AutoRagCooldownError'
  }
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
    const body = (await response.json().catch(() => null)) as {
      errors?: Array<{ code?: number; message?: string }>
    } | null
    if (body?.errors?.some((e) => e.message === 'sync_in_cooldown')) {
      throw new AutoRagCooldownError()
    }
    throw new Error(`AutoRAG sync trigger failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    result?: { id?: string }
    success?: boolean
  }

  if (!payload.success || !payload.result?.id) {
    throw new Error('AutoRAG sync response missing job id')
  }

  return { jobId: payload.result.id }
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
    result?: {
      ended_at?: string | null
      end_reason?: string | null
      id?: string
      started_at?: string | null
    }
    success?: boolean
  }

  if (!payload.success || !payload.result) {
    throw new Error('AutoRAG job response missing result')
  }

  const { ended_at, end_reason, started_at } = payload.result
  let runStatus: AutoRagJobRunStatus
  if (!started_at) {
    runStatus = 'pending'
  } else if (!ended_at) {
    runStatus = 'running'
  } else if (end_reason) {
    runStatus = 'failed'
  } else {
    runStatus = 'completed'
  }

  const status: AutoRagJobStatus = {
    jobId: payload.result.id ?? jobId,
    status: runStatus,
  }
  if (end_reason) {
    status.error = end_reason
  }
  return status
}
