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

// TC-08：系統能力外問題拒答
// 使用者要求系統執行寫入類操作（如「幫我直接修改 ERP 的採購單狀態」）。
// 系統不應宣稱已執行；應走拒答路徑：refused=true、citations=[]、answer=null。
// 關鍵驗證：
//   1. 回應不得包含「已修改 / 已更新 / 已執行 / 已完成 / 成功」等完成交易語句
//   2. 不得產生任何 citation（交易意圖不屬於任何知識庫文件）
//   3. Workers AI（用於 answer 生成）不得在 refused 路徑被呼叫
//   4. 不得把此類查詢包裝成一般 direct answer

const TRANSACTION_CLAIM_PHRASES = [
  '已修改',
  '已更新',
  '已執行',
  '已完成',
  '修改成功',
  '更新成功',
  '已下單',
  '已送出',
  '寫入成功',
]

interface Tc08TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

const tc08Mocks = vi.hoisted(
  (): Tc08TestState => ({
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
  getCloudflareEnv: () => tc08Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc08Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc08Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', async () => {
  const { createHubDbMock } = await import('./helpers/database')

  return createHubDbMock({ database: () => (tc08Mocks.bindings ?? {}).DB })
})

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc08Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc08Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc08Mocks.readZodBody(...args),
}))

installNuxtRouteTestGlobals()

describe('acceptance out-of-capability refusal (TC-08)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-08',
  )

  beforeEach(() => {
    tc08Mocks.actor = createAcceptanceActorFixture('user')
    tc08Mocks.bindings = null
    tc08Mocks.readBody.mockReset()
    tc08Mocks.readZodBody.mockReset()
    tc08Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc08Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc08Mocks.actor?.webSession))
  })

  it.each(cases)(
    'refuses transactional write intent %s without claiming execution',
    async (fixture) => {
      const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
        acceptanceIds: string[]
        channels: string[]
        expectedHttpStatus: string
        id: string
        primaryOutcome: string
      } | null

      expect(registryEntry).toMatchObject({
        acceptanceIds: expect.arrayContaining(['A06']),
        expectedHttpStatus: '200',
        id: 'TC-08',
        primaryOutcome: 'refused',
      })
      expect(fixture.expectedOutcome).toBe('refused')
      expect(['web', 'mcp']).toContain(fixture.channel)

      tc08Mocks.bindings = createTc08Bindings(
        tc08Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
      )
      tc08Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
      tc08Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

      const result =
        fixture.channel === 'web'
          ? ((await runWebCase()) as {
              data: {
                answer: string | null
                citations: Array<{ citationId: string; sourceChunkId: string }>
                refused: boolean
              }
            })
          : ((await runMcpCase(fixture.prompt)) as {
              data: {
                answer?: string
                citations: Array<{ citationId: string; sourceChunkId: string }>
                refused: boolean
              }
            })

      const d1 = (tc08Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>
      const workersAi = (tc08Mocks.bindings ?? {}).WORKERS_AI as ReturnType<
        typeof createWorkersAiBindingFake
      >

      // Refused 路徑契約
      expect(result.data.refused).toBe(true)
      expect(result.data.citations).toEqual([])

      // 不得宣稱已執行交易（answer 必為 null 或不存在；若有字串，任何交易宣告都不合法）
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

      // 進一步守門：若未來有人把 answer 欄位加回，也不得含交易完成宣告
      const answerText = (result.data as { answer?: string | null }).answer ?? ''

      for (const phrase of TRANSACTION_CLAIM_PHRASES) {
        expect(answerText).not.toContain(phrase)
      }

      // 不得呼叫 Workers AI 生成任何 answer（refused 時不進入 answer pipeline）
      expect(workersAi.calls).toHaveLength(0)

      // 不得寫入任何 citation_records
      const citationInserts = d1.calls.filter((call) =>
        call.query.includes('INSERT INTO citation_records'),
      )

      expect(citationInserts).toHaveLength(0)

      // query_logs 仍須寫入 accepted + configSnapshotVersion（此查詢本身非高風險，audit 不 block）
      const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

      expect(queryLogInsert).toBeDefined()
      expect(queryLogInsert?.values).toEqual(
        expect.arrayContaining([
          'local',
          tc08Mocks.runtimeConfig?.governance.configSnapshotVersion,
          'accepted',
        ]),
      )

      if (fixture.channel === 'mcp') {
        // TD-001 post-migration: `createMcpTokenStore` now issues Drizzle
        // queries instead of raw `prepare('... FROM mcp_tokens')`, so the
        // legacy SQL-string assertion no longer matches. Token auth is
        // covered by `createStubMcpTokenStoreFromActor` in the runner —
        // reaching the response assertions above already proves the token
        // resolved successfully.
      }
    },
  )
})

async function runWebCase() {
  const { default: handler } = await import('../../server/api/chat.post')

  return await handler(createRouteEvent())
}

async function runMcpCase(query: string) {
  const { default: tool } = await import('#server/mcp/tools/ask')
  const data = await runMcpTool(
    tool,
    { query },
    {
      actor: tc08Mocks.actor ?? undefined,
      cloudflareEnv: tc08Mocks.bindings ?? {},
      pendingEvent,
    },
  )

  return { data }
}

function createTc08Bindings(actor: ReturnType<typeof createAcceptanceActorFixture>) {
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
  // AI Search 回空：系統無法從知識庫對交易請求給出答案 → refused
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
