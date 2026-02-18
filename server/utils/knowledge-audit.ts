interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

type KnowledgeChannel = 'web' | 'mcp'
type QueryLogStatus = 'accepted' | 'blocked' | 'limited' | 'rejected'
type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

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
    async createMessage(input: {
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
    }): Promise<string> {
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

    async createQueryLog(input: {
      allowedAccessLevels: string[]
      channel: KnowledgeChannel
      configSnapshotVersion: string
      environment: string
      mcpTokenId?: string | null
      now?: Date
      queryText: string
      status: QueryLogStatus
      userProfileId?: string | null
    }): Promise<string> {
      const queryLogId = crypto.randomUUID()
      const audit = auditKnowledgeText(input.queryText)
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
          input.channel,
          input.userProfileId ?? null,
          input.mcpTokenId ?? null,
          input.environment,
          audit.redactedText,
          JSON.stringify(audit.riskFlags),
          JSON.stringify(input.allowedAccessLevels),
          audit.redactionApplied ? 1 : 0,
          input.configSnapshotVersion,
          input.status,
          now
        )
        .run()

      return queryLogId
    },
  }
}
