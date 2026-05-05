import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

import type { DemoEnvironment } from './demo-seed-data.ts'

interface TargetConfig {
  aiSearchIndex: string
  bucketName: string
  configFile: string
  databaseName: string
}

interface AiSearchJobStatus {
  error?: string
  jobId?: string
  status: 'completed' | 'cooldown' | 'failed' | 'skipped' | 'timeout'
}

const ACCOUNT_ID = '0eac599c12df10586d97a78179b9f11f'
const TARGETS: Record<DemoEnvironment, TargetConfig> = {
  production: {
    aiSearchIndex: 'agentic-rag',
    bucketName: 'agentic-rag-documents',
    configFile: 'wrangler.jsonc',
    databaseName: 'agentic-rag-db',
  },
  staging: {
    aiSearchIndex: 'agentic-rag-staging',
    bucketName: 'agentic-rag-documents-staging',
    configFile: 'wrangler.staging.jsonc',
    databaseName: 'agentic-rag-db-staging',
  },
}

const args = process.argv.slice(2)
const target = args.find((arg): arg is DemoEnvironment => arg === 'staging' || arg === 'production')
const apply = args.includes('--apply')
const skipSync = args.includes('--skip-sync')
const verifyOnly = args.includes('--verify-only')
const workerOutput = new WeakMap<ChildProcessWithoutNullStreams, string[]>()

if (!target) {
  console.error(
    'Usage: node scripts/demo-seed/run-demo-seed.ts <staging|production> [--apply] [--skip-sync] [--verify-only]',
  )
  process.exit(1)
}

const envFile = loadDotEnv(resolve('.env'))
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN ?? envFile.CLOUDFLARE_API_TOKEN
const aiSearchApiToken =
  process.env.NUXT_KNOWLEDGE_AUTO_RAG_API_TOKEN ??
  envFile.NUXT_KNOWLEDGE_AUTO_RAG_API_TOKEN ??
  cloudflareApiToken

if (!cloudflareApiToken) {
  console.error('Missing CLOUDFLARE_API_TOKEN in environment or .env')
  process.exit(1)
}

const config = TARGETS[target]
const seedToken = randomBytes(24).toString('base64url')
const port = await getFreePort()
const worker = startWranglerDev({
  config,
  cloudflareApiToken,
  environment: target,
  port,
  seedToken,
})

try {
  const dryRun = await waitForWorker(worker, port, seedToken, target)
  if (verifyOnly) {
    const aiSearchVerification = await verifyDemoSearches(port, seedToken)
    console.log(
      JSON.stringify(
        {
          aiSearchVerification,
          dryRun,
          target,
        },
        null,
        2,
      ),
    )
    process.exitCode = 0
  } else if (!apply) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          next: `Run with --apply to write ${target} D1/R2 demo seed.`,
          target,
          worker: dryRun,
        },
        null,
        2,
      ),
    )
    process.exitCode = 0
  } else {
    const applied = await postSeed(port, seedToken, target)
    const aiSearch = skipSync
      ? ({ status: 'skipped' } satisfies AiSearchJobStatus)
      : await triggerAndWaitAiSearchSync(config, aiSearchApiToken)
    if (aiSearch.status !== 'completed' && aiSearch.status !== 'skipped') {
      throw new Error(
        `AI Search sync did not complete (status=${aiSearch.status}${
          aiSearch.error ? `, error=${aiSearch.error}` : ''
        }). Refusing to mark --apply as successful — re-run after addressing the sync failure or pass --skip-sync explicitly.`,
      )
    }
    const aiSearchVerification = await verifyDemoSearches(port, seedToken)
    console.log(
      JSON.stringify(
        {
          aiSearch,
          aiSearchVerification,
          applied,
          target,
        },
        null,
        2,
      ),
    )
  }
} finally {
  await stopWorker(worker)
}

function loadDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {}
  }

  const output: Record<string, string> = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const separator = line.indexOf('=')
    if (separator === -1) {
      continue
    }
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    output[key] = value
  }
  return output
}

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolvePort(address.port)
        } else {
          reject(new Error('Unable to allocate a local port'))
        }
      })
    })
  })
}

