# Evals

這一區收錄針對 LLM 行為與系統輸出的可重跑評測，用來驗證 prompt、retrieval、
tool-selection 等決策不會因模型或 metadata 變動而出現回歸。

## 適用情境

- 想知道某個 LLM 行為（tool selection、query rewrite、citation 等）目前的命中率。
- 在改 prompt、改 schema、換模型前後，要拿同一份題組做基線對照。
- 在 acceptance 流程中需要量化證據而非只看單次手測。

## 現有評測

- [MCP Tool Selection](./mcp-tool-selection.md)

## 維護方式

- 新增評測檔案時，請同步更新本頁與 [docs/.vitepress/config.ts](../.vitepress/config.ts)
  的 `/evals/` sidebar。
- 若評測對應某個 spec 或 change，於 frontmatter 或開頭明確標註。
