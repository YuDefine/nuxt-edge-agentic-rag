import { describe, expect, it } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import {
  McpConnectorClientConfigError,
  resolveMcpConnectorClient,
} from '#server/utils/mcp-connector-clients'

describe('mcp connector clients', () => {
  it('parses known connector clients from runtime config input', () => {
    const config = createKnowledgeRuntimeConfig({
      mcpConnectors: {
        clients: [
          {
            clientId: 'claude-remote',
            enabled: true,
            allowedScopes: ['knowledge.ask', 'knowledge.search'],
            environments: ['local'],
            name: 'Claude Remote',
            redirectUris: ['https://claude.example/callback'],
          },
        ],
      },
    })

    expect(config.mcpConnectors.clients).toEqual([
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

  it('resolves a pre-registered client when client id, redirect uri, and scopes match', () => {
    const config = createKnowledgeRuntimeConfig({
      environment: 'local',
      mcpConnectors: {
        clients: [
          {
            clientId: 'claude-remote',
            enabled: true,
            allowedScopes: ['knowledge.ask', 'knowledge.search'],
            environments: ['local'],
            name: 'Claude Remote',
            redirectUris: ['https://claude.example/callback'],
          },
        ],
      },
    })

    const client = resolveMcpConnectorClient(
      {
        clientId: 'claude-remote',
        redirectUri: 'https://claude.example/callback',
        requestedScopes: ['knowledge.ask'],
      },
      config,
    )

    expect(client).toMatchObject({
      clientId: 'claude-remote',
      grantedScopes: ['knowledge.ask'],
      redirectUri: 'https://claude.example/callback',
    })
  })

  it('rejects an unknown client id before authorization can continue', () => {
    const config = createKnowledgeRuntimeConfig({
      mcpConnectors: {
        clients: [],
      },
    })

    expect(() =>
      resolveMcpConnectorClient(
        {
          clientId: 'unknown-client',
          redirectUri: 'https://claude.example/callback',
          requestedScopes: ['knowledge.ask'],
        },
        config,
      ),
    ).toThrowError(
      new McpConnectorClientConfigError('Unknown MCP connector client: unknown-client', 400),
    )
  })

  it('rejects a redirect uri outside the client allowlist', () => {
    const config = createKnowledgeRuntimeConfig({
      environment: 'local',
      mcpConnectors: {
        clients: [
          {
            clientId: 'claude-remote',
            enabled: true,
            allowedScopes: ['knowledge.ask'],
            environments: ['local'],
            name: 'Claude Remote',
            redirectUris: ['https://claude.example/callback'],
          },
        ],
      },
    })

    expect(() =>
      resolveMcpConnectorClient(
        {
          clientId: 'claude-remote',
          redirectUri: 'https://evil.example/callback',
          requestedScopes: ['knowledge.ask'],
        },
        config,
      ),
    ).toThrowError(
      new McpConnectorClientConfigError(
        'Redirect URI is not allowed for MCP connector client: claude-remote',
        400,
      ),
    )
  })
})
