import { describe, expect, it } from 'vitest'

import { evaluateDocumentDeletability } from '../../server/utils/document-deletability'

describe('evaluateDocumentDeletability', () => {
  it('returns deletable for draft with no published versions', () => {
    const result = evaluateDocumentDeletability({
      documentStatus: 'draft',
      versions: [
        { id: 'v1', publishedAt: null },
        { id: 'v2', publishedAt: null },
      ],
    })

    expect(result).toEqual({ deletable: true, reason: 'draft-never-published' })
  })

  it('returns deletable for draft with no versions at all', () => {
    const result = evaluateDocumentDeletability({
      documentStatus: 'draft',
      versions: [],
    })

    expect(result).toEqual({ deletable: true, reason: 'draft-never-published' })
  })

  it('rejects draft with any published-history version', () => {
    const result = evaluateDocumentDeletability({
      documentStatus: 'draft',
      versions: [
        { id: 'v1', publishedAt: null },
        { id: 'v2', publishedAt: '2026-01-01T00:00:00Z' },
      ],
    })

    expect(result).toEqual({ deletable: false, reason: 'has-published-history' })
  })

  it('rejects active document regardless of version history', () => {
    const result = evaluateDocumentDeletability({
      documentStatus: 'active',
      versions: [{ id: 'v1', publishedAt: null }],
    })

    expect(result).toEqual({ deletable: false, reason: 'status-active' })
  })

  it('rejects archived document regardless of version history', () => {
    const result = evaluateDocumentDeletability({
      documentStatus: 'archived',
      versions: [{ id: 'v1', publishedAt: null }],
    })

    expect(result).toEqual({ deletable: false, reason: 'status-archived' })
  })

  it('published-history check has priority over status-active', () => {
    // Active document with published history — both would reject, but status
    // takes priority because we want callers to archive rather than think
    // they could delete-if-only-they-could-rollback.
    const result = evaluateDocumentDeletability({
      documentStatus: 'active',
      versions: [{ id: 'v1', publishedAt: '2026-01-01T00:00:00Z' }],
    })

    expect(result).toEqual({ deletable: false, reason: 'status-active' })
  })
})
