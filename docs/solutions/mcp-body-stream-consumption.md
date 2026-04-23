---
category: mcp
tags:
  - cloudflare-workers
  - mcp-toolkit
  - h3
  - request-body
  - transport
date: 2026-04-24
---

# MCP request body consumed before transport

## Problem

Production Claude.ai Remote MCP integration returns a generic
`"Error occurred during tool execution"` for every tool call. `wrangler tail`
shows each `POST /mcp` `initialize` reply with HTTP **400** (~1.6 s), which means
the JSON-RPC handshake never completes — so any subsequent `tools/call` is
impossible. The Claude.ai host reflects the failure as the generic error string
above; the real cause is invisible to the end user.

## What didn't work

1. **Assuming it was a tool-handler bug.** `ask.ts` / `categories.ts` never
   run — the transport layer fails before `tools/call` dispatch. Looking at
   the tool code misleads the investigation.
2. **Assuming it was OAuth / bearer token expiry.** Auth middleware logs
   show 200 for token lookup; the 400 comes after auth succeeds.
3. **Removing `extractToolNames` from middleware.** Even without our own
   read, `@nuxtjs/mcp-toolkit`'s `createMcpHandler` runs
   `tagEvlogContext(event)` _before_ the middleware — it also calls
   `readBody(event)` to summarise the JSON-RPC request for evlog. So the
   stream is consumed regardless of what we do inside our middleware.

## Solution

On Cloudflare Workers, `event.web.request` _is_ the native `Request` object.
When `readBody(event)` drains its body stream, the downstream MCP transport
(`providers/node.js` → `toWebRequest(event)` → `transport.handleRequest(request)`)
gets the same disturbed Request and fails `await request.json()` inside the
MCP SDK, returning HTTP 400 / `-32700 parse_error`.

Rehydrate the request body at the end of our middleware:

```ts
// server/utils/mcp-rehydrate-request-body.ts
import type { H3Event } from 'h3'
import { readBody } from 'h3'

export async function rehydrateMcpRequestBody(event: H3Event): Promise<void> {
  const web = (event as unknown as { web?: { request?: Request } }).web
  const original = web?.request
  if (!original) return
  if (original.method === 'GET' || original.method === 'HEAD') return

  const parsed = await readBody(event) // hits H3 cache, does NOT re-drain
  const bodyText =
    parsed === undefined || parsed === null
      ? ''
      : typeof parsed === 'string'
        ? parsed
        : JSON.stringify(parsed)

  ;(event as unknown as { web: { request: Request } }).web.request = new Request(original.url, {
    method: original.method,
    headers: original.headers,
    body: bodyText,
    duplex: 'half',
  } as RequestInit)
}
```

Call it at the end of `defineMcpHandler({ middleware })` in
`server/mcp/index.ts`:

```ts
middleware: async (event) => {
  await runMcpMiddleware(event, {
    /* ... */
  })
  await rehydrateMcpRequestBody(event as unknown as H3Event)
}
```

Key points:

- `readBody(event)` **hits the H3 body cache** populated by the earlier
  `tagEvlogContext` / `extractToolNames` reads. It does not try to
  re-read the already-drained native stream.
- The new `Request` built from `bodyText` has a pristine body stream
  the MCP SDK can consume.
- `duplex: 'half'` is required by Workers / Undici when constructing a
  `Request` with a body.
- Live `event.web.request` swap is safe: `toWebRequest(event)` in
  `@nuxtjs/mcp-toolkit` returns `event.web.request` directly when it's
  already a `Request` instance.

## Prevention

- Upgrade `@nuxtjs/mcp-toolkit` cautiously. If `tagEvlogContext` or
  `extractToolNames` change their body-read behaviour, re-run
  `pnpm test:contracts` + a live `wrangler tail` after any bump.
- Unit test: `test/unit/mcp-rehydrate-request-body.test.ts` asserts
  that the rehydrated `Request` exposes a readable body identical to
  the cached parse.
- Monitor signals: `wrangler tail --format pretty` after any MCP-layer
  change should show `POST /mcp status 200` for `initialize`. A 400
  here reopens this regression.

## References

- `openspec/changes/fix-mcp-transport-body-consumed/` — the fix change.
- `openspec/specs/mcp-knowledge-tools/spec.md` — ADDED requirement
  "MCP handler middleware preserves request body for transport".
- `node_modules/@nuxtjs/mcp-toolkit/dist/runtime/server/mcp/utils.js`
  — `tagEvlogContext` implementation (upstream source of first
  `readBody` call).
