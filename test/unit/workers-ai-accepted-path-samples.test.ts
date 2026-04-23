import { describe, expect, it } from 'vitest'

import {
  buildWorkersAiAcceptedPathSamples,
  summarizeWorkersAiAcceptedPathCoverage,
} from '../acceptance/workers-ai-accepted-path-samples'

describe('workers-ai accepted-path samples', () => {
  it('pins a reproducible fixed sample set covering web and mcp direct/judge accepted paths', () => {
    const samples = buildWorkersAiAcceptedPathSamples()

    expect(samples).toHaveLength(4)
    expect(summarizeWorkersAiAcceptedPathCoverage(samples).toSorted()).toEqual([
      'mcp:direct_answer:TC-01',
      'mcp:judge_pass:TC-06',
      'web:direct_answer:TC-01',
      'web:judge_pass:TC-06',
    ])

    for (const sample of samples) {
      expect(sample.caseId.length).toBeGreaterThan(0)
      expect(sample.caseId.toLowerCase()).toContain(sample.registryId.toLowerCase())
      expect(sample.prompt.length).toBeGreaterThan(0)
      expect(sample.smokeCommand).toBe('pnpm test:workers-ai-accepted-path')
    }
  })
})
