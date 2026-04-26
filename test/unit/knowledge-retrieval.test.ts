import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import {
  normalizeKnowledgeQuery,
  retrieveVerifiedEvidence,
} from '#server/utils/knowledge-retrieval'

describe('knowledge retrieval', () => {
  it('normalizes category hints, abbreviations, whitespace, and dates without model calls', () => {
    expect(normalizeKnowledgeQuery('  category:finance   FAQ for 2026/04/16  ')).toEqual({
      categoryHints: ['finance'],
      normalizedQuery: 'frequently asked questions for 2026-04-16',
    })
  })

  it('applies retrieval filters and drops stale evidence after D1 verification', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const search = vi.fn().mockResolvedValue([
      {
        accessLevel: 'internal',
        citationLocator: 'lines 1-3',
        documentVersionId: 'ver-1',
        excerpt: 'Revenue grew 20%.',
        score: 0.82,
      },
      {
        accessLevel: 'internal',
        citationLocator: 'lines 1-3',
        documentVersionId: 'ver-stale',
        excerpt: 'Outdated revenue figure.',
        score: 0.91,
      },
    ])
    const store = {
      resolveCurrentEvidence: vi.fn().mockImplementation(async ({ documentVersionId }) => {
        if (documentVersionId !== 'ver-1') {
          return null
        }

        return {
          accessLevel: 'internal',
          categorySlug: 'finance',
          chunkText: 'Revenue grew 20%.',
          citationLocator: 'lines 1-3',
          documentId: 'doc-1',
          documentTitle: 'Quarterly Report',
          documentVersionId: 'ver-1',
          sourceChunkId: 'chunk-1',
        }
      }),
    }

    const result = await retrieveVerifiedEvidence(
      {
        allowedAccessLevels: ['internal'],
        maxResults: 8,
        query: 'category:finance FAQ for 2026/04/16',
      },
      {
        governance,
        search,
        store,
      },
    )

    expect(search).toHaveBeenCalledWith({
      filters: {
        filters: [
          { key: 'status', type: 'eq', value: 'active' },
          { key: 'version_state', type: 'eq', value: 'current' },
          { key: 'access_level', type: 'eq', value: 'internal' },
        ],
        type: 'and',
      },
      max_num_results: 8,
      query: 'frequently asked questions for 2026-04-16',
      ranking_options: {
        score_threshold: governance.retrieval.minScore,
      },
      rewrite_query: false,
    })
    expect(result).toEqual({
      evidence: [
        {
          accessLevel: 'internal',
          categorySlug: 'finance',
          chunkText: 'Revenue grew 20%.',
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
      normalizedQuery: 'frequently asked questions for 2026-04-16',
      // §S-OB (change rag-query-rewriting): rewriter columns appended to
      // the return shape — disabled path keeps originalQuery == normalized
      // and rewrittenQuery NULL.
      originalQuery: 'frequently asked questions for 2026-04-16',
      rewriterStatus: 'disabled',
      rewrittenQuery: null,
    })
  })
})
