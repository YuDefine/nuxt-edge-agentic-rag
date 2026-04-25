## Context

`/api/chat` 走完 `chatWithKnowledge` 後，只有 `result.refused === false` 且 `result.answer !== null` 的路徑會把 assistant message 寫入 `messages` table。所有 refusal 路徑（audit-blocked、pipeline_refusal、pipeline_error）只寫了 user message，沒寫對應的 assistant 拒答訊息。

UI 即時 render 的 RefusalMessage（前端 SSE `refusal` event 觸發）僅存在於 client state；只要使用者重新載入該對話，後端回傳的 messages list 就會少掉那則拒答 assistant message，看起來像「我問了卻沒人回我」。

`ChatMessage` type（`app/types/chat.ts`）已經帶 `refused: boolean`，但這個欄位從沒有從 DB 取出來——載入歷史對話時是直接用 `content === '抱歉，我無法回答這個問題。'` 的字串比對作為 fallback，這在 v1.0.0 messages 結構從未顯式記錄過 refusal 狀態的情況下根本走不到。

同時，sidebar 與入口的「新對話」按鈕目前只放 `i-lucide-plus` icon，沒有可見文字 label。使用者要靠 hover tooltip 或 aria-label 才看得出按鈕用途，跨 mobile / 桌面也容易被誤判為裝飾性 icon。

## Goals / Non-Goals

**Goals:**

- 讓 messages table 成為 refusal 訊息的 single source of truth：refusal 訊息與正常回答都被持久化，並由 `refused` 欄位區分；`refusal_reason` 欄位記錄具體原因供 reload UI 使用。
- 重新載入歷史對話時能完整還原 RefusalMessage UI（含建議下一步、可能原因區塊），且依 reason 顯示具體文案而非通用模板。
- audit-blocked、pipeline_refusal、pipeline_error 三條路徑統一寫入 assistant message，並帶上對應的 refusal_reason。
- audit-block 路徑下對話標題採用固定中文 fallback，避免內部 redaction marker（如 `[BLOCKED:credential]`）外洩到 sidebar / 全頁 UI。
- SSE refusal event payload 帶 reason，前端即時 render 與重載 render 走同一條 reason 路由。
- `RefusalMessage.vue` 依 reason 切換具體文案（restricted_scope / no_citation / low_confidence / pipeline_error 各一份）；reason 缺漏時 fallback 通用文案。
- sidebar 與入口的「新對話」按鈕含可見文字 label，跨 mobile / desktop 都讓使用者馬上看出用途。

**Non-Goals:**

- 不調整 `query_log.refusal_reason` 設計；該欄位仍是「為何拒答」的觀測記錄，與 messages.refused 並存而非互相取代。
- 不對 migration 前的歷史對話回填 refused = 1：原本就沒寫入 assistant message，沒有資料可回填；新欄位 default = 0 即可，舊資料維持原狀。
- 不改 `RefusalMessage.vue` 元件本身；它已經支援從 ChatMessage 渲染。
- 不為「新對話」按鈕加 dropdown / 額外功能，只純化 label。
- 不改 SSE refusal event 的 payload shape（前端 `createAssistantMessageFromTerminalEvent` 已經產生 `refused: true` 的 ChatMessage，本變更只是讓重載走相同路徑）。
- 不調整 MCP 路徑的 `askKnowledge` 流程；MCP 沒有 web conversation 概念，但共用 `auditStore.createMessage` 介面，本變更會把 `refused` 欄位下放到介面，MCP 寫入時帶 `refused: false`（MCP 拒答另有契約，本次不擴張）。

## Decisions

### Schema：新增 messages.refused INTEGER NOT NULL DEFAULT 0

採用獨立 boolean 欄位（D1 / SQLite 用 INTEGER 0/1），不採 metadata JSON。

理由：

- refusal 是少數需要在重載 UI 時做分支判斷的訊息屬性，獨立欄位讓前端 / API 不必反序列化即可分支。
- 未來若有 admin observability 需要篩 refusal 訊息，獨立欄位可建索引（雖然 v1.0.0 暫不建）。
- 與 `query_log.refusal_reason` 並存：messages.refused 是「DB 是不是拒答訊息」事實層；query_log.refusal_reason 是「為何拒答」觀測層。

替代方案：

