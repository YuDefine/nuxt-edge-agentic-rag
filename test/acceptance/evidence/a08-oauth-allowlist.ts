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
 * A08: Google OAuth + ADMIN_EMAIL_ALLOWLIST permission recomputation.
 *
 * Walks through the three canonical state transitions for a single
 * user session:
 *   1. `baseline`  — user signed in, not on allowlist → `user` role
 *   2. `promoted`  — user added to allowlist → next request sees `admin` role
 *   3. `demoted`   — user removed from allowlist → next request sees `user` role
 *
 * For each transition the sample records:
 *   - user role + accessible routes + navigation items snapshot
 *   - allowlist state pointer (before/after state of the env / KV entry)
 *   - session rehydration snapshot (OAuth token + decoded claims)
 *
 * Drift is detected when the recomputed role does not match the
 * expected role for the allowlist state.
 */

const ACCEPTANCE_ID = 'A08'

export type A08SessionState = 'baseline' | 'promoted' | 'demoted'
export type A08Role = 'user' | 'admin'

export interface A08SessionSnapshot {
  accessibleRoutes: string[]
  actualRole: A08Role
  allowlistContainsUser: boolean
  allowlistStatePointer: string
  expectedRole: A08Role
  httpStatus: number
  navigationItems: string[]
  oauthSessionPointer: string
  stateLabel: A08SessionState
  userEmail: string
}

export interface A08ExporterInput extends EvidenceExporterOptions {
  snapshots?: A08SessionSnapshot[]
}

function buildDefaultSnapshots(): A08SessionSnapshot[] {
  const userEmail = 'ops-lead@example.com'

  return [
    {
      accessibleRoutes: ['/', '/chat'],
      actualRole: 'user',
      allowlistContainsUser: false,
      allowlistStatePointer: 'stub://allowlist/state-baseline.json',
      expectedRole: 'user',
      httpStatus: 200,
      navigationItems: ['Home', 'Chat'],
      oauthSessionPointer: 'stub://oauth/session-baseline.json',
      stateLabel: 'baseline',
      userEmail,
    },
    {
      accessibleRoutes: ['/', '/chat', '/admin', '/admin/documents'],
      actualRole: 'admin',
      allowlistContainsUser: true,
      allowlistStatePointer: 'stub://allowlist/state-promoted.json',
      expectedRole: 'admin',
      httpStatus: 200,
      navigationItems: ['Home', 'Chat', 'Admin'],
      oauthSessionPointer: 'stub://oauth/session-promoted.json',
      stateLabel: 'promoted',
      userEmail,
    },
    {
      accessibleRoutes: ['/', '/chat'],
      actualRole: 'user',
      allowlistContainsUser: false,
      allowlistStatePointer: 'stub://allowlist/state-demoted.json',
      expectedRole: 'user',
      httpStatus: 200,
      navigationItems: ['Home', 'Chat'],
      oauthSessionPointer: 'stub://oauth/session-demoted.json',
      stateLabel: 'demoted',
      userEmail,
    },
  ]
}

interface AllowlistComparison {
  adminRouteLeak: boolean
  allowlistConsistentWithRole: boolean
  roleMatchesExpectation: boolean
}

function compareSnapshot(snapshot: A08SessionSnapshot): AllowlistComparison {
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

export function runA08OauthAllowlistExporter(
  input: A08ExporterInput = {}
): AcceptanceEvidenceExport {
  const context = createEvidenceExporterContext(input)
  const snapshots = input.snapshots ?? buildDefaultSnapshots()

  if (snapshots.length === 0) {
    throw new Error('A08 exporter requires at least one session snapshot to emit a record')
  }

  const registryEntry = getAcceptanceRegistryEntry(ACCEPTANCE_ID)

  if (!registryEntry) {
    throw new Error(`Registry entry not found for ${ACCEPTANCE_ID}`)
  }

  const records: AcceptanceEvidenceRecord[] = snapshots.map((snapshot) => {
    const isStubbed =
      snapshot.oauthSessionPointer.startsWith('stub://') ||
      snapshot.allowlistStatePointer.startsWith('stub://')
    const comparison = compareSnapshot(snapshot)
    const passed =
      comparison.roleMatchesExpectation &&
      comparison.allowlistConsistentWithRole &&
      !comparison.adminRouteLeak
    const status: AcceptanceEvidenceRecord['status'] = passed
      ? isStubbed
        ? 'pending-production-run'
        : 'passed'
      : 'failed'

    const notesParts: string[] = []

    if (!comparison.roleMatchesExpectation) {
      notesParts.push(
        `role recomputation drift at ${snapshot.stateLabel} (expected=${snapshot.expectedRole}, actual=${snapshot.actualRole})`
      )
    }

    if (!comparison.allowlistConsistentWithRole) {
      notesParts.push('allowlist membership does not match observed role')
    }

    if (comparison.adminRouteLeak) {
      notesParts.push('non-admin session exposes admin routes — possible privilege escalation leak')
    }

    if (isStubbed && passed) {
      notesParts.push(
        'Stubbed OAuth + allowlist snapshots — rerun promote/demote flow with real Google OAuth session to capture live payloads.'
      )
    }

    return {
      acceptanceId: ACCEPTANCE_ID,
      channel: 'web',
      configSnapshotVersion: context.runtimeConfig.governance.configSnapshotVersion,
      decisionPath: `allowlist-${snapshot.stateLabel}`,
      environment: context.runtimeConfig.environment,
      evidenceRefs: [
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
      ],
      generatedAt: context.generatedAt,
      httpStatus: snapshot.httpStatus,
      notes: notesParts.length > 0 ? notesParts.join(' | ') : undefined,
      reportVersion: context.reportVersion,
      status,
      testCaseId: null,
    }
  })

  return createEvidenceExport(ACCEPTANCE_ID, records, context)
}
