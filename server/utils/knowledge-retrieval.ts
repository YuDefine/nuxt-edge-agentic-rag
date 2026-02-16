import type { KnowledgeGovernanceConfig } from '#shared/schemas/knowledge-runtime'

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
    search: SearchKnowledgeClient['search']
    store: ResolveCurrentEvidenceStore
  }
): Promise<{
  evidence: VerifiedKnowledgeEvidence[]
  normalizedQuery: string
}> {
  const normalized = normalizeKnowledgeQuery(input.query)
  const candidates = await options.search({
    filters: buildKnowledgeSearchFilters({
      allowedAccessLevels: input.allowedAccessLevels,
    }),
    max_num_results: input.maxResults ?? options.governance.retrieval.maxResults,
    query: normalized.normalizedQuery,
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
