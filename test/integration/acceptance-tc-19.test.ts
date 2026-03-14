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

// TC-19：listCategories 計數規則
//
// 契約：listCategories 只回報 `status='active' AND v.is_current=1 AND current_version_id IS NOT NULL`
// 的 documents，且以 `d.access_level IN (allowed_access_levels)` 做可見性過濾。
//
// 模擬資料集（知識庫中實際分布 / 非 listCategories 的回傳）：
//   procurement：
//     - doc A：status=active, is_current=1 → ✔ 計入
//     - doc B：status=active, is_current=0（舊版覆蓋）→ ✘ 不計入
//     - doc C：status=draft → ✘ 不計入
//     → 應回報 count=1
//   policy：
//     - doc D：status=active, is_current=1 → ✔ 計入
//     - doc E：status=active, is_current=1 → ✔ 計入
//     → 應回報 count=2
//   inventory：
//     - doc F：status=archived → ✘ 不計入（整個 category 不出現）
//
// SQL 斷言：`SELECT ... FROM documents d INNER JOIN document_versions v
//           ... WHERE d.status='active' AND d.current_version_id IS NOT NULL
//           AND v.is_current=1 AND d.access_level IN (?)`
// 由 store 端在 SQL 就完成去重，test 直接驗證 SQL 文字 + 最終 response。

interface Tc19TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface Tc19CategoryCount {
  count: number
  slug: string
}

const tc19Mocks = vi.hoisted(
  (): Tc19TestState => ({
    actor: null,
    bindings: null,
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
  getCloudflareEnv: () => tc19Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc19Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc19Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc19Mocks.bindings ?? {}).DB,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc19Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc19Mocks.actor?.isAdmin ?? false,
  }
})

installNuxtRouteTestGlobals()

describe('acceptance listCategories count contract (TC-19)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-19',
  )
  // 代表 SQL 已過濾（active + is_current + visible）後每個 category 的最終計數。
  // 整個 category 不可見時（全 archived / 全 restricted 無 scope），不會出現在 response 中。
  const preFilteredCounts: Tc19CategoryCount[] = [
    { count: 1, slug: 'procurement' },
    { count: 2, slug: 'policy' },
  ]

  beforeEach(() => {
    tc19Mocks.actor = createAcceptanceActorFixture('user')
    tc19Mocks.bindings = null
    tc19Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal(
      'getValidatedQuery',
      vi.fn().mockResolvedValue({
        includeCounts: true,
      }),
    )
  })

  it.each(cases)(
    'returns only active + is_current documents per category for %s',
    async (fixture) => {
      const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
        acceptanceIds: string[]
        channels: string[]
        expectedHttpStatus: string
        id: string
        primaryOutcome: string
      } | null

      expect(registryEntry).toMatchObject({
        acceptanceIds: expect.arrayContaining(['A07']),
        channels: ['mcp'],
        expectedHttpStatus: '200',
        id: 'TC-19',
        primaryOutcome: 'direct',
      })
      expect(fixture.channel).toBe('mcp')
      expect(fixture.expectedOutcome).toBe('direct')

      tc19Mocks.bindings = createTc19Bindings(
        tc19Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
        preFilteredCounts,
      )

      const { default: tool } = await import('#server/mcp/tools/categories')
      const data = (await runMcpTool(
        tool,
        { includeCounts: true },
        {
          authorizationHeader: tc19Mocks.actor?.mcpToken.authorizationHeader ?? '',
          cloudflareEnv: tc19Mocks.bindings ?? {},
          pendingEvent,
        },
      )) as { categories: Array<{ count?: number; name: string }> }
      const result = { data }

      const d1 = (tc19Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>

      // 契約 #1：SQL 必須包含 active + current 過濾 + is_current=1 + access_level IN (?)
      const categoryQuery = d1.calls.find(
        (call) =>
          call.query.includes('FROM documents d') &&
          call.query.includes('INNER JOIN document_versions v') &&
          call.query.includes('COUNT(DISTINCT d.id)'),
      )

      expect(categoryQuery).toBeDefined()

      const queryText = categoryQuery?.query ?? ''

      expect(queryText).toContain("d.status = 'active'")
      expect(queryText).toContain('d.current_version_id IS NOT NULL')
      expect(queryText).toContain('v.is_current = 1')
      expect(queryText).toContain('d.access_level IN (')

      // 契約 #2：bind 的 allowedAccessLevels 為 user scope 可見（['internal']，不含 restricted）
      expect(categoryQuery?.values).toEqual(['internal'])

      // 契約 #3：回傳依 category name 遞增排序，每筆 { name, count }
      expect(result.data.categories).toEqual([
        { count: 2, name: 'policy' },
        { count: 1, name: 'procurement' },
      ])

      // 契約 #4：整個 category 全部 archived → 不會出現在 response（inventory 不存在）
      expect(result.data.categories.map((entry) => entry.name)).not.toContain('inventory')

      // 契約 #5：每個 entry 只暴露 { name, count }，無其他內部欄位
      for (const entry of result.data.categories) {
        expect(Object.keys(entry).toSorted()).toEqual(['count', 'name'])
      }

      // 契約 #6：MCP token 驗證 + touch last_used_at 有跑（scope/auth flow 正常）
      expect(d1.calls.some((call) => call.query.includes('FROM mcp_tokens'))).toBe(true)
      expect(d1.calls.some((call) => call.query.includes('UPDATE mcp_tokens'))).toBe(true)
    },
  )
})

function createTc19Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  preFilteredCounts: Tc19CategoryCount[],
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
        // listVisibleCategories 回傳已在 SQL 端去重過的 { category_slug, document_count }
        // 對應：procurement=1（舊版+draft 已被過濾）、policy=2、inventory 不出現（全 archived）
        match: /FROM documents d\s+INNER JOIN document_versions v/,
        resolve: () => ({
          all: preFilteredCounts.map((entry) => ({
            category_slug: entry.slug,
            document_count: entry.count,
          })),
        }),
      },
    ],
  })
  const kv = createKvBindingFake()

  return createCloudflareBindingsFixture({
    d1,
    kv,
  })
}
