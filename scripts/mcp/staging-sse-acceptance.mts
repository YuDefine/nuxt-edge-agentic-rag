#!/usr/bin/env node
/**
 * §7.1 Staging acceptance: SSE-aware mock client.
 *
 * 對 staging 跑一次完整 wire-do-tool-dispatch happy path，包含 SSE channel
 * mechanics（ReadableStream consume + Last-Event-Id replay simulation），
 * 取代 v0.42.x 階段只跑 curl 4 tool call 的 acceptance（curl 不發 GET
 * re-connect、看不到 stateful server 的 SSE 不對稱）。
 *
 * 使用：
 *   MCP_STAGING_URL=https://agentic-staging.yudefine.com.tw/mcp \
 *   MCP_STAGING_TOKEN=<oauth-bearer-token> \
 *   pnpm mcp:acceptance:staging
 *
 * 此 script 不會自己 mint token；先用 `mint-dev-mcp-token.mts` 或 staging OAuth
 * flow 取得 Bearer token。執行前驗證 staging runtime flag 為 true（否則 GET
 * 會落到 stateless 405 fallback、整段不做 SSE 路徑驗證）。
 *
 * Exit codes:
 *   0 = 全部 step 綠 + isError:false × 4
 *   1 = 任一 step 失敗（保留 stderr trace 供 debug）
 *   2 = 用法 / env 缺失
 */

import { argv, env, exit, stderr, stdout } from 'node:process'

const FLAG_HELP = argv.slice(2).some((a) => a === '--help' || a === '-h')
const FLAG_VERBOSE = argv.slice(2).some((a) => a === '--verbose' || a === '-v')

if (FLAG_HELP) {
  printHelp()
  exit(0)
}

const baseUrl = env.MCP_STAGING_URL
const bearer = env.MCP_STAGING_TOKEN
if (!baseUrl || !bearer) {
  stderr.write('Missing env: MCP_STAGING_URL and MCP_STAGING_TOKEN\n\n')
  printHelp()
  exit(2)
}

interface StepResult {
  name: string
  ok: boolean
  detail?: string
  durationMs: number
}

const results: StepResult[] = []

function log(msg: string) {
  if (FLAG_VERBOSE) stderr.write(`${msg}\n`)
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    const value = await fn()
    results.push({ name, ok: true, durationMs: performance.now() - started })
    log(`✓ ${name}`)
    return value
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    results.push({ name, ok: false, detail, durationMs: performance.now() - started })
    log(`✗ ${name}: ${detail}`)
    throw err
  }
}

function authHeaders(sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  return headers
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

interface ToolCallContent {
  type: string
  text?: string
}

interface ToolCallResult {
  content?: ToolCallContent[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

async function rpc<T = JsonRpcResponse>(
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ response: Response; data: T; sessionId: string | null }> {
  const response = await fetch(baseUrl!, {
    method: 'POST',
    headers: authHeaders(sessionId),
    body: JSON.stringify(body),
  })
  const sid = response.headers.get('Mcp-Session-Id')
  const text = await response.text()
  if (!response.ok && response.status !== 202) {
    throw new Error(`POST ${body.method} → ${response.status} ${response.statusText}: ${text}`)
  }
  if (response.status === 202 || text.length === 0) {
    return { response, data: {} as T, sessionId: sid }
  }
  return { response, data: JSON.parse(text) as T, sessionId: sid }
}

async function openSseChannel(
  sessionId: string,
  lastEventId?: string,
): Promise<{ response: Response; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    'Mcp-Session-Id': sessionId,
    accept: 'text/event-stream',
  }
  if (lastEventId) headers['Last-Event-Id'] = lastEventId

  const response = await fetch(baseUrl!, { method: 'GET', headers })
  if (response.status !== 200) {
    const body = await response.text().catch(() => '<no body>')
    throw new Error(`GET /mcp SSE → ${response.status}: ${body.slice(0, 200)}`)
  }
  const ct = response.headers.get('content-type') ?? ''
  if (!/text\/event-stream/.test(ct)) {
    throw new Error(`GET /mcp content-type expected SSE, got ${ct}`)
  }
  return { response, reader: response.body!.getReader() }
}

interface SseFrame {
  id?: string
  event?: string
  data?: unknown
  rawData?: string
  comment?: string
}

function parseSseBlock(block: string): SseFrame {
  const frame: SseFrame = {}
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      const txt = line.slice(1).trim()
      frame.comment = frame.comment ? `${frame.comment} ${txt}` : txt
      continue
    }
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon)
    const value = line.slice(colon + 1).trimStart()
    if (field === 'id') frame.id = value
    else if (field === 'event') frame.event = value
    else if (field === 'data') {
      frame.rawData = value
      try {
        frame.data = JSON.parse(value)
      } catch {
        frame.data = value
      }
    }
  }
  return frame
}

