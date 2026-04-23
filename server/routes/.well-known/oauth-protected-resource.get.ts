import { createMcpProtectedResourceMetadata } from '#server/utils/mcp-oauth-metadata'

export default defineEventHandler((event) => createMcpProtectedResourceMetadata(event))
