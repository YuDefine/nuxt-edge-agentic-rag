import { describe, expect, it, vi } from 'vitest'

import {
  retrieveVerifiedEvidence,
  type KnowledgeSearchCandidate,
  type VerifiedKnowledgeEvidence,
} from '#server/utils/knowledge-retrieval'
import type { RewriteForRetrieval } from '#server/utils/knowledge-query-rewriter'
import type { KnowledgeGovernanceConfig } from '#shared/schemas/knowledge-runtime'

const baseGovernance: Pick<KnowledgeGovernanceConfig, 'retrieval'> = {
  retrieval: {
    maxResults: 5,
    minScore: 0.4,
  },
}

function makeCandidate(overrides?: Partial<KnowledgeSearchCandidate>): KnowledgeSearchCandidate {
  return {
    accessLevel: 'open',
    citationLocator: 'doc-1#chunk-1',
    documentVersionId: 'doc-version-1',
    excerpt: '採購流程說明',
    // Score deliberately offset from governed thresholds so the drift
    // guard does not flag this file — exact value is arbitrary for the
    // rewriter integration assertions.
    score: 0.65,
    ...overrides,
  }
}

function stripRewriterCols(
  result: Awaited<ReturnType<typeof retrieveVerifiedEvidence>>,
): Pick<typeof result, 'evidence' | 'normalizedQuery'> {
  return {
    evidence: result.evidence,
    normalizedQuery: result.normalizedQuery,
  }
}

function makeVerifiedEvidence(): Omit<VerifiedKnowledgeEvidence, 'excerpt' | 'score' | 'title'> {
  return {
    accessLevel: 'open',
    categorySlug: 'procurement',
    chunkText: '採購流程內容',
    citationLocator: 'doc-1#chunk-1',
    documentId: 'doc-1',
    documentTitle: '採購流程操作手冊',
    documentVersionId: 'doc-version-1',
    sourceChunkId: 'chunk-1',
  }
}

