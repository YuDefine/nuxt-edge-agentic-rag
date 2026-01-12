---
description: 遠端 MCP 使用限制
globs: ["server/**/*.ts"]
---

# MCP Remote Database

若有遠端資料庫 MCP 連線，遵循以下規則：

- **ONLY** use remote MCP for: SELECT queries, debugging, checking data
- **NEVER** 用 production MCP 做 bulk data dump 或連續超過 5 次查詢
- **NEVER** 用 Agent/subagent 自動化批量查詢 production MCP
- Production MCP 允許：單次少量查詢（≤5 次/對話）用於確認 schema、檢查特定記錄、緊急除錯
