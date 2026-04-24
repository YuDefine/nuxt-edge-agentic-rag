import { experimental_createMCPClient } from '@ai-sdk/mcp'

const DEFAULT_MCP_URL = 'http://localhost:3010/mcp'
const DEFAULT_RETRIES = 5
const DEFAULT_SLEEP_MS = 500

export interface CreateEvalMcpClientOptions {
  url?: string
  retries?: number
  sleepMs?: number
  fetchFn?: typeof fetch
  bearerToken?: string
}

export type EvalMcpClient = Awaited<ReturnType<typeof experimental_createMCPClient>>

export function getEvalMcpUrl(): string {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }

  return runtime.process?.env?.EVAL_MCP_URL?.trim() || DEFAULT_MCP_URL
}

export function getEvalBearerToken(): string {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
  const token = runtime.process?.env?.EVAL_MCP_BEARER_TOKEN?.trim()

  if (!token) {
    throw new Error(
      'EVAL_MCP_BEARER_TOKEN is required for MCP tool-selection eval. 請先跑 `pnpm mint:dev-mcp-token` 取得 dev token 並填入 .env（runtime 不讀取；只 eval 用）。',
    )
  }

  return token
}

export async function createEvalMcpClient(
  options: CreateEvalMcpClientOptions = {},
): Promise<EvalMcpClient> {
  const url = options.url ?? getEvalMcpUrl()
  const bearerToken = options.bearerToken ?? getEvalBearerToken()
  const headers = { Authorization: `Bearer ${bearerToken}` }

  await waitForMcpServer({
    url,
    retries: options.retries ?? DEFAULT_RETRIES,
    sleepMs: options.sleepMs ?? DEFAULT_SLEEP_MS,
    fetchFn: options.fetchFn ?? fetch,
    bearerToken,
  })

  return experimental_createMCPClient({
    transport: {
      type: 'http',
      url,
      headers,
    },
  })
}

export async function waitForMcpServer({
  url,
  retries = DEFAULT_RETRIES,
  sleepMs = DEFAULT_SLEEP_MS,
  fetchFn = fetch,
  bearerToken,
}: Required<CreateEvalMcpClientOptions>): Promise<void> {
  let lastError: unknown
  const headers = { Authorization: `Bearer ${bearerToken}` }

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchFn(url, { method: 'GET', headers })

      if (response.status < 500) {
        return
      }

      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }

    if (attempt < retries) {
      await sleep(sleepMs)
    }
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : ''
  throw new Error(
    `MCP eval server is not ready at ${url}. 請先 \`pnpm dev\`（在 :3010），或用 EVAL_MCP_URL 指到正在執行的 MCP server。若看到 500 Server Error，檢查 NUXT_MCP_AUTH_SIGNING_KEY 是否已在 .env 設足 32 bytes。${detail}`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
