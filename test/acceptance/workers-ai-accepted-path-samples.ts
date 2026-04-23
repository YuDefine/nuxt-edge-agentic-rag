import { loadAcceptanceFixtureDataset } from './fixtures/loader'

export type WorkersAiAcceptedPathCoverageTag = 'direct_answer' | 'judge_pass'
export type WorkersAiAcceptedPathRegistryId = 'TC-01' | 'TC-06'

export interface WorkersAiAcceptedPathSample {
  caseId: string
  channel: 'mcp' | 'web'
  coverageTag: WorkersAiAcceptedPathCoverageTag
  prompt: string
  registryId: WorkersAiAcceptedPathRegistryId
  smokeCommand: string
}

const FIXED_SAMPLE_DEFINITIONS = [
  {
    channel: 'web',
    coverageTag: 'direct_answer',
    registryId: 'TC-01',
  },
  {
    channel: 'mcp',
    coverageTag: 'direct_answer',
    registryId: 'TC-01',
  },
  {
    channel: 'web',
    coverageTag: 'judge_pass',
    registryId: 'TC-06',
  },
  {
    channel: 'mcp',
    coverageTag: 'judge_pass',
    registryId: 'TC-06',
  },
] as const satisfies Array<{
  channel: 'mcp' | 'web'
  coverageTag: WorkersAiAcceptedPathCoverageTag
  registryId: WorkersAiAcceptedPathRegistryId
}>

const SMOKE_COMMAND = 'pnpm test:workers-ai-accepted-path'

export function buildWorkersAiAcceptedPathSamples(dataset = 'seed'): WorkersAiAcceptedPathSample[] {
  const fixtureDataset = loadAcceptanceFixtureDataset(dataset)

  return FIXED_SAMPLE_DEFINITIONS.map((definition) => {
    const fixture = fixtureDataset.cases.find(
      (entry) => entry.channel === definition.channel && entry.registryId === definition.registryId,
    )

    if (!fixture) {
      throw new Error(
        `Missing accepted-path fixture for registry=${definition.registryId} channel=${definition.channel} dataset=${dataset}`,
      )
    }

    return {
      caseId: fixture.caseId,
      channel: definition.channel,
      coverageTag: definition.coverageTag,
      prompt: fixture.prompt,
      registryId: definition.registryId,
      smokeCommand: SMOKE_COMMAND,
    }
  })
}

export function summarizeWorkersAiAcceptedPathCoverage(
  samples: WorkersAiAcceptedPathSample[],
): string[] {
  return samples.map((sample) => `${sample.channel}:${sample.coverageTag}:${sample.registryId}`)
}
