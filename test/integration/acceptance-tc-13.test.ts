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

vi.mock('../../server/utils/database', async () => {
  const { createHubDbMock } = await import('./helpers/database')

  return createHubDbMock({ database: () => (tc13Mocks.bindings ?? {}).DB })
})

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

    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')

    let thrown: unknown = null
    try {
      await runMcpTool(
        tool,
        { citationId: RESTRICTED_CITATION_ID },
        {
          authorizationHeader: tc13Mocks.actor?.mcpToken.authorizationHeader ?? '',
          cloudflareEnv: tc13Mocks.bindings ?? {},
          params: { citationId: RESTRICTED_CITATION_ID },
          pendingEvent,
        }
      )
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

    // `mcp-restricted-audit-trail` spec Scenario 1: 403 path must write ONE
    // query_logs row with `status='blocked'` + `risk_flags_json` containing
    // `restricted_scope_violation`, and the attempted citation id must be
    // captured in `query_redacted_text` so auditors can trace which
    // restricted resource was probed.
    const queryLogInserts = d1.calls.filter((call) => call.query.includes('INSERT INTO query_logs'))

    expect(queryLogInserts).toHaveLength(1)
    const blockedRow = queryLogInserts[0]
    expect(blockedRow?.values).toEqual(
      expect.arrayContaining([
        'mcp',
        'blocked',
        'local',
        JSON.stringify(['restricted_scope_violation']),
      ])
    )

    // token_id must match the violating token, not be null
    expect(blockedRow?.values[3]).toBe(tc13Mocks.actor?.mcpAuth.tokenId)
    // query_redacted_text must encode the attempted citation id
    expect(blockedRow?.values[5]).toBe(`getDocumentChunk:${RESTRICTED_CITATION_ID}`)
    // config_snapshot_version lines up with the active audit chain
    expect(blockedRow?.values[9]).toBe(tc13Mocks.runtimeConfig?.governance.configSnapshotVersion)
  })

  // `mcp-restricted-audit-trail` spec Scenario 2: audit write failure MUST
  // NOT mask the 403 refusal. Simulate a D1 transient error on the
  // `INSERT INTO query_logs` path and confirm:
  //   - the handler still throws 403
  //   - the response body contains no restricted content
  //   - the audit failure is surfaced via log.error (not silent)
  it('still returns 403 with no leakage when the audit INSERT fails', async () => {
    const logErrorSpy = vi.fn()
    const evlogModule = await import('evlog')
    vi.spyOn(evlogModule, 'useLogger').mockReturnValue({
      error: logErrorSpy,
      set: vi.fn(),
    } as unknown as ReturnType<typeof evlogModule.useLogger>)

    tc13Mocks.bindings = createTc13BindingsWithFailingAudit(
      tc13Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>
    )

    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')

    let thrown: unknown = null
    try {
      await runMcpTool(
        tool,
        { citationId: RESTRICTED_CITATION_ID },
        {
          authorizationHeader: tc13Mocks.actor?.mcpToken.authorizationHeader ?? '',
          cloudflareEnv: tc13Mocks.bindings ?? {},
          params: { citationId: RESTRICTED_CITATION_ID },
          pendingEvent,
        }
      )
    } catch (error) {
      thrown = error
    }

    // 403 must still surface even though the audit INSERT failed
    expect(thrown).toMatchObject({ statusCode: 403 })
    const errorMessage = (thrown as { message?: string }).message ?? ''
    expect(errorMessage).not.toContain(RESTRICTED_CHUNK_TEXT)
    expect(errorMessage).not.toContain(RESTRICTED_DOCUMENT_TITLE)
    expect(errorMessage).not.toContain(RESTRICTED_LOCATOR)

    // log.error must be called exactly once with the audit operation tag so
    // operators can detect the fail-open audit chain from logs
    expect(logErrorSpy).toHaveBeenCalledTimes(1)
    const [loggedError, loggedContext] = logErrorSpy.mock.calls[0] ?? []
    expect(loggedError).toBeInstanceOf(Error)
    expect(loggedContext).toMatchObject({
      operation: 'mcp-replay-blocked-log',
      tokenId: tc13Mocks.actor?.mcpAuth.tokenId,
      attemptedCitationId: RESTRICTED_CITATION_ID,
    })
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

// Variant that simulates a D1 transient error on the restricted audit INSERT
// so we can exercise `mcp-restricted-audit-trail` spec Scenario 2 (audit
// write failure does not mask the 403 response).
function createTc13BindingsWithFailingAudit(
  actor: ReturnType<typeof createAcceptanceActorFixture>
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
      {
        match: /INSERT INTO query_logs/,
        resolve: () => {
          throw new Error('D1 transient failure on query_logs INSERT')
        },
      },
    ],
  })
  const kv = createKvBindingFake()

  return createCloudflareBindingsFixture({
    d1,
    kv,
  })
}
