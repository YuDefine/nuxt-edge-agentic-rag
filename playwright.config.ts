import { defineConfig, devices } from '@playwright/test'

const isCI = process.env.CI === 'true'
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3010'
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === 'true'
const mcpConnectorClientsJson = JSON.stringify([
  {
    clientId: 'claude-remote',
    enabled: true,
    allowedScopes: ['knowledge.ask', 'knowledge.search', 'knowledge.category.list'],
    environments: ['local'],
    name: 'Claude Remote',
    redirectUris: ['https://claude.example/callback'],
  },
])

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: isCI
            ? `NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON='${mcpConnectorClientsJson}' NITRO_HOST=127.0.0.1 NITRO_PORT=3010 pnpm exec nuxt preview`
            : `PLAYWRIGHT=true NUXT_DEVTOOLS_ENABLED=false NUXT_DISABLE_HINTS=true NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON='${mcpConnectorClientsJson}' pnpm dev`,
          port: 3010,
          reuseExistingServer: !isCI,
        },
      }),
})
