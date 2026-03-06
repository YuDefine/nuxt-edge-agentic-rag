import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { loadAcceptanceFixtureDataset } from '../acceptance/fixtures/loader'
import { createAcceptanceActorFixture } from '../acceptance/helpers/auth'
import {
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

// TC-17：restricted existence-hiding 契約
//
// 知識庫內存在一份 restricted 文件；呼叫方的 MCP token 不含
// knowledge.restricted.read。系統必須「假裝該文件不存在」：
//
//   askKnowledge：
//     - HTTP 200（不是 404 / 403）
//     - refused=true、citations=[]、answer 不存在於回應
//     - 回應序列化結果不得包含 restricted chunkText / documentTitle
//
//   searchKnowledge：
//     - HTTP 200、results=[]
//     - envelope 不得暗示命中（無 answer / citations / refused / decisionPath）
//     - 回應序列化結果不得包含 restricted chunkText / documentTitle
//
// 底層機制：deriveAllowedAccessLevels('mcp', tokenScopes) 缺 restricted → ['internal']，
// AI Search filter 以 access_level='internal' 過濾，restricted-only 文件不進入 candidate。

const EXISTENCE_LEAK_PHRASES = [
  '無權',
  '無存取',
  '權限不足',
  '無權存取',
  '找到但隱藏',
  'restricted documents exist',
  'found but hidden',
  'hidden due to scope',
]

interface Tc17TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc17Scenario {
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

const tc17Mocks = vi.hoisted(
  (): Tc17TestState => ({
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
  getCloudflareEnv: () => tc17Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc17Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc17Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc17Mocks.bindings ?? {}).DB,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc17Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc17Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc17Mocks.readZodBody(...args),
}))

installNuxtRouteTestGlobals()

describe('acceptance restricted existence-hiding (TC-17)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-17'
  )
  const scenario = getTc17Scenario()

  beforeEach(() => {
    // user preset：mcp scopes 含 knowledge.search + knowledge.ask 但不含 knowledge.restricted.read
    tc17Mocks.actor = createAcceptanceActorFixture('user')
    tc17Mocks.bindings = null
    tc17Mocks.readBody.mockReset()
    tc17Mocks.readZodBody.mockReset()
    tc17Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc17Mocks.readBody)
  })

  it.each(cases)('hides restricted doc existence for %s', async (fixture) => {
    const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
      acceptanceIds: string[]
      channels: string[]
      expectedHttpStatus: string
      id: string
      primaryOutcome: string
    } | null

    expect(registryEntry).toMatchObject({
      acceptanceIds: expect.arrayContaining(['A09']),
      channels: ['mcp'],
      expectedHttpStatus: '200',
      id: 'TC-17',
      primaryOutcome: 'refused_or_empty',
    })
    expect(fixture.channel).toBe('mcp')

    // 前置：token 不含 knowledge.restricted.read
    expect(tc17Mocks.actor?.mcpAuth.scopes).not.toContain('knowledge.restricted.read')
    expect(tc17Mocks.actor?.allowedAccessLevels.mcp).toEqual(['internal'])

    // --- askKnowledge ---
    tc17Mocks.bindings = createTc17Bindings(
      tc17Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
      scenario
    )
    tc17Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
    tc17Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

    const { default: askTool } = await import('#server/mcp/tools/ask')
    const askData = (await runMcpTool(
      askTool,
      { query: fixture.prompt },
      {
        authorizationHeader: tc17Mocks.actor?.mcpToken.authorizationHeader ?? '',
        cloudflareEnv: tc17Mocks.bindings ?? {},
        pendingEvent,
      }
    )) as {
      answer?: string
      citations: Array<{ citationId: string; sourceChunkId: string }>
      refused: boolean
    }
    const askResult = { data: askData }

    // 契約 #1：askKnowledge refused=true + citations=[] + 不帶 answer 欄位
    expect(askResult.data.refused).toBe(true)
    expect(askResult.data.citations).toEqual([])
    expect(askResult.data.answer).toBeUndefined()

    // 契約 #2：回應序列化結果不得洩漏 restricted chunk/title/locator
    const askSerialized = JSON.stringify(askResult.data)

    expect(askSerialized).not.toContain(scenario.chunkText)
    expect(askSerialized).not.toContain(scenario.documentTitle)
    expect(askSerialized).not.toContain(scenario.documentVersionId)
    expect(askSerialized).not.toContain(scenario.sourceChunkId)

    for (const leak of EXISTENCE_LEAK_PHRASES) {
      expect(askSerialized).not.toContain(leak)
    }

    // 契約 #3：askKnowledge 不得寫入 citation_records
    const askD1 = (tc17Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>
    const askCitationInserts = askD1.calls.filter((call) =>
      call.query.includes('INSERT INTO citation_records')
    )

    expect(askCitationInserts).toHaveLength(0)

    // 契約 #4：query_logs 仍寫入，status='accepted'（查詢本身沒有違規，只是 evidence=[]）
    const askQueryLog = askD1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

    expect(askQueryLog).toBeDefined()
    expect(askQueryLog?.values).toEqual(
      expect.arrayContaining([
        'local',
        tc17Mocks.runtimeConfig?.governance.configSnapshotVersion,
        'accepted',
      ])
    )

    // --- searchKnowledge ---
    tc17Mocks.bindings = createTc17Bindings(
      tc17Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
      scenario
    )
    tc17Mocks.readBody.mockResolvedValue({ query: fixture.prompt })

    const { default: searchTool } = await import('#server/mcp/tools/search')
    const searchData = (await runMcpTool(
      searchTool,
      { query: fixture.prompt },
      {
        authorizationHeader: tc17Mocks.actor?.mcpToken.authorizationHeader ?? '',
        cloudflareEnv: tc17Mocks.bindings ?? {},
        pendingEvent,
      }
    )) as { results: unknown[] } & Record<string, unknown>
    const searchResult = { data: searchData }

    // 契約 #5：searchKnowledge 回 200 + results=[]
    expect(searchResult.data.results).toEqual([])

    // 契約 #6：envelope 不得含 answer / citations / refused / decisionPath 等暗示命中的欄位
    const envelopeKeys = Object.keys(searchResult.data)

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

    // 契約 #7：searchKnowledge 回應序列化結果不得洩漏 restricted chunk/title/locator
    const searchSerialized = JSON.stringify(searchResult.data)

    expect(searchSerialized).not.toContain(scenario.chunkText)
    expect(searchSerialized).not.toContain(scenario.documentTitle)
    expect(searchSerialized).not.toContain(scenario.documentVersionId)

    for (const leak of EXISTENCE_LEAK_PHRASES) {
      expect(searchSerialized).not.toContain(leak)
    }
  })
})

function getTc17Scenario(): Tc17Scenario {
  return {
    categorySlug: 'policy',
    chunkText: 'TC-17 restricted：下一季併購計畫代號 Aurora，估值 3.2 億美金，僅限董事會成員知悉。',
    citationLocator: 'lines 30-34',
    documentId: 'doc-tc17-restricted-ma',
    documentTitle: 'TC-17 機密併購案 Aurora',
    documentVersionId: 'ver-tc17-restricted-current',
    score: 0.93,
    sourceChunkId: 'chunk-tc17-restricted',
    title: 'TC-17 機密併購案 Aurora',
  }
}

function createTc17Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  scenario: Tc17Scenario
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
        // resolveCurrentEvidence：若 allowedAccessLevels 不含 restricted，回 null
        // 注意：正常流程 AI Search 就已被過濾，這條是守門保險。
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
      filename: 'tc-17-restricted.md',
      score: scenario.score,
    },
  })

  return createCloudflareBindingsFixture({
    ai,
    d1,
    kv,
  })
}

// 模擬 Cloudflare AI Search：當 request.filters 明確帶 access_level='internal' 時，
// restricted-only 文件不會進入候選（正確的生產行為）；其他情況才回傳 restricted entry。
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
