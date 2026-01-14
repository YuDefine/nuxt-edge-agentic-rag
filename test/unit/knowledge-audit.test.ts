import { describe, expect, it, vi } from 'vitest'

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

  it('stores only redacted query_logs and messages content', async () => {
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
      'v1',
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
