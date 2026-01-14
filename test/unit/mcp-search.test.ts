import { describe, expect, it, vi } from 'vitest'

import { searchKnowledge } from '../../server/utils/mcp-search'

describe('mcp search', () => {
  it('forwards allowed access levels into retrieval and returns only safe result fields', async () => {
    const retrieve = vi.fn().mockResolvedValue({
      evidence: [
        {
          accessLevel: 'internal',
          categorySlug: 'finance',
          chunkText: 'Revenue grew 20% in Q1.',
          citationLocator: 'lines 1-3',
          documentId: 'doc-1',
          documentTitle: 'Quarterly Report',
          documentVersionId: 'ver-1',
          excerpt: 'Revenue grew 20%.',
          score: 0.82,
          sourceChunkId: 'chunk-1',
          title: 'Quarterly Report',
        },
      ],
      normalizedQuery: 'finance revenue',
    })

    const result = await searchKnowledge(
      {
        allowedAccessLevels: ['internal'],
        query: 'finance revenue',
      },
      {
        retrieve,
      }
    )

    expect(retrieve).toHaveBeenCalledWith({
      allowedAccessLevels: ['internal'],
      query: 'finance revenue',
    })
    expect(result).toEqual({
      results: [
        {
          accessLevel: 'internal',
          categorySlug: 'finance',
          citationLocator: 'lines 1-3',
          excerpt: 'Revenue grew 20%.',
          title: 'Quarterly Report',
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('documentVersionId')
    expect(JSON.stringify(result)).not.toContain('score')
    expect(JSON.stringify(result)).not.toContain('chunkText')
    expect(JSON.stringify(result)).not.toContain('sourceChunkId')
  })

  it('returns 200-shape empty results when no visible evidence remains', async () => {
    const retrieve = vi.fn().mockResolvedValue({
      evidence: [],
      normalizedQuery: 'restricted roadmap',
    })

    const result = await searchKnowledge(
      {
        allowedAccessLevels: ['internal'],
        query: 'restricted roadmap',
      },
      {
        retrieve,
      }
    )

    expect(result).toEqual({
      results: [],
    })
  })
})
