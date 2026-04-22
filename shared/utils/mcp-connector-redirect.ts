export function buildMcpConnectorRedirectUrl(input: {
  redirectUri: string
  code?: string
  error?: string
  state?: string | null
}): string {
  const url = new URL(input.redirectUri)

  if (input.code) {
    url.searchParams.set('code', input.code)
  }

  if (input.error) {
    url.searchParams.set('error', input.error)
  }

  if (input.state) {
    url.searchParams.set('state', input.state)
  }

  return url.toString()
}
