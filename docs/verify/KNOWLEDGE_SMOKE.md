# Knowledge Smoke

## Purpose

在 local 或 production 環境驗證 bootstrap-v1-core-from-report 的最小閉環，覆蓋 allowlist、publish、web answering、MCP ask/replay/search/categories 與治理規則。本專案 `v1.0.0` 採 local + production 雙環境，不獨立部署 staging / preview；smoke 流程在兩個環境皆適用，差異僅在 backdated / shortened TTL 驗證僅限 local 執行。

## Preconditions

- local 與 production 各自使用獨立的 D1、R2、KV、AI Search bindings
- 已準備一組 allowlisted admin 帳號、一組一般 web user、一組 restricted MCP token、一組 non-restricted MCP token
- 已有可上傳的 md 或 txt 測試文件

## Smoke Steps

1. Web allowlist
   - 使用一般 web user 登入，確認無 admin 能力或管理入口。
   - 使用 allowlisted admin 登入，確認具備 admin 能力。

2. Publish flow
   - 走 presign → finalize → sync → publish。
   - 確認 publish API 成功後 current version 切換完成。

3. Web answering
   - 對 current version 內容提問，確認回答與 citation 正常返回。
   - 使用包含 credential/PII 的高風險輸入，確認請求被拒答且不執行 downstream retrieval。

4. MCP surface
   - `askKnowledge` 成功回答並返回 citations。
   - `getDocumentChunk` 可以回放剛取得的 citation。
   - non-restricted token 對 restricted citation 取得 `403`。
   - `searchKnowledge` 對可見資料返回結果，查無結果時返回 `200` + 空陣列。
   - `listCategories(includeCounts=true)` 只計可見 current documents。

5. Governance
   - 連續觸發 `/api/chat` 或 MCP tool 直到超限，確認返回 `429` 且不再消耗後端工作。
   - 檢查 `query_logs` 與 `messages`，確認僅保存 redacted content 或 blocked markers。

## Evidence To Capture

- Web chat 回答與 citation replay 截圖
- MCP ask/search/categories 的請求與回應摘要
- rate limit `429` 響應
- `query_logs` / `messages` 的 redacted persisted rows
