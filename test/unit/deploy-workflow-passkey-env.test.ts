import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const deployWorkflow = readFileSync(resolve('.github/workflows/deploy.yml'), 'utf8')

function getStepBlock(stepName: string): string {
  const marker = `- name: ${stepName}`
  const start = deployWorkflow.indexOf(marker)

  expect(start, `找不到 deploy step: ${stepName}`).toBeGreaterThanOrEqual(0)

  const nextStep = deployWorkflow.indexOf('\n      - name:', start + marker.length)
  return deployWorkflow.slice(start, nextStep === -1 ? undefined : nextStep)
}

describe('deploy workflow build env wiring', () => {
  it('injects production-only build env for passkey and remote mcp connector config', () => {
    const buildStep = getStepBlock('Build')

    expect(buildStep).toContain('NUXT_KNOWLEDGE_AI_GATEWAY_ID: agentic-rag-production')
    expect(buildStep).toContain('NUXT_KNOWLEDGE_ENVIRONMENT: production')
    expect(buildStep).toContain(
      "NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON: ${{ vars['PROD_MCP_CONNECTOR_CLIENTS_JSON'] || secrets.PROD_MCP_CONNECTOR_CLIENTS_JSON }}",
    )
    expect(buildStep).toContain("NUXT_KNOWLEDGE_FEATURE_PASSKEY: 'true'")
    expect(buildStep).toContain('NUXT_PASSKEY_RP_ID: yudefine.com.tw')
    expect(buildStep).toContain('NUXT_PASSKEY_RP_NAME: 知識問答系統')
  })

  it('injects staging-only build env for passkey and remote mcp connector config', () => {
    const buildStep = getStepBlock('Build (staging)')

    expect(buildStep).toContain('NUXT_KNOWLEDGE_AI_GATEWAY_ID: agentic-rag-staging')
    expect(buildStep).toContain('NUXT_KNOWLEDGE_ENVIRONMENT: staging')
    expect(buildStep).toContain(
      "NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON: ${{ vars['STAGING_MCP_CONNECTOR_CLIENTS_JSON'] || secrets.STAGING_MCP_CONNECTOR_CLIENTS_JSON }}",
    )
    expect(buildStep).toContain("NUXT_KNOWLEDGE_FEATURE_PASSKEY: 'true'")
    expect(buildStep).toContain('NUXT_PASSKEY_RP_ID: yudefine.com.tw')
    expect(buildStep).toContain('NUXT_PASSKEY_RP_NAME: 知識問答系統')
  })
})
