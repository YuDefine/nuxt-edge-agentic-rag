import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface LockfileDependencyEntry {
  specifier?: string
  version?: string
}

interface LockfileImporter {
  dependencies?: Record<string, LockfileDependencyEntry>
  devDependencies?: Record<string, LockfileDependencyEntry>
}

interface LockfileDocument {
  overrides?: Record<string, string>
  importers?: Record<string, LockfileImporter>
  packages?: Record<string, unknown>
}

interface WorkspaceDocument {
  overrides?: Record<string, string>
}

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as PackageJson
const lockfile = parse(readFileSync(resolve('pnpm-lock.yaml'), 'utf8')) as LockfileDocument
const workspaceConfig = parse(
  readFileSync(resolve('pnpm-workspace.yaml'), 'utf8'),
) as WorkspaceDocument

function listResolvedVersions(
  packages: Record<string, unknown> | undefined,
  packageName: string,
): string[] {
  return [
    ...new Set(
      Object.keys(packages ?? {})
        .filter((key) => key.startsWith(`${packageName}@`))
        .map((key) => key.slice(packageName.length + 1).split(/[_(]/)[0]!)
        .filter((version): version is string => Boolean(version)),
    ),
  ].toSorted()
}

describe('better-auth passkey hotfix dependency resolution', () => {
  it('locks the package specifiers and resolved lockfile entries required by the v1.6.7 fix', () => {
    const rootImporter = lockfile.importers?.['.']

    expect(packageJson.dependencies?.['better-auth']).toBe('^1.6.7')
    expect(packageJson.dependencies?.['@better-auth/passkey']).toBe('^1.6.7')
    expect(packageJson.devDependencies?.['@vitest/coverage-v8']).toBe('4.1.5')
    expect(packageJson.devDependencies?.['vite']).toBe('npm:@voidzero-dev/vite-plus-core@0.1.19')
    expect(packageJson.devDependencies?.['vitest']).toBe('npm:@voidzero-dev/vite-plus-test@0.1.19')
    expect(workspaceConfig.overrides?.['better-call']).toBe('1.3.5')
    expect(rootImporter?.dependencies?.['@better-auth/passkey']).toMatchObject({
      specifier: '^1.6.7',
    })
    expect(rootImporter?.dependencies?.['better-auth']).toMatchObject({
      specifier: '^1.6.7',
    })
    expect(rootImporter?.devDependencies?.['@vitest/coverage-v8']).toMatchObject({
      specifier: '4.1.5',
    })
    expect(rootImporter?.devDependencies?.['vite']).toMatchObject({
      specifier: 'npm:@voidzero-dev/vite-plus-core@0.1.19',
    })
    expect(rootImporter?.devDependencies?.['vitest']).toMatchObject({
      specifier: 'npm:@voidzero-dev/vite-plus-test@0.1.19',
    })

    expect(listResolvedVersions(lockfile.packages, 'better-call')).toEqual(['1.3.5'])
    expect(listResolvedVersions(lockfile.packages, '@better-auth/passkey')).toEqual(['1.6.7'])
    expect(listResolvedVersions(lockfile.packages, '@voidzero-dev/vite-plus-core')).toEqual([
      '0.1.19',
    ])
    expect(listResolvedVersions(lockfile.packages, '@voidzero-dev/vite-plus-test')).toEqual([
      '0.1.19',
    ])
    expect(listResolvedVersions(lockfile.packages, 'better-auth')).toContain('1.6.7')
    expect(listResolvedVersions(lockfile.packages, 'better-auth')).not.toContain('1.6.6')
    expect(listResolvedVersions(lockfile.packages, '@vitest/coverage-v8')).toEqual(['4.1.5'])
  })
})
