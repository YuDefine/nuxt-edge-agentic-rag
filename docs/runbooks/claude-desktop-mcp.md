# Claude Desktop MCP 連接

本手冊說明如何把本專案的 remote MCP 服務接到 Claude Desktop。

## 結論先講

- Claude 官方已支援 remote MCP，且 Claude.ai、Claude Desktop、Claude mobile 共用同一套 connector/auth 基礎設施。
- 但 Claude 官方目前明確不支援使用者手貼 static bearer token 作為 remote connector 驗證方式。
- 本專案目前的 MCP 驗證是純 `Authorization: Bearer <token>`，沒有 OAuth。
- 所以現況下不能把本專案的 `/mcp` 直接加成 Claude 的 remote custom connector。
- 目前最穩的接法是：Claude Desktop 連本機 stdio bridge，由 bridge 代為呼叫遠端 `/mcp` 並附上 Bearer token。

## 為什麼不能直接用 Claude Remote Connector

Claude 官方 connector auth 文件目前列出的重點如下：

- hosted Claude surfaces 共用同一套 auth 基礎設施
- remote connector 支援 OAuth 類型與 `none`
- `static_bearer` 目前不支援

本專案目前的 server 端行為則是：

- `/mcp` 每次請求都必須帶 Bearer token
- token 由 admin 建立，只會回傳明文一次
- server 端只存 token hash，不存明文

因此兩邊目前是卡在 auth 模式不相容，不是 MCP 工具本身不相容。

## 推薦做法

### 方案 A：現在就要接 Claude Desktop

使用本 repo 內建的本機 bridge：

- bridge 檔案：`scripts/claude-desktop-mcp-bridge.mjs`
- Claude Desktop 走本機 stdio MCP
- bridge 轉送到遠端 `/mcp`
- bridge 自動補上 `Authorization: Bearer <token>`
- 遠端 URL 預設必須使用 `https://`；只有 `localhost`、`127.0.0.1`、`::1` 的本機開發端點允許 `http://`

### 方案 B：未來要支援 Claude.ai / Desktop / mobile 直接連

把本專案 MCP auth 升級為 Claude remote connector 支援的 OAuth 模式。

在那之前，不要把目前的 Bearer token 流程誤認為可直接用在 Claude custom connector。

## 前置條件

1. 已安裝 Claude Desktop。
2. 本機可執行 `node`。
3. 你有一組可用的 MCP token。
4. 遠端 `/mcp` 端點可從你的電腦連線。

## 建立 MCP Token

### 方式 1：管理後台

使用管理介面的 MCP Token 管理頁建立 token。

建議 scope：

- `knowledge.search`
- `knowledge.ask`
- `knowledge.citation.read`
- `knowledge.category.list`

只有在你確定 Claude Desktop 可以讀 restricted 資料時，才加：

- `knowledge.restricted.read`

### 方式 2：腳本

本 repo 已有建立 token 的腳本：

```bash
npx tsx scripts/create-mcp-token.ts \
  --name "Claude Desktop" \
  --scopes "knowledge.search,knowledge.ask,knowledge.citation.read,knowledge.category.list"
```

此腳本成功後會直接印出測試用的 `/mcp` curl 範例。

## Claude Desktop 設定

macOS 設定檔位置：

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

### 最直接的設定

把下列內容加入 `mcpServers`：

```json
{
  "mcpServers": {
    "agentic-rag-remote": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/scripts/claude-desktop-mcp-bridge.mjs",
        "--mcp-url",
        "https://agentic.yudefine.com.tw/mcp",
        "--token",
        "<YOUR_MCP_TOKEN>"
      ]
    }
  }
}
```

請把以下欄位換成實際值：

- `/ABSOLUTE/PATH/TO/...`：repo 在你電腦上的絕對路徑
- `https://agentic.yudefine.com.tw/mcp`：你的環境 `/mcp` 端點
- `<YOUR_MCP_TOKEN>`：剛建立的明文 token

### 比較安全的設定

若你不想把 token 出現在 process args，可改成 shell 包一層：

```json
{
  "mcpServers": {
    "agentic-rag-remote": {
      "command": "bash",
      "args": [
        "-lc",
        "export MCP_REMOTE_URL='https://agentic.yudefine.com.tw/mcp'; export MCP_AUTH_TOKEN='<YOUR_MCP_TOKEN>'; node /ABSOLUTE/PATH/TO/scripts/claude-desktop-mcp-bridge.mjs"
      ]
    }
  }
}
```

bridge 支援以下環境變數：

- `MCP_REMOTE_URL`
- `MCP_AUTH_TOKEN`
- `MCP_TIMEOUT_MS`

注意：bridge 會轉送 JSON-RPC request 與 notification；若遠端端點設錯，Bearer token 也會一併送出，所以不要把 `MCP_REMOTE_URL` 指向不受信任主機。

## 啟用步驟

1. 存檔 `claude_desktop_config.json`。
2. 完全關閉 Claude Desktop。
3. 重新啟動 Claude Desktop。
4. 開一個新對話，確認輸入框附近出現 MCP 工具指示。

## 驗證方式

可以先問 Claude Desktop：

- 列出目前可用的知識庫工具
- 幫我搜尋某個已存在的文件關鍵字
- 幫我列出知識庫分類

如果 bridge 與 token 都正常，Claude Desktop 應能看到 remote server 的 tools/list 結果。

## 本專案的 MCP Auth 流程

本專案目前的 auth 流程如下：

1. admin 透過 `/api/admin/mcp-tokens` 建立 token。
2. server 回傳明文 token 一次；之後只保留 hash。
3. client 呼叫 `/mcp` 時必須帶 `Authorization: Bearer <token>`。
4. server 對明文 token 做 SHA-256，查 active token record。
5. 查到後更新 `last_used_at`。
6. middleware 寫入 `event.context.mcpAuth`。
7. 每個 tool 再檢查對應 scope。
8. scope 通過後，還要再經過 rate limit 與 role × guest policy gate。

## Scope 對應

| Tool               | Required scope            |
| ------------------ | ------------------------- |
| `searchKnowledge`  | `knowledge.search`        |
| `askKnowledge`     | `knowledge.ask`           |
| `getDocumentChunk` | `knowledge.citation.read` |
| `listCategories`   | `knowledge.category.list` |

restricted 文件可見性另外受 `knowledge.restricted.read` 控制。

## 風險與注意事項

- 不要把 production 高權限 token 長期放在多人共用電腦。
- 建議為 Claude Desktop 建一組專用 token，並設定到期日。
- 若只需要一般查詢，不要給 `knowledge.restricted.read`。
- bridge 只是 auth/transport workaround，不會改變 server 端權限模型。

## 已驗證項目

本 repo 內已有 smoke test 驗證 bridge 會：

- 接收本機 stdio JSON-RPC
- 轉送到 remote `/mcp`
- 自動附上 Bearer token

對應測試：`test/integration/claude-desktop-mcp-bridge.test.ts`

## 下一步建議

若你的目標是讓 Claude.ai、Claude Desktop、Claude mobile 都能直接用同一個 connector，下一個工程項應該是把目前的 MCP Bearer token auth 升級為 Claude remote connector 支援的 OAuth 流程，而不是繼續擴充 static bearer workaround。
