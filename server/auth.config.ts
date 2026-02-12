import { defineServerAuth } from '@onmax/nuxt-better-auth/config'
import { admin } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
// nuxt-better-auth 透過 jiti 載入本檔，jiti 不解析 `#shared` 虛擬 alias，只能用相對路徑
import {
  createKnowledgeRuntimeConfig,
  isAdminEmailAllowlisted,
  normalizeEmailAddress,
} from '../shared/schemas/knowledge-runtime'

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

  function deriveRole(email: string | null | undefined): 'admin' | 'user' {
    return isAdminEmailAllowlisted(email, allowlist) ? 'admin' : 'user'
  }

  return {
    database: db,
    emailAndPassword: { enabled: enableEmailAndPassword },
    plugins: [admin()],
    ...(socialProviders ? { socialProviders } : {}),
    databaseHooks: {
      // Admin role is managed via runtime ADMIN_EMAIL_ALLOWLIST:
      // - On signup: derive role from allowlist before user row is created.
      // - On every login: re-evaluate against current allowlist and update if drifted.
      user: {
        create: {
          before: async (user) => {
            return { data: { ...user, role: deriveRole(user.email) } }
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

            const expectedRole = deriveRole(existing.email)
            const adminSource = isAdminEmailAllowlisted(existing.email, allowlist)
              ? 'allowlist'
              : 'none'
            const emailNormalized = normalizeEmailAddress(existing.email)

            if (existing.role !== expectedRole) {
              await hubDb
                .update(schema.user)
                .set({ role: expectedRole })
                .where(eq(schema.user.id, session.userId))
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
                  roleSnapshot: expectedRole,
                  adminSource,
                })
                .onConflictDoUpdate({
                  target: schema.userProfiles.id,
                  set: { emailNormalized, roleSnapshot: expectedRole, adminSource },
                })
            } catch (error) {
              console.error('[auth] user_profiles sync failed', {
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
