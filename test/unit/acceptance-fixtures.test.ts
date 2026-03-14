import { describe, expect, it } from 'vitest'

interface FixtureLoaderModule {
  ACCEPTANCE_FIXTURE_DATASET_VALUES: string[]
  getAcceptanceFixturePath(dataset: string): string
  loadAcceptanceFixtureDataset(dataset: string): {
    cases: Array<{
      caseId: string
      registryId: string
    }>
    dataset: string
    policy: {
      mutableExpectations: boolean
      purpose: string
    }
    version: string
  }
}

async function importFixtureLoaderModule(): Promise<FixtureLoaderModule | null> {
  try {
    return (await import('../acceptance/fixtures/loader')) as FixtureLoaderModule
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/i.test(error.message)) {
      return null
    }

    throw error
  }
}

describe('acceptance fixture loader', () => {
  it('keeps seed, dev-calibration, and frozen-final datasets isolated', async () => {
    const module = await importFixtureLoaderModule()

    expect(module).not.toBeNull()
    expect(module?.ACCEPTANCE_FIXTURE_DATASET_VALUES).toEqual([
      'seed',
      'dev-calibration',
      'frozen-final',
    ])

    const seed = module?.loadAcceptanceFixtureDataset('seed')
    const calibration = module?.loadAcceptanceFixtureDataset('dev-calibration')
    const frozen = module?.loadAcceptanceFixtureDataset('frozen-final')

    expect(seed).toMatchObject({
      dataset: 'seed',
      policy: {
        mutableExpectations: true,
      },
      version: 'v1.0.0',
    })
    expect(calibration).toMatchObject({
      dataset: 'dev-calibration',
      policy: {
        mutableExpectations: true,
      },
      version: 'v1.0.0',
    })
    expect(frozen).toMatchObject({
      dataset: 'frozen-final',
      policy: {
        mutableExpectations: false,
      },
      version: 'v1.0.0',
    })
    expect(seed?.cases.length).toBeGreaterThan(0)
    expect(calibration?.cases.length).toBeGreaterThan(0)
    expect(frozen?.cases.length).toBeGreaterThan(0)
    expect(
      frozen?.cases.every(
        (entry) => entry.registryId.startsWith('TC-') || entry.registryId.startsWith('EV-'),
      ),
    ).toBe(true)
    expect(module?.getAcceptanceFixturePath('frozen-final')).toContain(
      'test/fixtures/acceptance/frozen-final/cases.json',
    )
  })
})
