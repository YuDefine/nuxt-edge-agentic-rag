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

interface Tc01TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  readZodBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

interface AcceptanceCaseScenario {
  answerFragments: string[]
  categorySlug: string
  chunkText: string
  citationLocator: string
  documentId: string
  documentTitle: string
  documentVersionId: string
  registryId: 'TC-01' | 'TC-02' | 'TC-03'
  sourceChunkId: string
  title: string
}

const tc01Mocks = vi.hoisted(
  (): Tc01TestState => ({
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
  getCloudflareEnv: () => tc01Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc01Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc01Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc01Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc01Mocks.actor?.isAdmin ?? false,
  }
})

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: (...args: unknown[]) => tc01Mocks.readZodBody(...args),
}))

// hub:db 在測試環境中無法 resolve，改成回傳 fake D1 binding
vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc01Mocks.bindings ?? {}).DB,
}))

installNuxtRouteTestGlobals()

describe('acceptance direct-answer automation', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter((entry) =>
    ['TC-01', 'TC-02', 'TC-03'].includes(entry.registryId)
  )

  beforeEach(() => {
    tc01Mocks.actor = createAcceptanceActorFixture('user')
    tc01Mocks.bindings = null
    tc01Mocks.readBody.mockReset()
    tc01Mocks.readZodBody.mockReset()
    tc01Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc01Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc01Mocks.actor?.webSession))
  })

  it.each(cases)('answers %s directly with a persisted citation', async (fixture) => {
    const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
      expectedHttpStatus: string
      id: string
      primaryOutcome: string
    } | null
    const scenario = getScenarioForCase(fixture.registryId as AcceptanceCaseScenario['registryId'])

    tc01Mocks.bindings = createTc01Bindings(
      tc01Mocks.actor as ReturnType<typeof createAcceptanceActorFixture>,
      scenario
    )
    tc01Mocks.readBody.mockResolvedValue({ query: fixture.prompt })
    tc01Mocks.readZodBody.mockResolvedValue({ query: fixture.prompt })

    const result =
      fixture.channel === 'web'
        ? await runWebCase()
        : await runMcpCase(tc01Mocks.actor?.mcpToken.authorizationHeader ?? '')

    const d1 = (tc01Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>
    const aiBinding = (tc01Mocks.bindings ?? {}).AI as ReturnType<typeof createAiSearchBindingFake>

    expect(registryEntry).toMatchObject({
      expectedHttpStatus: '200',
      id: fixture.registryId,
      primaryOutcome: 'direct',
    })
    expect(fixture.expectedOutcome).toBe('direct')
    expect(aiBinding.calls).toHaveLength(1)
    expect(aiBinding.calls[0]).toMatchObject({
      indexName: 'knowledge-index',
      request: {
        query: fixture.prompt,
      },
    })
    expect(result).toEqual({
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
      expect(result.data.answer).toContain(fragment)
    }

    const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))
    const citationInsert = d1.calls.find((call) =>
      call.query.includes('INSERT INTO citation_records')
    )

    expect(queryLogInsert?.values).toEqual(
      expect.arrayContaining([
        'local',
        tc01Mocks.runtimeConfig?.governance.configSnapshotVersion,
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

    if (fixture.channel === 'mcp') {
      expect(d1.calls.some((call) => call.query.includes('FROM mcp_tokens'))).toBe(true)
      expect(d1.calls.some((call) => call.query.includes('UPDATE mcp_tokens'))).toBe(true)
    }
  })
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

function createTc01Bindings(
  actor: ReturnType<typeof createAcceptanceActorFixture>,
  scenario: AcceptanceCaseScenario
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
          filename: `${scenario.registryId.toLowerCase()}.md`,
          score: 0.91,
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

function getScenarioForCase(
  registryId: AcceptanceCaseScenario['registryId']
): AcceptanceCaseScenario {
  switch (registryId) {
    case 'TC-01':
      return {
        answerFragments: ['PO', 'PR'],
        categorySlug: 'procurement',
        chunkText: 'PR 是請購需求，PO 是核准後建立的採購訂單。',
        citationLocator: 'lines 3-5',
        documentId: 'doc-procurement',
        documentTitle: '採購流程 current',
        documentVersionId: 'ver-procurement-current',
        registryId,
        sourceChunkId: 'chunk-procurement-1',
        title: '採購流程 current',
      }
    case 'TC-02':
      return {
        answerFragments: ['通知採購', '補貨'],
        categorySlug: 'inventory',
        chunkText: '庫存不足時應先通知採購並確認補貨責任人，再依 SOP 申請補貨。',
        citationLocator: 'lines 8-11',
        documentId: 'doc-inventory-sop',
        documentTitle: '庫存不足 SOP current',
        documentVersionId: 'ver-inventory-current',
        registryId,
        sourceChunkId: 'chunk-inventory-1',
        title: '庫存不足 SOP current',
      }
    case 'TC-03':
      return {
        answerFragments: ['未結案金額', '尚未結案'],
        categorySlug: 'reporting',
        chunkText: '未結案金額代表月結報表中尚未結案案件的累計金額。',
        citationLocator: 'lines 2-4',
        documentId: 'doc-reporting-fields',
        documentTitle: '報表欄位說明 current',
        documentVersionId: 'ver-reporting-current',
        registryId,
        sourceChunkId: 'chunk-reporting-1',
        title: '報表欄位說明 current',
      }
    default:
      throw new Error(`Unsupported acceptance registry id: ${registryId}`)
  }
}
