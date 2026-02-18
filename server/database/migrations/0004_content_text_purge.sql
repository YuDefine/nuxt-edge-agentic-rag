-- governance-refinements: §1.4 / §1.5 — Conversation delete purge policy
-- + audit-safe residue protection.
--
-- Design (see openspec/changes/governance-refinements/tasks.md §1.4 decision):
--
--   content_text     → user-visible original content. NULL'd out when the
--                      owning conversation is soft-deleted, so normal UI /
--                      API / future model-context readers never recover the
--                      raw text.
--   content_redacted → audit-safe redacted copy. Remains NOT NULL and is
--                      preserved across soft-delete so audit admins can still
--                      trace activity within the retention window. This
--                      column MUST NOT flow back into user-facing surfaces.
--
-- Backfill strategy:
--
--   - Messages under ACTIVE conversations (deleted_at IS NULL) copy the
--     existing `content_redacted` value into `content_text`. This is a
--     conservative best-effort: pre-governance rows only stored the
--     redacted text. That means, for an unlucky active row with pre-existing
--     redaction, `content_text` will equal `content_redacted`. Acceptable
--     trade-off: the alternative (leaving NULL) would silently purge
--     content for in-flight conversations.
--   - Messages under SOFT-DELETED conversations leave `content_text` NULL
--     — this retroactively applies the purge policy to any previously
--     soft-deleted conversation, so historical deletes now satisfy §1.4.
--   - Messages with NULL conversation_id (session-only legacy rows from the
--     v1.0.0 chat MVP) also leave content_text NULL. These were never
--     anchored to a conversation and should not surface back into user UI.

ALTER TABLE messages ADD COLUMN content_text TEXT;

UPDATE messages
SET content_text = content_redacted
WHERE conversation_id IS NOT NULL
  AND conversation_id IN (
    SELECT id FROM conversations WHERE deleted_at IS NULL
  );
