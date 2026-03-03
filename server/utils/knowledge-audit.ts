interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export type KnowledgeChannel = 'web' | 'mcp'
export type QueryLogStatus = 'accepted' | 'blocked' | 'limited' | 'rejected'
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface CreateMessageInput {
  channel: KnowledgeChannel
  configSnapshotVersion?: string
  /**
   * Optional conversation anchor. When supplied, the row is scoped under
   * the conversation so governance §1.4 purge (soft-delete NULLs
   * `content_text` by `conversation_id`) can find it. When omitted, the
   * message behaves like a session-only audit row.
   */
  conversationId?: string | null
  content: string
  /**
   * Optional citations payload — persisted raw to `citations_json` so the
   * stale resolver can re-derive cited `document_version_id` values on
   * follow-up. Defaults to `[]`.
   */
  citationsJson?: string
  now?: Date
  queryLogId?: string
  role: MessageRole
  userProfileId?: string | null
}

export interface CreateQueryLogInput {
  allowedAccessLevels: string[]
  channel: KnowledgeChannel
  configSnapshotVersion: string
  environment: string
  mcpTokenId?: string | null
  now?: Date
  queryText: string
  status: QueryLogStatus
  userProfileId?: string | null
  /**
   * observability-and-debug §0.1 / §0.3: optional debug-surface fields.
   * NULL means "not measured" — never fabricate a sentinel (0 / '' /
   * 'unknown'). The debug UI relies on NULL to mark partial runs honestly.
   */
  firstTokenLatencyMs?: number | null
  completionLatencyMs?: number | null
  retrievalScore?: number | null
  judgeScore?: number | null
  decisionPath?: string | null
  refusalReason?: string | null
}

interface InsertQueryLogRowInput {
  allowedAccessLevels: string[]
  channel: KnowledgeChannel
  configSnapshotVersion: string
  completionLatencyMs?: number | null
  createdAt: string
  decisionPath?: string | null
  environment: string
  firstTokenLatencyMs?: number | null
  id: string
  judgeScore?: number | null
  mcpTokenId?: string | null
  queryRedactedText: string
  redactionApplied: boolean
  refusalReason?: string | null
  retrievalScore?: number | null
  riskFlags: string[]
  status: QueryLogStatus
  userProfileId?: string | null
}

/**
 * Shared INSERT for `query_logs`. Both web-chat and MCP paths use this so the
 * six observability columns stay in one place — adding a new debug field only
 * needs one schema + one helper update.
 */
