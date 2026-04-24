import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

function collectMatchingFiles(
  directoryPath: string,
  fileNamePattern: RegExp,
  relativePathPattern?: RegExp,
): string[] {
  if (!existsSync(directoryPath)) {
    return []
  }

  const entries = readdirSync(directoryPath, { recursive: true, withFileTypes: true })

  return entries.flatMap((entry) => {
    if (!entry.isFile() || !fileNamePattern.test(entry.name)) {
      return []
    }

    const parentPath = typeof entry.parentPath === 'string' ? entry.parentPath : directoryPath
    const relativePath = `${parentPath.replace(`${directoryPath}/`, '')}/${entry.name}`.replace(
      /^\//u,
      '',
    )

    if (!relativePathPattern) {
      return [relativePath]
    }

    return relativePathPattern.test(relativePath) ? [relativePath] : []
  })
}

function requiresNuxtRuntime(filePath: string): boolean {
  const source = readFileSync(filePath, 'utf8')
  return /@nuxt\/test-utils\/runtime|mountSuspended|mockComponent|from ['"]vue['"]/u.test(source)
}

function getNuxtUnitFiles(): string[] {
  const testRoot = fileURLToPath(new URL('./test', import.meta.url))
  const unitTestFiles = collectMatchingFiles(
    testRoot,
    /\.(test|spec)\.ts$/,
    /^unit\/.+\.(test|spec)\.ts$/,
  )

  return unitTestFiles
    .filter((relativePath) => requiresNuxtRuntime(join(testRoot, relativePath)))
    .map((relativePath) => `test/${relativePath}`)
}

export default defineConfig(async () => {
  if (process.env.EVALITE_REPORT_TRACES === 'true') {
    return {
      ...nodeProjectConfig,
      test: {
        environment: 'node',
        include: ['test/evals/**/*.eval.ts'],
      },
    }
  }

  const appRoot = fileURLToPath(new URL('./app', import.meta.url))
  const nuxtTestRoot = fileURLToPath(new URL('./test/nuxt', import.meta.url))
  const nuxtUnitFiles = getNuxtUnitFiles()
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
        exclude: [...sharedTestConfig.exclude, ...nuxtUnitFiles],
      },
    },
  ]

  const hasNuxtProjectFiles =
    collectMatchingFiles(nuxtTestRoot, /\.[cm]?[jt]s$/).length > 0 ||
    collectMatchingFiles(appRoot, /\.(test|spec)\.ts$/).length > 0 ||
    nuxtUnitFiles.length > 0

  if (hasNuxtProjectFiles) {
    const nuxtProject = await defineVitestProject({
      ...sharedProjectConfig,
      test: {
        ...sharedTestConfig,
        name: 'nuxt',
        include: ['app/**/*.test.ts', 'test/nuxt/**/*.{test,spec}.ts', ...nuxtUnitFiles],
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
