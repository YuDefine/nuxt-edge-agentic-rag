## 1. 授權層與 client registry

- [ ] 1.1 實作 **Use a dedicated OAuth authorization layer backed by existing local accounts**：新增 remote MCP authorization / token 相關 server routes、runtime config 與必要資料模型。
- [x] 1.2 實作 **Remote MCP Clients Must Be Pre-Registered** 與 **Restrict V1 to known connector clients with explicit allowlist metadata**：建立 known connector client registry、redirect URI allowlist、scope allowlist 與 environment 綁定。
- [ ] 1.3 實作 **Remote MCP Authorization Uses Existing Local Accounts** 與 **Bind remote MCP authorization to existing local accounts only**：把 connector authorization 綁到既有本地帳號，並處理未綁定帳號時的拒絕與導引流程。

## 2. Token principal 與 MCP middleware

- [ ] 2.1 實作 **OAuth Access Tokens Resolve To Local MCP Principals**：發行可解析為本地 `user.id` 的 access token，並定義 token 驗證與 principal hydrate 流程。
- [ ] 2.2 實作 **Keep a single `/mcp` endpoint and normalize principal resolution in middleware**：擴充 `/mcp` middleware 讓 OAuth token 與 legacy token 都能產生統一 auth context。
- [ ] 2.3 實作 **Preserve one scope vocabulary across OAuth and legacy callers**：讓 OAuth principal 與 legacy principal 共用 `knowledge.*` scope，並更新 scope 驗證與 type/runtime contract。

## 3. 治理與 tool contract 收斂

- [ ] 3.1 更新 **Stateless MCP Authentication**：調整 `server/utils/mcp-auth.ts`、`server/utils/mcp-middleware.ts` 與相關 tests，使 MCP 可接受 OAuth access token 與 migration 期 legacy token。
- [ ] 3.2 更新 **Channel Access Matrix**：讓 OAuth principal 的 `allowed_access_levels`、restricted visibility 與 legacy principal 共用同一條存取矩陣。
- [ ] 3.3 更新 **Browse-Only Policy Restricts Guest Question Submission**：讓 Guest 經由 remote MCP 時也正確套用 browse-only 問答封鎖規則。
- [ ] 3.4 更新 **No-Access Policy Blocks All Feature Surfaces For Guests**：讓 Guest 經由 remote MCP 時也正確回傳 `ACCOUNT_PENDING` 與完全封鎖行為。
- [ ] 3.5 實作 **Treat legacy MCP tokens as migration-only after OAuth rollout**：重新收斂 legacy token 在程式與文件中的定位，避免與 OAuth 主路線並列。

## 4. UI 與操作面

- [ ] 4.1 實作 connector authorization / consent 相關 UI 與狀態頁，讓使用者能完成已知 connector 的授權、拒絕與未綁定帳號導引。
- [ ] 4.2 調整 admin MCP token 管理頁與相關文案，明確標示 legacy token 為 migration / internal tooling 用途，而非 remote connector 正式入口。

## 5. Design Review

- [ ] 5.1 依 `.spectra.yaml` 執行 Design Review：檢查 connector authorization / consent UI 相關頁面是否需要 `/impeccable teach`、`/design improve` 與 targeted skills。
- [ ] 5.2 執行 responsive / a11y 檢查，確認 connector authorization / consent 相關流程在 xs、md、xl 斷點與鍵盤操作下可用。

## 6. 文件、報告與驗證

- [ ] [P] 6.1 更新 runbooks、deployment docs 與 rollback 指南，記錄 Claude-first connector 設定、known client allowlist 與 OAuth-first rollout 流程。
- [ ] [P] 6.2 更新 `reports/latest.md`，把 MCP 對外互操作定位收斂為「Claude 為第一個正式 consumer、其他系統串接為後續延展方向」。
- [ ] 6.3 補齊 integration / acceptance tests，覆蓋 **Remote MCP Clients Must Be Pre-Registered**、**OAuth Access Tokens Resolve To Local MCP Principals**、**Stateless MCP Authentication**、**Channel Access Matrix**、**Browse-Only Policy Restricts Guest Question Submission**、**No-Access Policy Blocks All Feature Surfaces For Guests**。
- [ ] 6.4 執行 end-to-end rollout 驗證：確認 Claude remote connector、legacy migration path、restricted replay、guest policy 與 rollback 路徑都符合新契約。
