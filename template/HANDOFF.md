# Handoff

## In Progress

- [ ] Claude Desktop / MCP 這條線的相容性調查已完成：官方 remote connector 目前不支援 `static_bearer`，因此 Bearer-only `/mcp` 仍不能直接用 remote custom connector 直連。
- [ ] 本輪已補本機 stdio bridge `scripts/claude-desktop-mcp-bridge.mjs`；若下一位要接續處理 Claude Desktop，可直接沿這條 workaround 往下走。
- [ ] `docs/runbooks/claude-desktop-mcp.md` 與 `test/integration/claude-desktop-mcp-bridge.test.ts` 已就位；下一步若要實際接線，不必再重做相容性調查。
- [ ] 目前 workspace 不是乾淨狀態；除這次 Claude Desktop / MCP 相關變更外，還有既存的 `reports/`、`tooling/` 等其他修改。後續若要 commit 或整理 scope，先分清哪些是本次 bridge/runbook 相關，哪些是既有 WIP。

## Blocked

- Claude Desktop 這條線目前沒有實作 blocker；真正的產品級限制是 Anthropic 官方目前不接受 user-pasted bearer token 當 remote connector auth，所以若目標改成 Claude.ai / Desktop / mobile 直接共用同一個 connector，必須改做 OAuth，而不是繼續擴大 static bearer workaround。

## Next Steps

1. 若下一個 session 要實際幫使用者接上 Claude Desktop，直接依 `docs/runbooks/claude-desktop-mcp.md` 把實際的 `/mcp` URL、token 與 `claude_desktop_config.json` 配好即可。
2. 若下一步要把 connector 做成 Claude.ai / Desktop / mobile 可共用的正式方案，請另開 change，改做 OAuth-compatible MCP auth。
