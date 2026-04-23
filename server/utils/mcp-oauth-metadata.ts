import type { H3Event } from 'h3'

export const MCP_OAUTH_SCOPES = [
  'knowledge.ask',
  'knowledge.search',
  'knowledge.category.list',
  'knowledge.citation.read',
] as const

export function getMcpRequestOrigin(event: H3Event): string {
  return getRequestURL(event).origin
}

export function getMcpResourceUrl(event: H3Event): string {
  return `${getMcpRequestOrigin(event)}/mcp`
}

export function getMcpProtectedResourceMetadataUrl(event: H3Event): string {
  return `${getMcpRequestOrigin(event)}/.well-known/oauth-protected-resource`
}

export function createMcpProtectedResourceMetadata(event: H3Event) {
  const origin = getMcpRequestOrigin(event)

  return {
    authorization_servers: [origin],
    resource: getMcpResourceUrl(event),
    scopes_supported: [...MCP_OAUTH_SCOPES],
  }
}

export function createMcpAuthorizationServerMetadata(event: H3Event) {
  const origin = getMcpRequestOrigin(event)

  return {
    authorization_endpoint: `${origin}/auth/mcp/authorize`,
    client_id_metadata_document_supported: true,
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code'],
    issuer: origin,
    response_types_supported: ['code'],
    registration_endpoint: `${origin}/api/auth/mcp/register`,
    scopes_supported: [...MCP_OAUTH_SCOPES],
    token_endpoint: `${origin}/api/auth/mcp/token`,
    token_endpoint_auth_methods_supported: ['none'],
  }
}

export function setMcpAuthorizationChallenge(event: H3Event): void {
  const scopes = MCP_OAUTH_SCOPES.join(' ')

  setResponseHeader(
    event,
    'WWW-Authenticate',
    `Bearer resource_metadata="${getMcpProtectedResourceMetadataUrl(event)}", scope="${scopes}"`,
  )
}
