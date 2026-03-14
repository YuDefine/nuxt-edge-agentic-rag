import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { loadAcceptanceFixtureDataset } from '../acceptance/fixtures/loader'
import { createAcceptanceActorFixture } from '../acceptance/helpers/auth'
import {
  createAiSearchBindingFake,
  createCloudflareBindingsFixture,
  createD1BindingFake,
  createKvBindingFake,
  createWorkersAiBindingFake,
} from '../acceptance/helpers/bindings'
import { getAcceptanceRegistryEntry } from '../acceptance/registry/manifest'
import { runMcpTool } from './helpers/mcp-tool-runner'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const pendingEvent = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('nitropack/runtime', () => ({
  useEvent: () => pendingEvent.current,
}))

// TC-09：高風險敏感資料阻擋題
// 使用者查詢敏感資料（如「列出所有員工薪資帳號」）。
// 系統不應以一般回答包裝；應走拒答路徑：refused=true、citations=[]、answer=null。
// 即使知識庫若不慎收錄到相關 restricted chunk，retrieval 層也應該避免回傳；
// 本測試模擬 AI Search 找不到可回答 evidence（對 user scope 不可見），
// 因此 orchestration 以零分走 refuse 分支。
//
// 關鍵驗證：
//   1. refused=true、citations=[]、answer 為 null / undefined
//   2. 不得呼叫 Workers AI（原文不會被當作 prompt 送進 LLM）
//   3. 不得寫入 citation_records（沒有引用可落地）
//   4. query_logs 仍需記錄（status='accepted' 或 'blocked'，但不得含敏感原文以外的片段被放大）
//   5. 資料落地時不得出現敏感 keyword 以外的杜撰資訊；實際上 refuse 路徑不會產生 assistant message
//   6. answer 欄位（若存在）不得包含類似「薪資帳號為 ...」「帳號列表」這種包裝成已執行的語句

// 禁止在 answer 中出現的「洩漏 / 包裝已執行」語句
const SENSITIVE_CLAIM_PHRASES = [
  '薪資帳號為',
  '帳號列表',
  '員工薪資如下',
  '以下為薪資',
  '已查詢薪資',
  '帳號清單',
]

interface Tc09TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

const tc09Mocks = vi.hoisted(
  (): Tc09TestState => ({
    actor: null,
    bindings: null,
    readBody: vi.fn(),
    readZodBody: vi.fn(),
    runtimeConfig: null,
  }),
)

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/cloudflare-bindings', () => ({
  getCloudflareEnv: () => tc09Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc09Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc09Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc09Mocks.bindings ?? {}).DB,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc09Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc09Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc09Mocks.readZodBody(...args),
}))

installNuxtRouteTestGlobals()

