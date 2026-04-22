import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { createMcpOauthGrantStore } from '#server/utils/mcp-oauth-grants'

import { runMcpTool } from './helpers/mcp-tool-runner'
import { installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const pendingEvent = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('nitropack/runtime', () => ({
  useEvent: () => pendingEvent.current,
}))

const oauthToolMocks = vi.hoisted(() => ({
  askKnowledge: vi.fn(),
  createCloudflareAiSearchClient: vi.fn().mockReturnValue({ search: vi.fn() }),
  createCitationStore: vi.fn().mockReturnValue({}),
  createKnowledgeAuditStore: vi.fn().mockReturnValue({}),
  createKnowledgeEvidenceStore: vi.fn().mockReturnValue({}),
  createMcpCategoryStore: vi.fn().mockReturnValue({}),
  createMcpQueryLogStore: vi.fn().mockReturnValue({}),
  getD1Database: vi.fn().mockResolvedValue({}),
  getGuestPolicy: vi.fn(),
  getKnowledgeRuntimeConfig: vi.fn(),
  listCategories: vi.fn(),
  retrieveVerifiedEvidence: vi.fn(),
}))

vi.mock('../../server/utils/ai-search', () => ({
  createCloudflareAiSearchClient: oauthToolMocks.createCloudflareAiSearchClient,
}))

vi.mock('../../server/utils/citation-store', () => ({
  createCitationStore: oauthToolMocks.createCitationStore,
}))

vi.mock('../../server/utils/cloudflare-bindings', () => ({
  getCloudflareEnv: (
    event: { context?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined,
  ) => event?.context?.cloudflare?.env ?? {},
  getRequiredKvBinding: (
    event: { context?: { cloudflare?: { env?: Record<string, unknown> } } },
    bindingName: string,
  ) => {
    const binding = event.context?.cloudflare?.env?.[bindingName]

    if (!binding) {
      throw new Error(`Missing binding: ${bindingName}`)
    }

    return binding
  },
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: oauthToolMocks.getD1Database,
}))

vi.mock('../../server/utils/guest-policy', () => ({
  getGuestPolicy: oauthToolMocks.getGuestPolicy,
}))

vi.mock('../../server/utils/knowledge-audit', () => ({
  createKnowledgeAuditStore: oauthToolMocks.createKnowledgeAuditStore,
}))

vi.mock('../../server/utils/knowledge-evidence-store', () => ({
  createKnowledgeEvidenceStore: oauthToolMocks.createKnowledgeEvidenceStore,
}))

vi.mock('../../server/utils/knowledge-retrieval', () => ({
  retrieveVerifiedEvidence: oauthToolMocks.retrieveVerifiedEvidence,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: oauthToolMocks.getKnowledgeRuntimeConfig,
  }
})

vi.mock('../../server/utils/mcp-ask', () => ({
  askKnowledge: oauthToolMocks.askKnowledge,
  createMcpQueryLogStore: oauthToolMocks.createMcpQueryLogStore,
}))

vi.mock('../../server/utils/mcp-categories', () => ({
  createMcpCategoryStore: oauthToolMocks.createMcpCategoryStore,
  listCategories: oauthToolMocks.listCategories,
}))

installNuxtRouteTestGlobals()

describe('oauth mcp tool access integration', () => {
  beforeEach(() => {
    vi.resetModules()

    oauthToolMocks.askKnowledge.mockReset()
    oauthToolMocks.getGuestPolicy.mockReset()
    oauthToolMocks.listCategories.mockReset()
    oauthToolMocks.retrieveVerifiedEvidence.mockReset()

    oauthToolMocks.getKnowledgeRuntimeConfig.mockReturnValue(
      createKnowledgeRuntimeConfig({
        bindings: {
          aiSearchIndex: 'knowledge-index',
          d1Database: 'DB',
          documentsBucket: 'BLOB',
          rateLimitKv: 'KV',
        },
        environment: 'local',
      }),
    )

    oauthToolMocks.askKnowledge.mockResolvedValue({
      answer: '查詢結果',
      citations: [],
      refused: false,
    })
    oauthToolMocks.listCategories.mockResolvedValue([{ count: 2, slug: 'policy', title: 'Policy' }])
  })

  it('lets browse_only oauth guests use browse-safe tools through the real middleware path', async () => {
    const oauth = await issueOauthAccessToken({
      scopes: ['knowledge.category.list'],
      userId: 'guest-1',
    })

    oauthToolMocks.getGuestPolicy.mockResolvedValue('browse_only')

    const { default: tool } = await import('#server/mcp/tools/categories')
    const result = await runMcpTool(
      tool,
      { includeCounts: true },
      {
        authorizationHeader: `Bearer ${oauth.accessToken}`,
        cloudflareEnv: createOauthEnv(oauth.kv),
        pendingEvent,
        tokenStore: createUnusedLegacyTokenStore(),
        userRoleLookup: {
          async lookupRoleByUserId(userId: string) {
            return userId === 'guest-1' ? 'guest' : null
          },
        },
      },
    )

    expect(result).toEqual([{ count: 2, slug: 'policy', title: 'Policy' }])
    expect(oauthToolMocks.listCategories).toHaveBeenCalledTimes(1)
  })

  it('blocks browse_only oauth guests from askKnowledge before the tool executes', async () => {
    const oauth = await issueOauthAccessToken({
      scopes: ['knowledge.ask'],
      userId: 'guest-1',
    })

    oauthToolMocks.getGuestPolicy.mockResolvedValue('browse_only')

    const { default: tool } = await import('#server/mcp/tools/ask')

    await expect(
      runMcpTool(
        tool,
        { query: '可以幫我整理嗎？' },
        {
          authorizationHeader: `Bearer ${oauth.accessToken}`,
          cloudflareEnv: createOauthEnv(oauth.kv),
          pendingEvent,
          tokenStore: createUnusedLegacyTokenStore(),
          userRoleLookup: {
            async lookupRoleByUserId(userId: string) {
              return userId === 'guest-1' ? 'guest' : null
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      message: '訪客僅可瀏覽公開文件，無法提問',
      statusCode: 403,
    })

    expect(oauthToolMocks.askKnowledge).not.toHaveBeenCalled()
  })

  it('blocks all oauth guest access under no_access policy before browse tools execute', async () => {
    const oauth = await issueOauthAccessToken({
      scopes: ['knowledge.category.list'],
      userId: 'guest-1',
    })

    oauthToolMocks.getGuestPolicy.mockResolvedValue('no_access')

    const { default: tool } = await import('#server/mcp/tools/categories')

    await expect(
      runMcpTool(
        tool,
        { includeCounts: true },
        {
          authorizationHeader: `Bearer ${oauth.accessToken}`,
          cloudflareEnv: createOauthEnv(oauth.kv),
          pendingEvent,
          tokenStore: createUnusedLegacyTokenStore(),
          userRoleLookup: {
            async lookupRoleByUserId(userId: string) {
              return userId === 'guest-1' ? 'guest' : null
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      message: '帳號待管理員審核',
      statusCode: 403,
    })

    expect(oauthToolMocks.listCategories).not.toHaveBeenCalled()
  })
})

async function issueOauthAccessToken(input: { scopes: string[]; userId: string }): Promise<{
  accessToken: string
  kv: ReturnType<typeof createOauthKv>
}> {
  const kv = createOauthKv()
  const grants = createMcpOauthGrantStore({
    accessTokenTtlSeconds: 600,
    authorizationCodeTtlSeconds: 120,
    kv,
  })

  const code = await grants.issueAuthorizationCode({
    clientId: 'claude-remote',
    redirectUri: 'https://claude.example/callback',
    scopes: input.scopes,
    userId: input.userId,
  })
  const token = await grants.exchangeAuthorizationCode({
    clientId: 'claude-remote',
    code,
    redirectUri: 'https://claude.example/callback',
  })

  return {
    accessToken: token.accessToken,
    kv,
  }
}

function createOauthEnv(kv: ReturnType<typeof createOauthKv>) {
  return {
    AI: {
      autorag: vi.fn(),
    },
    KV: kv,
  }
}

function createOauthKv() {
  const store = new Map<string, string>()

  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
  }
}

function createUnusedLegacyTokenStore() {
  return {
    findUsableTokenByHash: vi.fn().mockResolvedValue(null),
    touchLastUsedAt: vi.fn(),
  }
}
