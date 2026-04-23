import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflowPath = resolve(process.cwd(), '.github/workflows/deploy.yml')
const workflowSource = readFileSync(workflowPath, 'utf8')
const stagingWranglerPath = resolve(process.cwd(), 'wrangler.staging.jsonc')
const stagingWranglerSource = readFileSync(stagingWranglerPath, 'utf8')

describe('deploy workflow config', () => {
  it('injects ADMIN_EMAIL_ALLOWLIST into the production build env', () => {
    const productionBuildSection = workflowSource.match(
      /- name: Build[\s\S]*?- name: Deploy to Cloudflare Workers \(production\)/,
    )?.[0]
    const productionValidateSection = workflowSource.match(
      /- name: Validate production build-time admin allowlist[\s\S]*?- name: Build/,
    )?.[0]

    expect(productionValidateSection).toContain('${{ secrets.PROD_ADMIN_EMAIL_ALLOWLIST }}')
    expect(productionBuildSection).toContain('${{ secrets.PROD_ADMIN_EMAIL_ALLOWLIST }}')
    expect(productionBuildSection).not.toContain('|| secrets.ADMIN_EMAIL_ALLOWLIST')
  })

  it('injects ADMIN_EMAIL_ALLOWLIST into the staging build env', () => {
    const stagingBuildSection = workflowSource.match(
      /- name: Build \(staging\)[\s\S]*?- name: Render staging wrangler config/,
    )?.[0]
    const stagingValidateSection = workflowSource.match(
      /- name: Validate staging build-time admin allowlist[\s\S]*?- name: Build \(staging\)/,
    )?.[0]

    expect(stagingValidateSection).toContain('${{ secrets.STAGING_ADMIN_EMAIL_ALLOWLIST }}')
    expect(stagingBuildSection).toContain('${{ secrets.STAGING_ADMIN_EMAIL_ALLOWLIST }}')
    expect(stagingBuildSection).not.toContain('|| secrets.ADMIN_EMAIL_ALLOWLIST')
  })

  it('keeps the staging deploy path available', () => {
    expect(workflowSource).toMatch(/^\s+- staging\s*$/m)
    expect(workflowSource).toMatch(/^\s*deploy-staging:\s*$/m)
    expect(workflowSource).toMatch(/^\s+environment:\s+staging\s*$/m)
  })

  it('keeps staging runtime vars aligned with the staging AI gateway', () => {
    expect(stagingWranglerSource).toContain('"NUXT_KNOWLEDGE_AI_GATEWAY_ID": "agentic-rag-staging"')
    expect(stagingWranglerSource).toContain('"NUXT_KNOWLEDGE_ENVIRONMENT": "staging"')
  })
})
