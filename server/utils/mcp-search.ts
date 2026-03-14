import type { VerifiedKnowledgeEvidence } from './knowledge-retrieval'

export interface McpSearchResult {
  accessLevel: string
  categorySlug: string
  citationLocator: string
  excerpt: string
  title: string
}

export async function searchKnowledge(
  input: {
    allowedAccessLevels: string[]
    query: string
  },
  options: {
    retrieve: (input: { allowedAccessLevels: string[]; query: string }) => Promise<{
      evidence: VerifiedKnowledgeEvidence[]
      normalizedQuery: string
    }>
  },
): Promise<{ results: McpSearchResult[] }> {
  if (input.allowedAccessLevels.length === 0) {
    return { results: [] }
  }

  const { evidence } = await options.retrieve({
    allowedAccessLevels: input.allowedAccessLevels,
    query: input.query,
  })

  return {
    results: evidence.map((item) => ({
      accessLevel: item.accessLevel,
      categorySlug: item.categorySlug,
      citationLocator: item.citationLocator,
      excerpt: item.excerpt,
      title: item.title,
    })),
  }
}
