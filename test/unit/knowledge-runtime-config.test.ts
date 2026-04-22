import { beforeAll, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'

let nuxtConfig: typeof import('../../nuxt.config').default

beforeAll(async () => {
  vi.stubGlobal('defineNuxtConfig', (input: unknown) => input)
  const module = await import('../../nuxt.config')
  nuxtConfig = module.default
})

describe('knowledge runtime bootstrap', () => {
  it('defines isolated bindings and feature flags for the knowledge stack', () => {
    const runtimeConfig = nuxtConfig.runtimeConfig as Record<string, unknown>
    const knowledge = runtimeConfig.knowledge as Record<string, unknown> | undefined

    expect(knowledge).toEqual({
      environment: 'local',
      adminEmailAllowlist: [],
      aiGateway: {
        id: '',
        cacheEnabled: true,
      },
      autoRag: {
        apiToken: '',
      },
      bindings: {
        aiSearchIndex: '',
        d1Database: 'DB',
        documentsBucket: 'BLOB',
        rateLimitKv: 'KV',
      },
      uploads: {
        accountId: '',
        accessKeyId: '',
        bucketName: '',
        presignExpiresSeconds: 900,
        secretAccessKey: '',
      },
      features: {
        adminDashboard: false,
        cloudFallback: false,
        mcpSession: false,
        passkey: false,
      },
      governance: {
        configSnapshotVersion: expect.any(String),
        environment: 'local',
        execution: {
          maxSelfCorrectionRetry: 1,
        },
        features: {
          adminDashboard: false,
          cloudFallback: false,
          mcpSession: false,
          passkey: false,
        },
        models: {
          agentJudge: 'agentJudge',
          defaultAnswer: 'defaultAnswer',
        },
        retrieval: {
          maxResults: 8,
          minScore: 0.2,
        },
        thresholds: {
          answerMin: 0.55,
          directAnswerMin: 0.7,
          judgeMin: 0.45,
        },
      },
      mcpConnectors: {
        oauth: {
          accessTokenTtlSeconds: 600,
          authorizationCodeTtlSeconds: 120,
        },
        clients: [],
      },
    })
  })
})

describe('knowledge runtime aiGateway', () => {
  it('defaults id to empty string and cacheEnabled to true', () => {
    const config = createKnowledgeRuntimeConfig()

    expect(config.aiGateway).toEqual({ id: '', cacheEnabled: true })
  })

  it('accepts explicit id and cacheEnabled boolean', () => {
    const config = createKnowledgeRuntimeConfig({
      aiGateway: { id: 'agentic-rag-production', cacheEnabled: false },
    })

    expect(config.aiGateway).toEqual({
      id: 'agentic-rag-production',
      cacheEnabled: false,
    })
  })

  it('parses cacheEnabled string "false" from env', () => {
    const config = createKnowledgeRuntimeConfig({
      aiGateway: { cacheEnabled: 'false' },
    })

    expect(config.aiGateway.cacheEnabled).toBe(false)
  })

  it('parses cacheEnabled string "true" from env', () => {
    const config = createKnowledgeRuntimeConfig({
      aiGateway: { cacheEnabled: 'true' },
    })

    expect(config.aiGateway.cacheEnabled).toBe(true)
  })

  it('falls back to cacheEnabled default (true) for unrecognized string', () => {
    const config = createKnowledgeRuntimeConfig({
      aiGateway: { cacheEnabled: 'yes' },
    })

    expect(config.aiGateway.cacheEnabled).toBe(true)
  })

  it('accepts empty string id as disabled gateway', () => {
    const config = createKnowledgeRuntimeConfig({
      aiGateway: { id: '' },
    })

    expect(config.aiGateway.id).toBe('')
  })
})
