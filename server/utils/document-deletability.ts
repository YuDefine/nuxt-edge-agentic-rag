import type { DocumentDeletabilityReason } from '#shared/schemas/admin-documents'
import { assertNever } from '#shared/utils/assert-never'

export interface DocumentDeletabilityInput {
  documentStatus: 'draft' | 'active' | 'archived'
  versions: Array<{ id: string; publishedAt: string | null }>
}

export interface DocumentDeletabilityResult {
  deletable: boolean
  reason: DocumentDeletabilityReason
}

export function evaluateDocumentDeletability(
  input: DocumentDeletabilityInput
): DocumentDeletabilityResult {
  switch (input.documentStatus) {
    case 'active':
      return { deletable: false, reason: 'status-active' }
    case 'archived':
      return { deletable: false, reason: 'status-archived' }
    case 'draft': {
      const hasPublishedHistory = input.versions.some((version) => version.publishedAt !== null)

      if (hasPublishedHistory) {
        return { deletable: false, reason: 'has-published-history' }
      }

      return { deletable: true, reason: 'draft-never-published' }
    }
    default:
      return assertNever(input.documentStatus, 'evaluateDocumentDeletability')
  }
}
