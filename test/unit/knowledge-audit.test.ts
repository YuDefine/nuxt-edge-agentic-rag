import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { auditKnowledgeText, createKnowledgeAuditStore } from '#server/utils/knowledge-audit'

describe('knowledge audit', () => {
  it('blocks credential-bearing input and produces a marker instead of persisting raw text', () => {
    const result = auditKnowledgeText('my api_key=super-secret-value should not be stored')

    expect(result).toEqual({
      redactedText: '[BLOCKED:credential]',
      redactionApplied: true,
      riskFlags: ['credential'],
      shouldBlock: true,
    })
  })

  it.each([
    ['Visa (spaces)', 'card 4111 1111 1111 1111 leaked'],
    ['Mastercard (hyphens)', 'mc 5555-5555-5555-4444 here'],
    ['Discover (compact)', 'disc 6011111111111117 here'],
    ['Amex (spaces)', 'amex 3782 822463 10005 here'],
  ])('blocks credit-card numbers (%s)', (_label, input) => {
    // `tc-acceptance-followups` §5 — credit card numbers now emit a
    // dedicated `pii_credit_card` flag and `[BLOCKED:credit_card]` marker,
    // separating PCI-DSS-governed PII from generic developer credentials
    // (`api_key`, `sk-...`, `Bearer <token>`) that still flag `credential`.
    const result = auditKnowledgeText(input)

    expect(result.shouldBlock).toBe(true)
    expect(result.redactedText).toBe('[BLOCKED:credit_card]')
    expect(result.riskFlags).toEqual(['pii_credit_card'])
  })

  it('blocks generic 13-19 digit runs with separators as pii_credit_card', () => {
    // Generic fallback for unknown card issuers — 14 digits, not matching
    // Visa/Mastercard/Discover/Amex prefixes, but grouped with hyphens.
    const result = auditKnowledgeText('unknown issuer 1234-5678-9012-34')

    expect(result.shouldBlock).toBe(true)
    expect(result.redactedText).toBe('[BLOCKED:credit_card]')
    expect(result.riskFlags).toEqual(['pii_credit_card'])
  })

  it('does not match 16-digit prefix inside longer digit runs', () => {
    // Plain 19-digit order id — no separators, so the generic fallback does
    // NOT fire (design.md false-positive mitigation). Specific Visa pattern
    // also passes thanks to its negative-lookbehind/lookahead guard.
    const result = auditKnowledgeText('order id 4111111111111111234 shipped')

    expect(result.shouldBlock).toBe(false)
    expect(result.riskFlags).not.toContain('credential')
    expect(result.riskFlags).not.toContain('pii_credit_card')
  })

  it('flags both pii_credit_card and credential when a prompt trips both buckets', () => {
    // A prompt that contains BOTH a card number and an api_key string must
    // emit both flags so auditors see the combined signal; the marker
    // follows the higher-severity PII bucket (`pii_credit_card`).
    const result = auditKnowledgeText('card 4111-1111-1111-1111 api_key=abc123')

    expect(result.shouldBlock).toBe(true)
    expect(result.redactedText).toBe('[BLOCKED:credit_card]')
    expect(result.riskFlags).toEqual(['credential', 'pii_credit_card'])
  })

  it('stores only redacted query_logs and messages content', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const run = vi.fn().mockResolvedValue(undefined)
    const database = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run,
        }),
      }),
    }
    const auditStore = createKnowledgeAuditStore(database)

    const queryLogId = await auditStore.createQueryLog({
      allowedAccessLevels: ['internal'],
      channel: 'web',
      configSnapshotVersion: governance.configSnapshotVersion,
      environment: 'local',
      queryText: 'Contact me at alice@example.com',
      status: 'accepted',
      userProfileId: 'user-1',
    })

    await auditStore.createMessage({
      channel: 'web',
      content: 'Contact me at alice@example.com',
      queryLogId,
      role: 'user',
      userProfileId: 'user-1',
    })

    expect(database.prepare).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(2)

    const queryLogPrepareCall = vi.mocked(database.prepare).mock.calls[0]?.[0] ?? ''
    const queryLogBind = vi.mocked(database.prepare).mock.results[0]?.value.bind as ReturnType<
      typeof vi.fn
    >
    const messageBind = vi.mocked(database.prepare).mock.results[1]?.value.bind as ReturnType<
      typeof vi.fn
    >

    // observability-and-debug tasks.md §0 (schema prerequisites): the INSERT
    // statement must include the six nullable debug columns. Prior callers
    // that don't supply values still bind NULL for each (i.e. 18 bind args
    // total, not 12).
    expect(queryLogPrepareCall).toContain('first_token_latency_ms')
    expect(queryLogPrepareCall).toContain('completion_latency_ms')
    expect(queryLogPrepareCall).toContain('retrieval_score')
    expect(queryLogPrepareCall).toContain('judge_score')
    expect(queryLogPrepareCall).toContain('decision_path')
    expect(queryLogPrepareCall).toContain('refusal_reason')

    expect(queryLogBind).toHaveBeenCalledWith(
      expect.any(String),
      'web',
      'user-1',
      null,
      'local',
      'Contact me at [REDACTED:email]',
      '["pii:email"]',
      '["internal"]',
      1,
      governance.configSnapshotVersion,
      'accepted',
      expect.any(String),
      // observability-and-debug §0.1: six nullable debug surface fields.
      // Null when caller doesn't supply — never fabricated to 0/empty string.
      null,
      null,
      null,
      null,
      null,
      null,
    )
    // After persist-refusal-and-label-new-chat: INSERT now binds
    //   id, conversation_id, query_log_id, user_profile_id, channel, role,
    //   content_redacted, content_text, citations_json, risk_flags_json,
    //   redaction_applied, refused, refusal_reason, created_at
    // content_text holds the raw input (pre-redaction); content_redacted
    // holds the redacted audit copy. `refused` defaults to 0 and
    // `refusal_reason` defaults to NULL when the caller omits them
    // (user / system / accepted-answer rows).
    expect(messageBind).toHaveBeenCalledWith(
      expect.any(String),
      null,
      queryLogId,
      'user-1',
      'web',
      'user',
      'Contact me at [REDACTED:email]',
      'Contact me at alice@example.com',
      '[]',
      '["pii:email"]',
      1,
      0,
      null,
      expect.any(String),
    )
  })

  it('persists optional observability debug fields when caller supplies them (observability-and-debug §0.1/§0.3)', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const run = vi.fn().mockResolvedValue(undefined)
    const database = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run,
        }),
      }),
    }
    const auditStore = createKnowledgeAuditStore(database)

    await auditStore.createQueryLog({
      allowedAccessLevels: ['internal'],
      channel: 'web',
      configSnapshotVersion: governance.configSnapshotVersion,
      environment: 'local',
      queryText: 'healthy query',
      status: 'accepted',
      userProfileId: 'user-debug',
      firstTokenLatencyMs: 180,
      completionLatencyMs: 2_450,
      retrievalScore: 0.82,
      judgeScore: 0.74,
      decisionPath: 'judge_pass_then_answer',
      refusalReason: null,
    })

    const queryLogBind = vi.mocked(database.prepare).mock.results[0]?.value.bind as ReturnType<
      typeof vi.fn
    >

    expect(queryLogBind).toHaveBeenCalledWith(
      expect.any(String),
      'web',
      'user-debug',
      null,
      'local',
      'healthy query',
      '[]',
      '["internal"]',
      0,
      governance.configSnapshotVersion,
      'accepted',
      expect.any(String),
      180,
      2_450,
      0.82,
      0.74,
      'judge_pass_then_answer',
      null,
    )
  })

  it('persists refusal metadata when caller supplies only refusal fields (observability-and-debug §0.1)', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const run = vi.fn().mockResolvedValue(undefined)
    const database = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run,
        }),
      }),
    }
    const auditStore = createKnowledgeAuditStore(database)

    await auditStore.createQueryLog({
      allowedAccessLevels: ['internal'],
      channel: 'web',
      configSnapshotVersion: governance.configSnapshotVersion,
      environment: 'local',
      queryText: 'restricted scope query',
      status: 'rejected',
      userProfileId: 'user-debug',
      decisionPath: 'refused_restricted_scope',
      refusalReason: 'restricted_scope',
    })

    const queryLogBind = vi.mocked(database.prepare).mock.results[0]?.value.bind as ReturnType<
      typeof vi.fn
    >

    // Latency + score fields stay NULL (not 0) when no measurement happened.
    // decision_path + refusal_reason carry meaningful text.
    expect(queryLogBind).toHaveBeenCalledWith(
      expect.any(String),
      'web',
      'user-debug',
      null,
      'local',
      'restricted scope query',
      '[]',
      '["internal"]',
      0,
      governance.configSnapshotVersion,
      'rejected',
      expect.any(String),
      null,
      null,
      null,
      null,
      'refused_restricted_scope',
      'restricted_scope',
    )
  })

  it('updates workers_ai_runs_json when query-log telemetry is back-filled', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const database = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run,
        }),
      }),
    }
    const auditStore = createKnowledgeAuditStore(database)
    const workersAiRunsJson =
      '[{"modelRole":"defaultAnswer","model":"@cf/meta/llama-4-scout-17b-16e-instruct","latencyMs":210,"usage":{"promptTokens":120,"completionTokens":18,"totalTokens":138,"cachedPromptTokens":32}}]'

    await auditStore.updateQueryLog({
      queryLogId: 'query-log-1',
      completionLatencyMs: 1_240,
      decisionPath: 'direct_answer',
      firstTokenLatencyMs: null,
      judgeScore: null,
      refusalReason: null,
      retrievalScore: 0.91,
      workersAiRunsJson,
    })

    const prepareCall = vi.mocked(database.prepare).mock.calls[0]?.[0] ?? ''
    const bind = vi.mocked(database.prepare).mock.results[0]?.value.bind as ReturnType<typeof vi.fn>

    expect(prepareCall).toContain('workers_ai_runs_json = ?')
    expect(bind).toHaveBeenCalledWith(
      null,
      1_240,
      0.91,
      null,
      'direct_answer',
      null,
      workersAiRunsJson,
      'query-log-1',
    )
  })
})
