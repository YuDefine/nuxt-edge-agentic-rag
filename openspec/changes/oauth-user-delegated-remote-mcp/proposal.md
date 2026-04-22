## Why

現行 MCP 對外存取以管理員預先建立的 Bearer token 為主，適合最小可用驗證與工具測試，卻無法滿足「外部 AI client 代表每位使用者自己的身分」這個正式產品目標，也難以作為一般使用者在桌機與手機上直接使用的 remote connector 路線。現在需要把 MCP 從工具型 workaround 收斂為正式對外介面，先以 Claude remote connector 作為第一個正式 consumer，同時保留系統作為其他 AI client 或企業內部代理服務整合基礎的延展性。

## What Changes

- 導入 OAuth-compatible remote MCP 授權模式，使外部 client 可透過本專案既有帳號體系完成授權，並以本地 `user.id` 作為 MCP access token 主體。
- 維持單一 `/mcp` endpoint、既有 tool 名稱、既有 I/O 契約與既有 `knowledge.*` scope 命名，不另分裂第二套 MCP surface。
- 新增 known-client allowlist 模式，V1 僅支援預先配置的 connector client，不實作 dynamic client registration。
- 將 Claude remote connector 定為第一個正式支援的 remote consumer；其他平台整合作為同一套 MCP 契約下的後續延展方向，不列為本輪正式驗收。
- 讓 MCP middleware、role gate、guest policy、restricted 存取與 citation replay 持續沿用現有治理核心，但 principal 來源改為 OAuth access token 所代表的本地使用者，而非 legacy MCP token 建立者。
- 將現有 legacy Bearer MCP token 重新定位為 migration、內部工具、Inspector 驗證或非使用者型 automation 的過渡方案，不再作為長期主路線。

## Non-Goals (optional)

- 不在本輪同時完成 ChatGPT、Gemini 或其他外部平台的正式 connector 接入。
- 不實作 public client onboarding、dynamic client registration、或通用型 OAuth 平台產品化能力。
- 不擴充新的 MCP tools、`MCP-Session-Id` 多輪上下文、或 ERP 寫入型高風險操作。
- 不把 legacy Bearer token 與 OAuth user-delegated auth 作為長期並列主路線。

## Capabilities

### New Capabilities

- `oauth-remote-mcp-auth`: 定義 remote MCP 的 OAuth 授權、已知 client allowlist、access token principal 與使用者授權流程。

### Modified Capabilities

- `mcp-knowledge-tools`: 將 MCP 驗證來源從 admin-provisioned static token 擴充為 user-delegated OAuth principal，同時維持既有 `/mcp` tool surface 與 stateless contract。
- `knowledge-access-control`: 將 MCP 權限來源改為本地使用者主體與對應 scope，並明確化 OAuth principal 與 legacy principal 的治理邊界。
- `guest-access-policy`: 將 Guest 經由 remote MCP 存取時的提問與瀏覽限制，改寫為以 OAuth 使用者身分為準，而非 guest-owned static token。

## Impact

- Affected specs: `oauth-remote-mcp-auth`（new）、`mcp-knowledge-tools`、`knowledge-access-control`、`guest-access-policy`
- Affected code: `server/mcp/**`, `server/utils/mcp-auth.ts`, `server/utils/mcp-middleware.ts`, `server/utils/mcp-role-gate.ts`, `server/utils/mcp-token-store.ts`, `server/auth.config.ts`, `server/api/admin/mcp-tokens/**`, new OAuth/connector server routes, runtime config and env wiring, MCP integration tests, deployment/runbook docs, `reports/latest.md`
- Affected systems: Claude remote connector integration, better-auth login/session flow, MCP auth pipeline, audit/governance docs, rollout and migration procedures
