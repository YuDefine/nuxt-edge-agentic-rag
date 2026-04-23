# Remote MCP 連接（Claude 與 ChatGPT）

本手冊說明如何讓本專案的 `/mcp` 以 **OAuth-compatible remote MCP** 方式接到 Claude remote connector 與 ChatGPT 自定義應用程式 / connector，並保留 legacy Bearer token + Desktop bridge 作為 migration / internal tooling 路徑。

## 結論先講

- 正式主路線已改為：**既有本地帳號 + known connector allowlist + OAuth-compatible remote MCP**
- 正式 consumer 已涵蓋：
  - **Claude remote connector**：可走 known connector allowlist
  - **ChatGPT 自定義應用程式 / connector**：可走 ChatGPT Dynamic Client Registration（DCR）
- `Authorization: Bearer <legacy token>` 仍可用，但定位只限 migration、Inspector、內部驗證與非使用者型 automation
- 若要給一般使用者直接授權使用，**不要**再引導他們手貼 legacy token

## 架構摘要

```text
Claude remote connector
  -> GET /api/auth/mcp/authorize
  -> 使用者以既有 better-auth 帳號登入
  -> consent UI 確認 granted scopes
  -> POST /api/auth/mcp/authorize
  -> POST /api/auth/mcp/token
  -> Bearer <oauth access token> 呼叫 /mcp
  -> middleware 解析 principal.userId
  -> role / guest policy / restricted replay 沿用既有治理
```

同一個 `/mcp` endpoint 仍同時接受：

- OAuth access token：正式 remote connector 路線
- legacy MCP token：migration-only 路線

ChatGPT 自定義應用程式會多走一次 dynamic registration：

```text
ChatGPT Create connector
  -> GET /.well-known/oauth-protected-resource
  -> GET /.well-known/oauth-authorization-server
  -> POST /api/auth/mcp/register
  -> 回傳 client_id metadata document URL
  -> ChatGPT OAuth 授權流程接回 /auth/mcp/authorize
  -> POST /api/auth/mcp/token
  -> Bearer <oauth access token> 呼叫 /mcp
```

## 必備設定

### 1. Runtime config

以下變數會影響 remote connector rollout：

| 變數                                                | 用途                   | 建議值                                                    |
| --------------------------------------------------- | ---------------------- | --------------------------------------------------------- |
| `NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON`         | known client allowlist | Claude 至少包含 `claude-remote`；ChatGPT DCR 不必預先配置 |
| `NUXT_KNOWLEDGE_MCP_ACCESS_TOKEN_TTL_SECONDS`       | access token TTL       | `600`                                                     |
| `NUXT_KNOWLEDGE_MCP_AUTHORIZATION_CODE_TTL_SECONDS` | authorization code TTL | `120`                                                     |

`NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON` 範例：

```json
[
  {
    "clientId": "claude-remote",
    "enabled": true,
    "allowedScopes": [
      "knowledge.ask",
      "knowledge.search",
      "knowledge.category.list",
      "knowledge.citation.read"
    ],
    "environments": ["production"],
    "name": "Claude Remote",
    "redirectUris": ["https://claude.ai/api/mcp/auth_callback"]
  }
]
```

注意事項：

- 這是 **allowlist config**，不是 secret；可用 `wrangler secret put` 或 `vars` 管理，但 production 仍建議走受控流程更新
- 若值缺失、JSON 格式錯誤、或不是陣列，Nuxt 啟動會直接失敗，避免 silent misconfig
- 若 registry 為空，remote connector 授權流程會在 `/api/auth/mcp/authorize` 直接拒絕 unknown client
- Anthropic 官方目前的 Claude OAuth callback URL 是 `https://claude.ai/api/mcp/auth_callback`；若之後官方變更，`redirectUris` 也必須跟著更新
- ChatGPT DCR 會由 `/api/auth/mcp/register` 產生 `client_id` metadata document URL；目前只接受 `https://chatgpt.com/connector/oauth/<callback_id>` 與 legacy `https://chatgpt.com/connector_platform_oauth_redirect`

### 2. 本地帳號前提

使用者必須先有本系統既有帳號。授權流程 **不會** 自動建帳。

允許的登入來源：

- Google OAuth
- Passkey（若 feature flag 開啟）

