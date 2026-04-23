import { createMcpAuthorizationServerMetadata } from '#server/utils/mcp-oauth-metadata'

export default defineEventHandler((event) => createMcpAuthorizationServerMetadata(event))