describe('acceptance sensitive-data policy refusal (TC-09)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-09',
  )

  beforeEach(() => {
    tc09Mocks.actor = createAcceptanceActorFixture('user')
    tc09Mocks.bindings = null
    tc09Mocks.readBody.mockReset()
    tc09Mocks.readZodBody.mockReset()
    tc09Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc09Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc09Mocks.actor?.webSession))
  })

  it.each(cases)('refuses sensitive query %s without leaking raw content', async (fixture) => {
    const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
      acceptanceIds: string[]
      channels: string[]
      expectedHttpStatus: string
      id: string
      primaryOutcome: string
    } | null

    expect(registryEntry).toMatchObject({
      acceptanceIds: expect.arrayContaining(['A06', 'A11']),
      expectedHttpStatus: '200',
      id: 'TC-09',
      primaryOutcome: 'refused',
    })
    expect(fixture.expectedOutcome).toBe('refused')
    expect(['web', 'mcp']).toContain(fixture.channel)

    tc09Mocks.bindings = createTc09Bindings(
      tc09Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
    )
    tc09Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
    tc09Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

    const result =
      fixture.channel === 'web'
        ? ((await runWebCase()) as {
            data: {
              answer: string | null
              citations: Array<{ citationId: string; sourceChunkId: string }>
              refused: boolean
            }
          })
        : ((await runMcpCase(
            tc09Mocks.actor?.mcpToken.authorizationHeader ?? '',
            fixture.prompt,
          )) as {
            data: {
              answer?: string
              citations: Array<{ citationId: string; sourceChunkId: string }>
              refused: boolean
            }
          })

    const d1 = (tc09Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>
    const workersAi = (tc09Mocks.bindings ?? {}).WORKERS_AI as ReturnType<
      typeof createWorkersAiBindingFake
    >

    // Refused 契約：refused=true + 零引用
    expect(result.data.refused).toBe(true)
    expect(result.data.citations).toEqual([])

    // answer：web=null；MCP 拒答路徑不帶 answer key
    if (fixture.channel === 'web') {
      const webResult = result as {
        data: { answer: string | null; citations: unknown[]; refused: boolean }
      }

      expect(webResult.data.answer).toBeNull()
    } else {
      const mcpResult = result as {
        data: { answer?: string; citations: unknown[]; refused: boolean }
      }

      expect(mcpResult.data.answer).toBeUndefined()
    }

    // 進一步守門：若未來 answer 被加回，也不得含任何包裝為「已查詢敏感資料」的宣告
    const answerText = (result.data as { answer?: string | null }).answer ?? ''

    for (const phrase of SENSITIVE_CLAIM_PHRASES) {
      expect(answerText).not.toContain(phrase)
    }

    // 不得呼叫 Workers AI（原文不進入 LLM prompt）
    expect(workersAi.calls).toHaveLength(0)

    // 不得寫入任何 citation_records
    const citationInserts = d1.calls.filter((call) =>
      call.query.includes('INSERT INTO citation_records'),
    )

    expect(citationInserts).toHaveLength(0)

    // query_logs 須寫入（拒答仍要留稽核軌跡）
    const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

    expect(queryLogInsert).toBeDefined()
    expect(queryLogInsert?.values).toEqual(
      expect.arrayContaining(['local', tc09Mocks.runtimeConfig?.governance.configSnapshotVersion]),
    )

    // Workers AI 所有呼叫（應為空）中不得含敏感 keyword
    for (const call of workersAi.calls) {
      const payloadText = JSON.stringify(call.payload)
      expect(payloadText).not.toContain('薪資')
      expect(payloadText).not.toContain('帳號')
    }

    if (fixture.channel === 'mcp') {
      expect(d1.calls.some((call) => call.query.includes('FROM mcp_tokens'))).toBe(true)
    }
  })
})

async function runWebCase() {
  const { default: handler } = await import('../../server/api/chat.post')

  return await handler(createRouteEvent())
}

async function runMcpCase(authorizationHeader: string, query: string) {
  const { default: tool } = await import('#server/mcp/tools/ask')
  const data = await runMcpTool(
    tool,
    { query },
    {
      authorizationHeader,
      cloudflareEnv: tc09Mocks.bindings ?? {},
      pendingEvent,
    },
  )

  return { data }
}

function createTc09Bindings(actor: ReturnType<typeof createAcceptanceActorFixture>) {
  const d1 = createD1BindingFake({
    responders: [
      {
        match: /FROM mcp_tokens/,
        resolve: ({ values }) => ({
          first:
            values[0] === actor.mcpToken.record.tokenHash && values[1] === 'local'
              ? {
                  created_at: '2026-04-16T00:00:00.000Z',
                  environment: 'local',
                  expires_at: null,
                  id: actor.mcpAuth.tokenId,
                  last_used_at: null,
                  name: actor.mcpToken.record.name,
                  revoked_at: null,
                  revoked_reason: null,
                  scopes_json: actor.mcpToken.record.scopesJson,
                  status: 'active',
                  token_hash: actor.mcpToken.record.tokenHash,
                }
              : null,
        }),
      },
      {
        match: /UPDATE mcp_tokens/,
        resolve: () => ({
          run: { success: true },
        }),
      },
    ],
  })
  const kv = createKvBindingFake()
  // 敏感查詢對 user scope 不可見：AI Search 回空 → retrievalScore = 0 → refuse
  // 這模擬「高風險政策」讓 retrieval 層看不到任何 restricted/employee 資料。
  const ai = createAiSearchBindingFake({
    responses: {
      'knowledge-index': [],
    },
  })
  const workersAi = createWorkersAiBindingFake()

  return createCloudflareBindingsFixture({
    ai,
    d1,
    kv,
    workersAi,
  })
}
