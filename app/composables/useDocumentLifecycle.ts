import type {
  ArchiveDocumentResponse,
  DeleteDocumentResponse,
  RetryDocumentSyncResponse,
  UnarchiveDocumentResponse,
} from '~~/shared/schemas/admin-documents'

interface RejectPayload {
  statusCode?: number
  data?: { reason?: string }
  statusMessage?: string
  message?: string
}

interface LifecycleResult<T> {
  ok: boolean
  data: T | null
  error: string | null
}

function extractErrorMessage(error: unknown, fallback: string): string {
  const err = error as RejectPayload
  const reason = err?.data?.reason

  if (reason) {
    switch (reason) {
      case 'has-published-history':
        return '此文件曾發布過版本，請改用封存操作'
      case 'status-active':
        return '已發布的文件無法刪除，請改用封存操作'
      case 'status-archived':
        return '封存的文件由保留期限管理，無法手動刪除'
      default:
        break
    }
  }

  if (err?.statusCode === 404) return '找不到資源'
  if (err?.statusCode === 403) return '權限不足'
  if (err?.statusCode === 409) return err?.statusMessage || err?.message || '操作被拒絕'

  return fallback
}

export function useDocumentLifecycle() {
  const toast = useToast()
  const isPending = ref(false)

  async function retrySync(
    documentId: string,
    versionId: string
  ): Promise<LifecycleResult<RetryDocumentSyncResponse['data']>> {
    isPending.value = true
    try {
      const response = await $fetch<RetryDocumentSyncResponse>(
        `/api/admin/documents/${documentId}/versions/${versionId}/retry-sync`,
        { method: 'POST' }
      )
      toast.add({
        title: '已觸發重新同步',
        description: '狀態將於同步流程完成後更新',
        color: 'success',
      })
      return { ok: true, data: response.data, error: null }
    } catch (error) {
      const message = extractErrorMessage(error, '重新同步失敗，請稍後再試')
      toast.add({ title: '重新同步失敗', description: message, color: 'error' })
      return { ok: false, data: null, error: message }
    } finally {
      isPending.value = false
    }
  }

  async function deleteDocument(
    documentId: string
  ): Promise<LifecycleResult<DeleteDocumentResponse['data']>> {
    isPending.value = true
    try {
      const response = await $fetch<DeleteDocumentResponse>(`/api/admin/documents/${documentId}`, {
        method: 'DELETE',
      })
      toast.add({
        title: '文件已刪除',
        description: `已移除 ${response.data.removedVersionCount} 個版本與 ${response.data.removedSourceChunkCount} 個原文片段`,
        color: 'success',
      })
      return { ok: true, data: response.data, error: null }
    } catch (error) {
      const message = extractErrorMessage(error, '刪除失敗，請稍後再試')
      toast.add({ title: '刪除失敗', description: message, color: 'error' })
      return { ok: false, data: null, error: message }
    } finally {
      isPending.value = false
    }
  }

  async function archive(
    documentId: string
  ): Promise<LifecycleResult<ArchiveDocumentResponse['data']>> {
    isPending.value = true
    try {
      const response = await $fetch<ArchiveDocumentResponse>(
        `/api/admin/documents/${documentId}/archive`,
        { method: 'POST' }
      )
      toast.add({
        title: response.data.noOp ? '文件已是封存狀態' : '文件已封存',
        description: response.data.noOp ? '不需再次操作' : '此文件將不再出現於對外檢索',
        color: 'success',
      })
      return { ok: true, data: response.data, error: null }
    } catch (error) {
      const message = extractErrorMessage(error, '封存失敗，請稍後再試')
      toast.add({ title: '封存失敗', description: message, color: 'error' })
      return { ok: false, data: null, error: message }
    } finally {
      isPending.value = false
    }
  }

  async function unarchive(
    documentId: string
  ): Promise<LifecycleResult<UnarchiveDocumentResponse['data']>> {
    isPending.value = true
    try {
      const response = await $fetch<UnarchiveDocumentResponse>(
        `/api/admin/documents/${documentId}/unarchive`,
        { method: 'POST' }
      )
      toast.add({
        title: response.data.noOp ? '文件已是啟用狀態' : '文件已解除封存',
        description: response.data.noOp ? '不需再次操作' : '此文件已回到檢索流程',
        color: 'success',
      })
      return { ok: true, data: response.data, error: null }
    } catch (error) {
      const message = extractErrorMessage(error, '解除封存失敗，請稍後再試')
      toast.add({ title: '解除封存失敗', description: message, color: 'error' })
      return { ok: false, data: null, error: message }
    } finally {
      isPending.value = false
    }
  }

  return {
    isPending: readonly(isPending),
    retrySync,
    deleteDocument,
    archive,
    unarchive,
  }
}