若 session 沒有對應本地 `user.id`，授權頁會顯示「無法辨識本地帳號」並拒絕繼續。

## Claude remote connector 上線流程

### Operator 準備

1. 設好 `NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON`
2. 確認 client 的 `redirectUris`、`allowedScopes`、`environments` 正確
3. 確認部署環境可從外網存取 `/api/auth/mcp/authorize`、`/api/auth/mcp/token`、`/mcp`
4. 確認測試帳號已可登入本系統，且角色 / guest policy 符合預期

### 使用者授權流程

1. Claude 送使用者到 `/auth/mcp/authorize?...`
2. 未登入者先看到本地帳號登入卡片
3. 已登入者看到 consent 卡片，列出：
   - 目前授權帳號
   - connector 名稱
   - requested / granted scopes
4. 使用者按「允許並繼續」後，系統發 authorization code 回 connector
5. connector 用 code 打 `/api/auth/mcp/token`
6. 之後以 `Bearer <oauth access token>` 呼叫 `/mcp`

### Claude Desktop 實際操作步驟

以下步驟是站在「你已經把本站部署到公開網址，且 runtime config 已設好」的前提。

1. 打開 Claude Desktop。
2. 進入 `Settings > Connectors`。
3. 點 `Add connector` 或 `Add custom connector`。
4. `Connector name` 輸入任意名稱，例如 `Yuntech RAG`。
5. `Connector URL` 輸入你的遠端 MCP endpoint，例如 `https://agentic.yudefine.com.tw/mcp`。
6. 若 UI 有 `Advanced settings`：
   - `OAuth Client ID` 填 `claude-remote`
   - `OAuth Client Secret` 留空
7. 按 `Add`。
8. 在 connector 列表找到剛新增的項目，按 `Connect`。
9. Claude 會開啟本專案的 `/auth/mcp/authorize` 授權頁。
10. 用本系統既有帳號登入。
11. 在 consent 頁確認 scope 與帳號資訊後，按「允許並繼續」。
12. 回到 Claude Desktop，開新對話。
13. 在對話左下 `+` 的 `Connectors` 裡把這個 connector 打開。
14. 先測一個 browse-safe 問題，例如「列出知識庫分類」或「搜尋某個主題」。

## ChatGPT 自定義應用程式 MCP 上線流程

> 2026-04-24 依 OpenAI Apps SDK / Developer mode 文件確認：ChatGPT Create connector 需要公開 HTTPS `/mcp` endpoint；OAuth connector 支援 static credentials 或 Dynamic Client Registration。OpenAI 文件同時建議用 developer mode、API Playground、MCP Inspector 與 golden prompts 做驗證。

### Server 端準備

1. 確認部署網域是公開 HTTPS。
2. 確認以下路徑未被 WAF / auth middleware 擋住：
   - `/.well-known/oauth-protected-resource`
   - `/.well-known/oauth-protected-resource/mcp`
   - `/.well-known/oauth-authorization-server`
   - `/api/auth/mcp/register`
   - `/api/auth/mcp/chatgpt-client-metadata`
   - `/auth/mcp/authorize`
   - `/api/auth/mcp/token`
   - `/mcp`
3. 確認 OAuth metadata 會公告：
   - `authorization_endpoint`
   - `token_endpoint`
   - `registration_endpoint`
   - `code_challenge_methods_supported: ["S256"]`
   - `token_endpoint_auth_methods_supported: ["none"]`
4. 確認測試帳號已可用 Google OAuth 或 Passkey 登入本系統。

ChatGPT DCR 不需要在 `NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON` 預先放 client；ChatGPT 會呼叫 `/api/auth/mcp/register`，server 會回傳一個 metadata document URL 形式的 `client_id`。後續 `/auth/mcp/authorize` 會讀取該 metadata document，檢查 redirect URI 是否為 ChatGPT callback，再進入既有 consent 流程。

### ChatGPT 實際操作步驟

1. 打開 ChatGPT web。
2. 進入 `Settings > Apps & Connectors > Advanced settings`，開啟 `Developer mode`。
3. 回到 `Settings > Connectors`，點 `Create`。
4. 填入：
   - `Connector name`：例如 `Yuntech RAG`
   - `Description`：說明何時使用本知識庫，例如「Use this when the user asks questions about the Yuntech project report, source documents, SOPs, or governed knowledge base.」
   - `Connector URL`：公開 MCP endpoint，例如 `https://agentic.yudefine.com.tw/mcp`
