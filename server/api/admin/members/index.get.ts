import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { paginateList, paginationQuerySchema } from '#shared/schemas/pagination'
import {
  CREDENTIAL_TYPE_VALUES,
  type AdminMemberRow,
  type CredentialType,
} from '#shared/types/admin-members'
import { ROLE_VALUES, normaliseRole } from '#shared/types/auth'
import { assertNever } from '#shared/utils/assert-never'

const SORT_VALUES = ['created_desc', 'created_asc', 'email_asc'] as const

/**
 * Defensive: drizzle's `timestamp_ms` mapper returns a Date, but if a future
 * driver / migration round leaves a row with an unparseable shape, prefer
 * returning null over crashing the whole list response.
 *
 * After passkey-authentication §13 the handler switched to raw SQL to
 * enable `LEFT JOIN` aggregation on `passkey` / `account`; drivers now
 * surface timestamp columns as either a number (ms epoch) or a string
 * depending on the sqlite driver path, so we normalise both.
 */
function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

/**
 * B16 §5.1 + passkey-authentication §13.1 — Admin member list.
 *
 * Source is the better-auth `user` table with LEFT JOIN aggregations:
 *   - `account` where `providerId = 'google'` → `hasGoogle`
 *   - `passkey` → `hasPasskey` + join over session.updatedAt for
 *     last-activity proxy.
 *
 * The handler uses raw SQL because (a) the generated drizzle proxy
 * names `displayName` with camelCase while the migration SQL created
 * `display_name` (snake_case) — see tasks.md "Found During Apply" — and
 * (b) drizzle's CTE support for EXISTS / multi-join sub-aggregations
 * is awkward compared to a single SELECT with conditional MAX().
 *
 * Columns returned mirror `AdminMemberRow` in `shared/types/admin-members.ts`
 * so the client types against a single source of truth.
 */
const querySchema = paginationQuerySchema.extend({
  role: z.enum(ROLE_VALUES).optional(),
  sort: z.enum(SORT_VALUES).default('created_desc'),
})

interface RawMemberRow {
  id: string
  email: string | null
  name: string | null
  display_name: string | null
  image: string | null
  role: string | null
  created_at: number | string | null
  updated_at: number | string | null
  has_google: number | null
  has_passkey: number | null
  last_activity_at: number | string | null
}

// Compile-time exhaustiveness guard — if `CREDENTIAL_TYPE_VALUES` grows
// (e.g. a future `sso` credential), this mapping forces a TS error
// rather than silently dropping the new category.
type CredentialFlagMap = Record<CredentialType, boolean>

function toCredentialTypes(hasGoogle: number | null, hasPasskey: number | null): CredentialType[] {
  const present: CredentialFlagMap = {
    google: Boolean(hasGoogle),
    passkey: Boolean(hasPasskey),
  }
  return CREDENTIAL_TYPE_VALUES.filter((kind) => present[kind])
}

export default defineEventHandler(async function listMembersHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  log.set({
    operation: 'admin-members-list',
    table: 'user',
    user: { id: session.user.id ?? null },
  })

  const { db } = await import('hub:db')
  const { sql } = await import('drizzle-orm')

  const orderByClause = (() => {
    switch (query.sort) {
      case 'created_desc':
        return sql`u.createdAt DESC, u.id ASC`
      case 'created_asc':
        return sql`u.createdAt ASC, u.id ASC`
      case 'email_asc':
        return sql`u.email ASC, u.id ASC`
      default:
        return assertNever(query.sort, 'listMembersHandler.sort')
    }
  })()

  // Role filter — narrow to the specific three-tier value when provided.
  const roleFilter = query.role ? sql`WHERE u.role = ${query.role}` : sql``

  try {
    return await paginateList(
      { page: query.page, pageSize: query.pageSize },
      {
        count: async () => {
          const rows = (await db.all(
            sql`SELECT COUNT(*) AS n FROM "user" u ${roleFilter}`,
          )) as Array<{ n: number }>
          return rows[0]?.n ?? 0
        },
        list: async ({ limit, offset }): Promise<AdminMemberRow[]> => {
          // `EXISTS` sub-queries rather than outer joins to keep the
          // result set one row per user (otherwise multi-passkey users
          // would duplicate).
          // `last_activity_at` falls back to `u.updatedAt` when the
          // session table yields no row (fresh user).
          const rows = (await db.all(
            sql`SELECT
                  u.id                         AS id,
                  u.email                      AS email,
                  u.name                       AS name,
                  u.display_name               AS display_name,
                  u.image                      AS image,
                  u.role                       AS role,
                  u.createdAt                  AS created_at,
                  u.updatedAt                  AS updated_at,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM account a
                    WHERE a.userId = u.id AND a.providerId = 'google'
                  ) THEN 1 ELSE 0 END          AS has_google,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM passkey p
                    WHERE p.userId = u.id
                  ) THEN 1 ELSE 0 END          AS has_passkey,
                  COALESCE(
                    (SELECT MAX(s.updatedAt) FROM session s WHERE s.userId = u.id),
                    u.updatedAt
                  )                             AS last_activity_at
                FROM "user" u
                ${roleFilter}
                ORDER BY ${orderByClause}
                LIMIT ${limit} OFFSET ${offset}`,
          )) as RawMemberRow[]

          return rows.map((row) => {
            const registeredAt = toIsoOrNull(row.created_at)
            return {
              id: row.id,
              email: row.email,
              name: row.name,
              displayName: row.display_name,
              image: row.image,
              role: normaliseRole(row.role),
              credentialTypes: toCredentialTypes(row.has_google, row.has_passkey),
              registeredAt,
              lastActivityAt: toIsoOrNull(row.last_activity_at) ?? registeredAt,
              createdAt: registeredAt ?? '',
              updatedAt: toIsoOrNull(row.updated_at) ?? '',
            }
          })
        },
      },
    )
  } catch (error) {
    log.error(error as Error, { step: 'list-members' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入會員清單，請稍後再試',
    })
  }
})
