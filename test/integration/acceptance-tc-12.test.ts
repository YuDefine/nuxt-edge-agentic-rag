import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '../../shared/schemas/knowledge-runtime'
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

// TC-12：MCP answer-to-replay 工具鏈
// 驗證 askKnowledge → getDocumentChunk 的 replay 一致性：
// 先以 MCP askKnowledge 取得 citationId/sourceChunkId，
// 再用同一個 citationId 呼叫 getDocumentChunk，確認回傳的 chunk_text
// 與 askKnowledge 時寫入 citation_records 的 chunk_text_snapshot 完全一致，
// 並確保底層 join 到同一個 document_version_id 上。

interface Tc12TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  capturedCitationId: string | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc12Scenario {
  accessLevel: string
  answerFragments: string[]
  categorySlug: string
  chunkText: string
  citationLocator: string
  documentId: string
  documentTitle: string
  documentVersionId: string
  sourceChunkId: string
  title: string
}

const tc12Mocks = vi.hoisted(
  (): Tc12TestState => ({
    actor: null,
    bindings: null,
    capturedCitationId: null,
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
  getCloudflareEnv: () => tc12Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc12Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc12Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc12Mocks.bindings ?? {}).DB,
  getDrizzleDb: async () => ({ db: (tc12Mocks.bindings ?? {}).DB }),
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc12Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc12Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc12Mocks.readZodBody(...args),
}))

installNuxtRouteTestGlobals()

describe('acceptance MCP interoperability replay chain', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-12'
  )
  const scenario = getTc12Scenario()

  beforeEach(() => {
    tc12Mocks.actor = createAcceptanceActorFixture('user')
    tc12Mocks.bindings = null
    tc12Mocks.capturedCitationId = null
    tc12Mocks.readBody.mockReset()
    tc12Mocks.readZodBody.mockReset()
    tc12Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc12Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc12Mocks.actor?.webSession))
  })

  it.each(cases)(
    'replays %s through askKnowledge → getDocumentChunk with identical chunk text',
    async (fixture) => {
      const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
        acceptanceIds: string[]
        channels: string[]
        expectedHttpStatus: string
        id: string
        primaryOutcome: string
      } | null

      expect(registryEntry).toMatchObject({
        acceptanceIds: expect.arrayContaining(['A03', 'A07']),
        channels: ['mcp'],
        id: 'TC-12',
        primaryOutcome: 'direct',
      })
      expect(fixture.channel).toBe('mcp')

      tc12Mocks.bindings = createTc12Bindings(
        tc12Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
        scenario
      )
      tc12Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
      tc12Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

      // Step 1：askKnowledge 取得 answer + citations
      const askResult = (await runAskKnowledge(
        tc12Mocks.actor?.mcpToken.authorizationHeader ?? ''
      )) as {
        data: {
          answer: string
          citations: Array<{ citationId: string; sourceChunkId: string }>
          refused: boolean
        }
      }

      const aiBinding = (tc12Mocks.bindings ?? {}).AI as ReturnType<
        typeof createAiSearchBindingFake
      >
      const d1 = (tc12Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

      expect(aiBinding.calls).toHaveLength(1)
      expect(aiBinding.calls[0]).toMatchObject({
        indexName: 'knowledge-index',
        request: {
          query: fixture.prompt,
        },
      })

      expect(askResult).toEqual({
        data: {
          answer: expect.any(String),
          citations: [
            {
              citationId: expect.any(String),
              sourceChunkId: scenario.sourceChunkId,
            },
          ],
          refused: false,
        },
      })
      for (const fragment of scenario.answerFragments) {
        expect(askResult.data.answer).toContain(fragment)
      }

      // askKnowledge 階段必備的 D1 寫入：query_logs 含 configSnapshotVersion、citation_records 含 source_chunk_id 與 document_version_id
      const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))
      const citationInsert = d1.calls.find((call) =>
        call.query.includes('INSERT INTO citation_records')
      )

      expect(queryLogInsert?.values).toEqual(
        expect.arrayContaining([
          'local',
          tc12Mocks.runtimeConfig?.governance.configSnapshotVersion,
          'accepted',
        ])
      )
      expect(citationInsert?.values).toEqual(
        expect.arrayContaining([
          scenario.documentVersionId,
          scenario.sourceChunkId,
          scenario.citationLocator,
          scenario.chunkText,
        ])
      )

      // MCP token 驗證與 last_used 更新應同時觸發
      expect(d1.calls.some((call) => call.query.includes('FROM mcp_tokens'))).toBe(true)
      expect(d1.calls.some((call) => call.query.includes('UPDATE mcp_tokens'))).toBe(true)

      const citationId = askResult.data.citations[0]?.citationId

      expect(citationId).toBeTruthy()
      tc12Mocks.capturedCitationId = citationId ?? null

      // Step 2：用同一個 citationId 打 getDocumentChunk
      const replayResult = (await runGetDocumentChunk(
        tc12Mocks.actor?.mcpToken.authorizationHeader ?? '',
        citationId ?? ''
      )) as {
        data: {
          chunkText: string
          citationId: string
          citationLocator: string
        }
      }

      // Step 3：驗證 chunk_text 與 citation_records 寫入時一致，citationId 相同，
      // 且底層 replay SELECT 會 join source_chunks（等同於 document_version_id 鏈結驗證）。
      expect(replayResult).toEqual({
        data: {
          chunkText: scenario.chunkText,
          citationId,
          citationLocator: scenario.citationLocator,
        },
      })

      const replaySelect = d1.calls.find(
        (call) =>
          call.query.includes('FROM citation_records') &&
          call.query.includes('INNER JOIN source_chunks')
      )

      expect(
        replaySelect,
        'replay select should join citation_records and source_chunks'
      ).toBeTruthy()
      expect(replaySelect?.values[0]).toBe(citationId)

      // askKnowledge 寫入的 citation chunk_text_snapshot 與 getDocumentChunk 回傳的 chunk_text 必須一致
      expect(replayResult.data.chunkText).toBe(citationInsert?.values[5])

      // 驗證 mcp_tokens 在兩次 MCP 呼叫中都被讀取並更新（stateless 鏈每一次都要 touch）
      const mcpTokenSelects = d1.calls.filter((call) => call.query.includes('FROM mcp_tokens'))
      const mcpTokenUpdates = d1.calls.filter((call) => call.query.includes('UPDATE mcp_tokens'))

      expect(mcpTokenSelects.length).toBeGreaterThanOrEqual(2)
      expect(mcpTokenUpdates.length).toBeGreaterThanOrEqual(2)
    }
  )
})

