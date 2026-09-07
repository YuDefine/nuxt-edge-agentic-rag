## Context

目前系統的後端已經有對話持久保存骨架：

- `/api/chat` 會驗證或自動建立 `conversationId`
- `messages` 同時保存 `content_text` 與 `content_redacted`
- `/api/conversations` 已可 list/get/delete/messages
- soft delete 已定義 `content_text` purge 與 `content_redacted` 保留

但前端 `ChatContainer` 仍只送出 `{ query }`，`ConversationHistory` 也仍顯示「未來版本提供」，所以使用者實際體驗還不等於「已完成聊天持久保存」。報告因此出現 code truth 與 report truth 分裂。

## Goals / Non-Goals

**Goals:**

- 讓 Web 使用者真的能使用持久保存對話，而不只是後端已能寫入。
- 讓聊天歷史在 reload 後仍可讀取、切換與續問。
- 讓刪除對話的治理規則在 UI/API/資料層一致成立。
- 讓 `local/reports/latest.md` 能以已完成語氣描述此功能，且有測試/證據支撐。

**Non-Goals:**

- 不引入 MCP session state。
- 不重新設計整個問答頁資訊架構。
- 不新增第二套 conversations store 或前端獨立真相來源。

## Decisions

1. **沿用既有 `conversations/messages` 作為唯一真相來源**
   不重做 schema，不另建前端 local-only history model。前端只負責載入、切換、刪除、續問與顯示。

2. **完成定義以使用者可觀察行為為準，不以前後端單邊落地自稱完成**
   本 change 完成後，至少要滿足：
   - 第一次提問自動建立對話
   - 重整頁面後歷史仍存在
   - 點選歷史可重載訊息與引用
   - 在同一對話續問時沿用同一 `conversationId`
   - 刪除後該對話從列表與詳情消失，且一般路徑不可回顯原文

3. **報告更新必須以 shipped + verified behavior 為門檻**
   若某段體驗還未對一般 Web 使用者完成，就不能在報告中寫成已完成；反過來，若本輪功能閉環完成，報告中所有「未支援 / 後續治理深化階段補齊」的舊描述都必須同步移除或改寫。

4. **驗收證據需覆蓋 create / reload / select / delete 四個關鍵路徑**
   單靠 schema 或 API 測試不足以支持報告宣稱「已完成 Web 對話持久保存」，至少要有能對應使用者體驗的驗證證據。

## Risks / Trade-offs

- **風險：scope 膨脹**
  若把聊天 UI 全面重構一起做，會拖慢真正需要的閉環交付。

- **風險：報告再度超前實作**
  若先改報告再補 UI/證據，會再次產生失真。

- **取捨：保留既有治理設計**
  沿用 `content_text` / `content_redacted` 雙軌與 soft-delete purge，能降低風險；代價是前端讀取與刪除行為必須嚴格遵守既有 API 契約。
