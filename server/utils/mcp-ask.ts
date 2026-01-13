import { answerKnowledgeQuery } from './knowledge-answering'
import { auditKnowledgeText } from './knowledge-audit'
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
      citations: Array<{ citationId: string; sourceChunkId: string }>
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
      configSnapshotVersion?: string
      environment: string
      mcpTokenId?: string | null
      now?: Date
      queryText: string
      status: 'accepted' | 'blocked' | 'limited' | 'rejected'
      userProfileId?: string | null
    }): Promise<string>
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
    }): Promise<Array<{ citationId: string; sourceChunkId: string }>>
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
      environment: string
      now?: Date
      queryText: string
      status: string
      tokenId: string
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
        environment: input.environment ?? 'local',
        mcpTokenId: input.auth.tokenId,
        now: input.now,
        queryText: input.query,
        status: 'accepted',
        userProfileId: null,
      })
    : await options.queryLogStore.createAcceptedQueryLog({
        allowedAccessLevels,
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
      judge: options.judge,
      persistCitations: async (citations) => {
        const payload: {
          citations: Array<{
            chunkTextSnapshot: string
            citationLocator: string
            documentVersionId: string
            queryLogId: string
            sourceChunkId: string
          }>
          now?: Date
          retentionDays?: number
        } = {
          citations: citations.map((citation) => ({
            ...citation,
            queryLogId,
          })),
        }

        if (input.now) {
          payload.now = input.now
        }

        if (typeof input.retentionDays === 'number') {
          payload.retentionDays = input.retentionDays
        }

        return options.citationStore.persistCitations(payload)
      },
      retrieve: options.retrieve,
    }
  )

  if (result.refused) {
    return {
      citations: [],
      refused: true,
    }
  }

  if (result.answer === null) {
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
      environment: string
      now?: Date
      queryText: string
      status: string
      tokenId: string
    }): Promise<string> {
      const queryLogId = crypto.randomUUID()
      const now = (input.now ?? new Date()).toISOString()

      await database
        .prepare(
          [
            'INSERT INTO query_logs (',
            '  id, channel, user_profile_id, mcp_token_id, environment, query_redacted_text, risk_flags_json, allowed_access_levels_json, redaction_applied, config_snapshot_version, status, created_at',
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ].join('\n')
        )
        .bind(
          queryLogId,
          'mcp',
          null,
          input.tokenId,
          input.environment,
          input.queryText,
          '[]',
          JSON.stringify(input.allowedAccessLevels),
          0,
          'v1',
          input.status,
          now
        )
        .run()

      return queryLogId
    },
  }
}
