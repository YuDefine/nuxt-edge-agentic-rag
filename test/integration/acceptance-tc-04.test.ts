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

// TC-04：模糊查詢 self-correction 題
// 驗證 Self-Correction 觸發與第二輪成功條件：
//   第一輪 retrieval 分數落在 [judgeMin, directAnswerMin) 區間 → 不是 direct。
//   Judge 回 shouldAnswer=false 且帶 reformulatedQuery → 進入第二輪。
//   第二輪 retrieval 分數 >= directAnswerMin → 以第二輪 evidence 成功作答。
// 確保 aiBinding 被打兩次（第二次帶 reformulatedQuery），
// citation_records 只引用第二輪 evidence，query_logs 仍帶 config_snapshot_version。

interface Tc04TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  reformulatedQuery: string
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc04Scenario {
  answerFragments: string[]
  categorySlug: string
  documentId: string
  documentTitle: string
  documentVersionId: string
  firstPassChunkText: string
  firstPassCitationLocator: string
  firstPassScore: number
  firstPassSourceChunkId: string
  secondPassChunkText: string
  secondPassCitationLocator: string
  secondPassScore: number
  secondPassSourceChunkId: string
  title: string
}

const tc04Mocks = vi.hoisted(
  (): Tc04TestState => ({
    actor: null,
    bindings: null,
    readBody: vi.fn(),
    readZodBody: vi.fn(),
    reformulatedQuery: '上個月的銷售月結報表如何檢視',
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
  getCloudflareEnv: () => tc04Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc04Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc04Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc04Mocks.bindings ?? {}).DB,
  getDrizzleDb: async () => ({ db: (tc04Mocks.bindings ?? {}).DB }),
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc04Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc04Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc04Mocks.readZodBody(...args),
}))

// chat.post / mcp/ask.post 都沒有把 judge 抽成可注入的 export，
// 改用 mock knowledge-answering：以 importOriginal 實作為底，強制覆寫 options.judge，
// 使 Self-Correction 路徑能穩定觸發（fallback judge 本身不會返回 reformulatedQuery）。
vi.mock('../../server/utils/knowledge-answering', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-answering')>()
  const { answerKnowledgeQuery: realAnswer } = actual

  return {
    ...actual,
    async answerKnowledgeQuery(
      input: Parameters<typeof realAnswer>[0],
      options: Parameters<typeof realAnswer>[1]
    ) {
      const judgedQueries: string[] = []

      return realAnswer(input, {
        ...options,
        async judge(judgeInput) {
          judgedQueries.push(judgeInput.query)

          // 第一輪 evidence 分數 < directAnswerMin，要求 reformulate
          return {
            reformulatedQuery: tc04Mocks.reformulatedQuery,
            shouldAnswer: false,
          }
        },
      })
    },
  }
})

installNuxtRouteTestGlobals()

describe('acceptance self-correction reformulation (TC-04)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-04'
  )
  const scenario = getTc04Scenario()

  beforeEach(() => {
    tc04Mocks.actor = createAcceptanceActorFixture('user')
    tc04Mocks.bindings = null
    tc04Mocks.readBody.mockReset()
    tc04Mocks.readZodBody.mockReset()
    tc04Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc04Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc04Mocks.actor?.webSession))
  })

  it.each(cases)(
    'triggers self-correction for %s and answers with the second pass evidence',
    async (fixture) => {
      const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
        acceptanceIds: string[]
        expectedHttpStatus: string
        id: string
        primaryOutcome: string
      } | null

      expect(registryEntry).toMatchObject({
        acceptanceIds: expect.arrayContaining(['A05']),
        expectedHttpStatus: '200',
        id: 'TC-04',
        primaryOutcome: 'self_corrected',
      })
      expect(fixture.expectedOutcome).toBe('self_corrected')

      tc04Mocks.bindings = createTc04Bindings(
        tc04Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
        scenario,
        fixture.prompt
      )
      tc04Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
      tc04Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

      const result = (
        fixture.channel === 'web'
          ? await runWebCase()
          : await runMcpCase(tc04Mocks.actor?.mcpToken.authorizationHeader ?? '')
      ) as {
        data: {
          answer: string
          citations: Array<{ citationId: string; sourceChunkId: string }>
          refused: boolean
        }
      }

      const aiBinding = (tc04Mocks.bindings ?? {}).AI as ReturnType<
        typeof createAiSearchBindingFake
      >
      const d1 = (tc04Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

      // --- Self-Correction 的觸發驗證：AI Search 被打兩次 ---
      expect(aiBinding.calls).toHaveLength(2)
      expect(aiBinding.calls[0]?.request).toMatchObject({ query: fixture.prompt })
      expect(aiBinding.calls[1]?.request).toMatchObject({ query: tc04Mocks.reformulatedQuery })

      // 第二輪成功條件：非 refused、有且只有一筆 citation、指向第二輪 sourceChunkId
      expect(result.data.refused).toBe(false)
      expect(result.data.citations).toHaveLength(1)
      expect(result.data.citations[0]).toMatchObject({
        citationId: expect.any(String),
        sourceChunkId: scenario.secondPassSourceChunkId,
      })
      for (const fragment of scenario.answerFragments) {
        expect(result.data.answer).toContain(fragment)
      }
      // 第一輪的片段不得殘留在最終回答中
      expect(result.data.answer).not.toContain(scenario.firstPassChunkText)

      // citation_records 只能寫入第二輪 evidence
      const citationInserts = d1.calls.filter((call) =>
        call.query.includes('INSERT INTO citation_records')
      )

      expect(citationInserts).toHaveLength(1)
      expect(citationInserts[0]?.values).toEqual(
        expect.arrayContaining([
          scenario.documentVersionId,
          scenario.secondPassSourceChunkId,
          scenario.secondPassCitationLocator,
          scenario.secondPassChunkText,
        ])
      )
      expect(citationInserts[0]?.values).not.toContain(scenario.firstPassSourceChunkId)
      expect(citationInserts[0]?.values).not.toContain(scenario.firstPassChunkText)

      // query_logs 仍須帶 env、configSnapshotVersion 與 accepted 狀態
      const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

      expect(queryLogInsert?.values).toEqual(
        expect.arrayContaining([
          'local',
          tc04Mocks.runtimeConfig?.governance.configSnapshotVersion,
          'accepted',
        ])
      )

      if (fixture.channel === 'mcp') {
        expect(d1.calls.some((call) => call.query.includes('FROM mcp_tokens'))).toBe(true)
        expect(d1.calls.some((call) => call.query.includes('UPDATE mcp_tokens'))).toBe(true)
      }
    }
  )
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

