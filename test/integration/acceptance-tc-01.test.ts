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

installNuxtRouteTestGlobals()

describe('TC-01 acceptance automation', () => {
  const registryEntry = getAcceptanceRegistryEntry('TC-01')
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-01'
  )

  beforeEach(() => {
    tc01Mocks.actor = createAcceptanceActorFixture('user')
    tc01Mocks.bindings = createTc01Bindings(tc01Mocks.actor)
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
      id: 'TC-01',
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
        answer: expect.stringContaining('PO'),
        citations: [
          {
            citationId: expect.any(String),
            sourceChunkId: 'chunk-procurement-1',
          },
        ],
        refused: false,
      },
    })

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
        'ver-procurement-current',
        'chunk-procurement-1',
        'lines 3-5',
        'PR 是請購需求，PO 是核准後建立的採購訂單。',
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

function createTc01Bindings(actor: ReturnType<typeof createAcceptanceActorFixture>) {
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
            category_slug: 'procurement',
            chunk_text: 'PR 是請購需求，PO 是核准後建立的採購訂單。',
            citation_locator: 'lines 3-5',
            document_id: 'doc-procurement',
            document_title: '採購流程 current',
            document_version_id: 'ver-procurement-current',
            source_chunk_id: 'chunk-procurement-1',
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
              citation_locator: 'lines 3-5',
              document_version_id: 'ver-procurement-current',
              title: '採購流程 current',
            },
          },
          content: [
            {
              text: 'PR 是請購需求，PO 是核准後建立的採購訂單。',
              type: 'text',
            },
          ],
          filename: 'procurement-flow-current.md',
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
