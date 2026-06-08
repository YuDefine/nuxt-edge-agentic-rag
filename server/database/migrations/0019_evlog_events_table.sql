-- adopt-evlog-nuxthub-ai-t3 / @evlog/nuxthub D1 drain target
-- @evlog/nuxthub writes wide events to the `evlog_events` table via its
-- NuxtHub D1 drain, but the package ships only the drizzle schema (no
-- migration). Without this table every drain insert fails in production
-- (`Failed query: insert into evlog_events`). Schema mirrors
-- @evlog/nuxthub events.sqlite.js (14 columns + 6 indexes) verbatim.

CREATE TABLE evlog_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  environment TEXT NOT NULL,
  method TEXT,
  path TEXT,
  status INTEGER,
  duration_ms INTEGER,
  request_id TEXT,
  source TEXT,
  error TEXT,
  data TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX evlog_events_timestamp_idx ON evlog_events (timestamp);
CREATE INDEX evlog_events_level_idx ON evlog_events (level);
CREATE INDEX evlog_events_service_idx ON evlog_events (service);
CREATE INDEX evlog_events_status_idx ON evlog_events (status);
CREATE INDEX evlog_events_request_id_idx ON evlog_events (request_id);
CREATE INDEX evlog_events_created_at_idx ON evlog_events (created_at);