5. 點 `Create`。成功後應看到 server advertised tools。
6. 開新對話，從 composer 附近的 `+` / `More` 選取剛建立的 connector。
7. 先測 browse-safe prompt：
   - 「使用 Yuntech RAG connector 列出知識庫分類。」
   - 「只使用 Yuntech RAG connector 搜尋專題報告的 MCP 相關內容。」
8. 檢查 ChatGPT 顯示的 tool payload，確認輸入、輸出與權限提示符合預期。

### ChatGPT static credentials fallback

若 ChatGPT UI 或企業管理流程要求手動填 static OAuth client，而不是 DCR，可以改用 known connector allowlist：

```json
[
  {
    "clientId": "chatgpt-custom-app",
    "enabled": true,
    "allowedScopes": [
      "knowledge.ask",
      "knowledge.search",
      "knowledge.category.list",
      "knowledge.citation.read"
    ],
    "environments": ["production"],
    "name": "ChatGPT Custom App",
    "redirectUris": [
      "https://chatgpt.com/connector/oauth/<callback_id>",
      "https://chatgpt.com/connector_platform_oauth_redirect"
    ]
  }
]
```

`<callback_id>` 以 ChatGPT app management 頁面顯示的 production redirect URI 為準。設定後重新部署，並在 ChatGPT static client 設定中填 `chatgpt-custom-app`；client secret 留空，因為本專案的 token endpoint 使用 public client + PKCE。

### ChatGPT 驗證清單

1. `GET /.well-known/oauth-protected-resource` 回傳 `resource: https://<domain>/mcp`
2. `GET /.well-known/oauth-authorization-server` 包含 `registration_endpoint`
3. ChatGPT 建立 connector 時可成功列出 tools
4. 未登入授權頁會要求本地帳號登入
5. 已登入授權頁會顯示 consent 與 granted scopes
6. 同意後 ChatGPT 能以 OAuth access token 呼叫 `/mcp`
7. `listCategories` / `searchKnowledge` 成功
8. `askKnowledge` 依角色與 guest policy 成功或被正確阻擋
9. restricted citation replay 仍需 `knowledge.restricted.read`

### Metadata 與安全注意事項

- Connector description 會影響 ChatGPT 何時選用本 connector；描述要明確寫「Use this when...」，也要寫不該使用的情境。
- Tools 若只是讀取或查詢，metadata 應盡量標示 read-only hint；寫入或破壞性 tool 必須保留人工確認與 server-side validation。
- Tool result 的 structured content 只放當次回答需要的資料，不要把 token、secret、完整 PII 或過量原文塞進回傳。
- 所有 tool call 都必須在 server 端重新驗證 scope、角色、guest policy 與 restricted access；不要信任模型傳入的參數。
- 用 golden prompts 做回歸：direct、indirect、negative 三類都要測，避免 ChatGPT 在不該使用 connector 時誤觸。

### Operator 最短清單

如果你是要幫使用者先把 server 端準備好，最少要完成這四件事：

1. 在部署環境設定：

```bash
NUXT_KNOWLEDGE_MCP_ACCESS_TOKEN_TTL_SECONDS=600
NUXT_KNOWLEDGE_MCP_AUTHORIZATION_CODE_TTL_SECONDS=120
NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON='[
  {
    "clientId": "claude-remote",
    "enabled": true,
    "allowedScopes": [
      "knowledge.ask",
      "knowledge.search",
      "knowledge.category.list",
      "knowledge.citation.read"
    ],
    "environments": ["production"],
    "name": "Claude Remote",
    "redirectUris": ["https://claude.ai/api/mcp/auth_callback"]
  }
]'
```

2. 重新部署。
3. 確認外網可連到 `/mcp`、`/api/auth/mcp/authorize`、`/api/auth/mcp/token`。
4. 先手動打開以下 URL，確認授權頁能正常顯示：

```text
https://<your-domain>/auth/mcp/authorize?client_id=claude-remote&redirect_uri=https://claude.ai/api/mcp/auth_callback&scope=knowledge.ask%20knowledge.search%20knowledge.category.list
```

ChatGPT DCR 路線可另外用以下 smoke request 確認 registration endpoint：