export async function insertQueryLogRow(
  database: D1DatabaseLike,
  input: InsertQueryLogRowInput
): Promise<void> {
  await database
    .prepare(
      [
        'INSERT INTO query_logs (',
        '  id, channel, user_profile_id, mcp_token_id, environment, query_redacted_text, risk_flags_json, allowed_access_levels_json, redaction_applied, config_snapshot_version, status, created_at,',
        '  first_token_latency_ms, completion_latency_ms, retrieval_score, judge_score, decision_path, refusal_reason',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join('\n')
    )
    .bind(
      input.id,
      input.channel,
      input.userProfileId ?? null,
      input.mcpTokenId ?? null,
      input.environment,
      input.queryRedactedText,
      JSON.stringify(input.riskFlags),
      JSON.stringify(input.allowedAccessLevels),
      input.redactionApplied ? 1 : 0,
      input.configSnapshotVersion,
      input.status,
      input.createdAt,
      // D1 rejects undefined — coerce to null explicitly.
      input.firstTokenLatencyMs ?? null,
      input.completionLatencyMs ?? null,
      input.retrievalScore ?? null,
      input.judgeScore ?? null,
      input.decisionPath ?? null,
      input.refusalReason ?? null
    )
    .run()
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_PATTERN = /\b(?:\+?\d[\d -]{8,}\d)\b/g
const CREDENTIAL_PATTERNS = [
  /\bapi[_ -]?key\s*[:=]\s*\S+/i,
  /\bpassword\s*[:=]\s*\S+/i,
  /\bsecret\s*[:=]\s*\S+/i,
  /\btoken\s*[:=]\s*\S+/i,
  /\bsk-[A-Za-z0-9]{10,}\b/,
  /(?<!\d)(?:4\d{3}|5[1-5]\d{2}|6(?:011|5\d{2}))[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/,
  /(?<!\d)3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}(?!\d)/,
]

export function auditKnowledgeText(text: string): {
  redactedText: string
  redactionApplied: boolean
  riskFlags: string[]
  shouldBlock: boolean
} {
  const normalizedText = text.trim()
  const riskFlags: string[] = []
  const hasCredential = CREDENTIAL_PATTERNS.some((pattern) => pattern.test(normalizedText))

  if (hasCredential) {
    riskFlags.push('credential')

    return {
      redactedText: '[BLOCKED:credential]',
      redactionApplied: true,
      riskFlags,
      shouldBlock: true,
    }
  }

  let redactedText = normalizedText

  if (EMAIL_PATTERN.test(redactedText)) {
    riskFlags.push('pii:email')
    redactedText = redactedText.replaceAll(EMAIL_PATTERN, '[REDACTED:email]')
  }

  if (PHONE_PATTERN.test(redactedText)) {
    riskFlags.push('pii:phone')
    redactedText = redactedText.replaceAll(PHONE_PATTERN, '[REDACTED:phone]')
  }

  return {
    redactedText,
    redactionApplied: redactedText !== normalizedText,
    riskFlags,
    shouldBlock: false,
  }
}

export function createKnowledgeAuditStore(database: D1DatabaseLike) {
  return {
    async createMessage(input: CreateMessageInput): Promise<string> {
      const messageId = crypto.randomUUID()
      const audit = auditKnowledgeText(input.content)
      const now = (input.now ?? new Date()).toISOString()

      // Governance §1.4 / §1.5: write two copies of the content.
      //
      //   content_text     → raw user-visible copy. Purge policy NULLs this
      //                      column when the owning conversation is
      //                      soft-deleted; until then, user/model-context
      //                      readers get the original text via
      //                      `getUserVisibleMessageContent`.
      //   content_redacted → audit-safe redacted copy. Stays NOT NULL across
      //                      delete so audit paths keep working within the
      //                      retention window.
      //
      // Blocked (high-risk) messages MUST NOT persist the raw content in
      // content_text — the row is refused so it never surfaces to any user
      // path, and keeping the raw on disk would defeat the whole point of
      // the redaction (acceptance TC-15). We null content_text for
      // shouldBlock rows so the raw never touches storage in any column.
      const contentTextForStorage = audit.shouldBlock ? null : input.content

      await database
        .prepare(
          [
            'INSERT INTO messages (',
            '  id, conversation_id, query_log_id, user_profile_id, channel, role,',
            '  content_redacted, content_text, citations_json, risk_flags_json,',
            '  redaction_applied, created_at',
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ].join('\n')
        )
        .bind(
          messageId,
          input.conversationId ?? null,
          input.queryLogId ?? null,
          input.userProfileId ?? null,
          input.channel,
          input.role,
          audit.redactedText,
          contentTextForStorage,
          input.citationsJson ?? '[]',
          JSON.stringify(audit.riskFlags),
          audit.redactionApplied ? 1 : 0,
          now
        )
        .run()

      return messageId
    },

    async createQueryLog(input: CreateQueryLogInput): Promise<string> {
      const queryLogId = crypto.randomUUID()
      const audit = auditKnowledgeText(input.queryText)
      const now = (input.now ?? new Date()).toISOString()

      await insertQueryLogRow(database, {
        id: queryLogId,
        channel: input.channel,
        userProfileId: input.userProfileId ?? null,
        mcpTokenId: input.mcpTokenId ?? null,
        environment: input.environment,
        queryRedactedText: audit.redactedText,
        riskFlags: audit.riskFlags,
        allowedAccessLevels: input.allowedAccessLevels,
        redactionApplied: audit.redactionApplied,
        configSnapshotVersion: input.configSnapshotVersion,
        status: input.status,
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