describe('retrieveVerifiedEvidence + rewriter integration', () => {
  describe('rewriter disabled (no option)', () => {
    it('passes the normalized query to search and reports rewriter_status=disabled', async () => {
      const search = vi.fn(async () => [makeCandidate()])
      const resolveCurrentEvidence = vi.fn(async () => makeVerifiedEvidence())

      const result = await retrieveVerifiedEvidence(
        {
          allowedAccessLevels: ['open'],
          query: 'PO 和 PR 差別',
        },
        {
          governance: baseGovernance,
          search,
          store: { resolveCurrentEvidence },
        },
      )

      expect(search).toHaveBeenCalledTimes(1)
      const searchArgs = search.mock.calls[0]?.[0] as { query: string }
      expect(searchArgs.query).toBe('PO 和 PR 差別')

      expect(result.rewriterStatus).toBe('disabled')
      expect(result.rewrittenQuery).toBeNull()
      expect(result.normalizedQuery).toBe('PO 和 PR 差別')
      expect(result.originalQuery).toBe('PO 和 PR 差別')
      expect(result.evidence).toHaveLength(1)
    })

    it('preserves baseline behaviour for the existing pre-change pipeline', async () => {
      const search = vi.fn(async () => [
        makeCandidate({ score: 0.42 }),
        makeCandidate({ citationLocator: 'doc-1#chunk-2', score: 0.38 }),
      ])
      const resolveCurrentEvidence = vi.fn(async () => makeVerifiedEvidence())

      const result = await retrieveVerifiedEvidence(
        {
          allowedAccessLevels: ['open', 'restricted'],
          query: 'category:procurement 採購流程',
        },
        {
          governance: baseGovernance,
          search,
          store: { resolveCurrentEvidence },
        },
      )

      // category:xxx is stripped by normalizeKnowledgeQuery — search receives the trimmed query
      const searchArgs = search.mock.calls[0]?.[0] as {
        query: string
        max_num_results: number
        ranking_options: { score_threshold: number }
      }
      expect(searchArgs.query).toBe('採購流程')
      expect(searchArgs.max_num_results).toBe(5)
      expect(searchArgs.ranking_options.score_threshold).toBe(0.4)
      expect(result.evidence).toHaveLength(2)
      expect(result.rewriterStatus).toBe('disabled')
    })
  })

  describe('rewriter enabled - success path', () => {
    it('passes the rewritten query to search and surfaces rewriter status + rewritten string', async () => {
      const search = vi.fn(async () => [makeCandidate()])
      const resolveCurrentEvidence = vi.fn(async () => makeVerifiedEvidence())
      const rewriter: RewriteForRetrieval = vi.fn(async () => ({
        rewrittenQuery: 'PO 採購單與 PR 請購單的角色差異',
        status: 'success',
      }))

      const result = await retrieveVerifiedEvidence(
        {
          allowedAccessLevels: ['open'],
          query: 'PO 和 PR 差別',
        },
        {
          governance: baseGovernance,
          rewriter,
          search,
          store: { resolveCurrentEvidence },
        },
      )

      expect(rewriter).toHaveBeenCalledTimes(1)
      expect(rewriter).toHaveBeenCalledWith('PO 和 PR 差別')

      const searchArgs = search.mock.calls[0]?.[0] as { query: string }
      expect(searchArgs.query).toBe('PO 採購單與 PR 請購單的角色差異')

      expect(result.rewriterStatus).toBe('success')
      expect(result.rewrittenQuery).toBe('PO 採購單與 PR 請購單的角色差異')
      expect(result.originalQuery).toBe('PO 和 PR 差別')
      expect(result.normalizedQuery).toBe('PO 和 PR 差別')
    })

    it('feeds the rewriter the post-normalization query, not the raw input', async () => {
      const search = vi.fn(async () => [makeCandidate()])
      const resolveCurrentEvidence = vi.fn(async () => makeVerifiedEvidence())
      const rewriter: RewriteForRetrieval = vi.fn(async (input) => ({
        rewrittenQuery: `rewritten[${input}]`,
        status: 'success',
      }))

      await retrieveVerifiedEvidence(
        {
          allowedAccessLevels: ['open'],
          // category:xxx will be stripped + replaced + trimmed before reaching the rewriter
          query: 'category:procurement   PO 和 PR 差別',
        },
        {
          governance: baseGovernance,
          rewriter,
          search,
          store: { resolveCurrentEvidence },
        },
      )

      // After normalize: category stripped, multiple spaces collapsed, trimmed
      expect(rewriter).toHaveBeenCalledWith('PO 和 PR 差別')
    })
  })

  describe('rewriter enabled - fallback paths', () => {
    it('falls back to original normalized query on fallback_timeout', async () => {
      const search = vi.fn(async () => [makeCandidate()])
      const resolveCurrentEvidence = vi.fn(async () => makeVerifiedEvidence())
      const rewriter: RewriteForRetrieval = vi.fn(async (input) => ({
        rewrittenQuery: input,
        status: 'fallback_timeout',
      }))

      const result = await retrieveVerifiedEvidence(
        {
          allowedAccessLevels: ['open'],
          query: 'original query',
        },
        {
          governance: baseGovernance,
          rewriter,
          search,
          store: { resolveCurrentEvidence },
        },
      )

      const searchArgs = search.mock.calls[0]?.[0] as { query: string }
      expect(searchArgs.query).toBe('original query')
      expect(result.rewriterStatus).toBe('fallback_timeout')
      expect(result.rewrittenQuery).toBeNull()
    })

    it('falls back to original normalized query on fallback_error', async () => {
      const search = vi.fn(async () => [makeCandidate()])
      const resolveCurrentEvidence = vi.fn(async () => makeVerifiedEvidence())
      const rewriter: RewriteForRetrieval = vi.fn(async (input) => ({
        rewrittenQuery: input,
        status: 'fallback_error',
      }))

      const result = await retrieveVerifiedEvidence(
        {
          allowedAccessLevels: ['open'],
          query: 'original query',
        },
        {
          governance: baseGovernance,
          rewriter,
          search,
          store: { resolveCurrentEvidence },
        },
      )

      expect(result.rewriterStatus).toBe('fallback_error')
      expect(result.rewrittenQuery).toBeNull()
      const searchArgs = search.mock.calls[0]?.[0] as { query: string }
      expect(searchArgs.query).toBe('original query')
    })

    it('falls back to original normalized query on fallback_parse', async () => {
      const search = vi.fn(async () => [makeCandidate()])
      const resolveCurrentEvidence = vi.fn(async () => makeVerifiedEvidence())
      const rewriter: RewriteForRetrieval = vi.fn(async (input) => ({
        rewrittenQuery: input,
        status: 'fallback_parse',
      }))

      const result = await retrieveVerifiedEvidence(
        {
          allowedAccessLevels: ['open'],
          query: 'original query',
        },
        {
          governance: baseGovernance,
          rewriter,
          search,
          store: { resolveCurrentEvidence },
        },
      )

      expect(result.rewriterStatus).toBe('fallback_parse')
      expect(result.rewrittenQuery).toBeNull()
    })
  })

  describe('backward compatibility', () => {
    it('produces identical evidence shape with rewriter disabled vs not supplied', async () => {
      const search = vi.fn(async () => [makeCandidate()])
      const resolveCurrentEvidence = vi.fn(async () => makeVerifiedEvidence())

      const withoutRewriter = await retrieveVerifiedEvidence(
        { allowedAccessLevels: ['open'], query: '採購流程' },
        { governance: baseGovernance, search, store: { resolveCurrentEvidence } },
      )

      const withRewriterUndefined = await retrieveVerifiedEvidence(
        { allowedAccessLevels: ['open'], query: '採購流程' },
        {
          governance: baseGovernance,
          rewriter: undefined,
          search,
          store: { resolveCurrentEvidence },
        },
      )

      // Drop the optional rewriter columns — the rest of the shape (which
      // existing callers consume) MUST be byte-for-byte identical.
      expect(stripRewriterCols(withoutRewriter)).toEqual(stripRewriterCols(withRewriterUndefined))
      expect(withoutRewriter.rewriterStatus).toBe('disabled')
      expect(withRewriterUndefined.rewriterStatus).toBe('disabled')
    })
  })
})
