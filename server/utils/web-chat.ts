import type { KnowledgeGovernanceConfig } from '../../shared/schemas/knowledge-runtime'
import { answerKnowledgeQuery } from './knowledge-answering'
import { auditKnowledgeText } from './knowledge-audit'
import { getAllowedAccessLevels } from './knowledge-runtime'
import type { VerifiedKnowledgeEvidence } from './knowledge-retrieval'
import {
  consumeFixedWindowRateLimit,
  FIXED_WINDOW_RATE_LIMIT_PRESETS,
  type FixedWindowRateLimitStore,
} from './rate-limiter'

export class ChatRateLimitExceededError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterMs: number
  ) {
    super(message)
    this.name = 'ChatRateLimitExceededError'
  }
}

interface WebCitationPersistenceInput {
  citations: Array<{
    chunkTextSnapshot: string
    citationLocator: string
    documentVersionId: string
    queryLogId: string
    sourceChunkId: string
  }>
  now?: Date
}

interface KvLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export function createChatKvRateLimitStore(kv: KvLike): FixedWindowRateLimitStore {
  return {
    async get(key) {
      const value = await kv.get(key)

      if (!value) {
        return null
      }

      return JSON.parse(value) as { count: number; windowStart: number }
    },
    async set(key, value) {
      await kv.put(key, JSON.stringify(value), {
        expirationTtl: Math.ceil(FIXED_WINDOW_RATE_LIMIT_PRESETS.chat.windowMs / 1000),
      })
    },
  }
}

export async function chatWithKnowledge(
  input: {
    auth: {
      isAdmin: boolean
      userId: string
    }
    governance: KnowledgeGovernanceConfig
    environment: string
    now?: number
    query: string
  },
  options: {
    answer: (input: {
      evidence: VerifiedKnowledgeEvidence[]
      modelRole: string
      query: string
      retrievalScore: number
    }) => Promise<string>
    auditStore?: {
      createMessage(input: {
        channel: 'mcp' | 'web'
        content: string
        now?: Date
        queryLogId?: string
        role: 'system' | 'user' | 'assistant' | 'tool'
        userProfileId?: string | null
      }): Promise<string>
      createQueryLog(input: {
        allowedAccessLevels: string[]
        channel: 'mcp' | 'web'
        configSnapshotVersion: string
        environment: string
        mcpTokenId?: string | null
        now?: Date
        queryText: string
        status: 'accepted' | 'blocked' | 'limited' | 'rejected'
        userProfileId?: string | null
      }): Promise<string>
    }
    judge: (input: {
      evidence: VerifiedKnowledgeEvidence[]
      query: string
      retrievalScore: number
    }) => Promise<{
      reformulatedQuery?: string
      shouldAnswer: boolean
    }>
    persistCitations?: (
      input: WebCitationPersistenceInput
    ) => Promise<Array<{ citationId: string; sourceChunkId: string }>>
    rateLimitStore: FixedWindowRateLimitStore
    retrieve: (input: { allowedAccessLevels: string[]; query: string }) => Promise<{
      evidence: VerifiedKnowledgeEvidence[]
      normalizedQuery: string
    }>
  }
): Promise<{
  answer: string | null
  citations: Array<{ citationId: string; sourceChunkId: string }>
  refused: boolean
  retrievalScore: number
}> {
  const rateLimit = await consumeFixedWindowRateLimit({
    key: `web:${input.environment}:chat:${input.auth.userId}`,
    now: input.now,
    preset: FIXED_WINDOW_RATE_LIMIT_PRESETS.chat,
    store: options.rateLimitStore,
  })

  if (!rateLimit.allowed) {
    throw new ChatRateLimitExceededError(
      'Rate limit exceeded for /api/chat',
      429,
      rateLimit.retryAfterMs
    )
  }

  const allowedAccessLevels = getAllowedAccessLevels({
    channel: 'web',
    isAdmin: input.auth.isAdmin,
    isAuthenticated: true,
  })
  const audit = auditKnowledgeText(input.query)

  if (audit.shouldBlock) {
    if (options.auditStore) {
      const queryLogId = await options.auditStore.createQueryLog({
        allowedAccessLevels,
        channel: 'web',
        configSnapshotVersion: input.governance.configSnapshotVersion,
        environment: input.environment,
        queryText: input.query,
        status: 'blocked',
        userProfileId: input.auth.userId,
      })

      await options.auditStore.createMessage({
        channel: 'web',
        content: input.query,
        queryLogId,
        role: 'user',
        userProfileId: input.auth.userId,
      })
    }

    return {
      answer: null,
      citations: [],
      refused: true,
      retrievalScore: 0,
    }
  }

  const queryLogId = options.auditStore
    ? await options.auditStore.createQueryLog({
        allowedAccessLevels,
        channel: 'web',
        configSnapshotVersion: input.governance.configSnapshotVersion,
        environment: input.environment,
        now: typeof input.now === 'number' ? new Date(input.now) : undefined,
        queryText: input.query,
        status: 'accepted',
        userProfileId: input.auth.userId,
      })
    : null

  if (options.auditStore) {
    await options.auditStore.createMessage({
      channel: 'web',
      content: input.query,
      now: typeof input.now === 'number' ? new Date(input.now) : undefined,
      queryLogId: queryLogId ?? undefined,
      role: 'user',
      userProfileId: input.auth.userId,
    })
  }

  const result = await answerKnowledgeQuery(
    {
      allowedAccessLevels,
      query: input.query,
    },
    {
      answer: options.answer,
      governance: {
        models: input.governance.models,
        thresholds: input.governance.thresholds,
      },
      judge: options.judge,
      persistCitations: async (citations) => {
        if (!options.persistCitations || !queryLogId) {
          return []
        }

        const payload: WebCitationPersistenceInput = {
          citations: citations.map((citation) => ({
            ...citation,
            queryLogId,
          })),
        }

        if (typeof input.now === 'number') {
          payload.now = new Date(input.now)
        }

        return options.persistCitations(payload)
      },
      retrieve: options.retrieve,
    }
  )

  if (!result.refused && result.answer !== null && options.auditStore) {
    await options.auditStore.createMessage({
      channel: 'web',
      content: result.answer,
      now: typeof input.now === 'number' ? new Date(input.now) : undefined,
      queryLogId: queryLogId ?? undefined,
      role: 'assistant',
      userProfileId: input.auth.userId,
    })
  }

  return result
}
