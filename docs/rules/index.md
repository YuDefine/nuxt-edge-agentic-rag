# 開發規則

這一頁不是規則全文，而是開發者入口。真正的規則內容仍在 repo 內維護，但你不需要先知道所有檔名，先知道去哪一類規則找答案比較重要。

## 規則來源

- `.claude/rules/`：Claude 工作流與專案規範的主要來源。
- `AGENTS.md`、`CLAUDE.md`：由規則同步後可直接到達的 project-wide instruction surface。

## 常用規則類型

### 開發流程

- development
- testing-anti-patterns
- review-tiers
- scope-discipline

### API 與錯誤處理

- api-patterns
- logging
- error-handling

### 文件、handoff 與 follow-up

- knowledge-and-decisions
- handoff
- follow-up-register

### UX / design / completeness

- proactive-skills
- ux-completeness
- screenshot-strategy

## 使用方式

- 要動 API：先看 api-patterns、logging、error-handling。
- 要做 UI / 流程：再補 proactive-skills、ux-completeness。
- 要做較大變更：補看 review-tiers、scope-discipline、handoff。

## 備註

- 文件站這裡先保留入口頁，避免 docs 內出現無法解析的目錄連結。
- 如果後續要把規則做成可瀏覽索引頁，建議另外做產生式清單，而不是手動複製規則全文。