async function runAskKnowledge(authorizationHeader: string) {
  const { default: handler } = await import('../../server/api/mcp/ask.post')

  return await handler(
    createRouteEvent({
      headers: {
        authorization: authorizationHeader,
      },
    })
  )
}

async function runGetDocumentChunk(authorizationHeader: string, citationId: string) {
  const { default: handler } = await import('../../server/api/mcp/chunks/[citationId].get')

  return await handler(
    createRouteEvent({
      context: {
        cloudflare: { env: {} },
        params: { citationId },
      },
      headers: {
        authorization: authorizationHeader,
      },
    })
  )
}

function getTc12Scenario(): Tc12Scenario {
  return {
    accessLevel: 'internal',
    answerFragments: ['PO', 'PR'],
    categorySlug: 'procurement',
    chunkText: 'PR 是請購需求，PO 是核准後建立的採購訂單，兩者於流程中職責不同。',
    citationLocator: 'lines 3-5',
    documentId: 'doc-procurement-tc12',
    documentTitle: 'TC-12 採購流程 current',
    documentVersionId: 'ver-procurement-current-tc12',
    sourceChunkId: 'chunk-procurement-tc12',
    title: 'TC-12 採購流程 current',
  }
}

function createTc12Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  scenario: Tc12Scenario
) {
  // 用一個共用的 citation 紀錄狀態模擬 D1：askKnowledge 寫入後，replay 能用同一個 citationId 取回。
  const persistedCitations = new Map<
    string,
    {
      accessLevel: string
      chunkTextSnapshot: string
      citationLocator: string
      documentVersionId: string
      sourceChunkId: string
    }
  >()

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
        match: /FROM source_chunks s\s+INNER JOIN document_versions/,
        resolve: () => ({
          first: {
            access_level: scenario.accessLevel,
            category_slug: scenario.categorySlug,
            chunk_text: scenario.chunkText,
            citation_locator: scenario.citationLocator,
            document_id: scenario.documentId,
            document_title: scenario.documentTitle,
            document_version_id: scenario.documentVersionId,
            source_chunk_id: scenario.sourceChunkId,
          },
        }),
      },
      {
        match: /INSERT INTO citation_records/,
        resolve: ({ values }) => {
          const [
            citationId,
            ,
            documentVersionId,
            sourceChunkId,
            citationLocator,
            chunkTextSnapshot,
          ] = values as [string, string, string, string, string, string]

          persistedCitations.set(citationId, {
            accessLevel: scenario.accessLevel,
            chunkTextSnapshot,
            citationLocator,
            documentVersionId,
            sourceChunkId,
          })

          return {
            run: { success: true },
          }
        },
      },
      {
        match: /FROM citation_records\s+cr\s+INNER JOIN source_chunks/,
        resolve: ({ values }) => {
          const citationId = values[0] as string
          const entry = persistedCitations.get(citationId)

          if (!entry) {
            return { first: null }
          }

          return {
            first: {
              access_level: entry.accessLevel,
              chunk_text_snapshot: entry.chunkTextSnapshot,
              citation_id: citationId,
              citation_locator: entry.citationLocator,
            },
          }
        },
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
  const ai = createAiSearchBindingFake({
    responses: {
      'knowledge-index': [
        {
          attributes: {
            file: {
              access_level: scenario.accessLevel,
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
          filename: 'tc-12.md',
          score: 0.92,
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
