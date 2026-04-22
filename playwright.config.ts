import { defineConfig, devices } from '@playwright/test'

const isCI = process.env.CI === 'true'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3010',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: isCI
      ? 'NITRO_HOST=127.0.0.1 NITRO_PORT=3010 pnpm exec nuxt preview'
      : 'NUXT_DISABLE_HINTS=true pnpm dev',
    port: 3010,
    reuseExistingServer: !isCI,
  },
})
