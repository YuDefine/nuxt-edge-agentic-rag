import { auditKnowledgeText } from './knowledge-audit'

/**
 * Fixed Traditional Chinese fallback used when the audit blocks the query.
 * The redactedText for blocked queries (e.g. `[BLOCKED:credential]`) is an
 * internal marker meant for audit logs — surfacing it directly in the
 * sidebar conversation list leaks implementation detail to end users.
 *
 * See: openspec/changes/persist-refusal-and-label-new-chat — capability
 * `web-agentic-answering` requirement "Audit-Blocked Conversation Title
 * Fallback".
 */
export const AUDIT_BLOCKED_CONVERSATION_TITLE = '無法處理的提問'

const TITLE_MAX_LENGTH = 40

/**
 * Derive the `conversations.title` for a freshly-created conversation
 * starting from a user query. Normal traffic uses the first 40 characters
 * of the redacted query (so PII / credential fragments never reach the
 * conversations row). When the audit blocks the query, the redactedText is
 * a marker like `[BLOCKED:credential]` which is unfit for UI; in that case
 * we use the fixed Traditional Chinese fallback.
 */
export function deriveConversationTitleFromQuery(query: string): string {
  const auditResult = auditKnowledgeText(query)

  if (auditResult.shouldBlock) {
    return AUDIT_BLOCKED_CONVERSATION_TITLE
  }

  return auditResult.redactedText.trim().slice(0, TITLE_MAX_LENGTH)
}
