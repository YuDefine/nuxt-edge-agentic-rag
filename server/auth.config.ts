import { defineServerAuth } from '@onmax/nuxt-better-auth/config'
import { admin } from 'better-auth/plugins'
import { consola } from 'consola'
import { eq } from 'drizzle-orm'
// nuxt-better-auth 透過 jiti 載入本檔，jiti 不解析 `#shared` 虛擬 alias，只能用相對路徑
import {
  createKnowledgeRuntimeConfig,
  isAdminEmailAllowlisted,
  normalizeEmailAddress,
} from '../shared/schemas/knowledge-runtime'
import { recordRoleChange, ROLE_CHANGE_SYSTEM_ACTOR } from './utils/member-role-changes'

const authLog = consola.withTag('auth')

/**
 * B16 three-tier role helper values.
 *
 * Duplicated here (rather than imported from `shared/types/auth`) because
 * this file is loaded via jiti and `#shared` aliasing does not apply —
 * see the import comment above. If `shared/types/auth.ts` ever adds a
 * new role value, this literal union must be widened in lockstep, and
 * the TypeScript compiler will catch the mismatch where
 * `member-role-changes.ts` (which imports from `shared/types/auth` via
 * a relative path) is called.
 */
type ThreeTierRole = 'admin' | 'member' | 'guest'

