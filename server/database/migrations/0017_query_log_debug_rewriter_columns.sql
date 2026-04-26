-- workers-ai-grounded-answering §S-OB / change rag-query-rewriting
-- design 以 `query_log_debug` 概念名指稱同一張 `query_logs` 表（query-log-debug-store
-- 投影同一張表給 admin debug surface）。在此加兩欄供 rewriter audit。
--
-- backward-compat: existing rows 透過 DEFAULT 'disabled' 自動取得 rewriter_status
-- 值，rewritten_query 留 NULL，符合 spec scenario「existing query_log_debug rows
-- remain readable after migration」。

ALTER TABLE query_logs
  ADD COLUMN rewriter_status TEXT NOT NULL DEFAULT 'disabled';

ALTER TABLE query_logs
  ADD COLUMN rewritten_query TEXT;
