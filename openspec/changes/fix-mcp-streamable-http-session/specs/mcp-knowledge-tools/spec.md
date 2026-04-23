## ADDED Requirements

### Requirement: MCP handler supports Streamable HTTP session with SSE channel

**Status**: DRAFT — 具體 scenario 與 spec delta 於 `/spectra-discuss` 收斂方向 A/B/C 後填入。

前置 change `fix-mcp-transport-body-consumed` 已確保 `POST /mcp initialize` 的 JSON-RPC body parsing 正確，本 change 在此基礎上擴展：MCP handler SHALL 支援 MCP Streamable HTTP 完整 session 生命週期，使 Claude.ai / ChatGPT 等 Remote MCP client 能在首次 `initialize` 後維持 SSE long-lived channel 完成 `tools/call`，而不是陷入 re-initialize 死循環。

#### Scenario: Discuss 後補齊具體 scenario

- **WHEN** `/spectra-discuss fix-mcp-streamable-http-session` 收斂方向 A（session + SSE）/ B（快速 405 fallback）/ C（protocol downgrade）並寫入 `design.md`
- **THEN** 本 spec 補齊對應 acceptance scenario：
  - session-id 產生 / 驗證 / 過期
  - GET /mcp SSE stream 開啟與 server-initiated event 推送
  - 跨 request session reuse
  - auth / rate-limit 與 session 生命週期綁定
  - Worker cold start / eviction 時的 graceful degradation
