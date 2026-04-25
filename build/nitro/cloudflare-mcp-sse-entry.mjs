/**
 * Custom Cloudflare Workers fetch entry that bypasses
 * `nitroApp.localFetch` for `/mcp` GET / DELETE.
 *
 * Why: nitropack's default `cloudflare-module.mjs` runs the H3 app via
 * `toNodeListener` + `fetchNodeRequestHandler`. That bridge buffers the
 * entire response into `ServerResponse._data` and only resolves once the
 * handler calls `res.end()` — which never happens for a long-lived SSE
 * stream. The result is the Cloudflare Worker fetch handler hangs and the
 * client never receives the response status line (root cause of
 * wire-do-tool-dispatch §6.4 G2; reproduced via
 * `pnpm mcp:acceptance:staging` after v0.44.1).
 *
 * Strategy: intercept GET / DELETE `/mcp` here, dispatch to the bypass
 * handler registered on `nitroApp` by
 * `server/plugins/register-mcp-streaming-bypass.ts`, and return its
 * `Response` (with streaming body) directly to workerd. The handler talks
 * to D1 + the MCP session Durable Object via the Worker `env`, signs the
 * auth-context envelope, and forwards the request — so the SSE stream
 * flows from the DO straight to the client without ever entering the H3
 * pipeline.
 *
 * POST `/mcp` continues through the normal H3 pipeline because POST
 * responses are short-lived JSON; the Node-listener buffer is harmless
 * (and required for the existing tool-dispatch logic).
 *
 * This file mirrors nitropack's
 * `dist/presets/cloudflare/runtime/cloudflare-module.mjs` (v2.13.3) — keep
 * the structure aligned when upgrading nitro.
 */

// eslint-disable-next-line import/no-unassigned-import -- nitro pollyfill side-effect import (mirrors nitropack default cloudflare-module entry)
import '#nitro-internal-pollyfills'
import wsAdapter from 'crossws/adapters/cloudflare'
import { useNitroApp } from 'nitropack/runtime'
import { isPublicAssetURL } from '#nitro-internal-virtual/public-assets'

import { createHandler } from 'nitropack/dist/presets/cloudflare/runtime/_module-handler.mjs'

const nitroApp = useNitroApp()
const ws = import.meta._websocket ? wsAdapter(nitroApp.h3App.websocket) : undefined

export default createHandler({
  fetch(request, env, context, url) {
    if (env.ASSETS && isPublicAssetURL(url.pathname)) {
      return env.ASSETS.fetch(request)
    }
    if (import.meta._websocket && request.headers.get('upgrade') === 'websocket') {
      return ws.handleUpgrade(request, env, context)
    }

    // SSE bypass: GET / DELETE /mcp routes directly to the Durable Object,
    // skipping nitroApp.localFetch (which buffers ReadableStream bodies via
    // the Node-listener bridge). See module docstring for root cause.
    if ((request.method === 'GET' || request.method === 'DELETE') && url.pathname === '/mcp') {
      const bypass = nitroApp.mcpStreamingBypass
      if (typeof bypass === 'function') {
        return bypass(request, env)
      }
    }
  },
})