async function readFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxFrames: number,
  timeoutMs: number,
): Promise<SseFrame[]> {
  const decoder = new TextDecoder()
  const frames: SseFrame[] = []
  let buffer = ''
  const deadline = Date.now() + timeoutMs

  while (frames.length < maxFrames && Date.now() < deadline) {
    const remaining = Math.max(deadline - Date.now(), 1)
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true; _t: true }>((resolve) => {
        timer = setTimeout(() => resolve({ value: undefined, done: true, _t: true }), remaining)
      }),
    ])
    if (timer) clearTimeout(timer)
    if (result.done) break
    buffer += decoder.decode(result.value as Uint8Array, { stream: true })
    let sep = buffer.indexOf('\n\n')
    while (sep !== -1 && frames.length < maxFrames) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      if (block.length > 0) frames.push(parseSseBlock(block))
      sep = buffer.indexOf('\n\n')
    }
  }
  return frames
}

async function deleteSession(sessionId: string): Promise<number> {
  const response = await fetch(baseUrl!, {
    method: 'DELETE',
    headers: authHeaders(sessionId),
  })
  return response.status
}

function printHelp(): void {
  stderr.write(
    [
      'wire-do-tool-dispatch §7.1 staging SSE acceptance',
      '',
      'Required env:',
      '  MCP_STAGING_URL    e.g. https://agentic-staging.yudefine.com.tw/mcp',
      '  MCP_STAGING_TOKEN  Bearer token (OAuth or dev-minted)',
      '',
      'Flags:',
      '  -v, --verbose      stream per-step trace to stderr',
      '  -h, --help         this help',
      '',
      '產出 stdout 為單行 JSON summary（pass count / fail count / details），',
      '便於 CI parse；human-readable trace 走 stderr。',
      '',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  // --- Phase 1: handshake ---
  const initResp = await step('initialize', async () => {
    const { data, sessionId } = await rpc<JsonRpcResponse>({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'staging-sse-acceptance', version: '1.0.0' },
      },
    })
    if (data.error) throw new Error(`initialize error: ${data.error.message}`)
    if (!sessionId) throw new Error('initialize did not return Mcp-Session-Id header')
    return { sessionId }
  })
  const { sessionId } = initResp

  await step('notifications/initialized', async () => {
    const { response } = await rpc(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      sessionId,
    )
    if (response.status !== 202 && response.status !== 200) {
      throw new Error(`expected 202/200, got ${response.status}`)
    }
  })

  await step('tools/list returns 4 tools', async () => {
    const { data } = await rpc<JsonRpcResponse>(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      sessionId,
    )
    const tools = (data.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? []
    if (tools.length !== 4) {
      throw new Error(
        `expected 4 tools, got ${tools.length}: ${tools.map((t) => t.name).join(',')}`,
      )
    }
  })

  // --- Phase 2: open SSE channel + drain initial connected frame ---
  const sse1 = await step('GET /mcp opens SSE channel', async () => {
    const { response, reader } = await openSseChannel(sessionId)
    const frames = await readFrames(reader, 1, 2000)
    if (!frames[0]?.comment?.includes('connected')) {
      throw new Error(`first SSE frame not connected: ${JSON.stringify(frames[0])}`)
    }
    return { response, reader }
  })

  // --- Phase 3: 4 tool calls — verify isError:false ---
  const toolCalls = [
    { name: 'askKnowledge', args: { query: 'What is Cloudflare R2?' } },
    { name: 'askKnowledge', args: { query: 'How does AutoRAG indexing work?' } },
    { name: 'searchKnowledge', args: { query: 'durable object' } },
    { name: 'searchKnowledge', args: { query: 'edge runtime' } },
  ]
  for (const [idx, call] of toolCalls.entries()) {
    await step(`tools/call #${idx + 1} ${call.name} isError=false`, async () => {
      const { data } = await rpc<JsonRpcResponse>(
        {
          jsonrpc: '2.0',
          id: 100 + idx,
          method: 'tools/call',
          params: { name: call.name, arguments: call.args },
        },
        sessionId,
      )
      if (data.error) throw new Error(`JSON-RPC error: ${data.error.message}`)
      const result = data.result as ToolCallResult | undefined
      if (!result) throw new Error('no result')
      if (result.isError === true) {
        const msg = result.content?.[0]?.text ?? '<no text>'
        throw new Error(`isError=true, content: ${msg.slice(0, 200)}`)
      }
    })
  }

  // --- Phase 4: collect any server-initiated frames sent during tool calls ---
  const collectedFrames = await step('collect server-initiated frames (best-effort)', async () => {
    const frames = await readFrames(sse1.reader, 10, 500)
    log(
      `  collected ${frames.length} frames; ids = ${frames
        .map((f) => f.id ?? '(comment)')
        .join(',')}`,
    )
    return frames
  })

  // --- Phase 5: close SSE, reconnect with Last-Event-Id ---
  await sse1.reader.cancel().catch(() => {})

  const lastEventId = [...collectedFrames].reverse().find((f) => f.id != null)?.id

  await step(
    `reconnect SSE${lastEventId ? ` with Last-Event-Id=${lastEventId}` : ' (no events received)'}`,
    async () => {
      const { reader } = await openSseChannel(sessionId, lastEventId)
      const frames = await readFrames(reader, 5, 2000)
      if (!frames[0]?.comment?.includes('connected')) {
        throw new Error('reconnect did not emit connected comment')
      }
      // 若 lastEventId 對到的 row 仍在 storage，應該不會 emit events_dropped
      // （既有 Last-Event-Id 比 server 已知 counter 早或等於就 silent）。
      // 若 events_dropped 出現代表 storage 已 TTL-evict — 記錄但不 fail。
      const dropped = frames.find(
        (f) =>
          (f.data as { method?: string } | undefined)?.method === 'notifications/events_dropped',
      )
      if (dropped) log(`  events_dropped received: ${JSON.stringify(dropped.data)}`)
      await reader.cancel().catch(() => {})
    },
  )

  // --- Phase 6: DELETE session ---
  await step('DELETE /mcp returns 204', async () => {
    const status = await deleteSession(sessionId)
    if (status !== 204) throw new Error(`expected 204, got ${status}`)
  })

  await step('subsequent GET on deleted session returns 404', async () => {
    const response = await fetch(baseUrl!, {
      method: 'GET',
      headers: authHeaders(sessionId),
    })
    if (response.status !== 404) {
      const body = await response.text().catch(() => '<no body>')
      throw new Error(`expected 404, got ${response.status}: ${body.slice(0, 100)}`)
    }
  })
}

main()
  .catch(() => {
    // already captured in results
  })
  .finally(() => {
    const passCount = results.filter((r) => r.ok).length
    const failCount = results.filter((r) => !r.ok).length
    const summary = {
      passCount,
      failCount,
      totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
      steps: results.map((r) => ({
        name: r.name,
        ok: r.ok,
        durationMs: Math.round(r.durationMs),
        ...(r.detail ? { detail: r.detail } : {}),
      })),
    }
    stdout.write(`${JSON.stringify(summary)}\n`)
    exit(failCount === 0 ? 0 : 1)
  })
