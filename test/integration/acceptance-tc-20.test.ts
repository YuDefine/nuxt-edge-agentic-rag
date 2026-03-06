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

// TC-20 MCP no-internal-diagnostics 契約
// MCP 對外回應不得暴露內部診斷欄位：retrievalScore、decisionPath、
// documentVersionId、firstTokenLatencyMs、completionLatencyMs、confidenceScore 等。
// 本測試同時驗證 searchKnowledge 與 listCategories 兩個讀取端點的 response envelope。

const INTERNAL_DIAGNOSTIC_KEYS = [
  'retrievalScore',
  'decisionPath',
  'documentVersionId',
  'firstTokenLatencyMs',
  'completionLatencyMs',
  'confidenceScore',
  'debugInfo',
  '_meta',
] as const

// searchKnowledge.results[] 允許欄位白名單（與 server/utils/mcp-search.ts 的 McpSearchResult 對齊）
const ALLOWED_SEARCH_RESULT_KEYS = new Set([
  'accessLevel',
  'categorySlug',
  'citationLocator',
  'excerpt',
  'title',
])

interface Tc20TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

const tc20Mocks = vi.hoisted(
  (): Tc20TestState => ({
    actor: null,
    bindings: null,
    readBody: vi.fn(),
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
  getCloudflareEnv: () => tc20Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc20Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc20Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc20Mocks.bindings ?? {}).DB,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc20Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc20Mocks.actor?.isAdmin ?? false,
  }
})

installNuxtRouteTestGlobals()

describe('acceptance MCP no-internal-diagnostics contract (TC-20)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-20'
  )

  beforeEach(() => {
    tc20Mocks.actor = createAcceptanceActorFixture('user')
    tc20Mocks.bindings = null
    tc20Mocks.readBody.mockReset()
    tc20Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc20Mocks.readBody)
    vi.stubGlobal('getValidatedQuery', vi.fn().mockResolvedValue({ includeCounts: true }))
  })

  it.each(cases)('does not expose internal diagnostics for %s', async (fixture) => {
    const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
      acceptanceIds: string[]
      channels: string[]
      expectedHttpStatus: string
      id: string
      primaryOutcome: string
    } | null

    expect(registryEntry).toMatchObject({
      acceptanceIds: expect.arrayContaining(['A12']),
      channels: ['mcp'],
      expectedHttpStatus: '200',
      id: 'TC-20',
    })
    expect(fixture.channel).toBe('mcp')

    tc20Mocks.bindings = createTc20Bindings(
      tc20Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>
    )
    tc20Mocks.readBody.mockResolvedValue({ query: fixture.prompt })

    // --- searchKnowledge tool ---
    const { default: searchTool } = await import('#server/mcp/tools/search')
    const searchResult = (await runMcpTool(
      searchTool,
      { query: fixture.prompt },
      {
        authorizationHeader: tc20Mocks.actor?.mcpToken.authorizationHeader ?? '',
        cloudflareEnv: tc20Mocks.bindings ?? {},
        pendingEvent,
      }
    )) as { results: Array<Record<string, unknown>> }

    assertNoInternalDiagnostics('search envelope', searchResult)

    for (const [index, row] of searchResult.results.entries()) {
      assertNoInternalDiagnostics(`search result[${index}]`, row)

      for (const key of Object.keys(row)) {
        expect(
          ALLOWED_SEARCH_RESULT_KEYS,
          `search result[${index}] exposes unknown key "${key}"`
        ).toContain(key)
      }
    }

    // --- listCategories tool ---
    const { default: categoriesTool } = await import('#server/mcp/tools/categories')
    const categoriesResult = (await runMcpTool(
      categoriesTool,
      { includeCounts: true },
      {
        authorizationHeader: tc20Mocks.actor?.mcpToken.authorizationHeader ?? '',
        cloudflareEnv: tc20Mocks.bindings ?? {},
        pendingEvent,
      }
    )) as { categories: Array<Record<string, unknown>> }

    assertNoInternalDiagnostics('categories envelope', categoriesResult)

    for (const [index, entry] of categoriesResult.categories.entries()) {
      assertNoInternalDiagnostics(`categories[${index}]`, entry)

      // 欄位限定為 { name, count }（MCP 契約不得暴露 documentVersionId、slug 以外的內部 id）
      for (const key of Object.keys(entry)) {
        expect(['name', 'count']).toContain(key)
      }
    }
  })
})

function assertNoInternalDiagnostics(label: string, payload: Record<string, unknown>) {
  for (const leakingKey of INTERNAL_DIAGNOSTIC_KEYS) {
    expect(
      Object.keys(payload),
      `${label} must not expose internal diagnostic "${leakingKey}"`
    ).not.toContain(leakingKey)
  }
}

function createTc20Bindings(actor: ReturnType<typeof createAcceptanceActorFixture>) {
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
        match: /FROM documents d\s+INNER JOIN document_versions/,
        resolve: () => ({
          all: [
            { category_slug: 'inventory', document_count: 3 },
            { category_slug: 'procurement', document_count: 5 },
          ],
        }),
      },
    ],
  })
  const kv = createKvBindingFake()
  const ai = createAiSearchBindingFake({
    responses: {
      'knowledge-index': [
        {
          attributes: {
            file: {
              access_level: 'internal',
              citation_locator: 'lines 1-3',
              document_version_id: 'ver-tc20-sample',
              title: 'TC-20 庫存管理要點',
            },
          },
          content: [
            {
              text: '庫存管理著重於先進先出與安全存量控管。',
              type: 'text',
            },
          ],
          filename: 'tc-20.md',
          score: 0.88,
        },
      ],
    },
  })

  return createCloudflareBindingsFixture({
    ai,
    d1,
    kv,
  })
}