```bash
curl -s -X POST "https://<your-domain>/api/auth/mcp/register" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Yuntech RAG",
    "redirect_uris": ["https://chatgpt.com/connector/oauth/callback_123"]
  }' | jq .
```

回應中的 `client_id` 應是 `https://<your-domain>/api/auth/mcp/chatgpt-client-metadata?...`，且 `redirect_uris` 保留 ChatGPT callback。

### Smoke checklist

1. 未登入打授權頁，看到登入卡片而不是 500
2. 已登入 member 打授權頁，看到 consent 與正確 scope
3. 拒絕授權時，redirect URI 收到 `error=access_denied`
4. 同意授權後，token exchange 拿到 `access_token`、`token_type=Bearer`
5. 用 access token 打 `/mcp`：
   - `listCategories` / `searchKnowledge` 成功
   - `askKnowledge` 成功或依 guest policy 被正確阻擋
   - restricted replay 仍需 `knowledge.restricted.read`

## Guest policy 與權限語意

OAuth principal 與 Web 使用相同的本地使用者真相：

- `admin` / `member`：正常依 scope 存取
- `guest` + `same_as_member`：照 member 規則
- `guest` + `browse_only`：可用 `searchKnowledge` / `listCategories` / `getDocumentChunk`，`askKnowledge` 會被拒絕
- `guest` + `no_access`：所有 MCP tools 都會回 `ACCOUNT_PENDING`

這些規則對 OAuth access token 與 legacy token 共用同一套 `knowledge.*` scope vocabulary。

## Legacy Bearer token 路徑

legacy MCP token **仍存在**，但用途改為：

- migration 期間的相容驗證
- MCP Inspector / curl / integration smoke
- 本機 Claude Desktop stdio bridge
- 明確受控的 non-user automation

不建議用途：

- 一般使用者 remote connector
- 文件把它寫成與 OAuth 並列的正式接入方式

### Claude Desktop bridge

若現在就要在本機接 Claude Desktop，可繼續用：

- `scripts/claude-desktop-mcp-bridge.mjs`

bridge 仍會：

- 接收本機 stdio JSON-RPC
- 轉送到遠端 `/mcp`
- 自動附上 `Authorization: Bearer <legacy token>`

這條路徑是 workaround，不是正式 remote connector onboarding。

## 失敗處置與 rollback

### 立即停用 remote connector

若 rollout 出現 blocking issue，可先：

1. 將 `NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON` 中對應 client 的 `enabled` 改為 `false`
2. 重新部署
3. 保留 legacy token / bridge 路徑做暫時回退

### 常見失敗點

| 症狀                                                                | 可能原因                                    | 處置                                             |
| ------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| `/api/auth/mcp/authorize` 回 `Unknown MCP connector client`         | allowlist 未配置或 `clientId` 不符          | 檢查 `NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON` |
| `/api/auth/mcp/authorize` 回 `Redirect URI is not allowed`          | redirect URI 未在 allowlist                 | 補上正確 redirect URI 後重新部署                 |
| 授權頁顯示「無法辨識本地帳號」                                      | session 沒有本地 `user.id`                  | 先完成一般登入 / account linking                 |
| `/api/auth/mcp/token` 回 `Authorization code is invalid or expired` | code 過期或重複使用                         | 重新走一次授權流程                               |
| OAuth token 打 `/mcp` 仍被 403                                      | guest policy / scope / restricted rule 命中 | 檢查使用者角色、scope 與 policy                  |

## 驗證對應

- integration:
  - `test/integration/mcp-connector-authorize-route.test.ts`
  - `test/integration/mcp-connector-authorize-post-route.test.ts`
  - `test/integration/mcp-connector-token-route.test.ts`
  - `test/integration/mcp-oauth-metadata-routes.test.ts`
  - `test/integration/mcp-oauth-tool-access.test.ts`
- unit:
  - `test/unit/mcp-connector-clients.test.ts`
  - `test/unit/mcp-connector-client-registry.test.ts`
  - `test/unit/mcp-middleware.test.ts`
  - `test/unit/mcp-role-gate.test.ts`
- e2e:
  - `e2e/mcp-connector-authorize.spec.ts`
- legacy bridge:
  - `test/integration/claude-desktop-mcp-bridge.test.ts`
