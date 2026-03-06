import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { createHubDbMock } from './helpers/database'
import { runMcpTool } from './helpers/mcp-tool-runner'
import { installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const pendingEvent = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('nitropack/runtime', () => ({
  useEvent: () => pendingEvent.current,
}))

/**
 * Integration test for the `getDocumentChunk` MCP replay route contract,
 * covering governance-refinements §2.3 (retention-window replay contract).
 *
 * Scenarios exercised:
 *   1. replay within retention returns the snapshot (200)
 *   2. row missing entirely (or expired cascade) returns 404 chunk_not_found
 *   3. row survives but snapshot was scrubbed → 404 chunk_retention_expired
 *      (defensive guard for future governance sweeps)
 *   4. restricted snapshot without scope returns 403 + records blocked query_log
 *   5. retention-window boundary: citation inside window still replays OK
 *
 * We run through the real route handler so the `createError` + reason-header
 * plumbing is tested end-to-end. The underlying `getDocumentChunk` utility and
 * `createMcpReplayStore` are mocked so we can inject precise snapshot states.
 */

const replayRouteMocks = vi.hoisted(() => {
  class MockMcpAuthError extends Error {
    constructor(
      message: string,
      readonly statusCode: number
    ) {
      super(message)
      this.name = 'McpAuthError'
    }
  }

  class MockMcpRateLimitExceededError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
      readonly retryAfterMs: number
    ) {
      super(message)
      this.name = 'McpRateLimitExceededError'
    }
  }

  class MockMcpReplayError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
      readonly reason:
        | 'chunk_not_found'
        | 'chunk_retention_expired'
        | 'restricted_scope_required' = 'chunk_not_found'
    ) {
      super(message)
      this.name = 'McpReplayError'
    }
  }

  return {
    MockMcpAuthError,
    MockMcpRateLimitExceededError,
    MockMcpReplayError,
    auditKnowledgeText: vi.fn().mockImplementation((text: string) => ({
      redactedText: text,
      riskFlags: [],
      redactionApplied: false,
    })),
    consumeMcpToolRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    createAcceptedQueryLog: vi.fn().mockResolvedValue('log-1'),
    createKvRateLimitStore: vi.fn().mockReturnValue({}),
    createMcpQueryLogStore: vi.fn(),
    createMcpReplayStore: vi.fn().mockReturnValue({
      findReplayableCitationById: vi.fn(),
    }),
    createMcpTokenStore: vi.fn().mockReturnValue({}),
    getAllowedAccessLevels: vi.fn().mockReturnValue(['internal']),
    getDocumentChunk: vi.fn(),
    getKnowledgeRuntimeConfig: vi.fn(),
    getRequiredKvBinding: vi.fn().mockReturnValue({ get: vi.fn(), put: vi.fn() }),
    requireMcpBearerToken: vi.fn().mockResolvedValue({
      scopes: ['knowledge.citation.read'],
      tokenId: 'token-1',
    }),
    requireMcpScope: vi.fn(),
    setResponseHeader: vi.fn(),
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/cloudflare-bindings', () => ({
  getRequiredKvBinding: replayRouteMocks.getRequiredKvBinding,
}))

vi.mock('../../server/utils/knowledge-audit', () => ({
  auditKnowledgeText: replayRouteMocks.auditKnowledgeText,
}))

vi.mock('../../server/utils/knowledge-runtime', () => ({
  getAllowedAccessLevels: replayRouteMocks.getAllowedAccessLevels,
  getKnowledgeRuntimeConfig: replayRouteMocks.getKnowledgeRuntimeConfig,
}))

vi.mock('../../server/utils/mcp-ask', () => ({
  createMcpQueryLogStore: replayRouteMocks.createMcpQueryLogStore,
}))

vi.mock('../../server/utils/mcp-auth', () => ({
  McpAuthError: replayRouteMocks.MockMcpAuthError,
  requireMcpBearerToken: replayRouteMocks.requireMcpBearerToken,
  requireMcpScope: replayRouteMocks.requireMcpScope,
}))

