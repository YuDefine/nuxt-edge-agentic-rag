import { describe, expect, it } from 'vitest'

import { parseMcpConnectorClientsEnv } from '#shared/utils/mcp-connector-client-registry'

describe('parseMcpConnectorClientsEnv', () => {
  it('returns an empty registry when the env var is missing', () => {
    expect(parseMcpConnectorClientsEnv()).toEqual([])
  })

  it('parses known connector clients from JSON env input', () => {
    expect(
      parseMcpConnectorClientsEnv(
        JSON.stringify([
          {
            clientId: 'claude-remote',
            enabled: true,
            allowedScopes: ['knowledge.ask', 'knowledge.search'],
            environments: ['local'],
            name: 'Claude Remote',
            redirectUris: ['https://claude.example/callback'],
          },
        ]),
      ),
    ).toEqual([
      {
        clientId: 'claude-remote',
        enabled: true,
        allowedScopes: ['knowledge.ask', 'knowledge.search'],
        environments: ['local'],
        name: 'Claude Remote',
        redirectUris: ['https://claude.example/callback'],
      },
    ])
  })

  it('rejects malformed JSON so rollout misconfiguration fails fast', () => {
    expect(() => parseMcpConnectorClientsEnv('{bad-json')).toThrowError(
      /NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON must be valid JSON/,
    )
  })

  it('rejects non-array JSON values', () => {
    expect(() => parseMcpConnectorClientsEnv('{"clientId":"claude-remote"}')).toThrowError(
      'NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON must be a JSON array',
    )
  })
})
