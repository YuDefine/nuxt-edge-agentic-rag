import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const aliases = {
  '~': fileURLToPath(new URL('./app', import.meta.url)),
  '@': fileURLToPath(new URL('./app', import.meta.url)),
  '~~': fileURLToPath(new URL('.', import.meta.url)),
  '@@': fileURLToPath(new URL('.', import.meta.url)),
  '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
  '#server': fileURLToPath(new URL('./server', import.meta.url)),
}

const sharedProjectConfig = {
  plugins: [vue()],
  resolve: {
    alias: aliases,
    preserveSymlinks: true,
  },
}

const sharedTestConfig = {
  globals: true,
  setupFiles: ['./test/setup-env.ts'],
  exclude: ['e2e/**', 'node_modules/**'],
}

export default defineConfig({
  test: {
    projects: [
      {
        ...sharedProjectConfig,
        test: {
          ...sharedTestConfig,
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.{test,spec}.ts'],
        },
      },
      {
        ...sharedProjectConfig,
        test: {
          ...sharedTestConfig,
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.{test,spec}.ts'],
          exclude: [...sharedTestConfig.exclude, 'test/unit/**/*.nuxt.{test,spec}.ts'],
        },
      },
    ],
  },
})