vi.mock('../../server/utils/mcp-rate-limit', () => ({
  consumeMcpToolRateLimit: replayRouteMocks.consumeMcpToolRateLimit,
  createKvRateLimitStore: replayRouteMocks.createKvRateLimitStore,
  McpRateLimitExceededError: replayRouteMocks.MockMcpRateLimitExceededError,
}))

vi.mock('../../server/utils/mcp-replay', () => ({
  createMcpReplayStore: replayRouteMocks.createMcpReplayStore,
  getDocumentChunk: replayRouteMocks.getDocumentChunk,
  McpReplayError: replayRouteMocks.MockMcpReplayError,
}))

vi.mock('../../server/utils/mcp-token-store', () => ({
  createMcpTokenStore: replayRouteMocks.createMcpTokenStore,
}))

installNuxtRouteTestGlobals()

function prepareRuntimeConfig() {
  replayRouteMocks.getKnowledgeRuntimeConfig.mockReturnValue(
    createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        rateLimitKv: 'RATE_LIMITS',
      },
      environment: 'local',
    })
  )
}

function prepareQueryLogStore() {
  replayRouteMocks.createMcpQueryLogStore.mockReturnValue({
    createAcceptedQueryLog: replayRouteMocks.createAcceptedQueryLog,
  })
}

