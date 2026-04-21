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
 * Defensive normaliser: drizzle's `timestamp_ms` mapper returns a Date for
 * `user.createdAt` / `user.updatedAt`, but `session.updatedAt` is a TEXT
 * column (see `server/db/schema.ts` session declaration) so it arrives
 * as an ISO string. If a future driver / migration round leaves a row
 * with an unparseable shape, prefer returning null over crashing the
 * whole list response — the `auth-storage-consistency` spec scenario
 * "Handler returns 200 with null when a timestamp is unparseable"
 * exercises this regression guard.
 *
 * TD-010 (2026-04-21) tightened the signature from `unknown` to the
 * concrete union so call sites get compile-time help; the runtime
 * branches stay identical.
 */
function toIsoOrNull(value: Date | string | number | null | undefined): string | null {
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
 * Source is the better-auth `user` table with per-page batched lookups
 * against `account` (google binding), `passkey`, and `session` for the
 * credential badges and last-activity proxy.
 *
 * TD-010 (2026-04-21): previously this handler used
 * `db.all(sql\`...\`)` raw SQL with EXISTS sub-queries, which worked on
 * production D1 but threw on local-dev libsql (`db.all` is not defined
 * on the libsql driver path). The refactor moves every query onto the
 * drizzle query builder (portable across D1 + libsql) and aggregates
 * credential flags / `lastActivityAt` in the application layer. See
 * `openspec/changes/drizzle-refactor-credentials-admin-members/design.md`
 * Decision 3 for the trade-off vs. a single leftJoin + groupBy.
 *
 * Columns returned mirror `AdminMemberRow` in `shared/types/admin-members.ts`
 * so the client types against a single source of truth.
 */
const querySchema = paginationQuerySchema.extend({
  role: z.enum(ROLE_VALUES).optional(),
  sort: z.enum(SORT_VALUES).default('created_desc'),
})

// Compile-time exhaustiveness guard — if `CREDENTIAL_TYPE_VALUES` grows
// (e.g. a future `sso` credential), this mapping forces a TS error
// rather than silently dropping the new category.
type CredentialFlagMap = Record<CredentialType, boolean>

function toCredentialTypes(hasGoogle: boolean, hasPasskey: boolean): CredentialType[] {
  const present: CredentialFlagMap = {
    google: hasGoogle,
    passkey: hasPasskey,
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

  const { db, schema } = await import('hub:db')
  const { and, asc, count, desc, eq, inArray, max } = await import('drizzle-orm')

  // Resolve the ORDER BY into a pair of drizzle column expressions so
  // the query builder emits a stable plan on both D1 and libsql.
  const orderByClause = (() => {
    switch (query.sort) {
      case 'created_desc':
        return [desc(schema.user.createdAt), asc(schema.user.id)] as const
      case 'created_asc':
        return [asc(schema.user.createdAt), asc(schema.user.id)] as const
      case 'email_asc':
        return [asc(schema.user.email), asc(schema.user.id)] as const
      default:
        return assertNever(query.sort, 'listMembersHandler.sort')
    }
  })()

  const roleCondition = query.role ? eq(schema.user.role, query.role) : undefined

  try {
    return await paginateList(
      { page: query.page, pageSize: query.pageSize },
      {
        count: async () => {
          const baseCount = db.select({ n: count() }).from(schema.user)
          const rows = roleCondition ? await baseCount.where(roleCondition) : await baseCount
          return rows[0]?.n ?? 0
        },
        list: async ({ limit, offset }): Promise<AdminMemberRow[]> => {
          // Stage A — page of users, ordered + paginated. Uses the
          // drizzle query builder so the runtime SQL is portable.
          const baseList = db
            .select({
              id: schema.user.id,
              email: schema.user.email,
              name: schema.user.name,
              displayName: schema.user.display_name,
              image: schema.user.image,
              role: schema.user.role,
              createdAt: schema.user.createdAt,
              updatedAt: schema.user.updatedAt,
            })
            .from(schema.user)

          const users = await (roleCondition ? baseList.where(roleCondition) : baseList)
            .orderBy(...orderByClause)
            .limit(limit)
            .offset(offset)

          if (users.length === 0) {
            return []
          }

          const pageUserIds = users.map((u) => u.id)

          // Stage B — batched lookups for credential badges + session
          // last-activity. Three parallel queries gated on `IN
          // (pageUserIds)` — far simpler than leftJoin+groupBy+count on
          // libsql, and because they run under `Promise.all` the wall
          // time matches the single-SELECT + EXISTS plan.
          const [googleRows, passkeyRows, sessionRows] = await Promise.all([
            db
              .select({ userId: schema.account.userId })
              .from(schema.account)
              .where(
                and(
                  inArray(schema.account.userId, pageUserIds),
                  eq(schema.account.providerId, 'google'),
                ),
              ),
            db
              .select({ userId: schema.passkey.userId })
              .from(schema.passkey)
              .where(inArray(schema.passkey.userId, pageUserIds)),
            db
              .select({
                userId: schema.session.userId,
                lastUpdatedAt: max(schema.session.updatedAt),
              })
              .from(schema.session)
              .where(inArray(schema.session.userId, pageUserIds))
              .groupBy(schema.session.userId),
          ])

          // Stage C — application-layer reduce. Sets / Maps keep the
          // per-row assembly O(1) and mirror the old EXISTS / MAX
          // semantics exactly.
          const googleSet = new Set(googleRows.map((row) => row.userId))
          const passkeySet = new Set(passkeyRows.map((row) => row.userId))
          const lastActivityMap = new Map<string, string | null>()
          for (const row of sessionRows) {
            lastActivityMap.set(row.userId, row.lastUpdatedAt ?? null)
          }

          return users.map((u) => {
            const registeredAt = toIsoOrNull(u.createdAt)
            const sessionMax = lastActivityMap.get(u.id) ?? null
            // Fall back to `u.updatedAt` when the session table yields
            // no row (fresh user without an active session). Matches
            // the legacy COALESCE behaviour.
            const lastActivityRaw: Date | string | number | null = sessionMax ?? u.updatedAt ?? null
            return {
              id: u.id,
              email: u.email,
              name: u.name,
              displayName: u.displayName,
              image: u.image,
              role: normaliseRole(u.role),
              credentialTypes: toCredentialTypes(googleSet.has(u.id), passkeySet.has(u.id)),
              registeredAt,
              lastActivityAt: toIsoOrNull(lastActivityRaw) ?? registeredAt,
              createdAt: registeredAt ?? '',
              updatedAt: toIsoOrNull(u.updatedAt) ?? '',
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
