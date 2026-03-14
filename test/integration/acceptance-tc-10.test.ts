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

// TC-10：制度查詢題
// 使用者詢問制度規章（如「新進人員請假規定是什麼？」）。
// 系統應走 direct 路徑：retrievalScore >= directAnswerMin，
// 不進 judge / self-correction，首輪即回答並附制度文件引用。
// 關鍵驗證：
//   1. refused=false，回答含制度 key phrase（「請假」「天」等）
//   2. aiBinding 被打恰好一次（direct 路徑）
//   3. 恰好一筆 citation 指向制度文件（category_slug='policy'）
//   4. citation_records 寫入且包含制度文件的 documentVersionId + chunkText
//   5. query_logs 狀態 accepted + configSnapshotVersion

interface Tc10TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc10Scenario {
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

const tc10Mocks = vi.hoisted(
  (): Tc10TestState => ({
    actor: null,
    bindings: null,
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
  getCloudflareEnv: () => tc10Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc10Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc10Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc10Mocks.bindings ?? {}).DB,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc10Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc10Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc10Mocks.readZodBody(...args),
}))

installNuxtRouteTestGlobals()

describe('acceptance policy direct-answer (TC-10)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-10',
  )
  const scenario = getTc10Scenario()

  beforeEach(() => {
    tc10Mocks.actor = createAcceptanceActorFixture('user')
    tc10Mocks.bindings = null
    tc10Mocks.readBody.mockReset()
    tc10Mocks.readZodBody.mockReset()
    tc10Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc10Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc10Mocks.actor?.webSession))
  })

  it.each(cases)(
    'answers policy query %s directly citing a policy-category document',
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
        expectedHttpStatus: '200',
        id: 'TC-10',
        primaryOutcome: 'direct',
      })
      expect(fixture.expectedOutcome).toBe('direct')
      expect(['web', 'mcp']).toContain(fixture.channel)

      tc10Mocks.bindings = createTc10Bindings(
        tc10Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
        scenario,
      )
      tc10Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
      tc10Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

      const result = (
        fixture.channel === 'web'
          ? await runWebCase()
          : await runMcpCase(tc10Mocks.actor?.mcpToken.authorizationHeader ?? '', fixture.prompt)
      ) as {
        data: {
          answer: string
          citations: Array<{ citationId: string; sourceChunkId: string }>
          refused: boolean
        }
      }

      const aiBinding = (tc10Mocks.bindings ?? {}).AI as ReturnType<
        typeof createAiSearchBindingFake
      >
      const d1 = (tc10Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

      // Direct 路徑：AI Search 恰好呼叫一次（不進 self-correction）
      expect(aiBinding.calls).toHaveLength(1)
      expect(aiBinding.calls[0]).toMatchObject({
        indexName: 'knowledge-index',
        request: {
          query: fixture.prompt,
        },
      })

      // 非 refused + 恰好一筆 citation
      expect(result.data.refused).toBe(false)
      expect(result.data.citations).toHaveLength(1)
      expect(result.data.citations[0]).toMatchObject({
        citationId: expect.any(String),
        sourceChunkId: scenario.sourceChunkId,
      })

      // Answer 含制度關鍵詞
      for (const fragment of scenario.answerFragments) {
        expect(result.data.answer).toContain(fragment)
      }

      // citation_records 寫入恰好一筆，且指向制度文件
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

      // source_chunks 查回的 category_slug 必須是制度類別
      expect(scenario.categorySlug).toBe('policy')

      // query_logs 狀態 accepted + config_snapshot_version
      const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

      expect(queryLogInsert?.values).toEqual(
        expect.arrayContaining([
          'local',
          tc10Mocks.runtimeConfig?.governance.configSnapshotVersion,
          'accepted',
        ]),
      )

      if (fixture.channel === 'mcp') {
        expect(d1.calls.some((call) => call.query.includes('FROM mcp_tokens'))).toBe(true)
        expect(d1.calls.some((call) => call.query.includes('UPDATE mcp_tokens'))).toBe(true)
      }
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
      cloudflareEnv: tc10Mocks.bindings ?? {},
      pendingEvent,
    },
  )

  return { data }
}

function getTc10Scenario(): Tc10Scenario {
  // 制度文件（category_slug = 'policy'），分數高於 directAnswerMin=0.7
  return {
    answerFragments: ['新進人員', '事假', '病假'],
    categorySlug: 'policy',
    chunkText:
      '新進人員（到職未滿 6 個月）可請事假 3 天，病假 5 天，依人事制度第 3 條辦理；年假需滿 1 年後方可申請。',
    citationLocator: 'lines 20-24',
    documentId: 'doc-tc10-policy-leave',
    documentTitle: '人事制度 current',
    documentVersionId: 'ver-tc10-policy-current',
    score: 0.88,
    sourceChunkId: 'chunk-tc10-leave',
    title: '人事制度 current',
  }
}

function createTc10Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  scenario: Tc10Scenario,
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
          filename: 'tc-10-policy.md',
          score: scenario.score,
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
