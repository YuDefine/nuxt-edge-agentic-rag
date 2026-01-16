import { beforeAll, describe, expect, it, vi } from 'vitest'

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
    })
  })
})
