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
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

// TC-14：Admin Web restricted 讀取 vs MCP scope 邊界隔離
//
// 同一個 Admin 使用者：
//   Web 側 → isAdmin=true → deriveAllowedAccessLevels('web', isAdmin) = ['internal', 'restricted']
//            → AI Search filter 不再帶 `access_level`，restricted 文件進入 candidate
//            → D1.resolveCurrentEvidence 允許 restricted chunk → 正式回答 + citation 指向 restricted
//   MCP 側 → admin preset token scopes 不含 `knowledge.restricted.read`
//            → deriveAllowedAccessLevels('mcp', ...) = ['internal']
//            → AI Search filter 限定 access_level='internal'，restricted-only 文件被過濾
//            → askKnowledge evidence=[] → refused=true + citations=[]，不得洩漏該文件存在
//
// 關鍵驗證：
//   1. Web channel：refused=false、一筆 citation、accessLevel='restricted'、answer 含 restricted 片段
//   2. MCP channel：refused=true、citations=[]、answer 不存在（existence-hiding）
//   3. Web AI Search filter 不包含 access_level=eq（只有 status + version_state）
//   4. MCP AI Search filter 明確帶 access_level='internal'
//   5. 兩條路徑都寫入 query_logs(accepted) + 正確 configSnapshotVersion

interface Tc14TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc14Scenario {
  answerFragments: string[]
  categorySlug: string
  chunkText: string
  citationLocator: string
  documentId: string
  documentTitle: string
  documentVersionId: string
  score: number
  sourceChunkId: string
  title: string
}

const tc14Mocks = vi.hoisted(
  (): Tc14TestState => ({
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
  getCloudflareEnv: () => tc14Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc14Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc14Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc14Mocks.bindings ?? {}).DB,
  getDrizzleDb: async () => ({ db: (tc14Mocks.bindings ?? {}).DB }),
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc14Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc14Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc14Mocks.readZodBody(...args),
}))

installNuxtRouteTestGlobals()

