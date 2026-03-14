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

// TC-05：Web 多輪追問語境延續（v1.0.0 範圍內的可驗證切片）
//
// Spec gap：v1.0.0 的 /api/chat 尚未實作 conversationId / history payload，
// 因此「LLM 將前輪 turn 帶入 context」無法端到端自動化驗證。
// 本檔改為驗證在同一使用者（等同同一 conversation 作用域）連續發問時，
// 系統仍能維持：
//   1. 每一輪都走 current-only retrieval（不會卡住舊版 evidence）
//   2. 兩輪共用同一 rate-limit key，計數從 1 遞增到 2（代表 conversation 作用域存在於 KV）
//   3. stale 保護：若第二輪 AI Search 回傳的 candidate 指到非 current 版本，D1
//      resolveCurrentEvidence 會把它過濾掉，不得用舊版 chunk 當 citation
//   4. 同一 configSnapshotVersion 全程落在兩筆 query_logs 上
// 真正完整 turn-by-turn LLM context replay 的驗證留給 E2E + conversationId feature 上線後補齊。

interface Tc05TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc05TurnScenario {
  chunkText: string
  citationLocator: string
  prompt: string
  sourceChunkId: string
}

interface Tc05Scenario {
  categorySlug: string
  currentDocumentId: string
  currentDocumentTitle: string
  currentDocumentVersionId: string
  firstTurn: Tc05TurnScenario
  secondTurn: Tc05TurnScenario
  staleDocumentVersionId: string
  staleSourceChunkId: string
  staleCitationLocator: string
  staleChunkText: string
}

const tc05Mocks = vi.hoisted(
  (): Tc05TestState => ({
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
  getCloudflareEnv: () => tc05Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc05Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc05Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc05Mocks.bindings ?? {}).DB,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc05Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc05Mocks.actor?.isAdmin ?? false,
  }
})

installNuxtRouteTestGlobals()

