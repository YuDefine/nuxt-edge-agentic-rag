import type { KnowledgeGovernanceConfig } from '#shared/schemas/knowledge-runtime'
import { auditKnowledgeText } from '#server/utils/knowledge-audit'
import type { RewriteForRetrieval, RewriterStatus } from '#server/utils/knowledge-query-rewriter'

export interface KnowledgeSearchCandidate {
  accessLevel: string
  citationLocator: string
  documentVersionId: string
  excerpt: string
  score: number
}

export interface VerifiedKnowledgeEvidence {
  accessLevel: string
  categorySlug: string
  chunkText: string
  citationLocator: string
  documentId: string
  documentTitle: string
  documentVersionId: string
  excerpt: string
  score: number
  sourceChunkId: string
  title: string
}

interface ResolveCurrentEvidenceStore {
  resolveCurrentEvidence(input: {
    allowedAccessLevels: string[]
    citationLocator: string
    documentVersionId: string
  }): Promise<{
    accessLevel: string
    categorySlug: string
    chunkText: string
    citationLocator: string
    documentId: string
    documentTitle: string
    documentVersionId: string
    sourceChunkId: string
  } | null>
}

interface SearchKnowledgeClient {
  search(input: {
    filters: Record<string, unknown>
    max_num_results: number
    query: string
    ranking_options: {
      score_threshold: number
    }
    rewrite_query: false
  }): Promise<KnowledgeSearchCandidate[]>
}

const QUERY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bfaq\b/gi, 'frequently asked questions'],
  [/\bq&a\b/gi, 'questions and answers'],
  [/\bdept\b/gi, 'department'],
]

export function normalizeKnowledgeQuery(query: string): {
  categoryHints: string[]
  normalizedQuery: string
} {
  const categoryHints = [...query.matchAll(/\bcategory:([a-z0-9_-]+)/gi)].flatMap((match) => {
    const categoryHint = match[1]

    return categoryHint ? [categoryHint.toLowerCase()] : []
  })
  let normalizedQuery = query.replace(/\bcategory:[a-z0-9_-]+/gi, ' ')

  for (const [pattern, replacement] of QUERY_REPLACEMENTS) {
    normalizedQuery = normalizedQuery.replace(pattern, replacement)
  }

  normalizedQuery = normalizedQuery
    .replace(/\b(\d{4})\/(\d{2})\/(\d{2})\b/g, '$1-$2-$3')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    categoryHints: [...new Set(categoryHints)],
    normalizedQuery,
  }
}

export async function retrieveVerifiedEvidence(
  input: {
    allowedAccessLevels: string[]
    maxResults?: number
    query: string
  },
  options: {
    governance: Pick<KnowledgeGovernanceConfig, 'retrieval'>
    /**
     * workers-ai-grounded-answering §S-RW (change rag-query-rewriting):
     * Optional LLM-based query rewriter applied AFTER `normalizeKnowledgeQuery`
     * and BEFORE the AI Search call. Caller is responsible for the
     * `isQueryRewritingEnabled` gate — pass `undefined` to keep the
     * pre-change behaviour 100% intact.
     */
    rewriter?: RewriteForRetrieval
    search: SearchKnowledgeClient['search']
    store: ResolveCurrentEvidenceStore
  },
): Promise<{
  evidence: VerifiedKnowledgeEvidence[]
  normalizedQuery: string
  /**
   * §S-OB — original normalized query before the rewriter step. Always
   * the same string the pre-change pipeline would have used. Callers MAY
   * persist this alongside `rewrittenQuery` for retrieval audit.
   */
  originalQuery: string
  /**
   * §S-OB — rewriter outcome enum to be persisted in
   * `query_logs.rewriter_status`. Defaults to `'disabled'` when no
   * rewriter is supplied (the disabled-path scenario).
   */
  rewriterStatus: RewriterStatus | 'disabled'
  /**
   * §S-OB — the rewritten query string when `rewriterStatus === 'success'`,
   * NULL otherwise (matching the column nullability).
   */
  rewrittenQuery: string | null
}> {
  const normalized = normalizeKnowledgeQuery(input.query)

  let queryForSearch = normalized.normalizedQuery
  let rewriterStatus: RewriterStatus | 'disabled' = 'disabled'
  let rewrittenQueryForAudit: string | null = null

  if (options.rewriter) {
    const rewriteResult = await options.rewriter(normalized.normalizedQuery)
    queryForSearch = rewriteResult.rewrittenQuery
    rewriterStatus = rewriteResult.status
    // §S-OB (change rag-query-rewriting): the rewriter LLM sees the
    // normalized (NOT redacted) query — same trust boundary as AI Search.
    // For the persisted audit value we redact through `auditKnowledgeText`
    // so the admin debug surface keeps the same PII guarantee as
    // `query_redacted_text`. `queryForSearch` (sent to AI Search) keeps
    // the un-redacted form to preserve retrieval quality.
    rewrittenQueryForAudit =
      rewriteResult.status === 'success'
        ? auditKnowledgeText(rewriteResult.rewrittenQuery).redactedText
        : null
  }

  const candidates = await options.search({
    filters: buildKnowledgeSearchFilters({
      allowedAccessLevels: input.allowedAccessLevels,
    }),
    max_num_results: input.maxResults ?? options.governance.retrieval.maxResults,
    query: queryForSearch,
    ranking_options: {
      score_threshold: options.governance.retrieval.minScore,
    },
    rewrite_query: false,
  })
  const evidence: VerifiedKnowledgeEvidence[] = []
  const categoryFilter = normalized.categoryHints[0] ?? null

  for (const candidate of candidates) {
    const verified = await options.store.resolveCurrentEvidence({
      allowedAccessLevels: input.allowedAccessLevels,
      citationLocator: candidate.citationLocator,
      documentVersionId: candidate.documentVersionId,
    })

    if (!verified) {
      continue
    }

    if (categoryFilter && verified.categorySlug !== categoryFilter) {
      continue
    }

    evidence.push({
      ...verified,
      excerpt: candidate.excerpt,
      score: candidate.score,
      title: verified.documentTitle,
    })
  }

  return {
    evidence,
    normalizedQuery: normalized.normalizedQuery,
    originalQuery: normalized.normalizedQuery,
    rewriterStatus,
    rewrittenQuery: rewrittenQueryForAudit,
  }
}

// Cloudflare AutoRAG (legacy `env.AI.autorag()`) filter schema:
//   { type: 'eq'|'ne'|'gt'|'gte'|'lt'|'lte', key, value }
//   { type: 'and', filters: [...] }
// No 'or' / 'in' operators — multi-value filters are deferred to the
// post-search verification step in `resolveCurrentEvidence`.
type AutoRagFilter =
  | { key: string; type: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; value: unknown }
  | { filters: AutoRagFilter[]; type: 'and' }

function buildKnowledgeSearchFilters(input: {
  allowedAccessLevels: string[]
}): AutoRagFilter | Record<string, never> {
  const filters: AutoRagFilter[] = [
    { key: 'status', type: 'eq', value: 'active' },
    { key: 'version_state', type: 'eq', value: 'current' },
  ]

  if (input.allowedAccessLevels.length === 1) {
    filters.push({ key: 'access_level', type: 'eq', value: input.allowedAccessLevels[0] })
  }

  return filters.length === 1 ? filters[0]! : { filters, type: 'and' }
}
