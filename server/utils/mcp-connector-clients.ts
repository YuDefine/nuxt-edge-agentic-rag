import type {
  KnowledgeRuntimeConfig,
  McpConnectorClientConfig,
} from '#shared/schemas/knowledge-runtime'

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
