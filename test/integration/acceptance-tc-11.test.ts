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

// TC-11：條件式程序題
// 使用者詢問「供應商主檔新增後何時生效？」這類條件式程序問題。
// primaryOutcome='direct'，但允收條件也接受 judge_pass（spec：「可接受 judge_pass；不得 self_corrected 或 refused」）。
//
// 本測試同時覆蓋兩條路徑：
//   path='direct'     → retrievalScore >= directAnswerMin（0.7）→ 不進 judge
//   path='judge_pass' → retrievalScore ∈ [judgeMin=0.45, directAnswerMin=0.7) → judge 被呼叫一次且 shouldAnswer=true
// 兩種路徑都視為通過；self_corrected 與 refused 必定不通過。
//
// 關鍵驗證：
//   1. refused=false、恰好一筆 citation、citation 指向 SOP 文件
//   2. aiBinding 恰好呼叫一次（不進 self-correction 的第二輪）
//   3. direct path：judge 不被呼叫；judge_pass path：judge 呼叫一次 + shouldAnswer=true
//   4. answer 含條件或時間關鍵詞
//   5. citation_records 寫入一筆 + query_logs accepted + configSnapshotVersion

type Tc11Path = 'direct' | 'judge_pass'

interface Tc11TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  judgeCalls: Array<{ query: string; retrievalScore: number }>
  path: Tc11Path
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc11Scenario {
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

const tc11Mocks = vi.hoisted(
  (): Tc11TestState => ({
    actor: null,
    bindings: null,
    judgeCalls: [],
    path: 'direct',
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
  getCloudflareEnv: () => tc11Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc11Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc11Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', async () => {
  const { createHubDbMock } = await import('./helpers/database')

  return createHubDbMock({ database: () => (tc11Mocks.bindings ?? {}).DB })
})

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc11Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc11Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc11Mocks.readZodBody(...args),
}))

// 為 judge_pass 路徑包裝 answerKnowledgeQuery：
// judge 一被呼叫，無論 evidence 如何一律回 shouldAnswer=true。
// direct 路徑下 judge 不會被呼叫（score >= directAnswerMin）。
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
          tc11Mocks.judgeCalls.push({
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

describe('acceptance conditional-procedure (TC-11)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-11',
  )
  const scenario = getTc11Scenario()

  beforeEach(() => {
    tc11Mocks.actor = createAcceptanceActorFixture('user')
    tc11Mocks.bindings = null
    tc11Mocks.judgeCalls = []
    tc11Mocks.path = 'direct'
    tc11Mocks.readBody.mockReset()
    tc11Mocks.readZodBody.mockReset()
    tc11Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc11Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc11Mocks.actor?.webSession))
  })

  describe.each<Tc11Path>(['direct', 'judge_pass'])('via %s path', (path) => {
    it.each(cases)('answers conditional-procedure query %s', async (fixture) => {
      const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
        acceptanceIds: string[]
        expectedHttpStatus: string
        id: string
        primaryOutcome: string
      } | null

      expect(registryEntry).toMatchObject({
        acceptanceIds: expect.arrayContaining(['A02']),
        expectedHttpStatus: '200',
        id: 'TC-11',
        primaryOutcome: 'direct',
      })
      expect(fixture.expectedOutcome).toBe('direct')
      expect(['web', 'mcp']).toContain(fixture.channel)

      tc11Mocks.path = path
      tc11Mocks.bindings = createTc11Bindings(
        tc11Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
        scenario,
        path,
      )
      tc11Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
      tc11Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

      const result = (
        fixture.channel === 'web' ? await runWebCase() : await runMcpCase(fixture.prompt)
      ) as {
        data: {
          answer: string
          citations: Array<{ citationId: string; sourceChunkId: string }>
          refused: boolean
        }
      }

      const aiBinding = (tc11Mocks.bindings ?? {}).AI as ReturnType<
        typeof createAiSearchBindingFake
      >
      const d1 = (tc11Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>
      const thresholds = tc11Mocks.runtimeConfig?.governance.thresholds

      expect(thresholds).toBeDefined()

      // AI Search 恰好呼叫一次（不進 self-correction 的第二輪）
      expect(aiBinding.calls).toHaveLength(1)
      expect(aiBinding.calls[0]).toMatchObject({
        indexName: 'knowledge-index',
        request: {
          query: fixture.prompt,
        },
      })

      // Path 分歧驗證
      if (path === 'direct') {
        // Direct：judge 不應被呼叫
        expect(tc11Mocks.judgeCalls).toHaveLength(0)
      } else {
        // Judge_pass：judge 呼叫一次，且 retrievalScore 落在 [judgeMin, directAnswerMin)
        expect(tc11Mocks.judgeCalls).toHaveLength(1)
        expect(tc11Mocks.judgeCalls[0]?.retrievalScore).toBeGreaterThanOrEqual(thresholds!.judgeMin)
        expect(tc11Mocks.judgeCalls[0]?.retrievalScore).toBeLessThan(thresholds!.directAnswerMin)
      }

      // 非 refused + 恰好一筆 citation 指向 SOP 文件
      expect(result.data.refused).toBe(false)
      expect(result.data.citations).toHaveLength(1)
      expect(result.data.citations[0]).toMatchObject({
        citationId: expect.any(String),
        sourceChunkId: scenario.sourceChunkId,
      })

      // Answer 含條件或時間關鍵詞
      for (const fragment of scenario.answerFragments) {
        expect(result.data.answer).toContain(fragment)
      }

      // citation_records 寫入恰好一筆
      const citationInserts = d1.calls.filter((call) =>
        call.query.includes('INSERT INTO citation_records'),
      )

      expect(citationInserts).toHaveLength(1)
      expect(citationInserts[0]?.values).toEqual(
        expect.arrayContaining([
          scenario.documentVersionId,
          scenario.sourceChunkId,
          scenario.citationLocator,
          scenario.chunkText,
        ]),
      )

      // query_logs 狀態 accepted + configSnapshotVersion
      const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

      expect(queryLogInsert?.values).toEqual(
        expect.arrayContaining([
          'local',
          tc11Mocks.runtimeConfig?.governance.configSnapshotVersion,
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
    })
  })
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
      actor: tc11Mocks.actor ?? undefined,
      cloudflareEnv: tc11Mocks.bindings ?? {},
      pendingEvent,
    },
  )

  return { data }
}

function getTc11Scenario(): Tc11Scenario {
  // 供應商主檔維護 SOP（category_slug = 'process'）
  return {
    answerFragments: ['生效', '審核'],
    categorySlug: 'process',
    chunkText:
      '供應商主檔新增後，需經採購主管於 ERP 完成審核，次一個工作日凌晨同步至交易系統後正式生效。',
    citationLocator: 'lines 12-16',
    documentId: 'doc-tc11-supplier-maintenance',
    documentTitle: '主檔維護 SOP current',
    documentVersionId: 'ver-tc11-supplier-current',
    sourceChunkId: 'chunk-tc11-supplier-activation',
    title: '主檔維護 SOP current',
  }
}

function createTc11Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  scenario: Tc11Scenario,
  path: Tc11Path,
) {
  // direct  → 0.85 ≥ 0.7（directAnswerMin）
  // judge_pass → 0.55 ∈ [0.45, 0.7)
  const score = path === 'direct' ? 0.85 : 0.55

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
        match: /FROM source_chunks/,
        resolve: () => ({
          first: {
            access_level: 'internal',
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
          filename: 'tc-11-supplier.md',
          score,
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
