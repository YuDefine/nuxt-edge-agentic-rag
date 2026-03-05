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

// TC-18：current-version-only 切版驗證
// 模擬同一份 document 有 V1（is_current=0, archived）與 V2（is_current=1, active）兩版，
// AI Search 同時回傳兩版 candidate，但 D1 post-verification（resolveCurrentEvidence）
// 會因為 `v.is_current = 1` + `d.status = 'active'` 過濾掉 V1，
// 最終 answer 的 citations 只會引用 V2 的 document_version_id / source_chunk_id。

interface Tc18TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc18Scenario {
  answerFragments: string[]
  categorySlug: string
  currentAccessLevel: string
  currentChunkText: string
  currentCitationLocator: string
  currentDocumentTitle: string
  currentDocumentVersionId: string
  currentSourceChunkId: string
  documentId: string
  staleAccessLevel: string
  staleChunkText: string
  staleCitationLocator: string
  staleDocumentTitle: string
  staleDocumentVersionId: string
  staleSourceChunkId: string
  title: string
}

const tc18Mocks = vi.hoisted(
  (): Tc18TestState => ({
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
  getCloudflareEnv: () => tc18Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc18Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc18Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc18Mocks.bindings ?? {}).DB,
  getDrizzleDb: async () => ({ db: (tc18Mocks.bindings ?? {}).DB }),
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc18Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc18Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc18Mocks.readZodBody(...args),
}))

installNuxtRouteTestGlobals()

