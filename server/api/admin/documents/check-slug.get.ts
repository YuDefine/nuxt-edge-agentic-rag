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
  await requireRuntimeAdminSession(event)

  const { slug } = await getValidatedQuery(event, querySchema.parse)
  const { db, schema } = await import('hub:db')

  const [existing] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.slug, slug))
    .limit(1)

  return {
    data: { available: !existing },
  }
})
