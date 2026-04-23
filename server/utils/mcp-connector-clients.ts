import type {
  KnowledgeRuntimeConfig,
  McpConnectorClientConfig,
} from '#shared/schemas/knowledge-runtime'
import { MCP_OAUTH_SCOPES } from '#server/utils/mcp-oauth-metadata'

export class McpConnectorClientConfigError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'McpConnectorClientConfigError'
  }
}

export interface ResolveMcpConnectorClientInput {
  clientId: string
  redirectUri: string
  requestedScopes: string[]
}

export interface ResolvedMcpConnectorClient extends McpConnectorClientConfig {
  grantedScopes: string[]
  redirectUri: string
}

export function resolveMcpConnectorClient(
  input: ResolveMcpConnectorClientInput,
  config: KnowledgeRuntimeConfig,
): ResolvedMcpConnectorClient {
  const client = config.mcpConnectors.clients.find(
    (candidate) => candidate.clientId === input.clientId,
  )

  if (!client) {
    throw new McpConnectorClientConfigError(`Unknown MCP connector client: ${input.clientId}`, 400)
  }

  if (!client.enabled) {
    throw new McpConnectorClientConfigError(
      `MCP connector client is disabled: ${input.clientId}`,
      400,
    )
  }

  if (!client.environments.includes(config.environment)) {
    throw new McpConnectorClientConfigError(
      `MCP connector client is not enabled in environment: ${config.environment}`,
      400,
    )
  }

  if (!client.redirectUris.includes(input.redirectUri)) {
    throw new McpConnectorClientConfigError(
      `Redirect URI is not allowed for MCP connector client: ${input.clientId}`,
      400,
    )
  }

  const grantedScopes = input.requestedScopes.filter((scope) =>
    client.allowedScopes.includes(scope),
  )

  if (grantedScopes.length !== input.requestedScopes.length) {
    throw new McpConnectorClientConfigError(
      `Requested scopes are not allowed for MCP connector client: ${input.clientId}`,
      400,
    )
  }

  return {
    ...client,
    grantedScopes,
    redirectUri: input.redirectUri,
  }
}

interface ClientMetadataDocument {
  client_id?: unknown
  client_name?: unknown
  redirect_uris?: unknown
}

export async function resolveMcpConnectorClientAsync(
  input: ResolveMcpConnectorClientInput,
  config: KnowledgeRuntimeConfig,
): Promise<ResolvedMcpConnectorClient> {
  if (isHttpsUrl(input.clientId)) {
    return resolveClientIdMetadataDocument(input)
  }

  return resolveMcpConnectorClient(input, config)
}

async function resolveClientIdMetadataDocument(
  input: ResolveMcpConnectorClientInput,
): Promise<ResolvedMcpConnectorClient> {
  const response = await fetch(input.clientId, {
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new McpConnectorClientConfigError(
      `Unable to fetch MCP client metadata document: ${input.clientId}`,
      400,
    )
  }

  const metadata = (await response.json().catch(() => null)) as ClientMetadataDocument | null

  if (!metadata || metadata.client_id !== input.clientId) {
    throw new McpConnectorClientConfigError('Invalid MCP client metadata document', 400)
  }

  if (!Array.isArray(metadata.redirect_uris)) {
    throw new McpConnectorClientConfigError('MCP client metadata is missing redirect_uris', 400)
  }

  const redirectUris = metadata.redirect_uris.filter(
    (redirectUri): redirectUri is string => typeof redirectUri === 'string',
  )

  if (!redirectUris.includes(input.redirectUri)) {
    throw new McpConnectorClientConfigError(
      `Redirect URI is not allowed for MCP connector client: ${input.clientId}`,
      400,
    )
  }

  const allowedScopes: string[] = [...MCP_OAUTH_SCOPES]
  const grantedScopes = input.requestedScopes.filter((scope) => allowedScopes.includes(scope))

  if (grantedScopes.length !== input.requestedScopes.length) {
    throw new McpConnectorClientConfigError(
      `Requested scopes are not allowed for MCP connector client: ${input.clientId}`,
      400,
    )
  }

  return {
    allowedScopes,
    clientId: input.clientId,
    enabled: true,
    environments: ['local', 'staging', 'production'],
    grantedScopes,
    name: typeof metadata.client_name === 'string' ? metadata.client_name : input.clientId,
    redirectUri: input.redirectUri,
    redirectUris,
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)

    return url.protocol === 'https:' && url.pathname.length > 1
  } catch {
    return false
  }
}
