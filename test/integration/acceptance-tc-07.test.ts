import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { loadAcceptanceFixtureDataset } from '../acceptance/fixtures/loader'
import { createAcceptanceActorFixture } from '../acceptance/helpers/auth'
import {
  createAiSearchBindingFake,
  createCloudflareBindingsFixture,
  createD1BindingFake,
  createKvBindingFake,
} from '../acceptance/helpers/bindings'
import { getAcceptanceRegistryEntry } from '../acceptance/registry/manifest'
import { runMcpTool } from './helpers/mcp-tool-runner'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const pendingEvent = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('nitropack/runtime', () => ({
  useEvent: () => pendingEvent.current,
}))

// TC-07：知識庫外問題拒答
// 使用者詢問與 knowledge base 無關的問題（如「今天天氣如何？」）。
// 底層 AI Search 找不到對應 evidence → evidence 空 → retrievalScore = 0 →
// answerKnowledgeQuery 走 refuse 路徑：answer=null、citations=[]、refused=true。
// 同時驗證：query_logs 仍寫入 accepted + configSnapshotVersion，
// citation_records / workers_ai 均不應被觸發，回應零引用。

interface Tc07TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

const tc07Mocks = vi.hoisted(
  (): Tc07TestState => ({
    actor: null,
    bindings: null,
    readBody: vi.fn(),
    readZodBody: vi.fn(),
    runtimeConfig: null,
  })
)

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/cloudflare-bindings', () => ({
  getCloudflareEnv: () => tc07Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc07Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc07Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc07Mocks.bindings ?? {}).DB,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc07Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc07Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc07Mocks.readZodBody(...args),
}))

installNuxtRouteTestGlobals()

describe('acceptance out-of-knowledge-base refusal (TC-07)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-07'
  )

  beforeEach(() => {
    tc07Mocks.actor = createAcceptanceActorFixture('user')
    tc07Mocks.bindings = null
    tc07Mocks.readBody.mockReset()
    tc07Mocks.readZodBody.mockReset()
    tc07Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc07Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc07Mocks.actor?.webSession))
  })

  it.each(cases)(
    'refuses %s with zero citations when query is out of knowledge base',
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
        id: 'TC-07',
        primaryOutcome: 'refused',
      })
      expect(fixture.expectedOutcome).toBe('refused')
      expect(['web', 'mcp']).toContain(fixture.channel)

      tc07Mocks.bindings = createTc07Bindings(
        tc07Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>
      )
      tc07Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
      tc07Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

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
              tc07Mocks.actor?.mcpToken.authorizationHeader ?? '',
              fixture.prompt
            )) as {
              data: {
                answer?: string
                citations: Array<{ citationId: string; sourceChunkId: string }>
                refused: boolean
              }
            })

      const aiBinding = (tc07Mocks.bindings ?? {}).AI as ReturnType<
        typeof createAiSearchBindingFake
      >
      const d1 = (tc07Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

      // AI Search 被呼叫一次（表示進了 retrieval pipeline），但 data 為空
      expect(aiBinding.calls).toHaveLength(1)

      // 拒答契約：refused:true、citations:[]
      expect(result.data.refused).toBe(true)
      expect(result.data.citations).toEqual([])

      // 拒答時 answer 必須為 null（不得包裝成一般回答）
      if (fixture.channel === 'web') {
        const webResult = result as {
          data: { answer: string | null; citations: unknown[]; refused: boolean }
        }

        expect(webResult.data.answer).toBeNull()
      } else {
        const mcpResult = result as {
          data: { answer?: string; citations: unknown[]; refused: boolean }
        }

        // MCP 拒答路徑回 { refused: true, citations: [] }，不會有 answer key
        expect(mcpResult.data.answer).toBeUndefined()
      }

      // 絕對不能寫 citation_records
      const citationInserts = d1.calls.filter((call) =>
        call.query.includes('INSERT INTO citation_records')
      )

      expect(citationInserts).toHaveLength(0)

      // query_logs 仍須帶 accepted + configSnapshotVersion（query 本身不是高風險，audit 不會 block）
      const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

      expect(queryLogInsert).toBeDefined()
      expect(queryLogInsert?.values).toEqual(
        expect.arrayContaining([
          'local',
          tc07Mocks.runtimeConfig?.governance.configSnapshotVersion,
          'accepted',
        ])
      )

      if (fixture.channel === 'mcp') {
        expect(d1.calls.some((call) => call.query.includes('FROM mcp_tokens'))).toBe(true)
      }
    }
  )
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
      cloudflareEnv: tc07Mocks.bindings ?? {},
      pendingEvent,
    }
  )

  return { data }
}

function createTc07Bindings(actor: ReturnType<typeof createAcceptanceActorFixture>) {
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
  // AI Search 回空結果 → 無 candidate → retrievalScore=0 → refuse
  const ai = createAiSearchBindingFake({
    responses: {
      'knowledge-index': [],
    },
  })

  return createCloudflareBindingsFixture({
    ai,
    d1,
    kv,
  })
}
