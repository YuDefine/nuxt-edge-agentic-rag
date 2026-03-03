-- observability-and-debug §0.2: add the debug-surface fields on query_logs.
--
-- All six columns are additive and nullable so:
--   - existing rows keep their original values (NULL on read);
--   - existing INSERT callers that don't supply values continue to work —
--     SQLite applies NULL for unlisted columns on ALTER TABLE ADD COLUMN;
--   - the debug surface (tasks.md §2 / §3) can distinguish "not measured"
--     (NULL) from a genuine zero-latency / zero-score run (see §3.3:
--     "表示 null latency 與 partial stream 狀態，不偽造數值").
--
-- Column contract:
--   first_token_latency_ms  INTEGER  SSE first-token latency (ms). NULL =
--                                    stream never started (blocked pre-stream
--                                    or legacy row).
--   completion_latency_ms   INTEGER  Completion latency (ms). NULL = run
--                                    refused / aborted before any tokens.
--   retrieval_score         REAL     0-1 retrieval score. NULL = retrieval
--                                    was not executed (e.g. blocked query).
--   judge_score             REAL     0-1 answerability judge score. NULL =
--                                    judge was bypassed.
--   decision_path           TEXT     Short decision-path tag (e.g.
--                                    `direct_answer`, `judge_pass_then_refuse`,
--                                    `self_correction_retry`). NULL = legacy
--                                    row. Enum owned by UI task §2.1.
--   refusal_reason          TEXT     Refusal classification (e.g.
--                                    `restricted_scope`, `no_citation`,
--                                    `sensitive_governance`). NULL = run did
--                                    not refuse. Enum owned by UI task §2.2.

ALTER TABLE query_logs ADD COLUMN first_token_latency_ms INTEGER;
ALTER TABLE query_logs ADD COLUMN completion_latency_ms INTEGER;
ALTER TABLE query_logs ADD COLUMN retrieval_score REAL;
ALTER TABLE query_logs ADD COLUMN judge_score REAL;
ALTER TABLE query_logs ADD COLUMN decision_path TEXT;
ALTER TABLE query_logs ADD COLUMN refusal_reason TEXT;
