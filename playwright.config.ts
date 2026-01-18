import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3010',
  },
  webServer: {
    command: 'pnpm dev',
    port: 3010,
    reuseExistingServer: true,
  },
})
