import { eq } from 'drizzle-orm'

import type { DrizzleDbModuleLike } from './database'

export interface UserProfileSyncInput {
  userId: string
  /**
   * Normalised email for the better-auth user. NULL for passkey-only users
   * who have no email at all (e.g. registered via passkey-first flow). Both
   * branches still produce a `user_profiles` row keyed by `userId` so child
   * FKs (`conversations`, `query_logs`, `messages`, `documents`) can resolve.
   *
   * NULL callers skip the email-first lookup that drives the TD-044 drift
   * recovery (it has no email key to match by); they fall back to id-first
   * lookup which is correct for passkey-only users since their id never
   * collides with another user's email.
   */
  emailNormalized: string | null
  roleSnapshot: string
  adminSource: string
}

export interface UserProfileSyncLogger {
  error: (message: string, fields?: Record<string, unknown>) => void
}

export interface UserProfileSyncDeps {
  db: DrizzleDbModuleLike['db']
  schema: DrizzleDbModuleLike['schema']
  log: UserProfileSyncLogger
  env?: string
}

/**
 * fix-user-profile-id-drift (TD-044):
 *
 * - email_normalized-first lookup (Decision 3)
 * - app-level migrate children before flipping parent id (Decisions 1 & 2)
 * - env-gated rethrow outside production (Decision 4)
 * - actionable redacted log hint on failure (Decision 5)
 *
 * Spec: openspec/specs/auth-storage-consistency/spec.md — three
 * "Session Hook …" requirements added by this change.
 */
export async function syncUserProfile(
  deps: UserProfileSyncDeps,
  input: UserProfileSyncInput,
): Promise<void> {
  const { db, schema, log } = deps
  const env = deps.env ?? process.env.NODE_ENV
  const { userId, emailNormalized, roleSnapshot, adminSource } = input

  try {
    // For passkey-only users (no email) the email-first lookup that drives
    // TD-044 drift recovery has no key to match against, so fall back to
    // id-first. There's no drift case to recover for them either: each
    // passkey-only `user_profiles` row is keyed solely by `user.id`, and that
    // id is allocated by better-auth for the lifetime of the user.
    const existing =
      emailNormalized === null
        ? await db
            .select({ id: schema.userProfiles.id })
            .from(schema.userProfiles)
            .where(eq(schema.userProfiles.id, userId))
            .limit(1)
        : await db
            .select({ id: schema.userProfiles.id })
            .from(schema.userProfiles)
            .where(eq(schema.userProfiles.emailNormalized, emailNormalized))
            .limit(1)
    const existingRow = existing[0]

    if (!existingRow) {
      await db.insert(schema.userProfiles).values({
        id: userId,
        emailNormalized,
        roleSnapshot,
        adminSource,
      })
      return
    }

    if (existingRow.id === userId) {
      await db
        .update(schema.userProfiles)
        .set({ roleSnapshot, adminSource })
        .where(eq(schema.userProfiles.id, userId))
      return
    }

    const staleId = existingRow.id
    await db.transaction(async (tx) => {
      await tx
        .update(schema.conversations)
        .set({ userProfileId: userId })
        .where(eq(schema.conversations.userProfileId, staleId))
      await tx
        .update(schema.queryLogs)
        .set({ userProfileId: userId })
        .where(eq(schema.queryLogs.userProfileId, staleId))
      await tx
        .update(schema.messages)
        .set({ userProfileId: userId })
        .where(eq(schema.messages.userProfileId, staleId))
      await tx
        .update(schema.documents)
        .set({ createdByUserId: userId })
        .where(eq(schema.documents.createdByUserId, staleId))
      await tx
        .update(schema.userProfiles)
        .set({ id: userId, roleSnapshot, adminSource })
        .where(eq(schema.userProfiles.id, staleId))
    })
  } catch (error) {
    log.error('user_profiles sync failed', {
      userId,
      emailNormalized: redactEmailNormalized(emailNormalized),
      error: error instanceof Error ? error.message : String(error),
      hint: 'Stale user_profiles row may exist with same email_normalized but different id; app-level migrate likely failed; inspect user_profiles + children FKs.',
    })
    if (env !== 'production') {
      throw error
    }
  }
}

function redactEmailNormalized(email: string | null): string {
  if (email === null) return '<null>'
  return `${email.slice(0, 3)}***`
}
