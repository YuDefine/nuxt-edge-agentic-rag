import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getAcceptanceRegistryEntry } from '../registry/manifest'

export const ACCEPTANCE_FIXTURE_DATASET_VALUES = [
  'seed',
  'dev-calibration',
  'frozen-final',
] as const

export interface AcceptanceFixturePolicy {
  mutableExpectations: boolean
  purpose: string
}

export interface AcceptanceFixtureCase {
  caseId: string
  channel: string
  expectedOutcome: string
  prompt: string
  registryId: string
}

export interface AcceptanceFixtureDataset {
  cases: AcceptanceFixtureCase[]
  dataset: string
  policy: AcceptanceFixturePolicy
  version: string
}

export function getAcceptanceFixturePath(dataset: string): string {
  assertKnownDataset(dataset)

  return resolve(process.cwd(), 'test', 'fixtures', 'acceptance', dataset, 'cases.json')
}

export function loadAcceptanceFixtureDataset(dataset: string): AcceptanceFixtureDataset {
  const raw = readFileSync(getAcceptanceFixturePath(dataset), 'utf8')
  const parsed = JSON.parse(raw) as AcceptanceFixtureDataset

  for (const entry of parsed.cases) {
    if (!getAcceptanceRegistryEntry(entry.registryId)) {
      throw new Error(`Unknown registry id in ${dataset}: ${entry.registryId}`)
    }
  }

  return parsed
}

function assertKnownDataset(dataset: string): void {
  if (!ACCEPTANCE_FIXTURE_DATASET_VALUES.includes(dataset as never)) {
    throw new Error(`Unknown acceptance fixture dataset: ${dataset}`)
  }
}
