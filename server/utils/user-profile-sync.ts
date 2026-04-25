import { eq } from 'drizzle-orm'

import type { DrizzleDbModuleLike } from './database'

export interface UserProfileSyncInput {
  userId: string
  emailNormalized: string
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
    const existing = await db
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

function redactEmailNormalized(email: string): string {
  return `${email.slice(0, 3)}***`
}
