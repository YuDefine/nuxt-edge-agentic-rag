import { describe, expect, it } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { createCloudflareAiSearchClient } from '#server/utils/ai-search'
import { hashMcpToken } from '#server/utils/mcp-auth'
import { createMcpTokenStore } from '#server/utils/mcp-token-store'
import { createChatKvRateLimitStore } from '#server/utils/web-chat'

interface BindingsModule {
  createAiSearchBindingFake(input?: Record<string, unknown>): {
    calls: Array<Record<string, unknown>>
  }
  createCloudflareBindingsFixture(input?: Record<string, unknown>): Record<string, unknown>
  createD1BindingFake(input?: Record<string, unknown>): {
    calls: Array<Record<string, unknown>>
  }
  createKvBindingFake(input?: Record<string, unknown>): Record<string, unknown>
  createR2BucketBindingFake(input?: Record<string, unknown>): Record<string, unknown>
  createWorkersAiBindingFake(input?: Record<string, unknown>): {
    calls: Array<Record<string, unknown>>
    run(model: string, payload: Record<string, unknown>): Promise<unknown>
  }
}

async function importBindingsModule(): Promise<BindingsModule | null> {
  try {
    return (await import('../acceptance/helpers/bindings')) as BindingsModule
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/i.test(error.message)) {
      return null
    }

    throw error
  }
}

describe('acceptance bindings fakes', () => {
  it('drive real orchestration helpers through D1, KV, R2, AI Search, and Workers AI fakes', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const module = await importBindingsModule()

    expect(module).not.toBeNull()

    const tokenHash = hashMcpToken('secret-token')
    const d1 = module?.createD1BindingFake({
      responders: [
        {
          match: /FROM mcp_tokens/,
          resolve: ({ values }: { values: unknown[] }) => ({
            first:
              values[0] === tokenHash && values[1] === 'local'
                ? {
                    created_at: '2026-04-16T00:00:00.000Z',
                    environment: 'local',
                    expires_at: null,
                    id: 'token-1',
                    last_used_at: null,
                    name: 'Local CLI',
                    revoked_at: null,
                    revoked_reason: null,
                    scopes_json: JSON.stringify(['knowledge.ask', 'knowledge.search']),
                    status: 'active',
                    token_hash: tokenHash,
                  }
                : null,
          }),
        },
        {
          match: /UPDATE mcp_tokens/,
          resolve: () => ({ run: { success: true } }),
        },
      ],
    })
    const tokenStore = createMcpTokenStore(d1 as never)

    await expect(tokenStore.findUsableTokenByHash(tokenHash, 'local')).resolves.toMatchObject({
      environment: 'local',
      id: 'token-1',
      scopesJson: JSON.stringify(['knowledge.ask', 'knowledge.search']),
    })

    await tokenStore.touchLastUsedAt('token-1', '2026-04-16T00:10:00.000Z')
    expect(d1?.calls).toHaveLength(2)

    const kv = module?.createKvBindingFake()
    const rateLimitStore = createChatKvRateLimitStore(kv as never)

    await rateLimitStore.set('chat:window', { count: 2, windowStart: 5 })
    await expect(rateLimitStore.get('chat:window')).resolves.toEqual({ count: 2, windowStart: 5 })

    const r2 = module?.createR2BucketBindingFake({
      objects: [
        {
          body: 'Launch moved to Tuesday.',
          key: 'chunks/chunk-1.txt',
        },
      ],
    })

    await expect(
      (
        await (r2 as { get(key: string): Promise<{ text(): Promise<string> }> }).get(
          'chunks/chunk-1.txt'
        )
      ).text()
    ).resolves.toBe('Launch moved to Tuesday.')

    const aiBinding = module?.createAiSearchBindingFake({
      responses: {
        'knowledge-index': [
          {
            attributes: {
              file: {
                access_level: 'internal',
                citation_locator: 'lines 1-2',
                document_version_id: 'ver-1',
                title: 'Launch Guide',
              },
            },
            content: [{ text: 'Launch moved to Tuesday.', type: 'text' }],
            filename: 'launch-guide.md',
            score: 0.88,
          },
        ],
      },
    })
    const aiSearchClient = createCloudflareAiSearchClient({
      aiBinding: aiBinding as never,
      indexName: 'knowledge-index',
    })

    await expect(
      aiSearchClient.search({
        filters: { access_level: { $in: ['internal'] } },
        max_num_results: 5,
        query: 'What changed?',
        ranking_options: {
          score_threshold: governance.retrieval.minScore,
        },
        rewrite_query: false,
      })
    ).resolves.toEqual([
      {
        accessLevel: 'internal',
        citationLocator: 'lines 1-2',
        documentVersionId: 'ver-1',
        excerpt: 'Launch moved to Tuesday.',
        score: 0.88,
      },
    ])

    const workersAi = module?.createWorkersAiBindingFake({
      responses: {
        '@cf/meta/llama-3.1-8b-instruct': {
          response: 'ok',
        },
      },
    })

    await expect(
      workersAi?.run('@cf/meta/llama-3.1-8b-instruct', {
        prompt: 'hello',
      })
    ).resolves.toEqual({ response: 'ok' })

    expect(
      module?.createCloudflareBindingsFixture({
        ai: aiBinding,
        d1,
        kv,
        r2,
        workersAi,
      })
    ).toMatchObject({
      AI: aiBinding,
      DB: d1,
      DOCUMENTS: r2,
      KV: kv,
      WORKERS_AI: workersAi,
    })
  })
})
