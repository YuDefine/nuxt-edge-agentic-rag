import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '../../shared/schemas/knowledge-runtime'
import { auditKnowledgeText, createKnowledgeAuditStore } from '../../server/utils/knowledge-audit'

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
    const result = auditKnowledgeText(input)

    expect(result.shouldBlock).toBe(true)
    expect(result.redactedText).toBe('[BLOCKED:credential]')
    expect(result.riskFlags).toEqual(['credential'])
  })

  it('does not match 16-digit prefix inside longer digit runs', () => {
    const result = auditKnowledgeText('order id 4111111111111111234 shipped')

    expect(result.shouldBlock).toBe(false)
    expect(result.riskFlags).not.toContain('credential')
  })

  it('stores only redacted query_logs and messages content', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'staging',
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
      environment: 'staging',
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

    const queryLogBind = vi.mocked(database.prepare).mock.results[0]?.value.bind as ReturnType<
      typeof vi.fn
    >
    const messageBind = vi.mocked(database.prepare).mock.results[1]?.value.bind as ReturnType<
      typeof vi.fn
    >

    expect(queryLogBind).toHaveBeenCalledWith(
      expect.any(String),
      'web',
      'user-1',
      null,
      'staging',
      'Contact me at [REDACTED:email]',
      '["pii:email"]',
      '["internal"]',
      1,
      governance.configSnapshotVersion,
      'accepted',
      expect.any(String)
    )
    expect(messageBind).toHaveBeenCalledWith(
      expect.any(String),
      queryLogId,
      'user-1',
      'web',
      'user',
      'Contact me at [REDACTED:email]',
      '["pii:email"]',
      1,
      expect.any(String)
    )
  })
})