export default defineServerAuth(({ db, runtimeConfig }) => {
  const knowledge = createKnowledgeRuntimeConfig(runtimeConfig.knowledge)
  const allowlist = knowledge.adminEmailAllowlist

  // v1.0.0 spec: Google OAuth is the only interactive login path.
  // emailAndPassword is only enabled in local environment for setup endpoint.
  const enableEmailAndPassword = knowledge.environment === 'local'

  const googleOAuth = (
    runtimeConfig.oauth as { google?: { clientId?: string; clientSecret?: string } } | undefined
  )?.google
  const socialProviders =
    googleOAuth?.clientId && googleOAuth?.clientSecret
      ? {
          google: {
            clientId: googleOAuth.clientId,
            clientSecret: googleOAuth.clientSecret,
          },
        }
      : undefined

  /**
   * B16 three-tier derivation.
   *
   * - email ∈ `ADMIN_EMAIL_ALLOWLIST` → `'admin'`
   * - otherwise → `'guest'`  (new signups land here; Admin promotes to
   *   `'member'` via `/admin/members` in Phase 4)
   *
   * Legacy `'user'` is NOT produced any more. Existing rows with
   * `role = 'user'` were upgraded to `'member'` by migration 0006, and
   * `session.create.before` tolerates legacy values defensively in case
   * of stale sessions.
   */
  function deriveRole(email: string | null | undefined): 'admin' | 'guest' {
    return isAdminEmailAllowlisted(email, allowlist) ? 'admin' : 'guest'
  }

  return {
    database: db,
    emailAndPassword: { enabled: enableEmailAndPassword },
    // `defaultRole: 'guest'` ensures any insert path that does not go
    // through our `user.create.before` hook (e.g. better-auth admin API
    // routes, future email+password bootstrap) still lands the user as
    // Guest — the least-privileged role — not `'user'`.
    // `adminRoles: ['admin']` restricts the set of roles the plugin
    // considers privileged for its own management endpoints; Member
    // stays a normal authenticated role.
    plugins: [admin({ defaultRole: 'guest', adminRoles: ['admin'] })],
    ...(socialProviders ? { socialProviders } : {}),
    databaseHooks: {
      // Admin role is managed via runtime ADMIN_EMAIL_ALLOWLIST:
      // - On signup: derive role from allowlist before user row is created.
      // - On every login: re-evaluate against current allowlist and update
      //   if drifted; record the transition in `member_role_changes`.
      user: {
        create: {
          before: async (user) => {
            return { data: { ...user, role: deriveRole(user.email) } }
          },
          /**
           * Audit the initial role assignment. We only write a row when
           * the user was seeded as Admin (allowlist hit); Guest signups
           * would otherwise produce a `guest → guest` no-op audit on
           * every single account creation, which is pure noise.
           *
           * `fromRole` is `'guest'` because that's the conceptual starting
           * point for any newly-registered user in the three-tier model —
           * even an allowlist-seeded admin has that implicit "before"
           * state at the moment of account creation.
           */
          after: async (created) => {
            const seededRole = deriveRole(created.email)
            if (seededRole !== 'admin') return

            try {
              const hubDb = await import('hub:db')
              await recordRoleChange(hubDb, {
                userId: created.id,
                fromRole: 'guest',
                toRole: 'admin',
                changedBy: ROLE_CHANGE_SYSTEM_ACTOR,
                reason: 'allowlist-seed',
              })
            } catch (error) {
              // Audit failure must not block login. Log and continue —
              // the role itself was already persisted by better-auth.
              authLog.error('member_role_changes seed-write failed', {
                userId: created.id,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const { db: hubDb, schema } = await import('hub:db')
            const [existing] = await hubDb
              .select({ email: schema.user.email, role: schema.user.role })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1)

            if (!existing?.email) return

            const inAllowlist = isAdminEmailAllowlisted(existing.email, allowlist)
            const adminSource = inAllowlist ? 'allowlist' : 'none'
            const emailNormalized = normalizeEmailAddress(existing.email)
            const currentRole = (existing.role ?? 'guest') as string

            /**
             * B16 three-tier drift reconciliation.
             *
             * Four transitions are meaningful; everything else is a no-op:
             *
             *   (A) allowlist hit, current role is not 'admin'
             *       → upgrade to 'admin', audit reason='allowlist-seed'
             *
             *   (B) allowlist miss, current role is 'admin'
             *       → DOWNGRADE TO 'member' (NOT 'guest'), audit
             *         reason='allowlist-removed'. The user *was* a full
             *         member of the system before being given Admin
             *         privileges; demoting them to Guest would strip
             *         privileges they had on the way up, so we stop at
             *         Member. Admin promotion back to Admin only happens
             *         by adding the email back to ADMIN_EMAIL_ALLOWLIST.
             *
             *   (C) legacy 'user' role (pre-0006 session) + allowlist miss
             *       → silently migrate to 'member' with NO audit row;
             *         this mirrors the one-shot UPDATE in migration 0006
             *         for sessions that were minted before it ran.
             *
             *   (D) anything else
             *       → current role is the truth; no write, no audit.
             */
            let targetRole: ThreeTierRole | null = null
            let auditReason: string | null = null

            if (inAllowlist && currentRole !== 'admin') {
              targetRole = 'admin'
              auditReason = 'allowlist-seed'
            } else if (!inAllowlist && currentRole === 'admin') {
              targetRole = 'member'
              auditReason = 'allowlist-removed'
            } else if (!inAllowlist && currentRole === 'user') {
              // Legacy migration (C) — no audit by design.
              targetRole = 'member'
              auditReason = null
            }

            const finalRole = (targetRole ?? currentRole) as string

            if (targetRole !== null && targetRole !== currentRole) {
              await hubDb
                .update(schema.user)
                .set({ role: targetRole })
                .where(eq(schema.user.id, session.userId))

              if (auditReason !== null) {
                try {
                  await recordRoleChange(
                    { db: hubDb, schema },
                    {
                      userId: session.userId,
                      // Normalise legacy 'user' to 'member' for the audit
                      // row so downstream readers never see the old enum.
                      fromRole: currentRole === 'user' ? 'member' : (currentRole as ThreeTierRole),
                      toRole: targetRole,
                      changedBy: ROLE_CHANGE_SYSTEM_ACTOR,
                      reason: auditReason,
                    }
                  )
                } catch (error) {
                  authLog.error('member_role_changes drift-write failed', {
                    userId: session.userId,
                    error: error instanceof Error ? error.message : String(error),
                  })
                }
              }
            }

            // Backfill / sync user_profiles row (FK target for query_logs etc.)
            // Wrap in try/catch: profile sync is auxiliary — if it throws (e.g. UNIQUE
            // conflict on email_normalized when a stale row exists under a different id),
            // we must not block the user's login. Log and continue.
            try {
              await hubDb
                .insert(schema.userProfiles)
                .values({
                  id: session.userId,
                  emailNormalized,
                  roleSnapshot: finalRole,
                  adminSource,
                })
                .onConflictDoUpdate({
                  target: schema.userProfiles.id,
                  set: { emailNormalized, roleSnapshot: finalRole, adminSource },
                })
            } catch (error) {
              authLog.error('user_profiles sync failed', {
                userId: session.userId,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          },
        },
      },
    },
  }
})
