import type { KnowledgeGovernanceConfig } from '#shared/schemas/knowledge-runtime'
import { answerKnowledgeQuery } from './knowledge-answering'
import {
  auditKnowledgeText,
  insertQueryLogRow,
  type CreateMessageInput,
  type CreateQueryLogInput,
} from './knowledge-audit'
import { getAllowedAccessLevels } from './knowledge-runtime'

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export interface McpAskAuthContext {
  scopes: string[]
  tokenId: string
}

export type McpAskResult =
  | {
      citations: []
      refused: true
    }
  | {
      answer: string
      citations: Array<{ citationId: string; documentVersionId: string; sourceChunkId: string }>
      refused: false
    }

interface McpAskDependencies {
  answer: (input: {
    evidence: Array<{
      accessLevel: string
      categorySlug: string
      chunkText: string
      citationLocator: string
      documentId: string
      documentTitle: string
      documentVersionId: string
      excerpt: string
      score: number
      sourceChunkId: string
      title: string
    }>
    modelRole: string
    query: string
    retrievalScore: number
  }) => Promise<string>
  auditStore?: {
    createMessage(input: CreateMessageInput): Promise<string>
    createQueryLog(input: CreateQueryLogInput): Promise<string>
  }
  citationStore: {
    persistCitations(input: {
      citations: Array<{
        chunkTextSnapshot: string
        citationLocator: string
        documentVersionId: string
        queryLogId: string
        sourceChunkId: string
      }>
      now?: Date
      retentionDays?: number
    }): Promise<Array<{ citationId: string; documentVersionId: string; sourceChunkId: string }>>
  }
  judge: (input: {
    evidence: Array<{
      accessLevel: string
      categorySlug: string
      chunkText: string
      citationLocator: string
      documentId: string
      documentTitle: string
      documentVersionId: string
      excerpt: string
      score: number
      sourceChunkId: string
      title: string
    }>
    query: string
    retrievalScore: number
  }) => Promise<{
    reformulatedQuery?: string
    shouldAnswer: boolean
  }>
  queryLogStore: {
    createAcceptedQueryLog(input: {
      allowedAccessLevels: string[]
      configSnapshotVersion: string
      environment: string
      now?: Date
      queryText: string
      status: string
      tokenId: string
      firstTokenLatencyMs?: number | null
      completionLatencyMs?: number | null
      retrievalScore?: number | null
      judgeScore?: number | null
      decisionPath?: string | null
      refusalReason?: string | null
    }): Promise<string>
  }
  retrieve: (input: { allowedAccessLevels: string[]; query: string }) => Promise<{
    evidence: Array<{
      accessLevel: string
      categorySlug: string
      chunkText: string
      citationLocator: string
      documentId: string
      documentTitle: string
      documentVersionId: string
      excerpt: string
      score: number
      sourceChunkId: string
      title: string
    }>
    normalizedQuery: string
  }>
}

export async function askKnowledge(
  input: {
    auth: McpAskAuthContext
    environment?: string
    governance: KnowledgeGovernanceConfig
    now?: Date
    query: string
    retentionDays?: number
  },
  options: McpAskDependencies
): Promise<McpAskResult> {
  const allowedAccessLevels = getAllowedAccessLevels({
    channel: 'mcp',
    isAuthenticated: true,
    tokenScopes: input.auth.scopes,
  })
  const audit = auditKnowledgeText(input.query)

  if (audit.shouldBlock) {
    if (options.auditStore) {
      const queryLogId = await options.auditStore.createQueryLog({
        allowedAccessLevels,
        channel: 'mcp',
        configSnapshotVersion: input.governance.configSnapshotVersion,
        environment: input.environment ?? 'local',
        mcpTokenId: input.auth.tokenId,
        queryText: input.query,
        status: 'blocked',
        userProfileId: null,
      })

      await options.auditStore.createMessage({
        channel: 'mcp',
        content: input.query,
        queryLogId,
        role: 'user',
        userProfileId: null,
      })
    }

    return {
      citations: [],
      refused: true,
    }
  }

  const queryLogId = options.auditStore
    ? await options.auditStore.createQueryLog({
        allowedAccessLevels,
        channel: 'mcp',
        configSnapshotVersion: input.governance.configSnapshotVersion,
        environment: input.environment ?? 'local',
        mcpTokenId: input.auth.tokenId,
        now: input.now,
        queryText: input.query,
        status: 'accepted',
        userProfileId: null,
      })
    : await options.queryLogStore.createAcceptedQueryLog({
        allowedAccessLevels,
        configSnapshotVersion: input.governance.configSnapshotVersion,
        environment: input.environment ?? 'local',
        now: input.now,
        queryText: input.query,
        status: 'accepted',
        tokenId: input.auth.tokenId,
      })

  if (options.auditStore) {
    await options.auditStore.createMessage({
      channel: 'mcp',
      content: input.query,
      now: input.now,
      queryLogId,
      role: 'user',
      userProfileId: null,
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
        return options.citationStore.persistCitations({
          citations: citations.map((citation) => ({ ...citation, queryLogId })),
          ...(input.now ? { now: input.now } : {}),
          ...(typeof input.retentionDays === 'number'
            ? { retentionDays: input.retentionDays }
            : {}),
        })
      },
      retrieve: options.retrieve,
    }
  )

  if (result.refused || result.answer === null) {
    return {
      citations: [],
      refused: true,
    }
  }

  if (options.auditStore) {
    await options.auditStore.createMessage({
      channel: 'mcp',
      content: result.answer,
      now: input.now,
      queryLogId,
      role: 'assistant',
      userProfileId: null,
    })
  }

  return {
    answer: result.answer,
    citations: result.citations,
    refused: false,
  }
}

export function createMcpQueryLogStore(database: D1DatabaseLike) {
  return {
    async createAcceptedQueryLog(input: {
      allowedAccessLevels: string[]
      configSnapshotVersion: string
      environment: string
      now?: Date
      queryText: string
      status: string
      tokenId: string
      firstTokenLatencyMs?: number | null
      completionLatencyMs?: number | null
      retrievalScore?: number | null
      judgeScore?: number | null
      decisionPath?: string | null
      refusalReason?: string | null
    }): Promise<string> {
      const queryLogId = crypto.randomUUID()
      const audit = auditKnowledgeText(input.queryText)
      const now = (input.now ?? new Date()).toISOString()

      // SECURITY: Re-run audit here even though callers typically pre-redact —
      // if a future caller forgets, raw credentials / PII would land in
      // `query_redacted_text` and leak via the admin log UI. Running it here
      // makes the redaction a structural guarantee of the store itself.
      await insertQueryLogRow(database, {
        id: queryLogId,
        channel: 'mcp',
        userProfileId: null,
        mcpTokenId: input.tokenId,
        environment: input.environment,
        queryRedactedText: audit.redactedText,
        riskFlags: audit.riskFlags,
        allowedAccessLevels: input.allowedAccessLevels,
        redactionApplied: audit.redactionApplied,
        configSnapshotVersion: input.configSnapshotVersion,
        status: input.status as CreateQueryLogInput['status'],
        createdAt: now,
        firstTokenLatencyMs: input.firstTokenLatencyMs,
        completionLatencyMs: input.completionLatencyMs,
        retrievalScore: input.retrievalScore,
        judgeScore: input.judgeScore,
        decisionPath: input.decisionPath,
        refusalReason: input.refusalReason,
      })

      return queryLogId
    },
  }
}
