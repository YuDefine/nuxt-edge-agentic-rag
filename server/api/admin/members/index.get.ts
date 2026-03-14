import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { ROLE_VALUES } from '#shared/types/auth'
import { paginateList, paginationQuerySchema } from '#shared/schemas/pagination'
import { assertNever } from '#shared/utils/assert-never'

const SORT_VALUES = ['created_desc', 'created_asc', 'email_asc'] as const

/**
 * B16 §5.1 — Admin member list.
 *
 * Source table is the better-auth `user` table in `hub:db`. The `user`
 * table is not declared in `server/db/schema.ts` (better-auth owns it),
 * so we access it through the generated drizzle proxy returned by
 * `getDrizzleDb()`.
 *
 * **Sort**: the design proposal suggested `last_login_at DESC` as the
 * default. That column does not exist on better-auth's `user` table
 * (only `createdAt` / `updatedAt` do; `updatedAt` is auto-bumped on any
 * row write via `$onUpdate`). We default to `created_desc` so the list
 * is deterministic on a fresh deploy; the dial-in for last-login
 * ordering belongs to admin-ui-post-core if it's ever needed.
 *
 * **Filtering**: `role` accepts the canonical three-tier values. Pre-0006
 * legacy `'user'` rows are already upgraded to `'member'` by migration
 * 0006, so we do not accept `'user'` here.
 */
const querySchema = paginationQuerySchema.extend({
  role: z.enum(ROLE_VALUES).optional(),
  sort: z.enum(SORT_VALUES).default('created_desc'),
})

export default defineEventHandler(async function listMembersHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  log.set({
    operation: 'admin-members-list',
    table: 'user',
    user: { id: session.user.id ?? null },
  })

  const { db, schema } = await import('hub:db')
  const { asc, desc, eq, count } = await import('drizzle-orm')

  const whereExpr = query.role ? eq(schema.user.role, query.role) : undefined

  const orderBy = (() => {
    switch (query.sort) {
      case 'created_desc':
        return desc(schema.user.createdAt)
      case 'created_asc':
        return asc(schema.user.createdAt)
      case 'email_asc':
        return asc(schema.user.email)
      default:
        // Exhaustiveness enforced at compile time: adding a new SORT_VALUES
        // entry without wiring it here is a TypeScript error, not a silent
        // fallback. Per `development.md` Exhaustiveness Rule.
        return assertNever(query.sort, 'listMembersHandler.sort')
    }
  })()

  return paginateList(
    { page: query.page, pageSize: query.pageSize },
    {
      count: async () => {
        const base = db.select({ n: count() }).from(schema.user)
        const rows = await (whereExpr ? base.where(whereExpr) : base)
        return rows[0]?.n ?? 0
      },
      list: async ({ limit, offset }) => {
        const base = db
          .select({
            id: schema.user.id,
            email: schema.user.email,
            name: schema.user.name,
            image: schema.user.image,
            role: schema.user.role,
            createdAt: schema.user.createdAt,
            updatedAt: schema.user.updatedAt,
          })
          .from(schema.user)

        const withWhere = whereExpr ? base.where(whereExpr) : base
        // Stable secondary sort by id keeps pagination deterministic when
        // primary key (createdAt / email) collides.
        const rows = await withWhere
          .orderBy(orderBy, asc(schema.user.id))
          .limit(limit)
          .offset(offset)

        return rows.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          image: row.image,
          role: row.role,
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
          updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        }))
      },
    },
  )
})
