# 專案風格審查規則

Code review 時，除了標準檢查項目外，**MUST** 額外檢查以下專案特定規則。
違反項目歸類為 🟠 Major。

## 元件替代規則

| 禁止使用 | 應替換為    | 說明                                                                                                               |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `<img>`  | `<NuxtImg>` | 使用 Nuxt Image 模組，支援自動最佳化、lazy loading、responsive sizes。除非有 `<!-- raw-img -->` 註解明確標記例外。 |

## 資料存取模式

| 禁止使用                               | 位置                     | 說明                                                                      |
| -------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| 直接寫入資料庫（insert/update/delete） | `app/` 目錄（client 端） | Client 端只能讀取資料。所有寫入必須透過 `server/api/v1/*` 的 Server API。 |

## Bug 修正文件同步

若本次變更包含 `🐛 fix` 類型的 commit，檢查是否已更新 `docs/verify/PRODUCTION_BUG_PATTERNS.md`。該文件記錄已發生過的錯誤模式與防範措施，修正 bug 時應同步補充對應的 Pattern 紀錄。

## Form 驗證模式

專案已內建 `@nuxt/ui` 的 `UForm` 與 `zod`，**MUST** 用於所有多欄位表單。違反時視為 🟠 Major。

| 禁止的寫法                                                                                    | 正確的替代方案                                                                                                    | 說明                                                                                                                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `<UButton :disabled="!field1 \|\| !field2" @click="submit">`                                  | `<UForm :schema="zodSchema" :state="state" @submit="onSubmit"><UButton type="submit">`                            | 手寫 `:disabled` 鎖 submit 沒有告訴使用者缺什麼、也不會 inline 顯示錯誤。UForm + Zod 會自動 focus 第一個錯誤欄位並 inline 提示。    |
| `<UFormField label="標題">` 但該欄實際必填                                                    | `<UFormField label="標題" name="title" required>` + schema 對應欄位 `z.string().min(1)`                           | 必填必須在 UI 上有星號標示；`name` 屬性才能讓 UForm 把 Zod 錯誤對應到欄位。                                                         |
| 從使用者輸入（檔名、標題等）自動產生識別字串（slug / id）後未處理「結果為空字串」的 edge case | 產生後必須 `if (!result) result = fallback()`（例如 `crypto.randomUUID().slice(0, 8)`），或顯式提示使用者手動填寫 | 全中文、emoji、純符號等輸入經 `[^a-z0-9]+` replace 後會變成空字串，欄位只剩 placeholder 看起來像已填、實際為空 → 使用者無法 debug。 |
| 把 `placeholder` 當作「這欄已有值」的視覺訊號                                                 | `placeholder` 僅供範例；必填提示用 `required` / inline error                                                      | placeholder 是灰字提示，使用者無法區分「已填」與「範例文字」。                                                                      |

**檢查動作**：

1. 掃 `app/**/*.vue` 中的 `<UButton[^>]*:disabled=` — 若 disabled 條件引用多個 form state，flag 為 🟠 Major，建議改用 UForm
2. 掃 auto-generate slug / id 邏輯 — 確認有空值 fallback
3. 掃 `<UFormField>` — 若對應 schema 欄位是 `.min(1)` 或非 optional，UFormField 必須有 `required` 且 `name` 屬性
