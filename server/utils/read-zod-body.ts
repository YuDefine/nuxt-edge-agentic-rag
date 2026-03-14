import type { ZodType } from 'zod'

export async function readZodBody<TSchema extends ZodType>(
  event: Parameters<typeof readBody>[0],
  schema: TSchema,
) {
  const result = schema.safeParse(await readBody(event))

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: result.error.issues[0]?.message ?? 'Invalid request body',
    })
  }

  return result.data
}
