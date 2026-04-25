-- persist-refusal-and-label-new-chat: introduce messages.refused so the
-- application layer can persist refusal assistant turns alongside accepted
-- answers. Before this migration the orchestration in
-- server/utils/web-chat.ts skipped writing assistant rows whenever a turn
-- ended in audit-block, pipeline refusal, or pipeline error; reloading the
-- conversation from the history sidebar therefore showed a user message
-- with no matching assistant turn.
--
-- Column shape:
--   refused INTEGER NOT NULL DEFAULT 0
--
-- - INTEGER 0/1 because D1 (SQLite) has no native boolean.
-- - NOT NULL DEFAULT 0 so existing rows backfill in place; the migration is
--   strictly additive (no data rewrite, no DROP, no ALTER on existing
--   columns) and SQLite's online ALTER ADD path applies.
-- - User and system messages always carry refused = 0; assistant rows carry
--   refused = 1 only for the three refusal outcomes (audit-block /
--   pipeline_refusal / pipeline_error), and refused = 0 for accepted
--   answers.
--
-- Truth boundary:
--   messages.refused is the DB-of-record for "is this assistant turn a
--   refusal?". query_logs.refusal_reason remains the observability layer
--   for "why did it refuse?" — the two coexist and do not replace each
--   other.

ALTER TABLE messages
  ADD COLUMN refused INTEGER NOT NULL DEFAULT 0;
