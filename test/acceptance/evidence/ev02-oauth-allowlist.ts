import type {
  AcceptanceEvidenceExport,
  AcceptanceEvidenceRecord,
} from '#shared/schemas/acceptance-evidence'

import { getAcceptanceRegistryEntry } from '../registry/manifest'
import {
  createEvidenceExport,
  createEvidenceExporterContext,
  type EvidenceExporterOptions,
} from './shared'

/**
 * EV-02: OAuth + ADMIN_EMAIL_ALLOWLIST permission-recompute chain.
 *
 * Aggregates A08's per-state snapshots (`baseline` → `promoted` →
 * `demoted`) into a single evidence record that report Chapter 3 links
 * to when documenting the login flow and role-recomputation guarantees.
 *
 * Drift detection mirrors A08:
 *   - actual role must match expected role for the allowlist state
 *   - allowlist membership must agree with observed role
 *   - non-admin must never expose `/admin/*` routes
 *
 * A failure at any transition collapses the whole chain to `failed`.
 */

const ACCEPTANCE_ID = 'EV-02'

export type Ev02SessionState = 'baseline' | 'promoted' | 'demoted'
export type Ev02Role = 'user' | 'admin'

export interface Ev02SessionSnapshot {
  accessibleRoutes: string[]
  actualRole: Ev02Role
  allowlistContainsUser: boolean
  allowlistStatePointer: string
  expectedRole: Ev02Role
  httpStatus: number
  navigationItems: string[]
  oauthSessionPointer: string
  stateLabel: Ev02SessionState
  userEmail: string
}

export interface Ev02ExporterInput extends EvidenceExporterOptions {
  snapshots?: Ev02SessionSnapshot[]
}

function buildDefaultSnapshots(): Ev02SessionSnapshot[] {
  const userEmail = 'ops-lead@example.com'

  return [
    {
      accessibleRoutes: ['/', '/chat'],
      actualRole: 'user',
      allowlistContainsUser: false,
      allowlistStatePointer: 'stub://ev02/allowlist-baseline.json',
      expectedRole: 'user',
      httpStatus: 200,
      navigationItems: ['Home', 'Chat'],
      oauthSessionPointer: 'stub://ev02/session-baseline.json',
      stateLabel: 'baseline',
      userEmail,
    },
    {
      accessibleRoutes: ['/', '/chat', '/admin', '/admin/documents'],
      actualRole: 'admin',
      allowlistContainsUser: true,
      allowlistStatePointer: 'stub://ev02/allowlist-promoted.json',
      expectedRole: 'admin',
      httpStatus: 200,
      navigationItems: ['Home', 'Chat', 'Admin'],
      oauthSessionPointer: 'stub://ev02/session-promoted.json',
      stateLabel: 'promoted',
      userEmail,
    },
    {
      accessibleRoutes: ['/', '/chat'],
      actualRole: 'user',
      allowlistContainsUser: false,
      allowlistStatePointer: 'stub://ev02/allowlist-demoted.json',
      expectedRole: 'user',
      httpStatus: 200,
      navigationItems: ['Home', 'Chat'],
      oauthSessionPointer: 'stub://ev02/session-demoted.json',
      stateLabel: 'demoted',
      userEmail,
    },
  ]
}

interface Ev02SnapshotComparison {
  adminRouteLeak: boolean
  allowlistConsistentWithRole: boolean
  roleMatchesExpectation: boolean
}

function compareSnapshot(snapshot: Ev02SessionSnapshot): Ev02SnapshotComparison {
  const roleMatchesExpectation = snapshot.actualRole === snapshot.expectedRole
  const allowlistConsistentWithRole =
    (snapshot.allowlistContainsUser && snapshot.actualRole === 'admin') ||
    (!snapshot.allowlistContainsUser && snapshot.actualRole === 'user')
  const adminRouteLeak =
    snapshot.actualRole === 'user' &&
    snapshot.accessibleRoutes.some((route) => route.startsWith('/admin'))

  return {
    adminRouteLeak,
    allowlistConsistentWithRole,
    roleMatchesExpectation,
  }
}

export function runEv02OauthAllowlistExporter(
  input: Ev02ExporterInput = {},
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const snapshots = input.snapshots ?? buildDefaultSnapshots()

  if (snapshots.length === 0) {
    throw new Error(
      'EV-02 exporter requires at least one OAuth+allowlist snapshot to emit a record',
    )
  }

  const registryEntry = getAcceptanceRegistryEntry(ACCEPTANCE_ID)

  if (!registryEntry) {
    throw new Error(`Registry entry not found for ${ACCEPTANCE_ID}`)
  }

  const isStubbed = snapshots.some(
    (snapshot) =>
      snapshot.oauthSessionPointer.startsWith('stub://') ||
      snapshot.allowlistStatePointer.startsWith('stub://'),
  )

  const notesParts: string[] = []
  let anyFailed = false

  for (const snapshot of snapshots) {
    const comparison = compareSnapshot(snapshot)

    if (!comparison.roleMatchesExpectation) {
      anyFailed = true
      notesParts.push(
        `role recomputation drift at ${snapshot.stateLabel} (expected=${snapshot.expectedRole}, actual=${snapshot.actualRole})`,
      )
    }

    if (!comparison.allowlistConsistentWithRole) {
      anyFailed = true
      notesParts.push(`allowlist membership does not match observed role at ${snapshot.stateLabel}`)
    }

    if (comparison.adminRouteLeak) {
      anyFailed = true
      notesParts.push(
        `non-admin session exposes admin routes at ${snapshot.stateLabel} — possible privilege escalation leak`,
      )
    }
  }

  const status: AcceptanceEvidenceRecord['status'] = anyFailed
    ? 'failed'
    : isStubbed
      ? 'pending-production-run'
      : 'passed'

  if (isStubbed && !anyFailed) {
    notesParts.push(
      'Stubbed OAuth + allowlist chain — rerun promote/demote flow with real Google OAuth sessions to capture live payloads.',
    )
  }

  const evidenceRefs = snapshots.flatMap((snapshot) => [
    {
      description: `OAuth session snapshot (${snapshot.stateLabel}, email=${snapshot.userEmail})`,
      kind: 'oauth-session-snapshot' as const,
      pointer: snapshot.oauthSessionPointer,
    },
    {
      description: `ADMIN_EMAIL_ALLOWLIST state (${snapshot.stateLabel}, contains=${snapshot.allowlistContainsUser})`,
      kind: 'allowlist-state' as const,
      pointer: snapshot.allowlistStatePointer,
    },
  ])

  const firstSnapshot = snapshots[0]
  const record: AcceptanceEvidenceRecord = {
    acceptanceId: ACCEPTANCE_ID,
    channel: 'web',
    configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
    decisionPath: 'allowlist-promote-demote-chain',
    environment: context.runtimeConfig.environment,
    evidenceRefs,
    generatedAt: context.generatedAt,
    httpStatus: firstSnapshot.httpStatus,
    notes: notesParts.length > 0 ? notesParts.join(' | ') : undefined,
    reportVersion: context.reportVersion,
    status,
    testCaseId: null,
  }

  return createEvidenceExport(ACCEPTANCE_ID, [record], context)
}