describe('acceptance admin web vs mcp scope isolation (TC-14)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-14'
  )
  const scenario = getTc14Scenario()

  beforeEach(() => {
    // Admin preset：isAdmin=true（web 可讀 restricted），但 MCP token scopes 不含 knowledge.restricted.read
    tc14Mocks.actor = createAcceptanceActorFixture('admin')
    tc14Mocks.bindings = null
    tc14Mocks.readBody.mockReset()
    tc14Mocks.readZodBody.mockReset()
    tc14Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc14Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc14Mocks.actor?.webSession))
  })

  it.each(cases)('enforces channel boundary for %s', async (fixture) => {
    const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
      acceptanceIds: string[]
      channels: string[]
      expectedHttpStatus: string
      id: string
      primaryOutcome: string
    } | null

    expect(registryEntry).toMatchObject({
      acceptanceIds: expect.arrayContaining(['A10']),
      id: 'TC-14',
    })

    // Admin web scopes 前置：web 為 admin + mcp 不含 restricted scope
    expect(tc14Mocks.actor?.isAdmin).toBe(true)
    expect(tc14Mocks.actor?.mcpAuth.scopes).not.toContain('knowledge.restricted.read')
    expect(tc14Mocks.actor?.allowedAccessLevels.web).toEqual(
      expect.arrayContaining(['internal', 'restricted'])
    )
    expect(tc14Mocks.actor?.allowedAccessLevels.mcp).toEqual(['internal'])

    // --- Web path (admin + restricted 可讀) ---
    tc14Mocks.bindings = createTc14Bindings(
      tc14Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
      scenario
    )
    tc14Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
    tc14Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

    const webResult = (await runWebCase()) as {
      data: {
        answer: string | null
        citations: Array<{ citationId: string; sourceChunkId: string }>
        refused: boolean
      }
    }

    const webAi = (tc14Mocks.bindings ?? {}).AI as ReturnType<typeof createAiSearchBindingFake>
    const webD1 = (tc14Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

    // 契約 #1：Web 成功引用 restricted 文件
    expect(webResult.data.refused).toBe(false)
    expect(webResult.data.citations).toHaveLength(1)
    expect(webResult.data.citations[0]).toMatchObject({
      citationId: expect.any(String),
      sourceChunkId: scenario.sourceChunkId,
    })
    for (const fragment of scenario.answerFragments) {
      expect(webResult.data.answer).toContain(fragment)
    }

    // 契約 #2：Web AI Search filter 允許 internal + restricted（不再帶單一 access_level=eq）
    expect(webAi.calls).toHaveLength(1)
    const webFilters = webAi.calls[0]?.request.filters as {
      filters: Array<{ key: string; type: string; value: unknown }>
      type: string
    }

    expect(webFilters).toMatchObject({
      filters: expect.arrayContaining([
        { key: 'status', type: 'eq', value: 'active' },
        { key: 'version_state', type: 'eq', value: 'current' },
      ]),
      type: 'and',
    })
    expect(webFilters.filters.some((filter) => filter.key === 'access_level')).toBe(false)

    // 契約 #3：Web 寫入 citation_records，包含 restricted documentVersionId + chunkText
    const webCitationInserts = webD1.calls.filter((call) =>
      call.query.includes('INSERT INTO citation_records')
    )

    expect(webCitationInserts).toHaveLength(1)
    expect(webCitationInserts[0]?.values).toEqual(
      expect.arrayContaining([scenario.documentVersionId, scenario.sourceChunkId])
    )

    // 契約 #4：Web query_logs 狀態 accepted
    const webQueryLog = webD1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

    expect(webQueryLog?.values).toEqual(
      expect.arrayContaining([
        'local',
        tc14Mocks.runtimeConfig?.governance.configSnapshotVersion,
        'accepted',
      ])
    )

    // --- MCP path (admin token 無 restricted scope) ---
    tc14Mocks.bindings = createTc14Bindings(
      tc14Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
      scenario
    )
    tc14Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
    tc14Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

    const mcpResult = (await runMcpCase(tc14Mocks.actor?.mcpToken.authorizationHeader ?? '')) as {
      data: {
        answer?: string
        citations: Array<{ citationId: string; sourceChunkId: string }>
        refused: boolean
      }
    }

    const mcpAi = (tc14Mocks.bindings ?? {}).AI as ReturnType<typeof createAiSearchBindingFake>
    const mcpD1 = (tc14Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

    // 契約 #5：MCP 拒答 + 不洩漏 restricted 文件存在
    expect(mcpResult.data.refused).toBe(true)
    expect(mcpResult.data.citations).toEqual([])
    expect(mcpResult.data.answer).toBeUndefined()

    // 契約 #6：MCP AI Search filter 明確帶 access_level='internal'
    expect(mcpAi.calls).toHaveLength(1)
    const mcpFilters = mcpAi.calls[0]?.request.filters as {
      filters: Array<{ key: string; type: string; value: unknown }>
      type: string
    }

    expect(mcpFilters.filters).toEqual(
      expect.arrayContaining([{ key: 'access_level', type: 'eq', value: 'internal' }])
    )

    // 契約 #7：MCP 不得寫任何 citation_records
    const mcpCitationInserts = mcpD1.calls.filter((call) =>
      call.query.includes('INSERT INTO citation_records')
    )

    expect(mcpCitationInserts).toHaveLength(0)

    // 契約 #8：MCP query_logs 仍寫入（accepted，查詢本身合法，只是無 evidence），
    // 同一 configSnapshotVersion
    const mcpQueryLog = mcpD1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

    expect(mcpQueryLog?.values).toEqual(
      expect.arrayContaining([
        'local',
        tc14Mocks.runtimeConfig?.governance.configSnapshotVersion,
        'accepted',
      ])
    )

    // 契約 #9：restricted 文件的 chunk 原文、標題都不得出現在 MCP 回應序列化結果
    const mcpSerialized = JSON.stringify(mcpResult.data)

    expect(mcpSerialized).not.toContain(scenario.chunkText)
    expect(mcpSerialized).not.toContain(scenario.documentTitle)

    // 額外：MCP 路徑有經過 token 驗證
    expect(mcpD1.calls.some((call) => call.query.includes('FROM mcp_tokens'))).toBe(true)
  })
})

