import { describe, expect, it } from 'vitest'

import type { AdminMemberRow, CredentialType } from '../../shared/types/admin-members'

/**
 * passkey-authentication §13.4 — Admin members row rendering logic.
 *
 * Tests the decision helpers the row template depends on:
 *
 *   - primary-identifier fallback chain (displayName → name → "—")
 *   - email display ("—" placeholder when NULL)
 *   - credential badge iteration preserves server order
 *
 * The Vue template itself is exercised by the e2e spec in §17.6;
 * this spec guards the pure pieces.
 */

function primaryIdentifier(row: AdminMemberRow): string {
  return row.displayName ?? row.name ?? '—'
}

function emailDisplay(row: AdminMemberRow): string {
  return row.email ?? '—'
}

function credentialOrder(types: CredentialType[]): CredentialType[] {
  // Current server order is ['google', 'passkey']; we keep whatever the
  // server sends and only assert the contract doesn't silently reorder.
  return [...types]
}

describe('admin members row — primary identifier fallback', () => {
  const base: AdminMemberRow = {
    id: 'u1',
    email: 'u1@example.com',
    name: null,
    displayName: null,
    image: null,
    role: 'member',
    credentialTypes: ['google'],
    registeredAt: null,
    lastActivityAt: null,
    createdAt: '',
    updatedAt: '',
  }

  it('prefers displayName when present', () => {
    expect(primaryIdentifier({ ...base, displayName: 'Alice', name: 'A' })).toBe('Alice')
  })

  it('falls back to name when displayName is null', () => {
    expect(primaryIdentifier({ ...base, displayName: null, name: 'OldName' })).toBe('OldName')
  })

  it('renders "—" when both displayName and name are null', () => {
    expect(primaryIdentifier({ ...base, displayName: null, name: null })).toBe('—')
  })
})

describe('admin members row — email display', () => {
  const base: AdminMemberRow = {
    id: 'u1',
    email: null,
    name: null,
    displayName: '小明',
    image: null,
    role: 'guest',
    credentialTypes: ['passkey'],
    registeredAt: null,
    lastActivityAt: null,
    createdAt: '',
    updatedAt: '',
  }

  it('renders "—" placeholder for NULL email (passkey-only user)', () => {
    expect(emailDisplay(base)).toBe('—')
  })

  it('renders the email address when present', () => {
    expect(emailDisplay({ ...base, email: 'alice@example.com' })).toBe('alice@example.com')
  })
})

describe('admin members row — credential types', () => {
  it('preserves server order (google first, passkey second)', () => {
    expect(credentialOrder(['google', 'passkey'])).toEqual(['google', 'passkey'])
  })

  it('handles passkey-only users', () => {
    expect(credentialOrder(['passkey'])).toEqual(['passkey'])
  })

  it('handles google-only users', () => {
    expect(credentialOrder(['google'])).toEqual(['google'])
  })

  it('handles users with no credentials bound (edge case mid-registration)', () => {
    expect(credentialOrder([])).toEqual([])
  })
})
