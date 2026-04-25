import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'

import { createMcpHandler } from '#server/utils/mcp-agents-compat'

// TD-029: production-wiring smoke test
//
// 對應 `docs/tech-debt.md` TD-029 — mcp-toolkit alias fragility，shim 可能被 bypass。
// `fix-mcp-streamable-http-session` 的 fix（GET/DELETE 405 + POST 強制 JSON）依賴：
//   1. `@nuxtjs/mcp-toolkit` cloudflare provider 在 runtime `await import("agents/mcp")` 載入 shim
//   2. `nuxt.config.ts` 的 `agents/mcp` alias 指到 shim 本身
//   3. `nuxt.config.ts` 的 `mcpToolkitCloudflareProvider → mcpToolkitNodeProvider` alias
//      把 cloudflare provider 整體替換為 node provider（node provider 內已有 GET 405）
//
// 風險：alias 規則消失 / toolkit upstream 換 specifier → 替換被 bypass，POST 走 SSE，
// Cloudflare Workers 30s CPU hang 回歸。
//
// 此 spec 用「靜態 source 檢查 + shim contract 行為驗證」雙層 catch alias drift。
// 若任一檢查失敗，代表 production wiring 已壞，必須立即重新 propose。
// 整套 build artifact 級別驗證（A2）成本太高（30s+ build），改用此輕量 A1 變體。

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const nuxtConfigPath = `${repoRoot}/nuxt.config.ts`
const cloudflareProviderPath = `${repoRoot}/node_modules/@nuxtjs/mcp-toolkit/dist/runtime/server/mcp/providers/cloudflare.js`

const INITIALIZE_BODY = {
  jsonrpc: '2.0' as const,
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'production-wiring-smoke', version: '0.0.0' },
  },
}

function buildServer() {
  const server = new McpServer({ name: 'production-wiring-smoke', version: '0.0.0' })
  return server.server
}

describe('MCP production wiring (TD-029 smoke test)', () => {
  describe('static config wiring', () => {
    it('nuxt.config.ts retains the agents/mcp → shim alias', () => {
      // 若此 alias 從 nuxt.config 移除，cloudflare provider `await import("agents/mcp")`
      // 會回到上游 SDK 的 worker transport（已知有 ownKeys / SSE 30s hang 問題）。
      const source = readFileSync(nuxtConfigPath, 'utf8')
      expect(source).toMatch(/['"]agents\/mcp['"]\s*:\s*mcpAgentsCompatProvider/u)
    })

    it('nuxt.config.ts retains the mcp-toolkit cloudflare → node provider alias', () => {
      // 若此 alias 消失，toolkit cloudflare provider 會被 bundle 進來，原始
      // cloudflare provider 的 import("agents/mcp") 仍能命中 shim，但 cloudflare
      // provider 本身有額外路徑分歧（fallbackCtx 等）會繞過 shim 的 route guard。
      // alias 把 cloudflare provider 整個換成 node provider 是預期入口。
      const source = readFileSync(nuxtConfigPath, 'utf8')
      expect(source).toMatch(/\[mcpToolkitCloudflareProvider\]\s*:\s*mcpToolkitNodeProvider/u)
    })

    it('mcpAgentsCompatProvider points at the shim source path', () => {
      const source = readFileSync(nuxtConfigPath, 'utf8')
      expect(source).toMatch(
        /mcpAgentsCompatProvider\s*=\s*fileURLToPath\([\s\S]*?server\/utils\/mcp-agents-compat\.ts/u,
      )
    })

    it('mcp-toolkit cloudflare provider still uses the agents/mcp specifier', () => {
      // 若 toolkit upstream 換 specifier（例如 `agents/mcp.js` 或 `@cloudflare/agents/mcp`），
      // alias 規則的 key 必須跟著改 — 此 case 在升級套件時提早失敗，避免 silent regression。
      const source = readFileSync(cloudflareProviderPath, 'utf8')
      expect(source).toMatch(/import\(\s*['"]agents\/mcp['"]\s*\)/u)
      expect(source).toMatch(/createMcpHandler/u)
    })
  })

  describe('shim contract (cloudflare provider depends on this)', () => {
    it('exports createMcpHandler that returns a Request → Response handler', () => {
      // cloudflare provider 從 `agents/mcp` 解構 `createMcpHandler` 並呼叫
      // `createMcpHandler(server, { route: '' })`，再以 `(request, env, ctx)` 觸發。
      // 此 case 確保 shim 提供同樣形狀的 export。
      expect(createMcpHandler).toBeTypeOf('function')
      const handler = createMcpHandler(buildServer() as never, { route: '/mcp' })
      expect(handler).toBeTypeOf('function')
    })

    it('GET /mcp returns 405 with Allow: POST and JSON-RPC error body', async () => {
      // 此 case 鎖定整條鏈（alias → shim → 405 path）的可觀察結果。
      // 若 toolkit cloudflare provider 拿到不同的 createMcpHandler（例如未替換成 shim
      // 的 stock @cloudflare/agents 版本），GET 會掛 30s SSE 而非立刻 405。
      const handler = createMcpHandler(buildServer() as never, { route: '/mcp' })

      const start = Date.now()
      const response = await handler(new Request('https://worker.test/mcp', { method: 'GET' }))
      const elapsed = Date.now() - start

      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('POST')
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(elapsed).toBeLessThan(1000)

      const body = (await response.json()) as { jsonrpc: string; error: { code: number } }
      expect(body.jsonrpc).toBe('2.0')
      expect(body.error.code).toBe(-32000)
    })

    it('DELETE /mcp returns 405 with Allow: POST', async () => {
      const handler = createMcpHandler(buildServer() as never, { route: '/mcp' })

      const response = await handler(new Request('https://worker.test/mcp', { method: 'DELETE' }))

      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('POST')
    })

    it('POST initialize returns Content-Type: application/json (not text/event-stream)', async () => {
      // 此 case 是 TD-029 的核心：enableJsonResponse: true 路徑被走過。
      // 若 shim 回到上游 cloudflare provider，POST 會走 SSE（`text/event-stream`）→
      // Workers 30s CPU 上限觸發。此 case 直接斷言 Content-Type 防止靜默回歸。
      const handler = createMcpHandler(buildServer() as never, { route: '/mcp' })

      const response = await handler(
        new Request('https://worker.test/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify(INITIALIZE_BODY),
        }),
      )

      expect(response.status).toBe(200)
      const contentType = response.headers.get('content-type') ?? ''
      expect(contentType).toMatch(/application\/json/u)
      expect(contentType).not.toMatch(/text\/event-stream/u)

      const text = await response.text()
      // SSE 回應會以 `event: message\n` 開頭；JSON 回應則直接是 `{`。
      expect(text.startsWith('event:')).toBe(false)

      const body = JSON.parse(text) as {
        jsonrpc: string
        id: number
        result: { protocolVersion?: string; capabilities?: unknown; serverInfo?: unknown }
      }
      expect(body.jsonrpc).toBe('2.0')
      expect(body.id).toBe(0)
      expect(body.result).toBeDefined()
      expect(body.result.protocolVersion).toBeDefined()
      expect(body.result.capabilities).toBeDefined()
      expect(body.result.serverInfo).toBeDefined()
    })
  })
})