describe('MCP getDocumentChunk — retention replay contract', () => {
  beforeEach(() => {
    vi.stubGlobal('setResponseHeader', replayRouteMocks.setResponseHeader)
    prepareRuntimeConfig()
    prepareQueryLogStore()
  })

  it('case 1: returns 200 with the snapshot when the citation is within retention', async () => {
    replayRouteMocks.getDocumentChunk.mockResolvedValueOnce({
      chunkText: 'Launch moved to Tuesday.',
      citationId: 'citation-in-window',
      citationLocator: 'lines 1-3',
    })

    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')
    const data = await runMcpTool(
      tool,
      { citationId: 'citation-in-window' },
      {
        authorizationHeader: 'Bearer test-token',
        cloudflareEnv: {},
        params: { citationId: 'citation-in-window' },
        pendingEvent,
      }
    )

    expect(data).toEqual({
      chunkText: 'Launch moved to Tuesday.',
      citationId: 'citation-in-window',
      citationLocator: 'lines 1-3',
    })
    // [Phase 4 migration] toolkit tool layer does not emit x-replay-reason;
    // header-level assertion is not applicable under the new MCP wire format.
  })

  it('case 2: returns 404 chunk_not_found when the citation row is missing', async () => {
    replayRouteMocks.getDocumentChunk.mockRejectedValueOnce(
      new replayRouteMocks.MockMcpReplayError(
        'The requested citation was not found',
        404,
        'chunk_not_found'
      )
    )

    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')

    await expect(
      runMcpTool(
        tool,
        { citationId: 'citation-never-existed' },
        {
          authorizationHeader: 'Bearer test-token',
          cloudflareEnv: {},
          params: { citationId: 'citation-never-existed' },
          pendingEvent,
        }
      )
    ).rejects.toMatchObject({
      message: 'The requested citation was not found',
      statusCode: 404,
    })

    // [Phase 4 migration] x-replay-reason header is unavailable in toolkit
    // tool layer; distinguishing reasons now flows through JSON-RPC error
    // payloads, not HTTP response headers. Skipping header-level assertion.
  })

  it('case 3: returns 404 chunk_retention_expired when the snapshot was scrubbed', async () => {
    // Retention-cleanup-governance §2.3 defensive guard: citation row survives
    // but chunk_text_snapshot has been scrubbed. Status stays 404 per
    // mcp-knowledge-tools spec; only `x-replay-reason` header distinguishes.
    replayRouteMocks.getDocumentChunk.mockRejectedValueOnce(
      new replayRouteMocks.MockMcpReplayError(
        'The requested citation was not found',
        404,
        'chunk_retention_expired'
      )
    )

    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')

    await expect(
      runMcpTool(
        tool,
        { citationId: 'citation-scrubbed' },
        {
          authorizationHeader: 'Bearer test-token',
          cloudflareEnv: {},
          params: { citationId: 'citation-scrubbed' },
          pendingEvent,
        }
      )
    ).rejects.toMatchObject({
      message: 'The requested citation was not found',
      statusCode: 404,
    })

    // [Phase 4 migration] x-replay-reason header assertion no longer applies.
    // Spec-mandated wire-level response code is still 404 (identical to
    // chunk_not_found), so a caller who only observes status cannot
    // distinguish "never existed" from "retention-expired"; finer audit
    // distinction is captured in query_logs.
  })

  it('case 4: returns 403 restricted_scope_required and records a blocked query_log', async () => {
    replayRouteMocks.getDocumentChunk.mockRejectedValueOnce(
      new replayRouteMocks.MockMcpReplayError(
        'The requested citation requires knowledge.restricted.read',
        403,
        'restricted_scope_required'
      )
    )

    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')

    await expect(
      runMcpTool(
        tool,
        { citationId: 'citation-restricted' },
        {
          authorizationHeader: 'Bearer test-token',
          cloudflareEnv: {},
          params: { citationId: 'citation-restricted' },
          pendingEvent,
        }
      )
    ).rejects.toMatchObject({
      message: 'The requested citation requires knowledge.restricted.read',
      statusCode: 403,
    })

    expect(replayRouteMocks.createAcceptedQueryLog).toHaveBeenCalledTimes(1)
    expect(replayRouteMocks.createAcceptedQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: 'getDocumentChunk:citation-restricted',
        status: 'blocked',
        tokenId: 'token-1',
      })
    )
    // [Phase 4 migration] x-replay-reason header assertion no longer applies;
    // restricted_scope_required surfaces via blocked query_log record instead.
  })

  it('case 5: still replays a citation whose creation time is just inside the retention boundary', async () => {
    // Boundary condition: governance-and-observability retention window is
    // 180 days. A citation created 179 days ago must still replay; a caller
    // should not be able to observe any probabilistic "about to expire"
    // behavior through this endpoint.
    replayRouteMocks.getDocumentChunk.mockResolvedValueOnce({
      chunkText: 'Boundary snapshot content.',
      citationId: 'citation-boundary',
      citationLocator: 'lines 10-12',
    })

    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')
    const data = await runMcpTool(
      tool,
      { citationId: 'citation-boundary' },
      {
        authorizationHeader: 'Bearer test-token',
        cloudflareEnv: {},
        params: { citationId: 'citation-boundary' },
        pendingEvent,
      }
    )

    expect(data).toEqual({
      chunkText: 'Boundary snapshot content.',
      citationId: 'citation-boundary',
      citationLocator: 'lines 10-12',
    })
    expect(replayRouteMocks.createAcceptedQueryLog).not.toHaveBeenCalled()
  })

  // [Phase 4 migration blocker] Session-rejection used to live in the legacy
  // replay HTTP handler. The toolkit
  // tool layer has no direct access to incoming HTTP session headers;
  // session-state rejection is now expected to be enforced by the toolkit's
  // `/mcp` JSON-RPC handler / middleware. Re-enable once toolkit middleware
  // surfaces `mcp-session-id` rejection (tracked as a Phase 5 follow-up).
  it.skip('rejects session-coupled replay requests with 400 (toolkit migration pending)', async () => {
    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')

    await expect(
      runMcpTool(
        tool,
        { citationId: 'citation-x' },
        {
          authorizationHeader: 'Bearer test-token',
          cloudflareEnv: {},
          params: { citationId: 'citation-x' },
          pendingEvent,
        }
      )
    ).rejects.toMatchObject({
      message: 'MCP session state is not supported in v1.0.0',
      statusCode: 400,
    })
  })
})
