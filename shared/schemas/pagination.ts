import { z } from 'zod'

/**
 * Upper bound for page size across all paginated admin/list endpoints.
 * Keep in sync with development rule in `.claude/rules/development.md`:
 *   PAGE_SIZE_MAX from `shared/schemas/pagination` — NEVER hardcode.
 */
export const PAGE_SIZE_MAX = 100

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(PAGE_SIZE_MAX).default(20),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
}

/**
 * Standard pagination envelope used by admin list endpoints.
 *
 * The caller provides `list` (given `{ limit, offset }`) and `count` loaders;
 * this helper runs them in parallel and assembles the `{ data, pagination }`
 * shape every admin list response adheres to.
 */
export async function paginateList<T>(
  input: { page: number; pageSize: number },
  loaders: {
    count: () => Promise<number>
    list: (args: { limit: number; offset: number }) => Promise<T[]>
  },
): Promise<{ data: T[]; pagination: PaginationMeta }> {
  const offset = (input.page - 1) * input.pageSize
  const [data, total] = await Promise.all([
    loaders.list({ limit: input.pageSize, offset }),
    loaders.count(),
  ])
  return {
    data,
    pagination: { page: input.page, pageSize: input.pageSize, total },
  }
}
