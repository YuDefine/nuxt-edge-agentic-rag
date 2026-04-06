# 專案風格審查規則

Code review 時，除了標準檢查項目外，**MUST** 額外檢查以下專案特定規則。
違反項目歸類為 🟠 Major。

## 自定義 Review 清單熱區

若本次變更包含下列路徑，**MUST** 逐條套用對應 checklist，而不是只做一般風格審查：

| 變更路徑                                                       | 必跑 checklist                          |
| -------------------------------------------------------------- | --------------------------------------- |
| `server/api/**`                                                | 資料存取模式、Bug 修正文件同步          |
| `shared/schemas/**`、`shared/types/**`                         | 資料存取模式（schema 為 contract 來源） |
| `server/db/schema.ts`、`server/database/migrations/**`         | 資料存取模式（DB schema 變更）          |
| `app/**/*.vue`、`app/components/**`、`app/pages/**`            | 元件替代規則、Form 驗證模式             |
| `.claude/rules/**`、`.claude/skills/**`、`.claude/commands/**` | 規則 / skill 變更影響後續 review 行為   |

## 元件替代規則

| 禁止使用                                                                                                                                                                                | 應替換為                                                                                                                  | 說明                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<img>`                                                                                                                                                                                 | `<NuxtImg>`                                                                                                               | 使用 Nuxt Image 模組，支援自動最佳化、lazy loading、responsive sizes。除非有 `<!-- raw-img -->` 註解明確標記例外。                                                                                                                                       |
| 原生 HTML date / time 輸入：`<input type="date">`、`<input type="datetime-local">`、`<input type="time">`、`<input type="month">`、`<input type="week">`，或包成 `<UInput type="date">` | `<UCalendar>`（[@nuxt/ui Calendar](https://ui.nuxt.com/docs/components/calendar)），搭配 `UPopover` 做為 date picker 觸發 | 原生 date picker 在不同瀏覽器外觀不一致、無法套用 design system theming、a11y 行為不可控、無法本地化日期格式（zh-TW vs en-US）、無法支援 disabled date / range 等需求。例外：純後端工具腳本、admin debug 內部頁面可豁免，**MUST** 在 PR 註明理由與位置。 |

## 資料存取模式

| 禁止使用                                                                                                    | 位置                  | 說明                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Drizzle 寫入操作：`db.insert()` / `db.update()` / `db.delete()`，或從 `'hub:db'` import 後執行任何 mutation | `app/**`（client 端） | Client 端只能透過 `useFetch` / `$fetch` / Pinia Colada 呼叫 server API。所有 DB 寫入必須在 `server/api/**` 內執行。            |
| `await import('hub:db')` 出現在 `app/**`                                                                    | `app/**`              | `hub:db` 是 Nitro server-only module，import 進 client bundle 會 build 失敗或洩漏 secret。Client 端應改呼叫對應的 server API。 |
| 在 `server/api/**` 跳過 `getValidatedQuery` / `readValidatedBody` + Zod 直接讀 `event.context.params`       | `server/api/**`       | 所有外部輸入必須經 Zod schema 驗證。違反會讓型別契約與 runtime 不一致，且失去 contract drift guard。                           |
| 在 handler 出口回傳未經 schema `.parse()` 包裝的物件（若該路由有定義 response schema）                      | `server/api/**`       | 出口若有對應的 response schema，必須用 `.parse()` 防止型別漂移；否則改動 schema 卻沒改 handler 不會被任何檢查抓到。            |
| handler 第一行不是 `const log = useLogger(event)`                                                           | `server/api/**`       | 違反 `logging.md` — 後續所有 log.error / log.set 都會 fallback 到 root logger，失去 request 關聯。                             |
| 在 `server/api/**` 用 `consola` / `console.log` / `console.error`                                           | `server/api/**`       | 必須用 `useLogger(event)`，consola 沒有 request context、不會聚合到 evlog drain。                                              |
| 對同一錯誤路徑呼叫 `log.error` 兩次以上                                                                     | `server/api/**`       | 每個錯誤只能 log 一次，重複記錄 = 重複告警。違反 `logging.md`。                                                                |

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
