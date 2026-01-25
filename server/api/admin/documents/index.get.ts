import { createDocumentListStore } from '../../../utils/document-list-store'

export default defineEventHandler(async function listAdminDocumentsHandler(event) {
  await requireRuntimeAdminSession(event)

  const store = createDocumentListStore()
  const documents = await store.listDocumentsWithCurrentVersion()

  return {
    data: documents,
  }
})
