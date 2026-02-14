import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { answerKnowledgeQuery } from '#server/utils/knowledge-answering'

describe('knowledge answering', () => {
  it('bypasses judge for high-confidence evidence and persists citations', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const retrieve = vi.fn().mockResolvedValue({
      evidence: [
        {
          accessLevel: 'internal',
          categorySlug: 'finance',
          chunkText: 'Revenue grew 20%.',
          citationLocator: 'lines 1-3',
          documentId: 'doc-1',
          documentTitle: 'Quarterly Report',
          documentVersionId: 'ver-2',
          excerpt: 'Revenue grew 20%.',
          score: 0.9,
          sourceChunkId: 'chunk-1',
          title: 'Quarterly Report',
        },
        {
          accessLevel: 'internal',
          categorySlug: 'finance',
          chunkText: 'Margins improved.',
          citationLocator: 'lines 5-6',
          documentId: 'doc-1',
          documentTitle: 'Quarterly Report',
          documentVersionId: 'ver-2',
          excerpt: 'Margins improved.',
          score: 0.8,
          sourceChunkId: 'chunk-2',
          title: 'Quarterly Report',
        },
      ],
      normalizedQuery: 'revenue growth',
    })
    const judge = vi.fn()
    const answer = vi.fn().mockResolvedValue('Revenue grew 20% and margins improved.')
    const persistCitations = vi.fn().mockResolvedValue([
      { citationId: 'cit-1', sourceChunkId: 'chunk-1' },
      { citationId: 'cit-2', sourceChunkId: 'chunk-2' },
    ])

    const result = await answerKnowledgeQuery(
      {
        allowedAccessLevels: ['internal'],
        query: 'What changed in revenue growth?',
      },
      {
        answer,
        governance,
        judge,
        persistCitations,
        retrieve,
      }
    )

    expect(judge).not.toHaveBeenCalled()
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRole: 'defaultAnswer',
        retrievalScore: 0.85,
      })
    )
    expect(persistCitations).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          citationLocator: 'lines 1-3',
          documentVersionId: 'ver-2',
          sourceChunkId: 'chunk-1',
        }),
      ])
    )
    expect(result).toEqual({
      answer: 'Revenue grew 20% and margins improved.',
      citations: [
        { citationId: 'cit-1', sourceChunkId: 'chunk-1' },
        { citationId: 'cit-2', sourceChunkId: 'chunk-2' },
      ],
      refused: false,
      retrievalScore: 0.85,
    })
  })

  it('judges mid-confidence evidence, retries once, and refuses if confidence stays weak', async () => {
    const governance = createKnowledgeRuntimeConfig({
      environment: 'local',
    }).governance
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({
        evidence: [
          {
            accessLevel: 'internal',
            categorySlug: 'finance',
            chunkText: 'Revenue guidance was updated.',
            citationLocator: 'lines 2-4',
            documentId: 'doc-1',
            documentTitle: 'Quarterly Report',
            documentVersionId: 'ver-2',
            excerpt: 'Revenue guidance was updated.',
            score: 0.5,
            sourceChunkId: 'chunk-1',
            title: 'Quarterly Report',
          },
        ],
        normalizedQuery: 'revenue guidance',
      })
      .mockResolvedValueOnce({
        evidence: [
          {
            accessLevel: 'internal',
            categorySlug: 'finance',
            chunkText: 'Revenue guidance was updated.',
            citationLocator: 'lines 2-4',
            documentId: 'doc-1',
            documentTitle: 'Quarterly Report',
            documentVersionId: 'ver-2',
            excerpt: 'Revenue guidance was updated.',
            score: 0.4,
            sourceChunkId: 'chunk-1',
            title: 'Quarterly Report',
          },
        ],
        normalizedQuery: 'quarterly revenue guidance',
      })
    const judge = vi.fn().mockResolvedValue({
      reformulatedQuery: 'quarterly revenue guidance',
      shouldAnswer: false,
    })
    const answer = vi.fn()
    const persistCitations = vi.fn()

    const result = await answerKnowledgeQuery(
      {
        allowedAccessLevels: ['internal'],
        query: 'What did the report say about guidance?',
      },
      {
        answer,
        governance,
        judge,
        persistCitations,
        retrieve,
      }
    )

    expect(judge).toHaveBeenCalledTimes(1)
    expect(retrieve).toHaveBeenNthCalledWith(1, {
      allowedAccessLevels: ['internal'],
      query: 'What did the report say about guidance?',
    })
    expect(retrieve).toHaveBeenNthCalledWith(2, {
      allowedAccessLevels: ['internal'],
      query: 'quarterly revenue guidance',
    })
    expect(answer).not.toHaveBeenCalled()
    expect(persistCitations).not.toHaveBeenCalled()
    expect(result).toEqual({
      answer: null,
      citations: [],
      refused: true,
      retrievalScore: 0.4,
    })
  })
})
