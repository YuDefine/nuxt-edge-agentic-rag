import { MCPSessionDurableObject } from '#server/durable-objects/mcp-session'

/**
 * Force `MCPSessionDurableObject` into the Nitro bundle so that a
 * `generateBundle` rollup plugin can locate the chunk and re-export the class
 * from the Worker entry (`.output/server/index.mjs`). Cloudflare Workers
 * require Durable Object classes to be exported from the top-level module
 * named in `wrangler.jsonc`; without this pin, the class would be tree-shaken
 * out of every chunk because nothing calls it directly — the DO runtime only
 * references it by name at platform level via the `MCP_SESSION` binding.
 */
export default defineNitroPlugin(() => {
  // Keep a side-effect reference so the bundler cannot drop the import.
  if (typeof MCPSessionDurableObject !== 'function') {
    throw new Error('MCPSessionDurableObject export missing from bundle')
  }
})
