import { Buffer } from 'node:buffer'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { getD1Database } from '#server/utils/database'
import { publishDocumentVersion } from '#server/utils/document-publish'
import { rewriteVersionMetadata } from '#server/utils/document-publish-r2'
import { createDocumentSyncStore } from '#server/utils/document-store'
import { syncDocumentVersionSnapshot } from '#server/utils/document-sync'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { createR2ObjectAccess } from '#server/utils/r2-object-access'

const bodySchema = z.object({
  accessLevel: z.enum(['internal', 'restricted']).default('internal'),
  categorySlug: z.string().trim().max(255).default(''),
  directory: z.string().trim().min(1).default('local/mock-documents'),
})

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9一-鿿-]+/g, '')
    .slice(0, 200)
}

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const runtimeConfig = getKnowledgeRuntimeConfig()

  if (runtimeConfig.environment !== 'local') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Mock document seeding is only available in local environment',
    })
  }

  const session = await requireRuntimeAdminSession(event)
  const adminUserId = (session.user as { id: string }).id

  const body = await readValidatedBody(event, bodySchema.parse)

  const repoRoot = process.cwd()
  const dirAbsolute = path.resolve(repoRoot, body.directory)

  if (dirAbsolute !== repoRoot && !dirAbsolute.startsWith(repoRoot + path.sep)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `directory must resolve inside repo root: ${dirAbsolute}`,
    })
  }

  let entries: string[]
  try {
    entries = await readdir(dirAbsolute)
  } catch {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `Directory not found: ${dirAbsolute}`,
    })
  }

  const mdFiles = entries.filter((name) => name.endsWith('.md'))

  const bucket = createR2ObjectAccess(event)
  const database = await getD1Database()
  const store = createDocumentSyncStore(database)

  const results: Array<{
    chunks?: number
    documentId?: string
    error?: string
    filename: string
    status: 'ok' | 'failed'
    versionId?: string
  }> = []

  for (const filename of mdFiles) {
    const filePath = path.join(dirAbsolute, filename)
    const buffer = await readFile(filePath)
    const bytes = new Uint8Array(buffer)
    const checksumSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString(
      'base64',
    )

    const baseName = filename.replace(/\.md$/, '')
    const objectKey = `staged/local/${adminUserId}/${crypto.randomUUID()}-${filename}`
    const uploadId = crypto.randomUUID()

    let documentId: string | undefined
    let versionId: string | undefined

    try {
      await bucket.put(objectKey, bytes, 'text/markdown', {
        upload_checksum_sha256: checksumSha256,
      })

      const result = await syncDocumentVersionSnapshot(
        {
          accessLevel: body.accessLevel,
          adminUserId,
          categorySlug: body.categorySlug,
          checksumSha256,
          environment: runtimeConfig.environment,
          mimeType: 'text/markdown',
          objectKey,
          size: bytes.byteLength,
          slug: slugify(baseName) || crypto.randomUUID(),
          title: baseName,
          uploadId,
        },
        {
          loadSourceBytes: async (key) => {
            const data = await bucket.getBytes(key)
            if (data === null) {
              throw createError({
                statusCode: 404,
                statusMessage: 'Not Found',
                message: `Source bytes not found for ${key}`,
              })
            }
            return data
          },
          loadSourceText: async (key) => {
            const text = await bucket.getText(key)
            if (text === null) {
              throw createError({
                statusCode: 404,
                statusMessage: 'Not Found',
                message: `Source text not found for ${key}`,
              })
            }
            return text
          },
          store,
          writeChunkObjects: async (objects) => {
            await Promise.all(
              objects.map((object) =>
                bucket.put(
                  object.key,
                  object.text,
                  'text/plain; charset=utf-8',
                  object.customMetadata,
                ),
              ),
            )
          },
        },
      )

      documentId = result.document.id
      versionId = result.version.id

      await store.setVersionIndexingStatus(versionId, {
        indexStatus: 'indexed',
        syncStatus: 'completed',
      })

      const publishResult = await publishDocumentVersion({ documentId, versionId }, { store })

      if (!publishResult.alreadyCurrent) {
        await rewriteVersionMetadata(event, versionId, 'current')
      }

      results.push({
        chunks: result.sourceChunkCount,
        documentId,
        filename,
        status: 'ok',
        versionId,
      })
    } catch (error) {
      log.error(error as Error, { documentId, filename, step: 'seed-mock-document', versionId })
      results.push({
        documentId,
        error: (error as Error).message,
        filename,
        status: 'failed',
        versionId,
      })
    }
  }

  return {
    adminUserId,
    directory: dirAbsolute,
    results,
    total: mdFiles.length,
  }
})
