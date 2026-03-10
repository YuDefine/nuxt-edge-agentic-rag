import type { H3Event } from 'h3'

// Dynamic import avoids a static circular-dependency warning between
// `@nuxtjs/mcp-toolkit` tool modules and `nitropack/runtime`. Cache the
// resolved binding so MCP tool hot paths don't re-resolve on every call.
let cachedUseEvent: (() => H3Event) | null = null

export async function getCurrentMcpEvent(): Promise<H3Event> {
  if (!cachedUseEvent) {
    const mod = await import('nitropack/runtime')
    cachedUseEvent = mod.useEvent
  }
  return cachedUseEvent()
}
