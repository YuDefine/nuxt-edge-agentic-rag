# 決策紀錄

這一區收錄已記錄的技術決策，適合在修改既有模組前先看一次，確認目前有哪些已經定案的限制與方向。

## 現有紀錄

依日期由新到舊：

- [2026-04-26 RAG Query Rewriting](./2026-04-26-rag-query-rewriting.md)
- [2026-04-25 Cloudflare SSE Streaming Bypass](./2026-04-25-cloudflare-sse-streaming-bypass.md)
- [2026-04-25 User Profiles App-Level Migrate](./2026-04-25-user-profiles-app-level-migrate.md)
- [2026-04-23 Canonical Root Handoff Artifact](./2026-04-23-canonical-root-handoff-artifact.md)
- [2026-04-23 Claude Source Of Truth Across Offline Repos](./2026-04-23-claude-source-of-truth-across-offline-repos.md)
- [2026-04-23 Recognize Staging As Active Environment](./2026-04-23-recognize-staging-as-active-environment.md)
- [2026-04-22 Canonical Test Roots And Repo Archives](./2026-04-22-canonical-test-roots-and-repo-archives.md)
- [2026-04-22 Stable Current Report Entry](./2026-04-22-stable-current-report-entry.md)
- [2026-04-19 Collapse Environments To Local And Production](./2026-04-19-collapse-environments-to-local-and-production.md)
- [2026-04-18 Sync Endpoint Staging Verification](./2026-04-18-sync-endpoint-staging-verification.md)
- [2026-04-18 Document Publish Draft To Active Gap](./2026-04-18-document-publish-draft-to-active-gap.md)

## 使用方式

- 要改既有流程前，先確認這裡是否已經有相關 decision。
- 如果新變更會跨多個任務生效，建議補新的 decision 檔，而不是只留在 PR 或 commit 討論裡。
- 新增 decision 時，請同步更新本頁與 [docs/.vitepress/config.ts](../.vitepress/config.ts) 的 sidebar。
