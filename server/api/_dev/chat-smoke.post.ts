import { createClient } from '@libsql/client'
import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { createWorkersAiAnswerAdapter, type WorkersAiBindingLike } from '#server/utils/workers-ai'

const bodySchema = z.object({
  modelRole: z.string().trim().min(1).default('defaultAnswer'),
  persist: z.boolean().default(false),
  query: z.string().trim().min(1),
  topK: z.number().int().positive().max(20).default(5),
  userEmail: z.string().email().default('charles.yudefine@gmail.com'),
})

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const runtimeConfig = getKnowledgeRuntimeConfig()

  if (runtimeConfig.environment !== 'local') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'chat-smoke is only available in local environment',
    })
  }

  await requireRuntimeAdminSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const libsqlUrl = process.env.NUXT_HUB_LIBSQL_URL || 'file:.data/db/sqlite.db'
  const client = createClient({ url: libsqlUrl })

  const baseSelect = `
    SELECT
      sc.id AS source_chunk_id,
      sc.chunk_text AS chunk_text,
      sc.citation_locator AS citation_locator,
      sc.document_version_id AS document_version_id,
      d.id AS document_id,
      d.title AS title,
      d.category_slug AS category_slug
    FROM source_chunks sc
    JOIN document_versions dv ON dv.id = sc.document_version_id
    JOIN documents d ON d.id = dv.document_id
  `

  const likePattern = `%${body.query.replace(/[%_]/g, (ch) => `\\${ch}`)}%`

  const candidate = await client.execute({
    sql: `${baseSelect} WHERE d.status = 'active' AND sc.chunk_text LIKE ? ESCAPE '\\' LIMIT ?`,
    args: [likePattern, body.topK],
  })

  let rows = candidate.rows

  if (rows.length === 0) {
    const fallback = await client.execute({
      sql: `${baseSelect} WHERE d.status = 'active' ORDER BY sc.created_at DESC LIMIT ?`,
      args: [body.topK],
    })
    rows = fallback.rows
  }

  await client.close()

  if (rows.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'No source chunks available — run /api/_dev/seed-mock-documents first',
    })
  }

  const evidence = rows.map((row) => ({
    accessLevel: 'internal',
    categorySlug: String(row.category_slug ?? ''),
    chunkText: String(row.chunk_text ?? ''),
    citationLocator: String(row.citation_locator ?? ''),
    documentId: String(row.document_id ?? ''),
    documentTitle: String(row.title ?? ''),
    documentVersionId: String(row.document_version_id ?? ''),
    excerpt: String(row.chunk_text ?? '').slice(0, 200),
    score: 0.9,
    sourceChunkId: String(row.source_chunk_id ?? ''),
    title: String(row.title ?? ''),
  }))

  const aiBinding = (event.context as { cloudflare?: { env?: Record<string, unknown> } }).cloudflare
    ?.env?.AI as WorkersAiBindingLike | undefined

  if (!aiBinding || typeof aiBinding.run !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Workers AI binding not available',
    })
  }

  const workersAiAnswer = createWorkersAiAnswerAdapter({
    binding: aiBinding,
  })

  let answer: string
  try {
    answer = await workersAiAnswer({
      evidence,
      modelRole: body.modelRole,
      query: body.query,
      retrievalScore: 0.9,
    })
  } catch (error) {
    log.error(error as Error, { step: 'chat-smoke-answer' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: `Workers AI answer failed: ${(error as Error).message}`,
    })
  }

  const baseResult = {
    answer,
    evidenceCount: evidence.length,
    evidencePreview: evidence.map((item) => ({
      excerpt: item.excerpt,
      locator: item.citationLocator,
      title: item.title,
    })),
    query: body.query,
  }

  if (!body.persist) {
    return baseResult
  }

  const writeClient = createClient({ url: libsqlUrl })
  try {
    const profile = await writeClient.execute({
      sql: 'SELECT id FROM user_profiles WHERE email_normalized = ? LIMIT 1',
      args: [body.userEmail.toLowerCase()],
    })
    const profileRow = profile.rows[0]
    if (!profileRow) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `user_profile not found for ${body.userEmail}`,
      })
    }
    const userProfileId = String(profileRow.id)

    const conversationId = crypto.randomUUID()
    const userMessageId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    const conversationTitle = body.query.slice(0, 40)

    await writeClient.batch([
      {
        sql: `INSERT INTO conversations (id, user_profile_id, access_level, title)
              VALUES (?, ?, 'internal', ?)`,
        args: [conversationId, userProfileId, conversationTitle],
      },
      {
        sql: `INSERT INTO messages
              (id, user_profile_id, channel, role, content_redacted, content_text,
               conversation_id, citations_json, refused)
              VALUES (?, ?, 'web', 'user', ?, ?, ?, '[]', 0)`,
        args: [userMessageId, userProfileId, body.query, body.query, conversationId],
      },
      {
        sql: `INSERT INTO messages
              (id, user_profile_id, channel, role, content_redacted, content_text,
               conversation_id, citations_json, refused)
              VALUES (?, ?, 'web', 'assistant', ?, ?, ?, '[]', 0)`,
        args: [assistantMessageId, userProfileId, answer, answer, conversationId],
      },
    ])

    return {
      ...baseResult,
      conversationId,
      persistedTo: body.userEmail,
      url: `http://localhost:3010/chat?conversationId=${conversationId}`,
    }
  } finally {
    await writeClient.close()
  }
})
