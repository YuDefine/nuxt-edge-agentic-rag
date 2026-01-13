import type { KnowledgeSearchCandidate } from './knowledge-retrieval'

export interface CloudflareAiBindingLike {
  autorag(indexName: string): {
    search(input: {
      filters: Record<string, unknown>
      max_num_results: number
      query: string
      ranking_options: {
        score_threshold: number
      }
      rewrite_query: boolean
    }): Promise<{
      data?: Array<{
        attributes?: {
          file?: Record<string, unknown>
        }
        content?: Array<{
          text?: string
          type?: string
        }>
        filename?: string
        score?: number
      }>
    }>
  }
}

export function createCloudflareAiSearchClient(input: {
  aiBinding: CloudflareAiBindingLike
  indexName: string
}) {
  return {
    async search(request: {
      filters: Record<string, unknown>
      max_num_results: number
      query: string
      ranking_options: {
        score_threshold: number
      }
      rewrite_query: false
    }): Promise<KnowledgeSearchCandidate[]> {
      const response = await input.aiBinding.autorag(input.indexName).search(request)

      return (response.data ?? [])
        .map((entry) => {
          const fileAttributes = entry.attributes?.file ?? {}
          const contentText = entry.content?.find((item) => item.type === 'text')?.text
          const citationLocator = readString(fileAttributes.citation_locator)
          const documentVersionId = readString(fileAttributes.document_version_id)
          const accessLevel = readString(fileAttributes.access_level)

          if (!contentText || !citationLocator || !documentVersionId || !accessLevel) {
            return null
          }

          return {
            accessLevel,
            citationLocator,
            documentVersionId,
            excerpt: contentText,
            score: typeof entry.score === 'number' ? entry.score : 0,
            title: readString(fileAttributes.title) ?? entry.filename ?? 'Untitled document',
          } satisfies KnowledgeSearchCandidate
        })
        .filter((candidate): candidate is KnowledgeSearchCandidate => candidate !== null)
    },
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