function getTc04Scenario(): Tc04Scenario {
  return {
    answerFragments: ['銷售月結報表', '損益'],
    categorySlug: 'reporting',
    documentId: 'doc-tc04-monthly-report',
    documentTitle: '月結報表操作手冊 current',
    documentVersionId: 'ver-tc04-current',
    firstPassChunkText: '報表模組提供多張表單，實際欄位依表單種類而定。',
    firstPassCitationLocator: 'lines 1-2',
    firstPassScore: 0.5,
    firstPassSourceChunkId: 'chunk-tc04-generic',
    secondPassChunkText: '銷售月結報表位於報表模組 > 月結 > 銷售，需先選擇結帳月份再檢視損益欄位。',
    secondPassCitationLocator: 'lines 8-12',
    secondPassScore: 0.86,
    secondPassSourceChunkId: 'chunk-tc04-monthly',
    title: '月結報表操作手冊',
  }
}

function createTc04Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  scenario: Tc04Scenario,
  originalPrompt: string
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
        // resolveCurrentEvidence — 兩輪不同 citationLocator 指向同一份 current 文件
        match: /FROM source_chunks s\s+INNER JOIN document_versions v/,
        resolve: ({ values }) => {
          const [documentVersionId, citationLocator] = values as [string, string, ...unknown[]]

          if (documentVersionId !== scenario.documentVersionId) {
            return { first: null }
          }

          if (citationLocator === scenario.firstPassCitationLocator) {
            return {
              first: {
                access_level: 'internal',
                category_slug: scenario.categorySlug,
                chunk_text: scenario.firstPassChunkText,
                citation_locator: scenario.firstPassCitationLocator,
                document_id: scenario.documentId,
                document_title: scenario.documentTitle,
                document_version_id: scenario.documentVersionId,
                source_chunk_id: scenario.firstPassSourceChunkId,
              },
            }
          }

          if (citationLocator === scenario.secondPassCitationLocator) {
            return {
              first: {
                access_level: 'internal',
                category_slug: scenario.categorySlug,
                chunk_text: scenario.secondPassChunkText,
                citation_locator: scenario.secondPassCitationLocator,
                document_id: scenario.documentId,
                document_title: scenario.documentTitle,
                document_version_id: scenario.documentVersionId,
                source_chunk_id: scenario.secondPassSourceChunkId,
              },
            }
          }

          return { first: null }
        },
      },
    ],
  })
  const kv = createKvBindingFake()

  // AI Search 依 request.query 切分兩種回應：
  //   原始 prompt → 低分 candidate（觸發 judge）
  //   reformulated prompt → 高分 candidate（直接作答）
  const ai = {
    calls: [] as Array<{ indexName: string; request: Record<string, unknown> }>,
    autorag(indexName: string) {
      return {
        async search(request: Record<string, unknown>) {
          ai.calls.push({ indexName, request })

          const query = request.query as string

          if (query === originalPrompt) {
            return {
              data: [
                {
                  attributes: {
                    file: {
                      access_level: 'internal',
                      citation_locator: scenario.firstPassCitationLocator,
                      document_version_id: scenario.documentVersionId,
                      title: scenario.title,
                    },
                  },
                  content: [
                    {
                      text: scenario.firstPassChunkText,
                      type: 'text',
                    },
                  ],
                  filename: 'tc-04-first.md',
                  score: scenario.firstPassScore,
                },
              ],
            }
          }

          return {
            data: [
              {
                attributes: {
                  file: {
                    access_level: 'internal',
                    citation_locator: scenario.secondPassCitationLocator,
                    document_version_id: scenario.documentVersionId,
                    title: scenario.title,
                  },
                },
                content: [
                  {
                    text: scenario.secondPassChunkText,
                    type: 'text',
                  },
                ],
                filename: 'tc-04-second.md',
                score: scenario.secondPassScore,
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
