import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { ROLE_VALUES } from '#shared/types/auth'
import { paginateList, paginationQuerySchema } from '#shared/schemas/pagination'
import { assertNever } from '#shared/utils/assert-never'

const SORT_VALUES = ['created_desc', 'created_asc', 'email_asc'] as const

/**
 * Tolerate schema drift on the better-auth `user` table. Production D1 stores
 * `createdAt` / `updatedAt` as TEXT (column affinity disagrees with drizzle's
 * `integer timestamp_ms` declaration) and some rows hold values like
 * `"1776332449872.0"` that produce Invalid Date through the drizzle mapper.
 * Calling `toISOString()` on Invalid Date throws `RangeError: Invalid time
 * value` and takes the whole list request down. Return null for unparseable
 * rows instead; a table-rebuild migration is the right long-term fix.
 */
function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  // 數值 / 數值字串分支故意排在 ISO 字串之前：production drift 值形如
  // `"1776332449872.0"`（epoch-ms float 偽裝成字串），先丟 Date.parse()
  // 會 NaN。只有無法解讀為 epoch-ms 的值（例如 ISO 字串）才 fallback 到
  // Date.parse。
  const asNumber = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(asNumber) && asNumber > 0) {
    const parsed = new Date(asNumber)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return null
}

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
  const { asc, desc, eq, count, sql } = await import('drizzle-orm')

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
        // `createdAt` / `updatedAt` are read via `sql<...>` to bypass
        // drizzle's `timestamp_ms` mapper. Production D1 stores these
        // columns as TEXT (affinity drift) and the mapper produces
        // Invalid Date on every row, which we then can't recover from.
        // Reading the raw driver value lets `toIsoOrNull` parse strings,
        // numbers, or actual Date instances uniformly.
        const base = db
          .select({
            id: schema.user.id,
            email: schema.user.email,
            name: schema.user.name,
            image: schema.user.image,
            role: schema.user.role,
            createdAtRaw: sql<string | number | null>`${schema.user.createdAt}`.as(
              'created_at_raw',
            ),
            updatedAtRaw: sql<string | number | null>`${schema.user.updatedAt}`.as(
              'updated_at_raw',
            ),
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
          createdAt: toIsoOrNull(row.createdAtRaw),
          updatedAt: toIsoOrNull(row.updatedAtRaw),
        }))
      },
    },
  )
})
