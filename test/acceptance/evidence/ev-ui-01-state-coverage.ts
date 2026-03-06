import type {
  AcceptanceEvidenceExport,
  AcceptanceEvidenceRecord,
} from '#shared/schemas/acceptance-evidence'

import {
  UI_STATE_BY_TEST_CASE,
  type UiCoverageTestCaseId,
  type UiPageState,
} from '../../../shared/utils/ui-state'
import { getAcceptanceRegistryEntry } from '../registry/manifest'
import {
  createEvidenceExport,
  createEvidenceExporterContext,
  type EvidenceExporterOptions,
} from './shared'

/**
 * EV-UI-01: TC-UI-01..TC-UI-05 state-coverage evidence.
 *
 * Aggregates the five UI-state test cases into one evidence export
 * with a record per case. Each record carries:
 *   - the UI state the case probes (`empty` / `loading` / `error` /
 *     `success` / `unauthorized`)
 *   - the screenshot pointer captured by `review-screenshot` agent
 *   - the network log pointer captured from the same page-load
 *   - the HTTP status the page resolved to
 *
 * Real production runs should inject:
 *   - `screenshotPointer` — path to the captured PNG
 *   - `networkLogPointer` — path to the captured HAR / JSON
 *   - `observedState` — which UI state the screenshot shows
 *
 * Local default falls back to stub pointers so the exporter + schema
 * stay exercised in unit tests. Drift is reported when the observed
 * state differs from the expected state for a given TC-UI-* id.
 */

const ACCEPTANCE_ID = 'EV-UI-01'

export interface EvUi01CaseObservation {
  expectedState: UiPageState
  httpStatus: number
  networkLogPointer: string
  observedState: UiPageState
  pageUrl: string
  screenshotPointer: string
  testCaseId: UiCoverageTestCaseId
}

export interface EvUi01ExporterInput extends EvidenceExporterOptions {
  observations?: EvUi01CaseObservation[]
}

function buildDefaultObservations(): EvUi01CaseObservation[] {
  return (Object.keys(UI_STATE_BY_TEST_CASE) as UiCoverageTestCaseId[]).map((testCaseId) => {
    const expectedState = UI_STATE_BY_TEST_CASE[testCaseId]
    const httpStatus = deriveHttpStatusForState(expectedState)

    return {
      expectedState,
      httpStatus,
      networkLogPointer: `stub://ev-ui-01/${testCaseId.toLowerCase()}-network.json`,
      observedState: expectedState,
      pageUrl: '/admin/documents',
      screenshotPointer: `stub://ev-ui-01/${testCaseId.toLowerCase()}-screenshot.png`,
      testCaseId,
    }
  })
}

function deriveHttpStatusForState(state: UiPageState): number {
  switch (state) {
    case 'empty':
    case 'success':
    case 'loading':
      return 200
    case 'error':
      return 500
    case 'unauthorized':
      return 403
  }
}

export function runEvUi01StateCoverageExporter(
  input: EvUi01ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const observations = input.observations ?? buildDefaultObservations()

  if (observations.length === 0) {
    throw new Error('EV-UI-01 exporter requires at least one UI-state observation to emit a record')
  }

  const registryEntry = getAcceptanceRegistryEntry(ACCEPTANCE_ID)

  if (!registryEntry) {
    throw new Error(`Registry entry not found for ${ACCEPTANCE_ID}`)
  }

  const records: AcceptanceEvidenceRecord[] = observations.map((observation) => {
    const caseRegistry = getAcceptanceRegistryEntry(observation.testCaseId)

    if (!caseRegistry) {
      throw new Error(
        `EV-UI-01 exporter referenced unknown UI test case: ${observation.testCaseId}`
      )
    }

    const isStubbed =
      observation.screenshotPointer.startsWith('stub://') ||
      observation.networkLogPointer.startsWith('stub://')

    const stateMatches = observation.observedState === observation.expectedState
    const status: AcceptanceEvidenceRecord['status'] = stateMatches
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (!stateMatches) {
      notesParts.push(
        `UI state drift — expected=${observation.expectedState}, observed=${observation.observedState}`
      )
    }

    if (isStubbed && stateMatches) {
      notesParts.push(
        'Stubbed screenshot + network log pointers — rerun review-screenshot agent against local or production to capture live UI evidence.'
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'web',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: `ui-state-${observation.expectedState}`,
      environment: context.runtimeConfig.environment,
      evidenceRefs: [
        {
          description: `UI screenshot (${observation.testCaseId} → ${observation.expectedState} @ ${observation.pageUrl})`,
          kind: 'ui-screenshot' as const,
          pointer: observation.screenshotPointer,
        },
        {
          description: `network log (${observation.testCaseId} @ ${observation.pageUrl}, http=${observation.httpStatus})`,
          kind: 'ui-network-log' as const,
          pointer: observation.networkLogPointer,
        },
      ],
      generatedAt: context.generatedAt,
      httpStatus: observation.httpStatus,
      notes: notesParts.length > 0 ? notesParts.join(' | ') : undefined,
      reportVersion: context.reportVersion,
      status,
      testCaseId: observation.testCaseId,
    }
  })

  return createEvidenceExport(ACCEPTANCE_ID, records, context)
}
