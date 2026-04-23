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

/**
 * `tc-acceptance-followups` §5 — split the credential flag into two buckets:
 *
 *   - `credential`      → API keys, passwords, secrets, Bearer tokens, OpenAI
 *                         `sk-...` keys. These are developer / service
 *                         credentials that must never land in logs.
 *   - `pii_credit_card` → card numbers. These are PII governed by PCI DSS
 *                         and must be treated as a distinct risk bucket so
 *                         auditors can filter by
 *                         `risk_flags_json LIKE '%pii_credit_card%'`.
 *
 * Rules for the generic 13-19 digit fallback (entry 8 below):
 *
 *   - Does NOT do Luhn validation — treasure-hunting real card numbers is
 *     not the goal. The goal is "string looks like a card → block". Wider
 *     false-positive rate is accepted in exchange for guaranteed coverage
 *     of future card issuers / test numbers.
 *   - Does NOT carry `/g`: `.test()` against a `/g` regex advances
 *     `lastIndex` and causes the next `.test()` to miss, which would leak
 *     a card number on a subsequent call with the same input string.
 *   - Kept last in the array so specific issuer patterns match first.
 */
interface CredentialPattern {
  readonly flag: 'credential' | 'pii_credit_card'
  readonly pattern: RegExp
}

const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = [
  { flag: 'credential', pattern: /\bapi[_ -]?key\s*[:=]\s*\S+/i },
  { flag: 'credential', pattern: /\bpassword\s*[:=]\s*\S+/i },
  { flag: 'credential', pattern: /\bsecret\s*[:=]\s*\S+/i },
  { flag: 'credential', pattern: /\btoken\s*[:=]\s*\S+/i },
  { flag: 'credential', pattern: /\bsk-[A-Za-z0-9]{10,}\b/ },
  // Visa / Mastercard / Discover 16-digit with optional spaces or hyphens.
  // Negative-lookbehind/lookahead guard prevents matching a 16-digit prefix
  // inside longer digit runs (e.g. order id 4111111111111111234).
  {
    flag: 'pii_credit_card',
    pattern: /(?<!\d)(?:4\d{3}|5[1-5]\d{2}|6(?:011|5\d{2}))[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/,
  },
  // Amex 15-digit 4-6-5 grouping.
  {
    flag: 'pii_credit_card',
    pattern: /(?<!\d)3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}(?!\d)/,
  },
]

/**
 * Generic 13-19 digit credit card fallback. `CREDENTIAL_PATTERNS` above
 * handles specific issuer prefixes (Visa / Mastercard / Discover / Amex);
 * this catcher fires when the digits look like a card but don't match any
 * known prefix (future issuers, test numbers, region-specific cards).
 *
 * Design constraint (`tc-acceptance-followups` design.md §Risks):
 *   - 寬鬆 regex 誤判 SOP 文件中的訂單編號
 *   - Mitigation: 限定 13-19 位 + **連續 separator** 才匹配
 *
 * The guard enforces the separator requirement — plain digit runs like
 * order id `4111111111111111234` (19 digits) do NOT match because no
 * space/hyphen separator appears inside the run. Real card numbers in the
 * wild are almost always displayed with 4-digit groups.
 */
const GENERIC_CREDIT_CARD_PATTERN = /\b(?:\d[ -]?){13,19}\b/

function matchesGenericCreditCard(text: string): boolean {
  const match = text.match(GENERIC_CREDIT_CARD_PATTERN)
  if (!match) {
    return false
  }

  // Require at least one space/hyphen separator BETWEEN two digits inside
  // the matched run — trailing separators (e.g. `...1234 shipped`) don't
  // count. This keeps plain long digit strings like order id
  // `4111111111111111234` out of the blocked set while still catching real
  // card formats like `4111-1111-1111-1111` or `4111 1111 1111 1111`.
  return /\d[ -]\d/.test(match[0])
}

// Redaction marker precedence. When a single prompt trips both `credential`
// and `pii_credit_card` buckets, the marker follows `pii_credit_card` because
// the PII disclosure is the higher-severity risk; the `credential` flag is
// still emitted alongside in `risk_flags_json` so auditors see both signals.
const REDACTION_MARKER: Record<CredentialPattern['flag'], string> = {
  credential: '[BLOCKED:credential]',
  pii_credit_card: '[BLOCKED:credit_card]',
}

export function auditKnowledgeText(text: string): {
  redactedText: string
  redactionApplied: boolean
  riskFlags: string[]
  shouldBlock: boolean
} {
  const normalizedText = text.trim()
  const blockedFlags = new Set<CredentialPattern['flag']>()

  for (const entry of CREDENTIAL_PATTERNS) {
    if (entry.pattern.test(normalizedText)) {
      blockedFlags.add(entry.flag)
    }
  }

  // Generic credit card fallback — fires when specific issuer prefixes above
  // miss but a 13-19 digit run with separators is still present.
  if (matchesGenericCreditCard(normalizedText)) {
    blockedFlags.add('pii_credit_card')
  }

  if (blockedFlags.size > 0) {
    // Preserve a deterministic ordering so `risk_flags_json` reads the same
    // across runs regardless of which pattern fires first.
    const riskFlags = Array.from(blockedFlags).toSorted()
    const markerFlag: CredentialPattern['flag'] = blockedFlags.has('pii_credit_card')
      ? 'pii_credit_card'
      : 'credential'

    return {
      redactedText: REDACTION_MARKER[markerFlag],
      redactionApplied: true,
      riskFlags,
      shouldBlock: true,
    }
  }

  const riskFlags: string[] = []
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
          ].join('\n'),
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
          now,
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
      /**
       * observability-and-debug §0.1 / §0.3: optional debug-surface fields.
       *
       * Every field is independently nullable — callers that don't measure
       * a value MUST leave it `undefined` (coerced to NULL on write), never
       * supply a sentinel like 0 / '' / 'unknown'. The debug surface
       * (tasks.md §2 / §3) relies on NULL meaning "not measured" to keep the
       * visualization honest about partial / refused runs.
       *
       * These fields are purely additive to the existing INSERT contract:
       * existing call sites that don't forward them continue to bind NULL,
       * and no existing test fixture needs to change to supply them.
       */
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
          now,
          // observability-and-debug §0.1: six nullable debug fields. Coerce
          // `undefined` to `null` explicitly so the prepared statement binds
          // SQL NULL instead of a JS undefined (which D1 rejects).
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
     * observability-and-debug §1.2 — back-fill debug-safe derived fields on a
     * previously-created `query_logs` row. Called AFTER the answering
     * pipeline completes (happy + refusal + error paths) so latency /
     * decision_path / retrieval_score can be persisted without replaying the
     * pipeline from the UI.
     *
     * Each input field is still nullable: leave `undefined` when a value
     * wasn't measured (e.g. firstTokenLatencyMs when SSE instrumentation is
     * not yet wired) — it will be bound as SQL NULL, preserving the "not
     * measured" semantics. NEVER coerce to 0 / '' / sentinels.
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