async function runWebCase() {
  const { default: handler } = await import('../../server/api/chat.post')

  return await handler(createRouteEvent())
}

async function runMcpCase(authorizationHeader: string) {
  const { default: handler } = await import('../../server/api/mcp/ask.post')

  return await handler(
    createRouteEvent({
      headers: {
        authorization: authorizationHeader,
      },
    })
  )
}

function getTc14Scenario(): Tc14Scenario {
  return {
    answerFragments: ['董事會', '核准'],
    categorySlug: 'policy',
    chunkText: 'TC-14 restricted：M&A 相關採購案須經董事會核准，且不可對外揭露交易細節。',
    citationLocator: 'lines 10-12',
    documentId: 'doc-tc14-restricted',
    documentTitle: 'TC-14 M&A 採購備忘錄 current',
    documentVersionId: 'ver-tc14-restricted-current',
    score: 0.9,
    sourceChunkId: 'chunk-tc14-restricted',
    title: 'TC-14 M&A 採購備忘錄 current',
  }
}

function createTc14Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  scenario: Tc14Scenario
) {
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
      {
        // resolveCurrentEvidence：只在 allowedAccessLevels 包含 restricted 時才回傳此 restricted chunk
        match: /FROM source_chunks s\s+INNER JOIN document_versions v/,
        resolve: ({ values }) => {
          const allowedAccessLevels = values.slice(2) as string[]

          if (!allowedAccessLevels.includes('restricted')) {
            return { first: null }
          }

          return {
            first: {
              access_level: 'restricted',
              category_slug: scenario.categorySlug,
              chunk_text: scenario.chunkText,
              citation_locator: scenario.citationLocator,
              document_id: scenario.documentId,
              document_title: scenario.documentTitle,
              document_version_id: scenario.documentVersionId,
              source_chunk_id: scenario.sourceChunkId,
            },
          }
        },
      },
    ],
  })
  const kv = createKvBindingFake()
  // AI Search 只回傳 restricted-only 文件：
  // - Web (filters 無 access_level) → 候選包含此 restricted 文件
  // - MCP (filters access_level='internal') → 候選被過濾空
  // Fake 實作忽略 filters（只依 index name 回傳），由 filter 斷言 + D1.resolveCurrentEvidence 雙重把關。
  const ai = createFilteredAiSearch({
    restrictedEntry: {
      attributes: {
        file: {
          access_level: 'restricted',
          citation_locator: scenario.citationLocator,
          document_version_id: scenario.documentVersionId,
          title: scenario.title,
        },
      },
      content: [
        {
          text: scenario.chunkText,
          type: 'text',
        },
      ],
      filename: 'tc-14-restricted.md',
      score: scenario.score,
    },
  })

  return createCloudflareBindingsFixture({
    ai,
    d1,
    kv,
  })
}

// 模擬 Cloudflare AI Search：根據 filters 內是否含 access_level=eq 來決定是否回傳 restricted candidate。
// 這讓 MCP path（filter access_level='internal'）真的拿不到 restricted candidate，
// 而 Web path（filter 無 access_level）可以拿到。兩邊共用同一份 index 模擬現實部署。
function createFilteredAiSearch(input: {
  restrictedEntry: {
    attributes: { file: Record<string, unknown> }
    content: Array<{ text: string; type: string }>
    filename: string
    score: number
  }
}) {
  const calls: Array<{ indexName: string; request: Record<string, unknown> }> = []

  return {
    autorag(indexName: string) {
      return {
        async search(request: Record<string, unknown>) {
          calls.push({ indexName, request })

          const filters = request.filters as
            | {
                filters?: Array<{ key?: string; type?: string; value?: unknown }>
                type?: string
              }
            | undefined
          const accessLevelFilter = filters?.filters?.find((entry) => entry?.key === 'access_level')

          if (
            accessLevelFilter &&
            accessLevelFilter.type === 'eq' &&
            accessLevelFilter.value !== 'restricted'
          ) {
            return { data: [] }
          }

          return { data: [input.restrictedEntry] }
        },
      }
    },
    calls,
  }
}
