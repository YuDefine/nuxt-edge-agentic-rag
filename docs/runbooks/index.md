# Runbooks

本區收錄短篇、單一主題、可直接操作的手冊，適合在已知道問題類型或任務範圍時快速查閱。

## 適用情境

- 需要執行某一個明確操作，而不是閱讀完整驗證流程。
- 已知主題明確，希望快速取得步驟與注意事項。
- 想先查局部操作，再回到較完整的驗證或架構文件補背景。

## 現有文件

- [remote-mcp-connectors](./remote-mcp-connectors.md)
- [guest-policy](./guest-policy.md)

## 與驗證指南的差異

- Runbooks：篇幅較短，聚焦單一主題與直接操作。
- [驗證指南](../verify/index.md)：涵蓋較完整的驗證流程、部署手冊、checklist 與 QA 文件。

## 維護原則

- 適合放入單一主題、可獨立執行的操作手冊。
- 若文件需要涵蓋完整驗證流程、跨步驟檢查或多角色協作，應優先放在 verify 區。
- 新增 runbook 後，需同步更新 [docs/.vitepress/config.ts](../.vitepress/config.ts) 的 sidebar。