describe('acceptance multi-turn continuity and stale protection (TC-05)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-05',
  )
  const scenario = getTc05Scenario()

  beforeEach(() => {
    tc05Mocks.actor = createAcceptanceActorFixture('user')
    tc05Mocks.bindings = null
    tc05Mocks.readBody.mockReset()
    tc05Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc05Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc05Mocks.actor?.webSession))
  })

  it.each(cases)(
    'retains conversation scope and enforces stale protection across two turns for %s',
    async (fixture) => {
      const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
        acceptanceIds: string[]
        channels: string[]
        expectedHttpStatus: string
        id: string
        primaryOutcome: string
      } | null

      expect(registryEntry).toMatchObject({
        acceptanceIds: expect.arrayContaining(['A02']),
        channels: ['web'],
        expectedHttpStatus: '200',
        id: 'TC-05',
        primaryOutcome: 'direct',
      })
      expect(fixture.expectedOutcome).toBe('direct')
      expect(fixture.channel).toBe('web')

      tc05Mocks.bindings = createTc05Bindings(scenario)

      // --- 第一輪 ---
      tc05Mocks.readBody.mockResolvedValueOnce({ query: scenario.firstTurn.prompt })
      const firstResult = (await runWebCase()) as {
        data: {
          answer: string
          citations: Array<{ citationId: string; sourceChunkId: string }>
          refused: boolean
        }
      }

      expect(firstResult.data.refused).toBe(false)
      expect(firstResult.data.citations).toHaveLength(1)
      expect(firstResult.data.citations[0]?.sourceChunkId).toBe(scenario.firstTurn.sourceChunkId)

      // --- 第二輪（fixture prompt 代表追問）---
      tc05Mocks.readBody.mockResolvedValueOnce({ query: scenario.secondTurn.prompt })
      const secondResult = (await runWebCase()) as {
        data: {
          answer: string
          citations: Array<{ citationId: string; sourceChunkId: string }>
          refused: boolean
        }
      }

      expect(secondResult.data.refused).toBe(false)
      expect(secondResult.data.citations).toHaveLength(1)
      // 第二輪只能引用 current 版本，stale sourceChunk 不得出現
      expect(secondResult.data.citations[0]?.sourceChunkId).toBe(scenario.secondTurn.sourceChunkId)
      expect(secondResult.data.citations.map((item) => item.sourceChunkId)).not.toContain(
        scenario.staleSourceChunkId,
      )

      const aiBinding = (tc05Mocks.bindings ?? {}).AI as ReturnType<
        typeof createAiSearchBindingFake
      >
      const kv = (tc05Mocks.bindings ?? {}).KV as ReturnType<typeof createKvBindingFake>
      const d1 = (tc05Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

      // 兩輪各打一次 AI Search，兩輪都帶上 current-only filter（status=active、version_state=current）
      expect(aiBinding.calls).toHaveLength(2)
      for (const call of aiBinding.calls) {
        expect(call.request).toMatchObject({
          filters: expect.objectContaining({
            filters: expect.arrayContaining([
              { key: 'status', type: 'eq', value: 'active' },
              { key: 'version_state', type: 'eq', value: 'current' },
            ]),
            type: 'and',
          }),
        })
      }

      // 兩輪共用同一 user-scoped rate-limit key（代表 conversation 作用域真的存在於 KV）
      const userId = tc05Mocks.actor?.webSession.user.id ?? ''
      const expectedKey = `web:local:chat:${userId}`
      const kvPutKeys = kv.putCalls.map((call) => call.key)

      expect(kvPutKeys.filter((key) => key === expectedKey)).toHaveLength(2)

      // 最後一次 put 的 value.count 應為 2（第一輪 => 1，第二輪 => 2）
      const lastPut = kv.putCalls[kv.putCalls.length - 1]

      expect(lastPut).toBeDefined()
      expect(lastPut?.key).toBe(expectedKey)
      const parsed = JSON.parse(lastPut?.value ?? '{}') as { count: number; windowStart: number }

      expect(parsed.count).toBe(2)

      // Stale 保護：D1 resolveCurrentEvidence 以 is_current=1 過濾掉舊版
      // 第二輪的 AI Search 同時回了 stale 與 current candidate，兩者都會觸發 evidence lookup，
      // 但 stale 版本在 D1 回 null，最終 citation 只能是 current 版本。
      const evidenceLookups = d1.calls.filter(
        (call) =>
          call.query.includes('FROM source_chunks s') &&
          call.query.includes('INNER JOIN document_versions v') &&
          call.query.includes('v.is_current = 1'),
      )
      const lookupVersionIds = evidenceLookups.map((call) => call.values[0] as string)

      expect(lookupVersionIds).toContain(scenario.staleDocumentVersionId)
      expect(lookupVersionIds).toContain(scenario.currentDocumentVersionId)

      // citation_records 一共寫入兩筆（每輪一筆），皆為 current 版本
      const citationInserts = d1.calls.filter((call) =>
        call.query.includes('INSERT INTO citation_records'),
      )

      expect(citationInserts).toHaveLength(2)
      for (const insert of citationInserts) {
        expect(insert.values).toContain(scenario.currentDocumentVersionId)
        expect(insert.values).not.toContain(scenario.staleDocumentVersionId)
        expect(insert.values).not.toContain(scenario.staleSourceChunkId)
      }

      // 兩筆 query_logs 共用同一 configSnapshotVersion（跨輪 governance 版本未飄移）
      const queryLogInserts = d1.calls.filter((call) =>
        call.query.includes('INSERT INTO query_logs'),
      )

      expect(queryLogInserts).toHaveLength(2)
      for (const insert of queryLogInserts) {
        expect(insert.values).toEqual(
          expect.arrayContaining([
            'local',
            tc05Mocks.runtimeConfig?.governance.configSnapshotVersion,
            'accepted',
          ]),
        )
      }
    },
  )
})

async function runWebCase() {
  const { default: handler } = await import('../../server/api/chat.post')

  return await handler(createRouteEvent())
}

function getTc05Scenario(): Tc05Scenario {
  return {
    categorySlug: 'sop',
    currentDocumentId: 'doc-tc05-onboarding',
    currentDocumentTitle: 'TC-05 新進人員 SOP current',
    currentDocumentVersionId: 'ver-tc05-current',
    firstTurn: {
      chunkText:
        '新進人員 SOP：第一步需至人資系統建立檔案，第二步由到職輔導員指派夥伴並填寫報到表單。',
      citationLocator: 'lines 3-6',
      prompt: '新進人員 SOP 的第一步要做什麼？',
      sourceChunkId: 'chunk-tc05-onboarding-turn1',
    },
    secondTurn: {
      chunkText: '第二步驟的報到表單需填寫姓名、到職日期、緊急聯絡人與銀行帳號四個必要欄位。',
      citationLocator: 'lines 10-12',
      prompt: '那第二步驟那個欄位要填什麼？',
      sourceChunkId: 'chunk-tc05-onboarding-turn2',
    },
    staleCitationLocator: 'lines 9-11',
    staleChunkText: '舊版第二步驟：僅需填寫姓名與到職日期兩個欄位（已於 2026-03 被取代）。',
    staleDocumentVersionId: 'ver-tc05-stale',
    staleSourceChunkId: 'chunk-tc05-onboarding-stale',
  }
}

