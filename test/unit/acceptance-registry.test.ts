import { describe, expect, it } from 'vitest'

interface RegistryModule {
  acceptanceRegistryManifest: {
    reportPath: string
    reportVersion: string
    summary: {
      acceptances: number
      evidence: number
      testCases: number
    }
  }
  createAcceptanceExportRow?: (input: {
    acceptanceId: string
    channel: 'mcp' | 'web'
    decisionPath: string
    httpStatus: number
    passed: boolean
    testCaseId: string
  }) => {
    acceptanceId: string
    channel: 'mcp' | 'web'
    configSnapshotVersion: string
    decisionPath: string
    httpStatus: number
    passed: boolean
    testCaseId: string
  }
  getAcceptanceRegistryEntry(id: string): Record<string, unknown> | null
  listAcceptanceRegistryEntries(): Array<{
    id: string
  }>
}

async function importRegistryModule(): Promise<RegistryModule | null> {
  try {
    return (await import('../acceptance/registry/manifest')) as RegistryModule
  } catch (error) {
    if (error instanceof Error && /Cannot find module|Failed to load url/i.test(error.message)) {
      return null
    }

    throw error
  }
}

describe('acceptance registry manifest', () => {
  it('covers every TC, A, and EV identifier from the report in one manifest', async () => {
    const module = await importRegistryModule()

    expect(module).not.toBeNull()

    const manifest = module?.acceptanceRegistryManifest
    const entries = module?.listAcceptanceRegistryEntries() ?? []

    expect(manifest).toMatchObject({
      reportPath: 'main-v0.0.36.md',
      reportVersion: 'v0.0.36',
      summary: {
        acceptances: 13,
        evidence: 5,
        testCases: 25,
      },
    })
    expect(entries).toHaveLength(43)
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(43)
    expect(module?.getAcceptanceRegistryEntry('TC-20')).toMatchObject({
      id: 'TC-20',
      acceptanceIds: expect.arrayContaining(['A12']),
      reportSections: expect.arrayContaining(['附錄 B', '4.1.1']),
    })
    expect(module?.getAcceptanceRegistryEntry('TC-UI-01')).toMatchObject({
      id: 'TC-UI-01',
      channels: ['web'],
      primaryOutcome: 'empty_state',
    })
    expect(module?.getAcceptanceRegistryEntry('TC-UI-05')).toMatchObject({
      id: 'TC-UI-05',
      primaryOutcome: 'unauthorized_state',
    })
    expect(module?.getAcceptanceRegistryEntry('EV-UI-01')).toMatchObject({
      id: 'EV-UI-01',
      kind: 'evidence',
    })
    expect(module?.getAcceptanceRegistryEntry('A02')).toMatchObject({
      id: 'A02',
      caseIds: expect.arrayContaining(['TC-01', 'TC-04', 'TC-06']),
      evidenceIds: expect.arrayContaining(['EV-01']),
      reportSections: expect.arrayContaining(['4.1.1']),
    })
    expect(module?.getAcceptanceRegistryEntry('EV-04')).toMatchObject({
      id: 'EV-04',
      acceptanceIds: expect.arrayContaining(['A13']),
      reportSections: expect.arrayContaining(['第三章補充證據項目']),
    })
  })

  it('stamps acceptance export rows with the shared config snapshot version', async () => {
    const module = await importRegistryModule()

    expect(module?.createAcceptanceExportRow).toBeTypeOf('function')

    expect(
      module?.createAcceptanceExportRow?.({
        acceptanceId: 'A02',
        channel: 'web',
        decisionPath: 'direct',
        httpStatus: 200,
        passed: true,
        testCaseId: 'TC-01',
      }),
    ).toMatchObject({
      acceptanceId: 'A02',
      channel: 'web',
      configSnapshotVersion: expect.any(String),
      decisionPath: 'direct',
      httpStatus: 200,
      passed: true,
      testCaseId: 'TC-01',
    })
  })
})
