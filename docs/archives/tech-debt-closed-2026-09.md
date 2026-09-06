# Closed Tech Debt — 2026-09

本檔是 append-only 結案索引。編號不重用；原始 disposition 與驗證紀錄在
`tasks/2026-09-06-backlog-cleanup.md`。

## Source collision — deploy-workflow contract test

**Original source key**: TD-071

**Status**: resolved（source key collision; no new TD ID allocated）

> `TD-071` 已由 `docs/archives/tech-debt-closed-2026-06.md` 的 AutoRAG → AI Search API migration
> entry 使用；本 receipt 刻意不重用該 ID。

### Resolution/Reason

在 `test/helpers/config-text.ts` 新增 `behaviourView()`，先濾掉 YAML `#` 與 JSONC `//` 整行註解，
再讓 `test/unit/deploy-workflow-config.test.ts` 與 `test/unit/deploy-workflow-passkey-env.test.ts`
對行為 view 斷言，避免 workflow 註解讓測試假綠。

### Evidence

commit `1896b929` 的 mutation 實證：只保留註解並刪除 secret 注入時，原文斷言會假 PASS、
`behaviourView` 會 FAIL；完整測試結果為 128 test files / 829 tests 全綠。
