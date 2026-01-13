export interface KnowledgeSearchCandidate {
  accessLevel: string
  citationLocator: string
  documentVersionId: string
  excerpt: string
  score: number
  title: string
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
      categoryHints: normalized.categoryHints,
    }),
    max_num_results: input.maxResults ?? 8,
    query: normalized.normalizedQuery,
    ranking_options: {
      score_threshold: 0.2,
    },
    rewrite_query: false,
  })
  const evidence: VerifiedKnowledgeEvidence[] = []

  for (const candidate of candidates) {
    const verified = await options.store.resolveCurrentEvidence({
      allowedAccessLevels: input.allowedAccessLevels,
      citationLocator: candidate.citationLocator,
      documentVersionId: candidate.documentVersionId,
    })

    if (!verified) {
      continue
    }

    evidence.push({
      ...verified,
      excerpt: candidate.excerpt,
      score: candidate.score,
      title: candidate.title,
    })
  }

  return {
    evidence,
    normalizedQuery: normalized.normalizedQuery,
  }
}

function buildKnowledgeSearchFilters(input: {
  allowedAccessLevels: string[]
  categoryHints: string[]
}): Record<string, unknown> {
  return {
    access_level: { $in: input.allowedAccessLevels },
    ...(input.categoryHints.length > 0 ? { category_slug: { $in: input.categoryHints } } : {}),
    status: 'active',
    version_state: 'current',
  }
}
