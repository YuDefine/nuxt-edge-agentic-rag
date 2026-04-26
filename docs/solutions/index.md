# Solutions

這一區收錄非 trivial 問題的可重用解法，避免同類問題重複踩坑。寫作規範與
判斷依據請見 [solutions/README](./README.md)。

## 適用情境

- Debug 嘗試 3+ 種方法才找到 root cause。
- 框架、平台或 SDK 的隱性限制與 workaround。
- 解法本身需要對相關背景做明確說明，僅靠 commit message 無法完整保留。

## 依主題分類

### Auth

- [Admin Allowlist Session Reconciliation](./auth/admin-allowlist-session-reconciliation.md)
- [Better Auth Passkey Worker Catch-all Override](./auth/better-auth-passkey-worker-catchall-override.md)
- [Passkey Self Delete Hard Redirect](./auth/passkey-self-delete-hard-redirect.md)

### MCP

- [MCP Body Stream Consumption](./mcp-body-stream-consumption.md)
- [MCP Streamable HTTP 405 Stateless](./mcp-streamable-http-405-stateless.md)
- [MCP Streamable HTTP Session Durable Objects](./mcp-streamable-http-session-durable-objects.md)

### Tooling

- [Cloudflare Pages UTF-8 Commit Message](./tooling/2026-04-25-cloudflare-pages-utf8-commit-message.md)
- [PostToolUse Hook Non-JSON stdin](./tooling/posttooluse-hook-non-json-stdin.md)

## 維護方式

- 新增解法檔案時，依 [README](./README.md) 的 frontmatter 與段落結構撰寫。
- 同步在本頁與 [docs/.vitepress/config.ts](../.vitepress/config.ts) 的
  `/solutions/` sidebar 加入新檔案連結。
- 若同一 pattern 反覆出現（3 次以上），考慮升級為 `.claude/rules/` 規則。