- `metadata JSON` — 彈性高但每次讀都要 parse、靜態類型不友善，否決。
- 用 `content === '抱歉，我無法回答這個問題。'` 字串比對 — 脆弱且把 UI 文案綁進邏輯，否決。

### 持久化策略：refusal 三路徑都寫 assistant message

- audit-blocked 路徑：在現有 createQueryLog（status: 'blocked'）之後，補一筆 `auditStore.createMessage({ role: 'assistant', content: '抱歉，我無法回答這個問題。', refused: true, conversationId, queryLogId })`。
- pipeline 主流程後：把目前 `if (!result.refused && result.answer !== null)` 拆成兩支：
  - `result.refused === true` → 寫 refusal assistant message（refused: true，無 citationsJson）
  - `result.refused === false && result.answer !== null` → 寫正常 assistant message（refused: false，含 citationsJson）
- pipeline_error（throw 路徑）：在 `catch` 中除了 update query_log，也寫一筆 refusal assistant message。後續 client 重載時即使這次 request 沒成功 stream 完，仍能看到「無法回答」紀錄，與當下 SSE error 的使用者體驗一致。

替代方案：

- 只在 audit-blocked + pipeline_refusal 持久化，pipeline_error 留白 — 否決，因為 error 路徑同樣會讓使用者看到 RefusalMessage（容器層 catch 後 render），重載卻空白，與本次目標矛盾。

### Refusal content 採固定字串 '抱歉，我無法回答這個問題。'

與前端 `createAssistantMessageFromTerminalEvent` 一致；不存放動態理由文案。RefusalMessage UI 中的「可能原因 / 建議下一步」是 component 內建模板，不依賴 content 內容，因此寫死字串不會限制 UI 表達。未來若要按 refusal_reason 分流文案，可從 query_log.refusal_reason JOIN 取出，不需動 messages.content。

### API contract：在 conversation messages list 帶上 refused

- `GET /api/conversations/[id]/messages` 與 `GET /api/conversations/[id]` 的 messages list 都帶 `refused: boolean`。
- `shared/types` 的 `ChatConversationMessage` 加 `refused: boolean`。
- `app/utils/chat-conversation-state.ts` `mapConversationDetailToChatMessages` 把 `refused` 從 detail 帶到 ChatMessage，移除舊有可能仰賴字串比對的 fallback。

### Refusal reason 持久化（messages.refusal_reason TEXT NULL，方案 A）

mid-apply 使用者驗收揭露 RefusalMessage 必須按 reason 顯示具體說明，故需要把 reason 從 server 傳到 reload UI。兩個方案：

- 方案 A：messages 加 `refusal_reason TEXT NULL`，與 `refused` 對稱（fact + reason）
- 方案 B：reload 時 SELECT JOIN `query_logs.refusal_reason`

採用方案 A。

理由：

- 與 `refused` 同形（「是不是拒答」事實層 + 「為什麼拒答」具體層），讀寫對稱、SELECT 簡單。
- 反正 0013 migration 已經要動 messages，0014 再加一個欄位邊際成本低。
- query_logs 是觀測層，未來可能 sample / TTL，messages 是會話歷史，不該對齊它的生命週期。
- 加索引彈性大（雖然 v1.0.0 還不需要）。

替代方案：

- JOIN query_logs — SELECT 變複雜、不同層耦合、未來 query_logs 若有 retention 政策會把訊息層的 reason 一起丟掉，否決。

### Audit-block 對話標題改採固定中文 fallback

`server/api/chat.post.ts` 在新對話時用 `auditKnowledgeText(body.query).redactedText.trim().slice(0, 40)` 當 title。當 audit.shouldBlock = true，redactedText 整段被 marker 覆蓋（例如 `[BLOCKED:credential]`），這個內部 marker 會直接出現在 sidebar 對話標題與全頁 UI——既不是中文、也不是有意義的描述。

修法：在進入 createForUser 前先檢查 audit.shouldBlock；若為 true，採用固定中文 fallback `'無法處理的提問'`（不超過 conversations.title 長度限制），其他路徑維持原 slice 邏輯。

理由：

- redactedText 的設計目的是「把敏感資訊從 audit log 裡擦掉」，並不是「給使用者看的標題」。把它直接當 UI title 是 layering 錯誤。
- 固定 fallback 雖然不能反映原問題，但本來這條 query 連 raw 都不該存（governance §1.4）；title 用語義化中文反而更貼近使用者預期（「我問了一個敏感的問題，系統幫我建了一個拒答對話」）。
- 不採取「不建立對話」的方案，因為 messages 仍要寫入持久化（前案 §持久化策略），需要載體。

