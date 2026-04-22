#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(__dirname)
const buildConfigPath = join(projectRoot, '.output', 'server', 'wrangler.json')
const stagingOverridesPath = join(projectRoot, 'wrangler.staging.jsonc')
const outputPath = join(projectRoot, '.output', 'server', 'wrangler.staging.json')

function parseJsonc(source, path) {
  return new Script(`(${source})`, { filename: path }).runInNewContext()
}

async function readConfig(path) {
  const source = await readFile(path, 'utf-8')
  return path.endsWith('.jsonc') ? parseJsonc(source, path) : JSON.parse(source)
}

function mergeD1Databases(buildConfig, stagingOverrides) {
  const buildD1 = buildConfig.d1_databases?.[0]

  return (stagingOverrides.d1_databases ?? []).map((entry) => ({
    ...entry,
    migrations_table: entry.migrations_table ?? buildD1?.migrations_table,
  }))
}

async function main() {
  const buildConfig = await readConfig(buildConfigPath)
  const stagingOverrides = await readConfig(stagingOverridesPath)

  const rendered = {
    ...buildConfig,
    name: stagingOverrides.name,
    vars: stagingOverrides.vars,
    routes: stagingOverrides.routes,
    d1_databases: mergeD1Databases(buildConfig, stagingOverrides),
    kv_namespaces: stagingOverrides.kv_namespaces,
    ai: stagingOverrides.ai,
    r2_buckets: stagingOverrides.r2_buckets,
    triggers: stagingOverrides.triggers,
  }

  await writeFile(outputPath, `${JSON.stringify(rendered, null, 2)}\n`, 'utf-8')
  console.log(`[render-staging-wrangler] wrote ${outputPath}`)
}

main().catch((error) => {
  console.error('[render-staging-wrangler] failed:', error)
  process.exit(1)
})
