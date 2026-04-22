const MCP_CONNECTOR_RETURN_TO_KEY = 'mcp-connector:return-to'

export function saveMcpConnectorReturnTo(path: string): void {
  if (!import.meta.client) {
    return
  }

  sessionStorage.setItem(MCP_CONNECTOR_RETURN_TO_KEY, path)
}

export function peekMcpConnectorReturnTo(): string | null {
  if (!import.meta.client) {
    return null
  }

  return sessionStorage.getItem(MCP_CONNECTOR_RETURN_TO_KEY)
}

export function clearMcpConnectorReturnTo(): void {
  if (!import.meta.client) {
    return
  }

  sessionStorage.removeItem(MCP_CONNECTOR_RETURN_TO_KEY)
}

export function consumeMcpConnectorReturnTo(): string | null {
  const value = peekMcpConnectorReturnTo()

  if (value) {
    clearMcpConnectorReturnTo()
  }

  return value
}
