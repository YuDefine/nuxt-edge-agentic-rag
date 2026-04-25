import { describe, expect, it } from 'vitest'

import {
  AUDIT_BLOCKED_CONVERSATION_TITLE,
  deriveConversationTitleFromQuery,
} from '#server/utils/conversation-title'

/**
 * Capability under test: web-agentic-answering — Audit-Blocked Conversation
 * Title Fallback.
 *
 * The Web chat handler MUST NOT use the audit's `redactedText` (which
 * carries an internal redaction marker like `[BLOCKED:credential]`) as the
 * title for a freshly-created conversation. When the audit blocks the
 * query, the handler delegates to a fixed Traditional Chinese fallback so
 * the sidebar conversation list never surfaces internal markers to end
 * users. Non-blocked queries continue to derive the title from the
 * redacted-but-readable copy of the user query.
 */

describe('deriveConversationTitleFromQuery', () => {
  it('uses the fixed Chinese fallback when the audit blocks the query (credential leak)', () => {
    const title = deriveConversationTitleFromQuery('help with api_key=sk-supersecret')

    expect(title).toBe(AUDIT_BLOCKED_CONVERSATION_TITLE)
    expect(title).toBe('無法處理的提問')
    expect(title).not.toContain('[BLOCKED')
    expect(title).not.toContain('credential')
  })

  it('uses the fixed Chinese fallback when the audit blocks the query (password leak)', () => {
    const title = deriveConversationTitleFromQuery('password=hunter2')

    expect(title).toBe('無法處理的提問')
    expect(title).not.toContain('[BLOCKED')
  })

  it('derives title from the redacted query for normal questions (preserves prior behavior)', () => {
    const title = deriveConversationTitleFromQuery('採購流程的第一步是什麼？')

    expect(title).toBe('採購流程的第一步是什麼？')
    expect(title).not.toBe('無法處理的提問')
  })

  it('truncates non-blocked redacted text to 40 characters', () => {
    const longQuery = '這是一個很長的問題' + '一'.repeat(60) + '最後一段'
    const title = deriveConversationTitleFromQuery(longQuery)

    expect(title.length).toBeLessThanOrEqual(40)
    expect(title.length).toBeGreaterThan(0)
  })

  it('redacts non-blocking PII (email) inside the title source rather than blocking outright', () => {
    // Email triggers redaction (`[REDACTED:email]`) but does NOT trigger
    // shouldBlock — email is a soft signal, not a credential leak. The
    // resulting title is the redacted form, not the audit-block fallback.
    const title = deriveConversationTitleFromQuery('Contact me at alice@example.com')

    expect(title).not.toBe('無法處理的提問')
    expect(title).toContain('[REDACTED:email]')
    expect(title).not.toContain('alice@example.com')
  })
})
