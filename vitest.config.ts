import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineVitestProject } from '@nuxt/test-utils/config'
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
  plugins: [] as unknown[],
  resolve: {
    alias: aliases,
    preserveSymlinks: true,
  },
}

const nodeProjectConfig = {
  ...sharedProjectConfig,
  plugins: [vue()],
}

const sharedTestConfig = {
  globals: true,
  setupFiles: ['./test/setup-env.ts'],
  exclude: ['e2e/**', 'node_modules/**'],
}

function directoryHasMatchingFile(
  directoryPath: string,
  fileNamePattern: RegExp,
  relativePathPattern?: RegExp,
): boolean {
  if (!existsSync(directoryPath)) {
    return false
  }

  const entries = readdirSync(directoryPath, { recursive: true, withFileTypes: true })

  return entries.some((entry) => {
    if (!entry.isFile() || !fileNamePattern.test(entry.name)) {
      return false
    }

    if (!relativePathPattern) {
      return true
    }

    const parentPath = typeof entry.parentPath === 'string' ? entry.parentPath : directoryPath
    const relativePath = `${parentPath.replace(`${directoryPath}/`, '')}/${entry.name}`

    return relativePathPattern.test(relativePath)
  })
}

function hasNuxtTestFiles(): boolean {
  const testRoot = fileURLToPath(new URL('./test', import.meta.url))
  const appRoot = fileURLToPath(new URL('./app', import.meta.url))
  const nuxtTestRoot = fileURLToPath(new URL('./test/nuxt', import.meta.url))

  return (
    directoryHasMatchingFile(nuxtTestRoot, /\.[cm]?[jt]s$/) ||
    directoryHasMatchingFile(appRoot, /\.(test|spec)\.ts$/) ||
    directoryHasMatchingFile(testRoot, /\.(test|spec)\.ts$/, /(^|\/).+\.nuxt\.(test|spec)\.ts$/)
  )
}

export default defineConfig(async () => {
  const projects = [
    {
      ...nodeProjectConfig,
      test: {
        ...sharedTestConfig,
        name: 'integration',
        environment: 'node',
        include: ['test/integration/**/*.{test,spec}.ts'],
      },
    },
    {
      ...nodeProjectConfig,
      test: {
        ...sharedTestConfig,
        name: 'unit',
        environment: 'node',
        include: ['test/unit/**/*.{test,spec}.ts'],
        exclude: [...sharedTestConfig.exclude, 'test/unit/**/*.nuxt.{test,spec}.ts'],
      },
    },
  ]

  if (hasNuxtTestFiles()) {
    const nuxtProject = await defineVitestProject({
      ...sharedProjectConfig,
      test: {
        ...sharedTestConfig,
        name: 'nuxt',
        include: [
          'app/**/*.test.ts',
          'test/nuxt/**/*.{test,spec}.ts',
          'test/unit/**/*.nuxt.{test,spec}.ts',
        ],
        environment: 'nuxt',
      },
    })

    projects.push(nuxtProject)
  }

  return {
    test: {
      projects,
    },
  }
})