function createTc05Bindings(scenario: Tc05Scenario) {
  const d1 = createD1BindingFake({
    responders: [
      {
        match: /FROM source_chunks s\s+INNER JOIN document_versions v/,
        resolve: ({ values }) => {
          const [documentVersionId, citationLocator] = values as [string, string, ...unknown[]]

          if (
            documentVersionId === scenario.currentDocumentVersionId &&
            citationLocator === scenario.firstTurn.citationLocator
          ) {
            return {
              first: {
                access_level: 'internal',
                category_slug: scenario.categorySlug,
                chunk_text: scenario.firstTurn.chunkText,
                citation_locator: scenario.firstTurn.citationLocator,
                document_id: scenario.currentDocumentId,
                document_title: scenario.currentDocumentTitle,
                document_version_id: scenario.currentDocumentVersionId,
                source_chunk_id: scenario.firstTurn.sourceChunkId,
              },
            }
          }

          if (
            documentVersionId === scenario.currentDocumentVersionId &&
            citationLocator === scenario.secondTurn.citationLocator
          ) {
            return {
              first: {
                access_level: 'internal',
                category_slug: scenario.categorySlug,
                chunk_text: scenario.secondTurn.chunkText,
                citation_locator: scenario.secondTurn.citationLocator,
                document_id: scenario.currentDocumentId,
                document_title: scenario.currentDocumentTitle,
                document_version_id: scenario.currentDocumentVersionId,
                source_chunk_id: scenario.secondTurn.sourceChunkId,
              },
            }
          }

          // Stale 版本被 is_current=1 過濾掉 → 回 null
          return { first: null }
        },
      },
    ],
  })

  // KV 採真實可持久化的 fake，兩輪之間會累加 count
  const kv = createKvBindingFake()

  // AI Search 依 query 切分：
  //   - 第一輪 prompt → current 第一段
  //   - 第二輪 prompt → 同時回 stale 與 current 第二段 candidate，交由 D1 過濾
  const ai = {
    calls: [] as Array<{ indexName: string; request: Record<string, unknown> }>,
    autorag(indexName: string) {
      return {
        async search(request: Record<string, unknown>) {
          ai.calls.push({ indexName, request })

          const query = request.query as string

          if (query === scenario.firstTurn.prompt) {
            return {
              data: [
                {
                  attributes: {
                    file: {
                      access_level: 'internal',
                      citation_locator: scenario.firstTurn.citationLocator,
                      document_version_id: scenario.currentDocumentVersionId,
                      title: scenario.currentDocumentTitle,
                    },
                  },
                  content: [
                    {
                      text: scenario.firstTurn.chunkText,
                      type: 'text',
                    },
                  ],
                  filename: 'tc-05-turn-1.md',
                  score: 0.88,
                },
              ],
            }
          }

          // 第二輪：同時放 stale + current candidate，測試 stale 保護
          return {
            data: [
              {
                attributes: {
                  file: {
                    access_level: 'internal',
                    citation_locator: scenario.staleCitationLocator,
                    document_version_id: scenario.staleDocumentVersionId,
                    title: scenario.currentDocumentTitle,
                  },
                },
                content: [
                  {
                    text: scenario.staleChunkText,
                    type: 'text',
                  },
                ],
                filename: 'tc-05-turn-2-stale.md',
                score: 0.83,
              },
              {
                attributes: {
                  file: {
                    access_level: 'internal',
                    citation_locator: scenario.secondTurn.citationLocator,
                    document_version_id: scenario.currentDocumentVersionId,
                    title: scenario.currentDocumentTitle,
                  },
                },
                content: [
                  {
                    text: scenario.secondTurn.chunkText,
                    type: 'text',
                  },
                ],
                filename: 'tc-05-turn-2-current.md',
                score: 0.9,
              },
            ],
          }
        },
      }
    },
  }

  return createCloudflareBindingsFixture({
    ai,
    d1,
    kv,
  })
}
