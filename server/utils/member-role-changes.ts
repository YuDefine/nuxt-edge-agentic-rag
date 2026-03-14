// Use a relative import so this module is also resolvable from
// `server/auth.config.ts`, which is loaded by nuxt-better-auth via jiti
// (jiti does not understand the `#shared` virtual alias). See the comment
// at the top of `server/auth.config.ts` for the same reason.
import type { Role } from '../../shared/types/auth'

/**
 * Single entry point for every role transition in B16
 * (`member-and-permission-management`).
 *
 * **Q3=A "唯一入口"**: every mutation of `user.role` MUST also call
 * `recordRoleChange` in the same logical unit of work. The three writers
 * wired up in Phases 3+ are:
 *
 *   1. `server/auth.config.ts`
 *        databaseHooks.user.create.before      — allowlist seed on signup
 *        databaseHooks.session.create.before   — drift sync on each login
 *   2. `server/api/admin/members/[userId].patch.ts` — Admin UI upgrade/downgrade
 *   3. Any future `change role` path MUST route through this helper.
 *
 * A role mutation that bypasses this helper is a design bug, not a clever
 * optimisation — audit completeness is the whole point.
 */

/**
 * Minimal shape we need from the `hub:db` drizzle proxy. Typed structurally
 * so tests can inject a fake without pulling the full drizzle types graph.
 */
export interface HubDbInsertChain {
  values(row: unknown): { run(): Promise<unknown> }
}

export interface HubDbLike {
  insert(table: unknown): HubDbInsertChain
}

export interface HubDbSchemaLike {
  memberRoleChanges: unknown
}

/** Destructured `{ db, schema }` pair returned by `getDrizzleDb()`. */
export interface HubDbModuleLike {
  db: HubDbLike
  schema: HubDbSchemaLike
}

/**
 * Sentinel `changed_by` values. Admin-initiated changes carry the admin's
 * better-auth `user.id`; these sentinels cover non-user actors.
 *
 * - `'system'`: Automated drift sync from `ADMIN_EMAIL_ALLOWLIST` via the
 *   better-auth session hook or migration 0006 backfill.
 * - `'db-direct'`: Reserved for a future DB trigger covering manual SQL
 *   UPDATEs; not yet wired, listed here so the audit table never has to
 *   invent a value at write time.
 */
export const ROLE_CHANGE_SYSTEM_ACTOR = 'system' as const
export const ROLE_CHANGE_DB_DIRECT_ACTOR = 'db-direct' as const

export interface RecordRoleChangeInput {
  userId: string
  fromRole: Role
  toRole: Role
  changedBy: string
  reason?: string | null
}

/**
 * Insert a single audit row. Returns the generated id so callers can log
 * the audit record alongside the role mutation for evlog correlation.
 *
 * @param db - Either `getDrizzleDb()`'s result or a compatible transaction
 *   handle from `hub:db`. Accepting both keeps the helper callable from
 *   better-auth hooks (which build their own `db` reference) and from API
 *   handlers (which use the drizzle proxy).
 * @param input - Role transition payload. `fromRole === toRole` is
 *   legal but discouraged; the caller is expected to skip no-op writes.
 */
export async function recordRoleChange(
  hubDb: HubDbModuleLike,
  input: RecordRoleChangeInput,
): Promise<{ id: string }> {
  const id = crypto.randomUUID()

  await hubDb.db
    .insert(hubDb.schema.memberRoleChanges)
    .values({
      id,
      userId: input.userId,
      fromRole: input.fromRole,
      toRole: input.toRole,
      changedBy: input.changedBy,
      reason: input.reason ?? null,
    })
    .run()

  return { id }
}
