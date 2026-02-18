-- governance-refinements: Section 1 (Conversation Lifecycle Governance)
--
-- Adds the two columns that `conversation-stale-resolver` and the web-chat
-- follow-up path need:
--
-- 1. `messages.conversation_id` so persisted assistant/user messages can be
--    grouped under the owning conversation. The column is nullable to stay
--    backward compatible with rows persisted by the v1.0.0 chat MVP, which
--    still runs in session-only mode.
-- 2. `messages.citations_json` so stale-revalidation can read the set of
--    `document_version_id` values cited by the latest assistant message
--    without needing to JOIN citation_records. This matches the resolver
--    contract defined in `conversation-lifecycle-governance` spec.
--
-- Both columns are additive; existing rows keep their original values.

ALTER TABLE messages ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
  ON messages(conversation_id, created_at);
