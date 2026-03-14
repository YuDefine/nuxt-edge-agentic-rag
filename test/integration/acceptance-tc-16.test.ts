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
import { installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const pendingEvent = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('nitropack/runtime', () => ({
  useEvent: () => pendingEvent.current,
}))

// TC-16 searchKnowledge no-hit 契約
// 當查詢在目前 actor 可見的 evidence 集合中找不到結果時，
// MCP `searchKnowledge` tool（@nuxtjs/mcp-toolkit /mcp JSON-RPC endpoint）
// 必須回傳 `{ results: [] }`（toolkit wrap 後 CallToolResult 仍是 200），
// 並且不得回傳任何暗示命中的欄位。

interface Tc16TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

const tc16Mocks = vi.hoisted(
  (): Tc16TestState => ({
    actor: null,
    bindings: null,
    readBody: vi.fn(),
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
  getCloudflareEnv: () => tc16Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc16Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc16Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc16Mocks.bindings ?? {}).DB,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc16Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc16Mocks.actor?.isAdmin ?? false,
  }
})

installNuxtRouteTestGlobals()

describe('acceptance searchKnowledge no-hit contract (TC-16)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-16',
  )

  beforeEach(() => {
    tc16Mocks.actor = createAcceptanceActorFixture('user')
    tc16Mocks.bindings = null
    tc16Mocks.readBody.mockReset()
    tc16Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc16Mocks.readBody)
  })

  it.each(cases)('returns HTTP 200 with empty results for %s', async (fixture) => {
    const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
      acceptanceIds: string[]
      channels: string[]
      expectedHttpStatus: string
      id: string
      primaryOutcome: string
    } | null

    expect(registryEntry).toMatchObject({
      acceptanceIds: expect.arrayContaining(['A07']),
      channels: ['mcp'],
      expectedHttpStatus: '200',
      id: 'TC-16',
      primaryOutcome: '200_empty',
    })
    expect(fixture.expectedOutcome).toBe('200_empty')
    expect(fixture.channel).toBe('mcp')

    tc16Mocks.bindings = createTc16Bindings(
      tc16Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
    )
    tc16Mocks.readBody.mockResolvedValue({ query: fixture.prompt })

    const { default: tool } = await import('#server/mcp/tools/search')
    const result = (await runMcpTool(
      tool,
      { query: fixture.prompt },
      {
        authorizationHeader: tc16Mocks.actor?.mcpToken.authorizationHeader ?? '',
        cloudflareEnv: tc16Mocks.bindings ?? {},
        pendingEvent,
      },
    )) as { results: unknown[]; normalizedQuery?: string }

    // 契約 #1：tool 直接回傳 results（不含 data envelope）；200 + results: []
    expect(result.results).toEqual([])

    // 契約 #2：回傳 envelope 不得暗示命中（無 answer / citations / refused / decisionPath）
    const envelopeKeys = Object.keys(result)

    for (const leakingKey of [
      'answer',
      'citations',
      'refused',
      'decisionPath',
      'retrievalScore',
      'documentVersionId',
    ]) {
      expect(envelopeKeys).not.toContain(leakingKey)
    }

    // 契約 #3：AI search 被呼叫一次（表示 allowed_access_levels 套用於 retrieval），
    // 且底層 D1 仍正確對 mcp_tokens 做 scope 檢查
    const aiBinding = (tc16Mocks.bindings ?? {}).AI as ReturnType<typeof createAiSearchBindingFake>
    const d1 = (tc16Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

    expect(aiBinding.calls).toHaveLength(1)
    expect(d1.calls.some((call) => call.query.includes('FROM mcp_tokens'))).toBe(true)
  })
})

function createTc16Bindings(actor: ReturnType<typeof createAcceptanceActorFixture>) {
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
  // AI search 回 empty → retrieveVerifiedEvidence 得不到 evidence，searchKnowledge 回 results: []
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
