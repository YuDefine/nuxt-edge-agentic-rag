import type { H3Event } from 'h3'

export const CHATGPT_CONNECTOR_LEGACY_REDIRECT_URI =
  'https://chatgpt.com/connector_platform_oauth_redirect'

const CHATGPT_CONNECTOR_OAUTH_PATH_PATTERN = /^\/connector\/oauth\/[A-Za-z0-9_-]{1,64}$/

export interface ChatGptClientMetadataInput {
  clientName?: string
  redirectUris: string[]
}

export function isAllowedChatGptConnectorRedirectUri(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri)

    return (
      redirectUri === CHATGPT_CONNECTOR_LEGACY_REDIRECT_URI ||
      (url.origin === 'https://chatgpt.com' &&
        CHATGPT_CONNECTOR_OAUTH_PATH_PATTERN.test(url.pathname) &&
        url.search.length === 0 &&
        url.hash.length === 0)
    )
  } catch {
    return false
  }
}

export function normalizeChatGptRedirectUris(redirectUris: string[]): string[] {
  return [...new Set(redirectUris.map((redirectUri) => redirectUri.trim()).filter(Boolean))]
}

export function buildChatGptClientMetadataUrl(
  event: H3Event,
  input: ChatGptClientMetadataInput,
): string {
  const url = new URL('/api/auth/mcp/chatgpt-client-metadata', getRequestURL(event).origin)

  for (const redirectUri of input.redirectUris) {
    url.searchParams.append('redirect_uri', redirectUri)
  }

  if (input.clientName) {
    url.searchParams.set('client_name', input.clientName)
  }

  return url.toString()
}
