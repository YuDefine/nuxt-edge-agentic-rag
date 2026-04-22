## Context

目前 `/mcp` 已提供 4 個無狀態 tools，並透過 `Authorization: Bearer <token>`、token hash、scope 與 Guest policy 完成最小可用閉環；但 principal 來源仍是 `mcp_tokens.createdByUserId`，代表的是「誰建立了 token」，不是「哪一位終端使用者正在使用 remote connector」。這種模式適合管理端發 token、Inspector 驗證、bridge workaround 與非使用者型自動化，但不適合把 MCP 作為一般使用者可直接授權使用的正式對外介面。

本 change 的目標是把 MCP auth 模型收斂為 user-delegated remote access：外部 client 先經本專案授權，再以本地 `user.id` 存取 MCP tools。第一個正式 consumer 以 Claude remote connector 為主，但設計須維持 MCP 作為標準化互操作邊界，讓未來其他 AI client 或企業內部代理服務仍可沿用同一套 tool、scope 與治理契約。

## Goals / Non-Goals

**Goals:**

- 讓 remote MCP caller 以本地使用者身分存取 `/mcp`，而非以管理員預建 token 建立者身分存取。
- 維持單一 `/mcp` endpoint、既有 tool 名稱、既有 `knowledge.*` scope 與既有 stateless MCP contract。
- 讓 OAuth principal 與現有 role gate、guest policy、restricted 存取、citation replay、current-version-only 驗證共用同一條治理核心。
- 讓 V1 能支援 Claude remote connector，並以預先配置的 known client allowlist 控制可授權的 connector。
- 保留現有 legacy MCP token 作為 migration / internal tooling 過渡方案，但將其限制為非主路線。

**Non-Goals:**

- 不在本輪同時支援所有外部 AI client 平台的正式接入。
- 不實作 dynamic client registration、public connector marketplace、或通用型第三方 onboarding 平台。
- 不擴充新的 MCP tools、`MCP-Session-Id` 多輪上下文、或 Web 對話模型。
- 不把 connector authorization 當成新帳號建立入口；remote MCP 授權不會自動建立本地使用者。

## Decisions

### Use a dedicated OAuth authorization layer backed by existing local accounts

本專案將新增 OAuth-compatible authorization layer，但登入與帳號真相仍沿用既有 better-auth user/session 流程。授權層只負責把已存在的本地使用者授權給 remote connector，不重新定義使用者資料模型，也不直接把外部 IdP 身分視為權限真相。

選這條路而不是完全委派給外部 IdP，是因為目前 Admin / Member / Guest、Guest policy、allowlist 漂移重算與 passkey-first 帳號都以本地 `user` 為核心。若直接以外部 IdP 當 principal，會把權限治理拆成第二套身分系統。

### Keep a single `/mcp` endpoint and normalize principal resolution in middleware

`/mcp` 仍維持唯一 canonical endpoint，不拆出第二條 `/mcp-oauth`。middleware 需要先解析 Bearer token 類型，再統一產生 auth context：

- OAuth access token → `principal.userId`
- legacy MCP token → `principal.userId = createdByUserId`

後續 scope、role gate、guest policy、retrieval、replay 與 tools 只吃統一後的 principal context，不直接感知 token 來源。這樣可以避免把 auth 分支滲入每個 tool，也讓 legacy rollout 與後續退場更單純。

### Bind remote MCP authorization to existing local accounts only

remote MCP 授權只允許綁定既有本地帳號，不把 connector authorization 當成自動建帳入口。若使用者尚未擁有本地帳號，系統必須先引導其完成既有 Web onboarding / sign-in，再回到 connector authorization。

選這條路而不是 JIT auto-provisioning，是為了避免把 OAuth connector flow 變成第二套帳號建立與角色初始化流程。第一版先確保 principal、role、guest policy、審計與權限繼承清晰一致。

### Restrict V1 to known connector clients with explicit allowlist metadata

