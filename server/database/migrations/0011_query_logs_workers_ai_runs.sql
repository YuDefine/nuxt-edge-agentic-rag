-- workers-ai-grounded-answering §3.1
-- Persist the minimal Workers AI baseline telemetry alongside each query_log
-- row so fixed-sample verification can distinguish measured run data from
-- scenario estimates without replaying the request from external logs only.

ALTER TABLE query_logs
  ADD COLUMN workers_ai_runs_json TEXT NOT NULL DEFAULT '[]';
