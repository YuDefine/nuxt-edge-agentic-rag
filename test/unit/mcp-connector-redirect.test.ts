import { describe, expect, it } from 'vitest'

import { buildMcpConnectorRedirectUrl } from '#shared/utils/mcp-connector-redirect'

describe('buildMcpConnectorRedirectUrl', () => {
  it('appends authorization code and state to the connector redirect uri', () => {
    expect(
      buildMcpConnectorRedirectUrl({
        code: 'oauth-code-1',
        redirectUri: 'https://claude.example/callback',
        state: 'opaque-state',
      }),
    ).toBe('https://claude.example/callback?code=oauth-code-1&state=opaque-state')
  })

  it('preserves existing query params while appending denial error data', () => {
    expect(
      buildMcpConnectorRedirectUrl({
        error: 'access_denied',
        redirectUri: 'https://claude.example/callback?source=mobile',
        state: 'opaque-state',
      }),
    ).toBe('https://claude.example/callback?source=mobile&error=access_denied&state=opaque-state')
  })
})