V1 僅支援預先配置的 connector client，不做 dynamic client registration。每個 client 都要有明確的 `client_id`、允許的 redirect URI、允許的 scope、適用環境與啟用狀態。第一個 client 為 Claude remote connector，但資料模型需允許未來加入其他 connector。

選 known-client allowlist，是因為本輪目標是交付第一個正式 consumer，不是建立通用對外 OAuth 平台。這樣能把風險集中在已知整合對象，避免同時解 redirect 管理、client metadata 驗證、第三方審核與濫用防護。

### Preserve one scope vocabulary across OAuth and legacy callers

OAuth access token 與 legacy MCP token 共用同一組 `knowledge.*` scope。scope 決定 tool 與 restricted access，principal 決定角色與 guest policy。這樣可以保留現有 MCP contract 與文件用詞，不需要為 OAuth 再造第二套權限語彙。

替代方案是為 OAuth tokens 引入新 scope 命名，但那會讓 Web、MCP、Admin token UI、測試與報告同時維護兩套權限模型，沒有必要。

### Treat legacy MCP tokens as migration-only after OAuth rollout

legacy MCP tokens 在 V1 rollout 期間可以保留，但定位只限 migration、Inspector、內部驗證與非使用者型 automation。文件、runbook、管理介面與報告措辭都應把 OAuth user-delegated access 描述為正式主路線。

這個決定不是要求第一天就刪除 legacy，而是避免把兩種 principal model 長期並列成同等正式方案。等 Claude remote connector 穩定後，再決定是否只保留少數 service-access 例外。

## Risks / Trade-offs

- [OAuth authorization 與既有 better-auth session 邊界不清] → 將 connector authorization 明確限制為「授權既有本地帳號」，不在授權流程內建立新使用者。
- [同 endpoint 雙 auth path 讓 middleware 變複雜] → 先收斂成統一 principal context，避免 tool 層知道 token 類型。
- [legacy 與 OAuth 並存期間文件容易失真] → 在 runbook、admin UI 與報告中明確標示 OAuth 為主路線、legacy 為 migration-only。
- [已知 client allowlist 限制平台彈性] → V1 先優先支援 Claude；client registry schema 預留未來擴充空間，不把資料模型寫死成單一供應商。
- [既有 MCP token 管理 UI 與 API 語意會變得過時] → 將其重新定位為 legacy/service-access 管理面，而非 remote connector 的正式入口。

## Migration Plan

1. 先新增 OAuth authorization 與 connector client registry，但不改動既有 `/mcp` tools 與 legacy token flow。
2. 擴充 MCP middleware，使其可解析 OAuth access token，並把 principal 統一映射到本地 `user.id`。
3. 調整 role gate、Guest policy 與 restricted replay 判定，確認 OAuth principal 與 legacy principal 都經同一條治理核心。
4. 補齊 Claude remote connector 的設定、授權流程、runbook 與 acceptance coverage。
5. 將文件與管理面措辭更新為 OAuth-first；legacy token 改標示為 migration / internal tooling。
6. rollout 後觀察是否仍有必要保留 legacy token 作為非使用者型 client 入口；若無，另開後續 change 做退場。

Rollback:

- 若 OAuth flow、connector authorization 或 `/mcp` principal resolution 在 rollout 中出現 blocking issue，先停用新 connector client 與 OAuth auth path，保留既有 legacy MCP token 路線作為回退方案。
- rollback 不變更 tool surface 與 existing token schema，避免影響既有 Web / MCP contract。

## Open Questions

- Claude remote connector 在本專案部署拓樸下需要採用哪一種 OAuth/OIDC 最小相容子集，才能兼顧官方要求與 Worker 環境可行性？
- connector consent 畫面與使用者已登入 / 未登入 / 帳號未綁定三種狀態之 UX，要以最小變更接到哪一組既有 auth pages？
- rollout 後是否仍需保留一種明確的 service-account / non-user automation 入口；若需要，其範圍與風險邊界要如何獨立治理？
