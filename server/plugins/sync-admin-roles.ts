import { consola } from 'consola'
import { inArray } from 'drizzle-orm'
import { getRuntimeAdminAccess } from '#server/utils/knowledge-runtime'

const log = consola.withTag('sync-admin-roles')

/**
 * Dev-only plugin: Sync admin roles on first request.
 *
 * Ensures users in ADMIN_EMAIL_ALLOWLIST have role='admin' in DB,
 * so existing sessions reflect correct permissions without re-login.
 *
 * Uses first-request pattern to ensure NuxtHub D1 binding is ready.
 * Only runs in local environment to avoid production overhead.
 */
export default defineNitroPlugin((nitroApp) => {
  const runtimeConfig = useRuntimeConfig()
  const knowledgeEnv = runtimeConfig.knowledge?.environment ?? 'local'

  // Only run in local dev
  if (knowledgeEnv !== 'local') {
    return
  }

  let synced = false

  nitroApp.hooks.hook('request', async () => {
    if (synced) return
    synced = true

    try {
      const { db, schema } = await import('hub:db')

      // Get all users
      const users = await db
        .select({ id: schema.user.id, email: schema.user.email, role: schema.user.role })
        .from(schema.user)

      // Find users whose role needs updating
      const updates: { id: string; expectedRole: string }[] = []

      for (const user of users) {
        if (!user.email) continue

        const shouldBeAdmin = getRuntimeAdminAccess(user.email)
        const expectedRole = shouldBeAdmin ? 'admin' : 'user'

        if (user.role !== expectedRole) {
          updates.push({ id: user.id, expectedRole })
        }
      }

      // Batch update
      if (updates.length > 0) {
        const adminIds = updates.filter((u) => u.expectedRole === 'admin').map((u) => u.id)
        const userIds = updates.filter((u) => u.expectedRole === 'user').map((u) => u.id)

        if (adminIds.length > 0) {
          await db
            .update(schema.user)
            .set({ role: 'admin' })
            .where(inArray(schema.user.id, adminIds))
        }
        if (userIds.length > 0) {
          await db.update(schema.user).set({ role: 'user' }).where(inArray(schema.user.id, userIds))
        }

        log.info(`Updated ${updates.length} user(s) role based on allowlist`)
      }
    } catch (error) {
      log.warn('Skipped:', error)
    }
  })
})
