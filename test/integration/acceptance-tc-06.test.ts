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

// TC-06：跨文件比較題
// 驗證：
//   1. 兩份不同 current 文件（退貨流程 / 採購流程）皆被引用（distinct documentVersionId >= 2）
//   2. answer 包含兩份文件各自的關鍵詞（至少一個 distinguishing fragment）
//   3. 第一輪 retrievalScore 落在 judge window（>= judgeMin 且 < directAnswerMin），
//      因此會進入 judge；judge 回 shouldAnswer=true → 走 judge_pass 路徑
//   4. selectAnswerModelRole 因 distinctDocuments.size > 1，走 agentJudge 模型角色
//   5. citation_records 寫入兩筆，每筆對應各自 documentVersionId / sourceChunkId

interface Tc06TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  judgeCalls: Array<{ query: string; retrievalScore: number }>
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc06DocumentFacet {
  chunkText: string
  citationLocator: string
  documentId: string
  documentTitle: string
  documentVersionId: string
  keyword: string
  score: number
  sourceChunkId: string
}

interface Tc06Scenario {
  categorySlug: string
  purchasing: Tc06DocumentFacet
  returning: Tc06DocumentFacet
}

const tc06Mocks = vi.hoisted(
  (): Tc06TestState => ({
    actor: null,
    bindings: null,
    judgeCalls: [],
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
  getCloudflareEnv: () => tc06Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc06Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc06Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc06Mocks.bindings ?? {}).DB,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc06Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc06Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc06Mocks.readZodBody(...args),
}))

// 為了穩定觸發 judge_pass 路徑，將 knowledge-answering 的 judge 替換成「看到有 evidence 就通過」，
// 避免 fallback judge 需要到達 answerMin 才能通過。
vi.mock('../../server/utils/knowledge-answering', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-answering')>()
  const { answerKnowledgeQuery: realAnswer } = actual

  return {
    ...actual,
    async answerKnowledgeQuery(
      input: Parameters<typeof realAnswer>[0],
      options: Parameters<typeof realAnswer>[1],
    ) {
      return realAnswer(input, {
        ...options,
        async judge(judgeInput) {
          tc06Mocks.judgeCalls.push({
            query: judgeInput.query,
            retrievalScore: judgeInput.retrievalScore,
          })

          return {
            shouldAnswer: judgeInput.evidence.length > 0,
          }
        },
      })
    },
  }
})

installNuxtRouteTestGlobals()

describe('acceptance cross-document comparison (TC-06)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-06',
  )
  const scenario = getTc06Scenario()

  beforeEach(() => {
    tc06Mocks.actor = createAcceptanceActorFixture('user')
    tc06Mocks.bindings = null
    tc06Mocks.judgeCalls = []
    tc06Mocks.readBody.mockReset()
    tc06Mocks.readZodBody.mockReset()
    tc06Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc06Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc06Mocks.actor?.webSession))
  })

  it.each(cases)(
    'answers %s by citing at least two distinct documents via judge path',
    async (fixture) => {
      const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
        acceptanceIds: string[]
        expectedHttpStatus: string
        id: string
        primaryOutcome: string
      } | null

      expect(registryEntry).toMatchObject({
        acceptanceIds: expect.arrayContaining(['A02']),
        expectedHttpStatus: '200',
        id: 'TC-06',
        primaryOutcome: 'judge_pass',
      })
      expect(fixture.expectedOutcome).toBe('judge_pass')

      tc06Mocks.bindings = createTc06Bindings(
        tc06Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
        scenario,
      )
      tc06Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
      tc06Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

      const result = (
        fixture.channel === 'web'
          ? await runWebCase()
          : await runMcpCase(tc06Mocks.actor?.mcpToken.authorizationHeader ?? '', fixture.prompt)
      ) as {
        data: {
          answer: string
          citations: Array<{ citationId: string; sourceChunkId: string }>
          refused: boolean
        }
      }

      const aiBinding = (tc06Mocks.bindings ?? {}).AI as ReturnType<
        typeof createAiSearchBindingFake
      >
      const d1 = (tc06Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

      // AI Search 呼叫一次（judge_pass，不進入 self-correction）
      expect(aiBinding.calls).toHaveLength(1)

      // judge_pass 路徑驗證：judge 被呼叫一次，且 score 位於 [judgeMin, directAnswerMin)
      const thresholds = tc06Mocks.runtimeConfig?.governance.thresholds
      expect(thresholds).toBeDefined()
      expect(tc06Mocks.judgeCalls).toHaveLength(1)
      expect(tc06Mocks.judgeCalls[0]?.retrievalScore).toBeGreaterThanOrEqual(thresholds!.judgeMin)
      expect(tc06Mocks.judgeCalls[0]?.retrievalScore).toBeLessThan(thresholds!.directAnswerMin)

      // 非 refused + 至少兩筆 citation 對應不同 sourceChunk
      expect(result.data.refused).toBe(false)
      expect(result.data.citations.length).toBeGreaterThanOrEqual(2)
      const citedChunkIds = result.data.citations.map((item) => item.sourceChunkId)

      expect(citedChunkIds).toEqual(
        expect.arrayContaining([
          scenario.purchasing.sourceChunkId,
          scenario.returning.sourceChunkId,
        ]),
      )

      // Answer 同時涵蓋兩份文件的關鍵詞
      expect(result.data.answer).toContain(scenario.purchasing.keyword)
      expect(result.data.answer).toContain(scenario.returning.keyword)

      // citation_records 寫入兩筆，且 documentVersionId 為兩份不同文件
      const citationInserts = d1.calls.filter((call) =>
        call.query.includes('INSERT INTO citation_records'),
      )

      expect(citationInserts).toHaveLength(2)

      const insertedVersionIds = new Set<string>()

      for (const call of citationInserts) {
        for (const value of call.values) {
          if (
            typeof value === 'string' &&
            (value === scenario.purchasing.documentVersionId ||
              value === scenario.returning.documentVersionId)
          ) {
            insertedVersionIds.add(value)
          }
        }
      }

      expect(insertedVersionIds.size).toBe(2)
      expect(insertedVersionIds).toContain(scenario.purchasing.documentVersionId)
      expect(insertedVersionIds).toContain(scenario.returning.documentVersionId)

      // query_logs 仍須寫入 accepted 與 configSnapshotVersion
      const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

      expect(queryLogInsert?.values).toEqual(
        expect.arrayContaining([
          'local',
          tc06Mocks.runtimeConfig?.governance.configSnapshotVersion,
          'accepted',
        ]),
      )
    },
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
      cloudflareEnv: tc06Mocks.bindings ?? {},
      pendingEvent,
    },
  )

  return { data }
}

