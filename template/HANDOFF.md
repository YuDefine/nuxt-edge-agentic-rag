# Handoff

## In Progress

- [ ] `oauth-user-delegated-remote-mcp` 已完成後端 OAuth authorization / token routes、MCP middleware principal normalize、guest policy guard 與 Claude Desktop bridge / runbook；剩 tasks 1.3、3.5、4.x、5.x、6.x。
- [ ] `drizzle-refactor-credentials-admin-members` 與 `fk-cascade-repair-for-self-delete` 仍是 active changes，本輪未收尾，後續進度以 `openspec/ROADMAP.md` 的 AUTO 區塊為準。
- [ ] `v0.27.0` release commit 已建立，待 GitHub Actions 與 Cloudflare production / staging deploy 驗證完成。

## Blocked

- Anthropic 官方 remote connector 目前不接受 user-pasted bearer token 當正式 auth 流程；若目標是 Claude.ai / Desktop / mobile 共用同一個 connector，仍必須完成 OAuth 路線，而不是繼續擴大 static bearer workaround。

## Next Steps

1. 監看本次 `main` push 與 `v0.27.0` tag 的 GitHub Actions，確認 app 與 docs 的 production / staging deploy 全綠。
2. 驗證 docs custom domains：`agentic-docs.yudefine.com.tw` 與 `agentic-docs-staging.yudefine.com.tw` 均可正常開啟，必要時再檢查 Pages `pages.dev` fallback。
3. 繼續完成 `oauth-user-delegated-remote-mcp` 的 tasks 1.3、3.5、4.1、4.2、5.1、5.2、6.1、6.2、6.3、6.4。
4. 收尾 `fk-cascade-repair-for-self-delete` 與 `drizzle-refactor-credentials-admin-members` 的 production manual closeout 與 tech debt 狀態回填。
