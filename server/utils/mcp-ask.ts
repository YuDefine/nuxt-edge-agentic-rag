import type { KnowledgeGovernanceConfig } from '#shared/schemas/knowledge-runtime'
import type { DecisionPath, RefusalReason } from '#shared/types/observability'
import { answerKnowledgeQuery, type KnowledgeAnsweringTelemetry } from './knowledge-answering'
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
    createMessage(input: {
      channel: 'mcp' | 'web'
      citationsJson?: string
      conversationId?: string | null
      content: string
      now?: Date
      queryLogId?: string
      role: 'system' | 'user' | 'assistant' | 'tool'
      /**
       * persist-refusal-and-label-new-chat: web-chat uses this flag to mark
       * refusal assistant turns. MCP callers always pass `false` because
       * MCP v1.0.0 has no conversation reload UI and its refusal contract
       * is governed elsewhere.
       */
      refused?: boolean
      /**
       * persist-refusal-and-label-new-chat: web-chat refusal reason. MCP
       * callers always pass `null` — MCP refusal copy is governed
       * separately.
       */
      refusalReason?: string | null
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
      // observability-and-debug §1.2: derived debug fields written on the
      // initial INSERT for paths known at creation time (audit-blocked).
      // Accepted-path / pipeline-error rows leave these undefined here and
      // back-fill via `updateQueryLog` after the pipeline settles.
      firstTokenLatencyMs?: number | null
      completionLatencyMs?: number | null
      retrievalScore?: number | null
      judgeScore?: number | null
      decisionPath?: string | null
      refusalReason?: string | null
    }): Promise<string>
    /**
     * observability-and-debug §1.2 — back-fill derived debug fields on a
     * query_log row after the answering pipeline returned (or threw).
     * Optional so legacy test fixtures that only stub
     * `{createMessage, createQueryLog}` continue to work.
     */
    updateQueryLog?(input: {
      queryLogId: string
      firstTokenLatencyMs?: number | null
      completionLatencyMs?: number | null
      retrievalScore?: number | null
      judgeScore?: number | null
      decisionPath?: string | null
      refusalReason?: string | null
    }): Promise<void>
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
      // observability-and-debug §0.1 / §0.3: optional debug fields; see
      // `auditStore.createQueryLog` above for the contract.
      firstTokenLatencyMs?: number | null
      completionLatencyMs?: number | null
      retrievalScore?: number | null
      judgeScore?: number | null
      decisionPath?: string | null
      refusalReason?: string | null
    }): Promise<string>
    /** observability-and-debug §1.2 — see auditStore.updateQueryLog. */
    updateQueryLog?(input: {
      queryLogId: string
      firstTokenLatencyMs?: number | null
      completionLatencyMs?: number | null
      retrievalScore?: number | null
      judgeScore?: number | null
      decisionPath?: string | null
      refusalReason?: string | null
    }): Promise<void>
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
  options: McpAskDependencies,
): Promise<McpAskResult> {
  const allowedAccessLevels = getAllowedAccessLevels({
    channel: 'mcp',
    isAuthenticated: true,
    tokenScopes: input.auth.scopes,
  })
  const audit = auditKnowledgeText(input.query)

  if (audit.shouldBlock) {
    if (options.auditStore) {
      // observability-and-debug §1.2: audit-blocked path — decision is fully
      // known at INSERT time, no separate `updateQueryLog` needed.
      const blockedDecisionPath: DecisionPath = 'restricted_blocked'
      const blockedRefusalReason: RefusalReason = 'restricted_scope'
      const queryLogId = await options.auditStore.createQueryLog({
        allowedAccessLevels,
        channel: 'mcp',
        configSnapshotVersion: input.governance.configSnapshotVersion,
        environment: input.environment ?? 'local',
        mcpTokenId: input.auth.tokenId,
        queryText: input.query,
        status: 'blocked',
        userProfileId: null,
        firstTokenLatencyMs: null,
        completionLatencyMs: null,
        retrievalScore: null,
        judgeScore: null,
        decisionPath: blockedDecisionPath,
        refusalReason: blockedRefusalReason,
      })

      await options.auditStore.createMessage({
        channel: 'mcp',
        content: input.query,
        queryLogId,
        role: 'user',
        refused: false,
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
      refused: false,
      userProfileId: null,
    })
  }

  // observability-and-debug §1.2: measure pipeline completion latency and
  // collect the internal decision path so the debug surface can render
  // latency + decision without replaying retrieval / judge.
  const pipelineStartMs = Date.now()
  let telemetry: KnowledgeAnsweringTelemetry | null = null

  const updateSink = options.auditStore?.updateQueryLog ?? options.queryLogStore.updateQueryLog
  const maybeUpdateQueryLog = async (snapshot: {
    decisionPath: DecisionPath
    refusalReason: RefusalReason | null
    retrievalScore: number | null
    judgeScore: number | null
    completionLatencyMs: number | null
  }) => {
    if (!updateSink) {
      return
    }
    await updateSink({
      queryLogId,
      firstTokenLatencyMs: null,
      completionLatencyMs: snapshot.completionLatencyMs,
      retrievalScore: snapshot.retrievalScore,
      judgeScore: snapshot.judgeScore,
      decisionPath: snapshot.decisionPath,
      refusalReason: snapshot.refusalReason,
    })
  }

  let result: Awaited<ReturnType<typeof answerKnowledgeQuery>>
  try {
    result = await answerKnowledgeQuery(
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
        onDecision: (snapshot) => {
          telemetry = snapshot
        },
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
      },
    )
  } catch (error) {
    await maybeUpdateQueryLog({
      decisionPath: 'pipeline_error',
      refusalReason: 'pipeline_error',
      retrievalScore: null,
      judgeScore: null,
      completionLatencyMs: null,
    })
    throw error
  }

  const completionLatencyMs = Date.now() - pipelineStartMs
  const snapshot: KnowledgeAnsweringTelemetry = telemetry ?? {
    decisionPath: 'pipeline_error',
    refusalReason: 'pipeline_error',
    retrievalScore: result.retrievalScore,
    judgeScore: null,
  }
  await maybeUpdateQueryLog({
    decisionPath: snapshot.decisionPath,
    refusalReason: snapshot.refusalReason,
    retrievalScore: snapshot.retrievalScore,
    judgeScore: snapshot.judgeScore,
    completionLatencyMs,
  })

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
      refused: false,
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
      /**
       * observability-and-debug §0.1 / §0.3: optional debug-surface fields.
       * Keep undefined (→ NULL) when the path didn't measure the value —
       * see `knowledge-audit.ts::createQueryLog` for the contract rationale.
       */
      firstTokenLatencyMs?: number | null
      completionLatencyMs?: number | null
      retrievalScore?: number | null
      judgeScore?: number | null
      decisionPath?: string | null
      refusalReason?: string | null
    }): Promise<string> {
      const queryLogId = crypto.randomUUID()
      const now = (input.now ?? new Date()).toISOString()

      await database
        .prepare(
          [
            'INSERT INTO query_logs (',
            '  id, channel, user_profile_id, mcp_token_id, environment, query_redacted_text, risk_flags_json, allowed_access_levels_json, redaction_applied, config_snapshot_version, status, created_at,',
            '  first_token_latency_ms, completion_latency_ms, retrieval_score, judge_score, decision_path, refusal_reason',
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ].join('\n'),
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
          input.configSnapshotVersion,
          input.status,
          now,
          // observability-and-debug §0.1: six nullable debug fields; see
          // knowledge-audit.ts for the contract.
          input.firstTokenLatencyMs ?? null,
          input.completionLatencyMs ?? null,
          input.retrievalScore ?? null,
          input.judgeScore ?? null,
          input.decisionPath ?? null,
          input.refusalReason ?? null,
        )
        .run()

      return queryLogId
    },

    /**
     * `mcp-restricted-audit-trail` spec — write a `query_logs` row for an
     * MCP request that was refused with 403 because the caller's token
     * lacks `knowledge.restricted.read` for the attempted citation.
     *
     * Differs from `createAcceptedQueryLog` in two ways:
     *   - `risk_flags_json` contains `["restricted_scope_violation"]` so
     *     auditors can filter via
     *     `SELECT * FROM query_logs WHERE risk_flags_json LIKE '%restricted_scope_violation%'`.
     *   - `decision_path` / `refusal_reason` are persisted at INSERT time
     *     (`restricted_blocked` / `restricted_scope`), matching the shape
     *     that `mcp-ask.ts` writes for audit-blocked `askKnowledge` runs.
     *
     * `query_redacted_text` is bound verbatim from the caller — the
     * handler passes a pre-redacted string that encodes the attempted
     * `citationId` so the schema needs no new column while still meeting
     * the spec's "captures attempted citation_id" requirement.
     */
    async createBlockedRestrictedScopeQueryLog(input: {
      allowedAccessLevels: string[]
      configSnapshotVersion: string
      environment: string
      now?: Date
      queryText: string
      tokenId: string
    }): Promise<string> {
      const queryLogId = crypto.randomUUID()
      const now = (input.now ?? new Date()).toISOString()

      await database
        .prepare(
          [
            'INSERT INTO query_logs (',
            '  id, channel, user_profile_id, mcp_token_id, environment, query_redacted_text, risk_flags_json, allowed_access_levels_json, redaction_applied, config_snapshot_version, status, created_at,',
            '  first_token_latency_ms, completion_latency_ms, retrieval_score, judge_score, decision_path, refusal_reason',
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ].join('\n'),
        )
        .bind(
          queryLogId,
          'mcp',
          null,
          input.tokenId,
          input.environment,
          input.queryText,
          JSON.stringify(['restricted_scope_violation']),
          JSON.stringify(input.allowedAccessLevels),
          0,
          input.configSnapshotVersion,
          'blocked',
          now,
          null,
          null,
          null,
          null,
          'restricted_blocked',
          'restricted_scope',
        )
        .run()

      return queryLogId
    },

    /**
     * observability-and-debug §1.2 — parallel `updateQueryLog` contract to
     * `knowledge-audit.ts::createKnowledgeAuditStore`. Used only when
     * mcp-ask runs without the richer auditStore (fallback path in older
     * tests); the real runtime always uses auditStore.updateQueryLog.
     */
    async updateQueryLog(input: {
      queryLogId: string
      firstTokenLatencyMs?: number | null
      completionLatencyMs?: number | null
      retrievalScore?: number | null
      judgeScore?: number | null
      decisionPath?: string | null
      refusalReason?: string | null
      workersAiRunsJson?: string | null
    }): Promise<void> {
      await database
        .prepare(
          [
            'UPDATE query_logs',
            'SET first_token_latency_ms = ?,',
            '    completion_latency_ms = ?,',
            '    retrieval_score = ?,',
            '    judge_score = ?,',
            '    decision_path = ?,',
            '    refusal_reason = ?,',
            '    workers_ai_runs_json = ?',
            'WHERE id = ?',
          ].join('\n'),
        )
        .bind(
          input.firstTokenLatencyMs ?? null,
          input.completionLatencyMs ?? null,
          input.retrievalScore ?? null,
          input.judgeScore ?? null,
          input.decisionPath ?? null,
          input.refusalReason ?? null,
          input.workersAiRunsJson ?? '[]',
          input.queryLogId,
        )
        .run()
    },
  }
}