替代方案：

- 直接不建 conversation — 否決，refusal message 沒地方寫。
- title 寫使用者原 query 前 40 字 — 否決，等於把敏感字面留在 conversations.title，破壞 audit 的目的。

### 「新對話」按鈕從純 icon 變成 icon + 文字 label

- 桌機：`<UButton icon="i-lucide-plus" label="新對話" />`，沿用現有 nuxt/ui 樣式 props（color / variant 顯式寫出）。
- Mobile：sidebar 折疊時仍顯示 label（現行 sidebar 主要在 viewport 較窄時透過 sheet / drawer 展開，展開後空間夠放 label）。若有極窄入口（例如 header 上方的 plus icon），維持 icon-only + aria-label 並標示為 secondary entrypoint，主要按鈕一律 icon + label。
- 不改 click handler 或 navigation 行為；只改 visual shell。

替代方案：

- 全平台 icon-only + tooltip — 否決，使用者反映此為痛點。
- 純文字 button（移除 icon）— 否決，icon 仍有助掃描識別，移除會降低資訊密度。

## Risks / Trade-offs

- [Risk] 新欄位 NOT NULL DEFAULT 0 在 D1 對既有 row 做 backfill 時觸發整表掃描 — 目前 messages 表規模小（v1.0.0 早期），影響可接受。Mitigation: migration 在 staging / production 套用前先 `pragma table_info` 與 row count 確認。
- [Risk] 三條 refusal 路徑都要新增 createMessage call，可能讓 audit store 的測試 fixture / mock 過時 — Mitigation: 在 `auditStore` 介面集中加 `refused?: boolean`，並在 `createKnowledgeAuditStore` 預設未帶值時視為 false（user message / 既有 spec 行為不破）。
- [Risk] mcp-ask.ts 共用 `auditStore.createMessage` 介面，refused 欄位變成介面一部分 — Mitigation: MCP 寫入處 explicit pass `refused: false`，並在介面 docstring 標註 MCP 不啟用此 flag；未來 MCP 拒答契約另案處理。
- [Risk] 「新對話」按鈕 label 化後，極窄 viewport（< 360px）可能擠壓其他 sidebar 元素 — Mitigation: 在 mobile breakpoint 用 `truncate` + `min-w-0`，並透過 screenshot review 抽 360 / 768 / 1280 三個 viewport。
- [Trade-off] 不回填舊資料 → 既有歷史對話的 refusal 訊息仍會缺漏。Mitigation: 在 `docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md` 註記此行為，必要時提供管理員手動標註用 SQL（後續工作，不在本 change scope）。

## Migration Plan

1. 部署 `0013_messages_refused_flag.sql`：`ALTER TABLE messages ADD COLUMN refused INTEGER NOT NULL DEFAULT 0`。
2. 部署 `0014_messages_refusal_reason.sql`：`ALTER TABLE messages ADD COLUMN refusal_reason TEXT`。0013 與 0014 為兩條獨立 migration（不合併）以保持每條 migration 單一職責；0014 雖然可以併入 0013，但分開讓 mid-apply ingest 的 schema 變化更可追溯。
3. 同 deploy：server code 同步加上 refused / refusal_reason 欄位的寫入與讀出，audit-block path 採固定中文 fallback title，SSE refusal event payload 加 reason，`RefusalMessage.vue` 依 reason 切換具體文案。
4. Verify：
   - Local：跑 `pnpm test:integration` 含 web-chat persistence refusal path 四條（audit-block / pipeline_refusal / pipeline_error / accepted）+ migration 0014 schema test + audit-block title fallback test。
   - Staging（若已啟用）：執行 acceptance script 對 audit-blocked / pipeline 拒答兩種輸入確認 messages.refused = 1、messages.refusal_reason 寫入正確、reload 後 RefusalMessage UI 渲染 reason-specific 文案。
5. Rollback：若 server code 回滾但 schema 已遷移，`refused` 欄位仍 default 0、`refusal_reason` 仍 NULL；不會破壞舊 server。若連同 schema 一起回滾，需先 backfill schema（D1 SQLite 不支援 DROP COLUMN）— 因此 schema 變更為單向，rollback 只回滾 server code。