describe('acceptance current-version-only enforcement', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-18'
  )
  const scenario = getTc18Scenario()

  beforeEach(() => {
    tc18Mocks.actor = createAcceptanceActorFixture('user')
    tc18Mocks.bindings = null
    tc18Mocks.readBody.mockReset()
    tc18Mocks.readZodBody.mockReset()
    tc18Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc18Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc18Mocks.actor?.webSession))
  })

  it.each(cases)(
    'answers %s referencing only the current version after superseding an older one',
    async (fixture) => {
      const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
        acceptanceIds: string[]
        channels: string[]
        expectedHttpStatus: string
        id: string
        primaryOutcome: string
      } | null

      expect(registryEntry).toMatchObject({
        acceptanceIds: expect.arrayContaining(['A04']),
        id: 'TC-18',
        primaryOutcome: 'refused_or_new_version_only',
      })
      expect(['web', 'mcp']).toContain(fixture.channel)

      tc18Mocks.bindings = createTc18Bindings(
        tc18Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
        scenario
      )
      tc18Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
      tc18Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

      const result = (
        fixture.channel === 'web'
          ? await runWebCase()
          : await runMcpCase(tc18Mocks.actor?.mcpToken.authorizationHeader ?? '', fixture.prompt)
      ) as {
        data: {
          answer: string
          citations: Array<{ citationId: string; sourceChunkId: string }>
          refused: boolean
        }
      }

      const aiBinding = (tc18Mocks.bindings ?? {}).AI as ReturnType<
        typeof createAiSearchBindingFake
      >
      const d1 = (tc18Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

      // AI Search 被呼叫一次，且 filters 明確帶上 version_state='current' 與 status='active'（
      // 以防 AI Search 放寬限制，D1 仍會做二次過濾，下方會再驗證）。
      expect(aiBinding.calls).toHaveLength(1)
      expect(aiBinding.calls[0]).toMatchObject({
        indexName: 'knowledge-index',
        request: {
          filters: expect.objectContaining({
            filters: expect.arrayContaining([
              { key: 'status', type: 'eq', value: 'active' },
              { key: 'version_state', type: 'eq', value: 'current' },
            ]),
            type: 'and',
          }),
          query: fixture.prompt,
        },
      })

      // 最終回答只引用當前版本的 source_chunk，拒答/舊版引用都不能發生
      expect(result.data.refused).toBe(false)
      expect(result.data.citations).toHaveLength(1)
      expect(result.data.citations[0]).toMatchObject({
        citationId: expect.any(String),
        sourceChunkId: scenario.currentSourceChunkId,
      })
      for (const fragment of scenario.answerFragments) {
        expect(result.data.answer).toContain(fragment)
      }
      // 舊版的片段不能出現在正式回答中
      expect(result.data.answer).not.toContain(scenario.staleChunkText)

      // D1 的 evidence 解析要對 V1 與 V2 兩個 candidate 都查詢一次；
      // 其中 V1 會被 is_current=1 過濾掉，V2 才會成為正式 evidence。
      const evidenceLookups = d1.calls.filter(
        (call) =>
          call.query.includes('FROM source_chunks s') &&
          call.query.includes('INNER JOIN document_versions v') &&
          call.query.includes('v.is_current = 1')
      )

      expect(evidenceLookups.length).toBeGreaterThanOrEqual(2)
      const lookedUpVersionIds = evidenceLookups.map((call) => call.values[0])

      expect(lookedUpVersionIds).toEqual(
        expect.arrayContaining([scenario.staleDocumentVersionId, scenario.currentDocumentVersionId])
      )

      // citation_records 的寫入只能針對 current 版本；絕對不能出現 stale 版本的任何欄位
      const citationInserts = d1.calls.filter((call) =>
        call.query.includes('INSERT INTO citation_records')
      )

      expect(citationInserts).toHaveLength(1)
      expect(citationInserts[0]?.values).toEqual(
        expect.arrayContaining([
          scenario.currentDocumentVersionId,
          scenario.currentSourceChunkId,
          scenario.currentCitationLocator,
          scenario.currentChunkText,
        ])
      )
      expect(citationInserts[0]?.values).not.toContain(scenario.staleDocumentVersionId)
      expect(citationInserts[0]?.values).not.toContain(scenario.staleSourceChunkId)
      expect(citationInserts[0]?.values).not.toContain(scenario.staleChunkText)

      // query_logs 仍須帶上 configSnapshotVersion 與 accepted 狀態
      const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))

      expect(queryLogInsert?.values).toEqual(
        expect.arrayContaining([
          'local',
          tc18Mocks.runtimeConfig?.governance.configSnapshotVersion,
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

async function runMcpCase(authorizationHeader: string, query: string) {
  const { default: tool } = await import('#server/mcp/tools/ask')
  const data = await runMcpTool(
    tool,
    { query },
    {
      authorizationHeader,
      cloudflareEnv: tc18Mocks.bindings ?? {},
      pendingEvent,
    }
  )

  return { data }
}

function getTc18Scenario(): Tc18Scenario {
  return {
    answerFragments: ['新版', '流程'],
    categorySlug: 'policy',
    currentAccessLevel: 'internal',
    currentChunkText: '新版流程：請購單由部門主管複核後，於 ERP 系統提交，以確保採購合規。',
    currentCitationLocator: 'lines 4-6',
    currentDocumentTitle: 'TC-18 請購流程 current',
    currentDocumentVersionId: 'ver-tc18-v2-current',
    currentSourceChunkId: 'chunk-tc18-v2',
    documentId: 'doc-tc18-policy',
    staleAccessLevel: 'internal',
    staleChunkText: '舊版流程：請購單由同仁自行於郵件系統寄送主管即可完成申請。',
    staleCitationLocator: 'lines 2-4',
    staleDocumentTitle: 'TC-18 請購流程 V1',
    staleDocumentVersionId: 'ver-tc18-v1-archived',
    staleSourceChunkId: 'chunk-tc18-v1',
    title: 'TC-18 請購流程',
  }
}

function createTc18Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  scenario: Tc18Scenario
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
        // resolveCurrentEvidence 會針對每個 AI Search candidate 各打一次，
        // 且查詢 WHERE v.id = ? AND v.is_current = 1。
        // 舊版 V1 查到 null（被過濾），新版 V2 查到完整 row。
        match: /FROM source_chunks s\s+INNER JOIN document_versions v/,
        resolve: ({ values }) => {
          const [documentVersionId, citationLocator] = values as [string, string, ...unknown[]]

          if (
            documentVersionId === scenario.currentDocumentVersionId &&
            citationLocator === scenario.currentCitationLocator
          ) {
            return {
              first: {
                access_level: scenario.currentAccessLevel,
                category_slug: scenario.categorySlug,
                chunk_text: scenario.currentChunkText,
                citation_locator: scenario.currentCitationLocator,
                document_id: scenario.documentId,
                document_title: scenario.currentDocumentTitle,
                document_version_id: scenario.currentDocumentVersionId,
                source_chunk_id: scenario.currentSourceChunkId,
              },
            }
          }

          // 舊版 V1 或其他未知 candidate 一律回 null，代表 is_current=1 過濾掉它們
          return { first: null }
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
  // AI Search 刻意回傳 V1 與 V2 兩筆 candidate，模擬索引尚未完全清除舊版、
  // 或向量相近度讓舊版也被召回的情境；交由 D1 post-verification 把關。
  const ai = createAiSearchBindingFake({
    responses: {
      'knowledge-index': [
        {
          attributes: {
            file: {
              access_level: scenario.staleAccessLevel,
              citation_locator: scenario.staleCitationLocator,
              document_version_id: scenario.staleDocumentVersionId,
              title: scenario.staleDocumentTitle,
            },
          },
          content: [
            {
              text: scenario.staleChunkText,
              type: 'text',
            },
          ],
          filename: 'tc-18-v1.md',
          score: 0.88,
        },
        {
          attributes: {
            file: {
              access_level: scenario.currentAccessLevel,
              citation_locator: scenario.currentCitationLocator,
              document_version_id: scenario.currentDocumentVersionId,
              title: scenario.currentDocumentTitle,
            },
          },
          content: [
            {
              text: scenario.currentChunkText,
              type: 'text',
            },
          ],
          filename: 'tc-18-v2.md',
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