function startWranglerDev(input: {
  cloudflareApiToken: string
  config: TargetConfig
  environment: DemoEnvironment
  port: number
  seedToken: string
}): ChildProcessWithoutNullStreams {
  const child = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      'scripts/demo-seed/demo-seed-worker.ts',
      '--remote',
      '--config',
      input.config.configFile,
      '--port',
      String(input.port),
      '--show-interactive-dev-session',
      'false',
      '--var',
      `DEMO_SEED_TOKEN:${input.seedToken}`,
      '--var',
      `NUXT_KNOWLEDGE_ENVIRONMENT:${input.environment}`,
      '--var',
      `NUXT_KNOWLEDGE_AI_SEARCH_INDEX:${input.config.aiSearchIndex}`,
    ],
    {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: input.cloudflareApiToken,
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const output: string[] = []
  workerOutput.set(child, output)
  const collect = (chunk: Buffer) => {
    const text = chunk.toString()
    output.push(text)
    if (output.length > 80) {
      output.shift()
    }
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.once('exit', (code) => {
    if (code && code !== 0) {
      console.error(`wrangler dev exited with ${code}`)
      console.error(output.join('').split(/\r?\n/u).slice(-60).join('\n'))
    }
  })

  return child
}

async function waitForWorker(
  worker: ChildProcessWithoutNullStreams,
  port: number,
  seedToken: string,
  environment: DemoEnvironment,
): Promise<unknown> {
  const deadline = Date.now() + 120_000
  let lastError: unknown
  while (Date.now() < deadline) {
    if (worker.exitCode !== null || worker.signalCode !== null) {
      throw new Error(`wrangler dev exited before ready:\n${getWorkerOutput(worker)}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(3000),
        headers: { 'x-demo-seed-token': seedToken },
        method: 'GET',
      })
      if (response.ok) {
        const payload = await response.json()
        if (payload?.summary?.environment === environment) {
          return payload
        }
      } else {
        lastError = new Error(`HTTP ${response.status}`)
      }
    } catch (error) {
      lastError = error
    }
    await sleep(1500)
  }
  throw new Error(
    `Timed out waiting for wrangler dev worker: ${String(lastError)}\n${getWorkerOutput(worker)}`,
  )
}

async function postSeed(
  port: number,
  seedToken: string,
  environment: DemoEnvironment,
): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}/`, {
    body: JSON.stringify({ dryRun: false, environment }),
    headers: {
      'content-type': 'application/json',
      'x-demo-seed-token': seedToken,
    },
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`Seed worker failed with HTTP ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

async function verifyDemoSearches(port: number, seedToken: string): Promise<unknown[]> {
  const probes = [
    { accessLevel: 'internal', query: 'PR 和 PO 的差別' },
    { accessLevel: 'restricted', query: 'restricted access 可以查哪些預算資料' },
  ]
  return Promise.all(
    probes.map(async (probe) => {
      const params = new URLSearchParams(probe)
      const response = await fetch(`http://127.0.0.1:${port}/ai-search?${params}`, {
        headers: { 'x-demo-seed-token': seedToken },
        method: 'GET',
        signal: AbortSignal.timeout(60_000),
      })
      const payload = (await response.json().catch(() => null)) as {
        matched?: unknown
      } | null
      if (!response.ok) {
        throw new Error(
          `AI Search verification failed with HTTP ${response.status}: ${JSON.stringify(payload)}`,
        )
      }
      const matched = typeof payload?.matched === 'number' ? payload.matched : 0
      if (matched <= 0) {
        throw new Error(
          `AI Search verification failed for ${probe.accessLevel} probe "${probe.query}": matched=${matched}. Expected ≥1 chunk with status=active / version_state=current / citation metadata. Payload: ${JSON.stringify(payload)}`,
        )
      }
      return payload
    }),
  )
}

async function triggerAndWaitAiSearchSync(
  config: TargetConfig,
  apiToken: string | undefined,
): Promise<AiSearchJobStatus> {
  if (!apiToken) {
    return { error: 'missing AI Search API token', status: 'skipped' }
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-search/instances/${config.aiSearchIndex}/jobs`
  const triggered = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${apiToken}` },
    method: 'POST',
  })
  const triggerPayload = (await triggered.json().catch(() => null)) as {
    errors?: Array<{ message?: string }>
    result?: { id?: string }
    success?: boolean
  } | null

  if (!triggered.ok || !triggerPayload?.success) {
    const message = triggerPayload?.errors?.map((error) => error.message).join('; ') ?? ''
    if (message.includes('sync_in_cooldown')) {
      return { error: message, status: 'cooldown' }
    }
    return { error: `trigger failed HTTP ${triggered.status}: ${message}`, status: 'failed' }
  }

  const jobId = triggerPayload.result?.id
  if (!jobId) {
    return { error: 'missing job id', status: 'failed' }
  }

  const deadline = Date.now() + 6 * 60_000
  while (Date.now() < deadline) {
    await sleep(5000)
    const statusResponse = await fetch(`${endpoint}/${jobId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      method: 'GET',
    })
    const payload = (await statusResponse.json().catch(() => null)) as {
      result?: {
        end_reason?: string | null
        ended_at?: string | null
        started_at?: string | null
      }
      success?: boolean
    } | null
    if (!statusResponse.ok || !payload?.success || !payload.result) {
      return { error: `lookup failed HTTP ${statusResponse.status}`, jobId, status: 'failed' }
    }
    if (payload.result.ended_at && payload.result.end_reason) {
      return { error: payload.result.end_reason, jobId, status: 'failed' }
    }
    if (payload.result.ended_at) {
      return { jobId, status: 'completed' }
    }
  }

  return { error: 'job did not complete within 6 minutes', jobId, status: 'timeout' }
}

async function stopWorker(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  signalWorker(child, 'SIGINT')
  await Promise.race([
    new Promise((resolveClose) => child.once('close', resolveClose)),
    sleep(3000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        signalWorker(child, 'SIGKILL')
      }
    }),
  ])
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function getWorkerOutput(child: ChildProcessWithoutNullStreams): string {
  return (workerOutput.get(child) ?? []).join('').split(/\r?\n/u).slice(-80).join('\n')
}

function signalWorker(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall back to signalling the direct child when the process group has
      // already collapsed.
    }
  }
  child.kill(signal)
}
