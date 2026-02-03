import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '../../shared/schemas/knowledge-runtime'
import { loadAcceptanceFixtureDataset } from '../acceptance/fixtures/loader'
import { createAcceptanceActorFixture } from '../acceptance/helpers/auth'
import {
  createCloudflareBindingsFixture,
  createD1BindingFake,
  createKvBindingFake,
} from '../acceptance/helpers/bindings'
import { getAcceptanceRegistryEntry } from '../acceptance/registry/manifest'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

interface Tc13TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

// TC-13 restricted 情境：使用 non-restricted token 嘗試取得 restricted chunk
// 必須拒絕於 403，且不得回傳 chunkText / document 描述資訊
const RESTRICTED_CITATION_ID = 'citation-restricted-policy'
const RESTRICTED_CHUNK_TEXT = 'RESTRICTED_SECRET_CONTENT_DO_NOT_LEAK'
const RESTRICTED_DOCUMENT_TITLE = 'RESTRICTED_DOC_TITLE_DO_NOT_LEAK'
const RESTRICTED_LOCATOR = 'lines 1-3'

const tc13Mocks = vi.hoisted(
  (): Tc13TestState => ({
    actor: null,
    bindings: null,
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
  getCloudflareEnv: () => tc13Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc13Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc13Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc13Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc13Mocks.actor?.isAdmin ?? false,
  }
})

// hub:db 在測試環境中無法 resolve，改成回傳 fake D1 binding
vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc13Mocks.bindings ?? {}).DB,
}))

installNuxtRouteTestGlobals()

describe('acceptance restricted citation scope (TC-13)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-13'
  )

  beforeEach(() => {
    // 使用 user preset — scopes 含 knowledge.citation.read，但缺 knowledge.restricted.read
    tc13Mocks.actor = createAcceptanceActorFixture('user')
    tc13Mocks.bindings = null
    tc13Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })
  })

  it.each(cases)('blocks %s with HTTP 403 and leaks no restricted content', async (fixture) => {
    const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
      expectedHttpStatus: string
      id: string
      primaryOutcome: string
    } | null

    tc13Mocks.bindings = createTc13Bindings(
      tc13Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>
    )

    expect(registryEntry).toMatchObject({
      expectedHttpStatus: '403',
      id: 'TC-13',
      primaryOutcome: '403',
    })
    expect(fixture.expectedOutcome).toBe('403')
    expect(fixture.channel).toBe('mcp')

    // Non-restricted token 確認 scope 不含 restricted read
    expect(tc13Mocks.actor?.mcpAuth.scopes).not.toContain('knowledge.restricted.read')

    const { default: handler } = await import('../../server/api/mcp/chunks/[citationId].get')
    const event = createRouteEvent({
      context: {
        cloudflare: { env: tc13Mocks.bindings ?? {} },
        params: { citationId: RESTRICTED_CITATION_ID },
      },
      headers: {
        authorization: tc13Mocks.actor?.mcpToken.authorizationHeader ?? '',
      },
    })

    let thrown: unknown = null
    try {
      await handler(event)
    } catch (error) {
      thrown = error
    }

    // 必須拋出 403
    expect(thrown).not.toBeNull()
    expect(thrown).toMatchObject({
      statusCode: 403,
    })

    // 錯誤訊息不得包含原始 chunkText、document title 或 locator
    const errorMessage = (thrown as { message?: string }).message ?? ''
    expect(errorMessage).not.toContain(RESTRICTED_CHUNK_TEXT)
    expect(errorMessage).not.toContain(RESTRICTED_DOCUMENT_TITLE)
    expect(errorMessage).not.toContain(RESTRICTED_LOCATOR)

    // 驗證 D1 calls 沒有把敏感 chunkText 回寫給 caller
    const d1 = (tc13Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>
    const citationSelect = d1.calls.find((call) => call.query.includes('FROM citation_records cr'))

    // handler 有真的嘗試查詢 citation（表示 scope check 發生在取資料之後）
    expect(citationSelect).toBeDefined()
    expect(citationSelect?.values).toEqual(expect.arrayContaining([RESTRICTED_CITATION_ID]))

    // 403 路徑會寫一筆 query_logs { status: 'blocked' }，queryText 經過 auditKnowledgeText 再存。
    // 無論哪種路徑，restricted chunkText 與文件標題都不得外洩到 D1 的任一筆寫入。
    for (const call of d1.calls) {
      for (const value of call.values) {
        if (typeof value !== 'string') {
          continue
        }

        expect(value).not.toContain(RESTRICTED_CHUNK_TEXT)
        expect(value).not.toContain(RESTRICTED_DOCUMENT_TITLE)
      }
    }
  })
})

function createTc13Bindings(actor: ReturnType<typeof createAcceptanceActorFixture>) {
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
        // citation SELECT JOIN source_chunks，回傳 access_level='restricted'
        match: /FROM citation_records cr/,
        resolve: ({ values }) =>
          values[0] === RESTRICTED_CITATION_ID
            ? {
                first: {
                  access_level: 'restricted',
                  chunk_text_snapshot: RESTRICTED_CHUNK_TEXT,
                  citation_id: RESTRICTED_CITATION_ID,
                  citation_locator: RESTRICTED_LOCATOR,
                },
              }
            : { first: null },
      },
    ],
  })
  const kv = createKvBindingFake()

  return createCloudflareBindingsFixture({
    d1,
    kv,
  })
}
