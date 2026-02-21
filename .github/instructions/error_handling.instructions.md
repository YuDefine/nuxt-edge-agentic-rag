---
description: 錯誤處理規範（Server 驗證 + Client 顯示）
globs: ['app/**/*.{vue,ts}', 'server/**/*.ts']
---

# Error Handling

**Server-side 驗證**：使用 Zod schema 驗證請求資料，錯誤回傳 `statusMessage`
**NEVER** 在 `createError()` 中傳遞 `data` 屬性 — 可能洩漏內部錯誤細節

**Client-side 錯誤顯示**：使用 `toastError(title, error)` 或 `getErrorMessage(error, fallback)`
**NEVER** 直接讀取 `error.message` 顯示給使用者 — 可能包含堆疊追蹤或內部資訊

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## 資料存取錯誤診斷

不同資料供應者會回傳不同格式的錯誤碼，但 handler 應統一轉成穩定的 HTTP 狀態與使用者可理解的訊息。

### 常見錯誤類型

| 類型                      | HTTP      | 情境                     | 處理方式                     |
| ------------------------- | --------- | ------------------------ | ---------------------------- |
| Unique conflict           | 409       | 唯一鍵衝突               | 回傳「資料已存在」           |
| Foreign key               | 409       | 關聯資料不存在或仍被引用 | 回傳關聯資料錯誤             |
| Permission denied         | 401 / 403 | 權限不足或未登入         | 轉為 auth / permission 錯誤  |
| Not found                 | 404       | 查詢不到資源             | 轉為 404，不要直接丟底層錯誤 |
| Timeout / pool exhausted  | 503 / 504 | 連線池滿或後端逾時       | `log.error` + 告警           |
| Validation / domain error | 400       | 業務邏輯錯誤             | 轉為清楚的使用者訊息         |

### 處理原則

- **4xx 是 caller 的錯**（user input / stale type）→ 不要 `log.error`，轉友善訊息即可
- **5xx / 503 / 504 是系統問題** → `log.error` + 告警
- **查不到資源** 應明確轉成 `404`，不要把底層供應者的原始錯誤直接拋給 client
- **權限錯誤** 應在 server 端統一處理，避免把 provider-specific 權限模型暴露到 client
