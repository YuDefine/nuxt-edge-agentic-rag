import { describe, expect, it } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'

describe('knowledge governance config snapshot', () => {
  it('derives a stable config snapshot version from the governed runtime config', () => {
    const runtimeConfig = createKnowledgeRuntimeConfig({
      environment: 'local',
      features: {
        adminDashboard: true,
      },
    })

    expect(runtimeConfig.governance).toMatchObject({
      environment: 'local',
      execution: {
        maxSelfCorrectionRetry: 1,
      },
      features: {
        adminDashboard: true,
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
    })
    expect(runtimeConfig.governance.configSnapshotVersion).toContain('env=local')
    expect(runtimeConfig.governance.configSnapshotVersion).toContain('features.adminDashboard=on')
  })

  it('bumps the config snapshot version when a governed threshold changes', () => {
    const baseline = createKnowledgeRuntimeConfig({
      environment: 'production',
    })
    const changed = createKnowledgeRuntimeConfig({
      environment: 'production',
      governance: {
        thresholds: {
          answerMin: 0.56,
        },
      },
    })

    expect(changed.governance.configSnapshotVersion).not.toBe(
      baseline.governance.configSnapshotVersion
    )
  })
})
