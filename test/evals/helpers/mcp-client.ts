import { experimental_createMCPClient } from '@ai-sdk/mcp'

const DEFAULT_MCP_URL = 'http://localhost:3000/mcp'
const DEFAULT_RETRIES = 5
const DEFAULT_SLEEP_MS = 500

export interface CreateEvalMcpClientOptions {
  url?: string
  retries?: number
  sleepMs?: number
  fetchFn?: typeof fetch
}

export type EvalMcpClient = Awaited<ReturnType<typeof experimental_createMCPClient>>

export function getEvalMcpUrl(): string {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }

  return runtime.process?.env?.EVAL_MCP_URL?.trim() || DEFAULT_MCP_URL
}

export async function createEvalMcpClient(
  options: CreateEvalMcpClientOptions = {},
): Promise<EvalMcpClient> {
  const url = options.url ?? getEvalMcpUrl()

  await waitForMcpServer({
    url,
    retries: options.retries ?? DEFAULT_RETRIES,
    sleepMs: options.sleepMs ?? DEFAULT_SLEEP_MS,
    fetchFn: options.fetchFn ?? fetch,
  })

  return experimental_createMCPClient({
    transport: {
      type: 'http',
      url,
    },
  })
}

export async function waitForMcpServer({
  url,
  retries = DEFAULT_RETRIES,
  sleepMs = DEFAULT_SLEEP_MS,
  fetchFn = fetch,
}: Required<CreateEvalMcpClientOptions>): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchFn(url, { method: 'GET' })

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
    `MCP eval server is not ready at ${url}. 請先 \`pnpm dev\`，或用 EVAL_MCP_URL 指到正在執行的 MCP server.${detail}`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
