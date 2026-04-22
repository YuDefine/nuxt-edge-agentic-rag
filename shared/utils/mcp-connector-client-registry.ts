import type { KnowledgeRuntimeConfigInput } from '#shared/schemas/knowledge-runtime'

type McpConnectorClientsInput = NonNullable<
  NonNullable<KnowledgeRuntimeConfigInput['mcpConnectors']>['clients']
>

export function parseMcpConnectorClientsEnv(rawValue?: string): McpConnectorClientsInput {
  const normalized = rawValue?.trim()

  if (!normalized) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(normalized)
  } catch (error) {
    throw new Error(
      `NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON must be valid JSON: ${getErrorMessage(error)}`,
      {
        cause: error,
      },
    )
  }

  if (!Array.isArray(parsed)) {
    throw new Error('NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON must be a JSON array')
  }

  return parsed as McpConnectorClientsInput
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}
