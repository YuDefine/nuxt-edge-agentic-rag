import { useLogger } from 'evlog'
import { z } from 'zod'
import { eq } from 'drizzle-orm'

const querySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/),
})

export default defineEventHandler(async function checkDocumentSlugHandler(event) {
  const log = useLogger(event)
  await requireRuntimeAdminSession(event)

  const { slug } = await getValidatedQuery(event, querySchema.parse)
  const { db, schema } = await import('hub:db')

  try {
    const [existing] = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.slug, slug))
      .limit(1)

    return {
      data: { available: !existing },
    }
  } catch (error) {
    log.error(error as Error, { step: 'check-document-slug' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法檢查 slug，請稍後再試',
    })
  }
})
