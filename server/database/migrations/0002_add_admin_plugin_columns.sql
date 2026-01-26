-- Better Auth `admin()` plugin requires `role`, `banned`, `banReason`, `banExpires` on the user table.
-- Initial schema (0001) was generated before the plugin was added; this migration closes the gap.

ALTER TABLE user ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE user ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN banReason TEXT;
ALTER TABLE user ADD COLUMN banExpires TEXT;