function getTc06Scenario(): Tc06Scenario {
  // 兩份不同 current 文件，同屬 policy 分類，但 documentVersionId 與 documentId 不同
  // 分數皆落在 [judgeMin=0.45, directAnswerMin=0.7) 區間，強制走 judge 路徑
  return {
    categorySlug: 'process',
    purchasing: {
      chunkText: '採購流程：需部門主管審核請購單、ERP 建立 PO 並由供應商回簽。',
      citationLocator: 'lines 10-14',
      documentId: 'doc-tc06-purchasing',
      documentTitle: 'TC-06 採購流程 current',
      documentVersionId: 'ver-tc06-purchasing-current',
      keyword: '採購流程',
      score: 0.6,
      sourceChunkId: 'chunk-tc06-purchasing',
    },
    returning: {
      chunkText: '退貨流程：客服建立 RMA 單、倉儲收貨後驗退，財務再開立退款。',
      citationLocator: 'lines 4-8',
      documentId: 'doc-tc06-returning',
      documentTitle: 'TC-06 退貨流程 current',
      documentVersionId: 'ver-tc06-returning-current',
      keyword: '退貨流程',
      score: 0.55,
      sourceChunkId: 'chunk-tc06-returning',
    },
  }
}

function createTc06Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  scenario: Tc06Scenario,
) {
  const facets: Tc06DocumentFacet[] = [scenario.purchasing, scenario.returning]

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
        match: /FROM source_chunks s\s+INNER JOIN document_versions v/,
        resolve: ({ values }) => {
          const [documentVersionId, citationLocator] = values as [string, string, ...unknown[]]
          const match = facets.find(
            (facet) =>
              facet.documentVersionId === documentVersionId &&
              facet.citationLocator === citationLocator,
          )

          if (!match) {
            return { first: null }
          }

          return {
            first: {
              access_level: 'internal',
              category_slug: scenario.categorySlug,
              chunk_text: match.chunkText,
              citation_locator: match.citationLocator,
              document_id: match.documentId,
              document_title: match.documentTitle,
              document_version_id: match.documentVersionId,
              source_chunk_id: match.sourceChunkId,
            },
          }
        },
      },
    ],
  })
  const kv = createKvBindingFake()
  const ai = createAiSearchBindingFake({
    responses: {
      'knowledge-index': facets.map((facet) => ({
        attributes: {
          file: {
            access_level: 'internal',
            citation_locator: facet.citationLocator,
            document_version_id: facet.documentVersionId,
            title: facet.documentTitle,
          },
        },
        content: [
          {
            text: facet.chunkText,
            type: 'text',
          },
        ],
        filename: `${facet.sourceChunkId}.md`,
        score: facet.score,
      })),
    },
  })

  return createCloudflareBindingsFixture({
    ai,
    d1,
    kv,
  })
}
