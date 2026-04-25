import { handleMcpStreamingBypass } from '#server/utils/mcp-streaming-bypass'

/**
 * Expose the MCP streaming bypass handler on the NitroApp instance so the
 * custom Cloudflare Worker entry (`build/nitro/cloudflare-mcp-sse-entry.mjs`)
 * can call it from the Worker fetch handler — bypassing
 * `nitroApp.localFetch` for GET / DELETE `/mcp` to avoid the
 * `toNodeListener` + `fetchNodeRequestHandler` buffer that hangs long-lived
 * SSE streams.
 *
 * This plugin must run before the first request reaches the Worker entry's
 * `hooks.fetch`. Nitro plugins run during `useNitroApp()` module-level init
 * (top of `_module-handler.mjs`), which is before the fetch handler is
 * invoked, so this ordering is guaranteed.
 */
export default defineNitroPlugin((nitroApp) => {
  ;(nitroApp as { mcpStreamingBypass?: typeof handleMcpStreamingBypass }).mcpStreamingBypass =
    handleMcpStreamingBypass
})
