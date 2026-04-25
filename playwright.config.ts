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
          // CI 走 wrangler dev (cloudflare-module preset 對齊 production runtime)；
          // local 走 nuxt dev (HMR + 快速 iter)。詳見 docs/tech-debt.md TD-059。
          command: isCI
            ? 'pnpm exec wrangler dev --config .output/server/wrangler.json --port 3010 --ip 127.0.0.1 --persist-to .wrangler/e2e-state --log-level warn'
            : `PLAYWRIGHT=true NUXT_DEVTOOLS_ENABLED=false NUXT_DISABLE_HINTS=true NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON='${mcpConnectorClientsJson}' pnpm dev`,
          port: 3010,
          reuseExistingServer: !isCI,
          timeout: isCI ? 120_000 : 60_000,
        },
      }),
})
