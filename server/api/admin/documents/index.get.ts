import { createDocumentListStore } from '../../../utils/document-list-store'

export default defineEventHandler(async function listAdminDocumentsHandler(event) {
  await requireRuntimeAdminSession(event)

  const runtimeConfig = getKnowledgeRuntimeConfig()
  const database = getRequiredD1Binding(event, runtimeConfig.bindings.d1Database)
  const store = createDocumentListStore(database)

  const documents = await store.listDocumentsWithCurrentVersion()

  return {
    data: documents,
  }
})
