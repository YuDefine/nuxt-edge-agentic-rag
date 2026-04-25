-- persist-refusal-and-label-new-chat: introduce messages.refusal_reason so
-- the application layer can persist the specific reason every refusal
-- assistant turn was emitted with. Paired with the `refused` flag added in
-- migration 0013: `refused` answers "is this a refusal turn?" while
-- `refusal_reason` answers "why?". Reload UIs use the reason to render
-- reason-specific copy in `RefusalMessage.vue`.
--
-- Column shape:
--   refusal_reason TEXT (nullable)
--
-- - TEXT to mirror `query_logs.refusal_reason` enum strings (no FK; the
--   enum membership is enforced in the application layer via
--   `RefusalReason` from `shared/types/observability.ts`).
-- - Nullable because user / system / accepted-assistant rows have no
--   refusal reason. Adding `NOT NULL` would force a sentinel value and
--   break the "row has no reason" semantics that reload paths rely on.
-- - Strictly additive: no DROP, no UPDATE on existing rows. SQLite's
--   online ALTER ADD path applies.
--
-- Truth boundary:
--   `messages.refusal_reason` is the message-history copy consumed by the
--   reload UI. `query_logs.refusal_reason` remains the observability
--   record and may be sampled / TTL'd independently. The two coexist by
--   design (see design.md "Refusal reason 持久化（messages.refusal_reason
--   TEXT NULL，方案 A）").

ALTER TABLE messages
  ADD COLUMN refusal_reason TEXT;
