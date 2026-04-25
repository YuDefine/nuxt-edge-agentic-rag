// eslint-disable-next-line import/no-unassigned-import
import 'reflect-metadata'
import { passkey } from '@better-auth/passkey'
import { defineServerAuth } from '@onmax/nuxt-better-auth/config'
import { setSessionCookie } from 'better-auth/cookies'
import { admin } from 'better-auth/plugins'
import { consola } from 'consola'
import { eq, sql } from 'drizzle-orm'
// nuxt-better-auth 透過 jiti 載入本檔，jiti 不解析 `#shared` 虛擬 alias，只能用相對路徑
import {
  isAdminEmailAllowlisted,
  normalizeEmailAddress,
  resolveKnowledgeRuntimeConfig,
} from '../shared/schemas/knowledge-runtime'
import { nicknameSchema } from '../shared/schemas/nickname'
import { createBetterAuthSafeLogger } from './utils/better-auth-safe-logger'
import { getDrizzleDb } from './utils/database'
import { recordRoleChange, ROLE_CHANGE_SYSTEM_ACTOR } from './utils/member-role-changes'
import { syncUserProfile } from './utils/user-profile-sync'

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
  const knowledge = resolveKnowledgeRuntimeConfig(runtimeConfig.knowledge)
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
   * passkey-authentication: Feature flag as dual gate (Decision 4).
   *
   * Server-side plugin registration is only performed when
   * `knowledge.features.passkey === true` AND both RP env vars are set.
   * When the flag is on but env vars are missing, we log a critical error
   * and skip registration — this keeps `/api/auth/passkey/*` returning
   * 404 rather than pretending to work and failing cryptically at the
   * WebAuthn ceremony.
   */
  const passkeyRpConfig =
    (runtimeConfig.passkey as { rpId?: string; rpName?: string } | undefined) ?? {}
  const passkeyFlagEnabled = knowledge.features.passkey === true
  const passkeyEnvComplete = Boolean(passkeyRpConfig.rpId && passkeyRpConfig.rpName)
  const passkeyEnabled = passkeyFlagEnabled && passkeyEnvComplete

  if (passkeyFlagEnabled && !passkeyEnvComplete) {
    authLog.error('passkey feature flag enabled but RP env vars missing; skipping plugin', {
      rpIdSet: Boolean(passkeyRpConfig.rpId),
      rpNameSet: Boolean(passkeyRpConfig.rpName),
    })
  }

  const plugins = [admin({ defaultRole: 'guest', adminRoles: ['admin'] })]
  if (passkeyEnabled) {
    plugins.push(
      passkey({
        rpID: passkeyRpConfig.rpId,
        rpName: passkeyRpConfig.rpName,
        /**
         * passkey-first registration — no prior session, no email.
         *
         * The client sends the chosen nickname as the `context` query
         * param (see `PasskeyRegisterDialog.vue`: `addPasskey({ name, context })`).
         * `resolveUser` validates + reserves the nickname; `afterVerification`
         * creates the user + session once the ceremony is verified.
         *
         * For already-authenticated callers (adding a passkey to their
         * existing account), `resolveUser` falls back to the session user
         * via the plugin's built-in fast path — no context is sent, no
         * new user row is made.
         */
        registration: {
          requireSession: false,
          resolveUser: async ({ context }) => {
            // `context` is the nickname from the client. Reject if absent:
            // this branch is passkey-first, caller must have supplied one.
            if (!context) {
              throw new Error('PASSKEY_FIRST_NICKNAME_REQUIRED')
            }
            const parsed = nicknameSchema.safeParse(context)
            if (!parsed.success) {
              throw new Error('PASSKEY_FIRST_NICKNAME_INVALID')
            }
            const nickname = parsed.data

            const { db: hubDb } = await import('hub:db')
            const rows = (await hubDb.all(
              sql`SELECT 1 AS hit FROM "user" WHERE lower(display_name) = lower(${nickname}) LIMIT 1`,
            )) as Array<{ hit: number }>
            if (rows.length > 0) {
              throw new Error('PASSKEY_FIRST_NICKNAME_TAKEN')
            }

            // Placeholder id — `afterVerification` creates the actual row
            // via `internalAdapter.createUser` and returns that real id.
            return {
              id: crypto.randomUUID(),
              name: nickname,
              displayName: nickname,
            }
          },
          afterVerification: async ({ ctx, user }) => {
            const session = ctx.context.session
            if (session?.user?.id) {
              // Authenticated path — existing user adding a passkey. Let
              // the plugin use the session user id; no new row to create.
              return { userId: session.user.id }
            }

            // Passkey-first path — create the user row via adapter so
            // `databaseHooks.user.create.before/after` fire (role='guest',
            // member_role_changes audit = 'passkey-first-registration').
            // `email` is omitted so the column stores NULL (0009 made it
            // nullable); TypeScript's generated type marks email required
            // because better-auth's core schema predates the nullable
            // migration — the cast bridges that gap.
            const now = new Date()
            const newUser = (await (
              ctx.context.internalAdapter.createUser as unknown as (
                data: Record<string, unknown>,
              ) => Promise<{ id: string } | null>
            )({
              name: user.name,
              displayName: user.displayName,
              emailVerified: false,
              createdAt: now,
              updatedAt: now,
            })) as { id: string } | null
            if (!newUser) {
              throw new Error('PASSKEY_FIRST_CREATE_USER_FAILED')
            }

            // Mint the session immediately so the client is logged in
            // once verify-registration returns. `session.create.before`
            // hook handles `user_profiles` sync (sentinel email_normalized).
            const newSession = await ctx.context.internalAdapter.createSession(newUser.id)
            if (!newSession) {
              throw new Error('PASSKEY_FIRST_CREATE_SESSION_FAILED')
            }
            const hydratedUser = await ctx.context.internalAdapter.findUserById(newUser.id)
            if (!hydratedUser) {
              throw new Error('PASSKEY_FIRST_USER_LOOKUP_FAILED')
            }
            await setSessionCookie(ctx, {
              session: newSession,
              user: hydratedUser,
            })

            return { userId: newUser.id }
          },
        },
      }) as unknown as (typeof plugins)[number],
    )
  }

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
    logger: createBetterAuthSafeLogger(),
    session: {
      /**
       * Cloudflare Worker live runtime returns adapter rows that may not
       * survive Better Auth's cookie-cache `structuredClone()` path.
       * Disable session cookie cache so passkey verify-authentication
       * only mints the signed session token cookie, avoiding the
       * `a14.ownKeys...` proxy-trap crash in production reauth.
       */
      cookieCache: {
        enabled: false,
      },
    },
    /**
     * passkey-authentication: Declare `displayName` as a required custom
     * field on the better-auth `user` model so the plugin and drizzle
     * schema agree on its presence. The `user.create.before` hook
     * guarantees every inserted row carries a non-empty value, but the
     * better-auth core doesn't know that without this declaration.
     */
    user: {
      additionalFields: {
        displayName: {
          type: 'string',
          required: true,
          input: true,
          fieldName: 'display_name',
        },
      },
    },
    // `defaultRole: 'guest'` ensures any insert path that does not go
    // through our `user.create.before` hook (e.g. better-auth admin API
    // routes, future email+password bootstrap) still lands the user as
    // Guest — the least-privileged role — not `'user'`.
    // `adminRoles: ['admin']` restricts the set of roles the plugin
    // considers privileged for its own management endpoints; Member
    // stays a normal authenticated role.
    //
    // The `plugins` array is assembled above this return to allow
    // conditional registration of `passkey()` based on feature flag +
    // RP env presence (Decision 4).
    plugins,
    ...(socialProviders ? { socialProviders } : {}),
    databaseHooks: {
      // Admin role is managed via runtime ADMIN_EMAIL_ALLOWLIST:
      // - On signup: derive role from allowlist before user row is created.
      // - On every login: re-evaluate against current allowlist and update
      //   if drifted; record the transition in `member_role_changes`.
      user: {
        create: {
          /**
           * Three-tier role + passkey-first registration handling.
           *
           * - If `user.email` is present (Google / email+password path),
           *   allowlist comparison drives role as before.
           * - If `user.email` is NULL (passkey-first path), allowlist is
           *   not consulted (the allowlist is email-keyed) and role is
           *   always `'guest'`. Admin promotion for no-email users is
           *   blocked at `/admin/members/[userId].patch` regardless of
           *   what the input payload says.
           *
           * `displayName` is assumed to be provided by the passkey register
           * dialog (it's declared as `required: true` on `user`). For Google
           * OAuth paths, better-auth maps the Google profile `name` into
           * `user.name`; the migration 0009 backfill also seeds
           * `displayName` so existing users still have a stable anchor.
           */
          before: async (user) => {
            const hasEmail = Boolean(user.email)
            const role: ThreeTierRole = hasEmail ? deriveRole(user.email) : 'guest'
            // Ensure `display_name` is always populated — the migration
            // enforces NOT NULL and the passkey-first flow already supplies
            // it via the register dialog. Google / email OAuth paths don't
            // run that dialog, so fall back to the profile `name`, or a
            // stable `user-<id>` placeholder when both are absent.
            const incoming = user as typeof user & {
              displayName?: string | null
            }
            const fallbackName =
              typeof user.name === 'string' && user.name.trim().length > 0
                ? user.name.trim()
                : `user-${user.id.slice(0, 8)}`
            const displayName =
              typeof incoming.displayName === 'string' && incoming.displayName.trim().length > 0
                ? incoming.displayName.trim()
                : fallbackName
            return { data: { ...user, role, displayName } }
          },
          /**
           * Audit the initial role assignment.
           *
           * - Allowlist-seeded admins: write `allowlist-seed` (existing
           *   behaviour).
           * - Passkey-first registrations (NULL email): write
           *   `passkey-first-registration` so the audit trail keeps
           *   every role mutation path accounted for.
           * - Plain Google guest signups: no audit row — a
           *   `guest → guest` no-op would be pure noise on every single
           *   account creation.
           */
          after: async (created) => {
            const seededRole = deriveRole(created.email)
            const isPasskeyFirst = !created.email

            if (seededRole !== 'admin' && !isPasskeyFirst) return

            try {
              const hubDb = await import('hub:db')
              await recordRoleChange(hubDb, {
                userId: created.id,
                fromRole: 'guest',
                toRole: isPasskeyFirst ? 'guest' : 'admin',
                changedBy: ROLE_CHANGE_SYSTEM_ACTOR,
                reason: isPasskeyFirst ? 'passkey-first-registration' : 'allowlist-seed',
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
        /**
         * passkey-authentication: Cross-account email conflict detection
         * (Decision 5, tasks.md §6.3).
         *
         * When a passkey-first user (currently `email = NULL`) links a
         * Google account, better-auth writes the Google email into
         * `user.email` via `user.update`. If that email already belongs to
         * another user row (e.g. someone already signed in with that
         * Google account and created a separate passkey account by
         * mistake), we MUST refuse the update — `user.email` has a
         * partial unique index and a naive update would produce a
         * SQLITE_CONSTRAINT error at the driver level with an opaque
         * message.
         *
         * Throwing 409 here gives the UI a user-friendly path to tell
         * the user "this Google account is already linked to another
         * identity — sign in with that account directly instead".
         */
        update: {
          before: async (updates, ctx) => {
            // Only interesting when `email` is being set to a new value.
            const nextEmail = (updates as { email?: string | null }).email
            if (!nextEmail) return

            const { db: hubDb, schema } = await getDrizzleDb()

            // The better-auth hook context exposes the target user id via
            // `ctx?.context?.session?.user?.id` depending on call path.
            // We take a defensive approach: look up the row by the email
            // we're trying to write; if it's already owned by another id,
            // reject.
            const ctxUserId =
              (ctx as { context?: { session?: { user?: { id?: string } } } } | undefined)?.context
                ?.session?.user?.id ?? null

            if (!ctxUserId) return

            const collision = await hubDb
              .select({ id: schema.user.id })
              .from(schema.user)
              .where(eq(schema.user.email, nextEmail))
              .limit(1)

            const conflictRow = collision[0]
            if (conflictRow && conflictRow.id !== ctxUserId) {
              throw new Error(
                'EMAIL_ALREADY_LINKED: 此 email 已綁定其他帳號，請改用該帳號登入後再加綁其他憑證',
              )
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const { db: hubDb, schema } = await getDrizzleDb()
            const [existing] = await hubDb
              .select({ email: schema.user.email, role: schema.user.role })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1)

            if (!existing) return

            /**
             * passkey-authentication: users created by the passkey plugin
             * may have `email = NULL`. The allowlist is email-keyed, so we
             * MUST skip allowlist comparison (`isAdminEmailAllowlisted`
             * already returns false for null/empty, but we short-circuit
             * explicitly here to make the intent obvious to readers).
             *
             * NULL-email users still need their `user_profiles` row synced
             * on every session refresh because downstream FKs (conversations
             * / query_logs / messages) reference `user_profiles.id`. We use
             * a sentinel value for `email_normalized` so the NOT NULL
             * UNIQUE constraint holds (see TD-009 for the nullable rebuild
             * follow-up). The sentinel contains `:` which
             * `isAdminEmailAllowlisted` / `normalizeEmailAddress` will
             * never match any real allowlist entry.
             */
            const hasEmail = Boolean(existing.email)
            const inAllowlist = hasEmail
              ? isAdminEmailAllowlisted(existing.email, allowlist)
              : false
            const adminSource = inAllowlist ? 'allowlist' : 'none'
            const emailNormalized = hasEmail
              ? normalizeEmailAddress(existing.email as string)
              : `__passkey__:${session.userId}`
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
                    },
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
            // See fix-user-profile-id-drift change + TD-044: the synchronizer
            // performs email_normalized-first lookup, app-level children FK
            // migration for stale rows, and env-gated rethrow. Production keeps
            // the conservative "log-and-return" behavior so hook errors never
            // block the user's login.
            await syncUserProfile(
              { db: hubDb, schema, log: authLog },
              {
                userId: session.userId,
                emailNormalized,
                roleSnapshot: finalRole,
                adminSource,
              },
            )
          },
        },
      },
    },
  }
})
