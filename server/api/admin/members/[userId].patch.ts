import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { recordRoleChange } from '#server/utils/member-role-changes'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { normaliseRole, ROLE_VALUES, type Role } from '#shared/types/auth'
import { isAdminEmailAllowlisted } from '#shared/schemas/knowledge-runtime'

/**
 * B16 §5.2 — Admin role change endpoint.
 *
 * Implements design.md "Admin 無法自降 Admin 的實作" as four hard checks
 * before the write. Checks are ordered to produce the most specific /
 * user-actionable error first:
 *
 *   (1) Self-demotion: `userId === session.user.id` and target !== 'admin'.
 *       → 403 "不可降低自己的 Admin 權限，請從 ADMIN_EMAIL_ALLOWLIST 移除此 email"
 *
 *   (2) Allowlist seed demotion: target user's email is still on the
 *       allowlist and target role !== 'admin'.
 *       → 403 "此使用者為 Admin seed，請先從 ADMIN_EMAIL_ALLOWLIST 移除"
 *
 *   (3) Non-allowlist promotion to admin: target role === 'admin' and
 *       target user's email is NOT on the allowlist.
 *       → 403 "Admin 權限僅由 ADMIN_EMAIL_ALLOWLIST env var 控制，無法由 UI 指派"
 *
 *   (4) Any other role change that would make the target 'admin'
 *       (catch-all for completeness: UI tries to promote Admin without
 *        allowlist even if check (3) was bypassed by a client payload).
 *       → 403 same message as (3).
 *
 * Happy path: target role is `'member'` or `'guest'`, and target is not
 * self / not allowlist seed / is already non-Admin. The update is written
 * + `recordRoleChange` audits the transition atomically (same logical
 * request scope — no DB transaction API in hub:db yet).
 */

const paramsSchema = z.object({
  userId: z.string().min(1),
})

const bodySchema = z.object({
  role: z.enum(ROLE_VALUES),
  reason: z.string().trim().max(500).optional(),
})

function forbidden(message: string): never {
  throw createError({ statusCode: 403, statusMessage: 'Forbidden', message })
}

function notFound(message: string): never {
  throw createError({ statusCode: 404, statusMessage: 'Not Found', message })
}

export default defineEventHandler(async function updateMemberRoleHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)
  const { userId: targetUserId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  log.set({
    operation: 'admin-members-update-role',
    table: 'user',
    user: { id: session.user.id ?? null },
  })

  const runtimeConfig = getKnowledgeRuntimeConfig()
  const allowlist = runtimeConfig.adminEmailAllowlist

  const { db, schema } = await import('hub:db')
  const { eq } = await import('drizzle-orm')

  const [target] = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      role: schema.user.role,
    })
    .from(schema.user)
    .where(eq(schema.user.id, targetUserId))
    .limit(1)

  if (!target) {
    notFound('找不到此使用者')
  }

  const currentRole = normaliseRole(target.role)
  const targetRole: Role = body.role
  const targetIsAllowlisted = isAdminEmailAllowlisted(target.email ?? null, allowlist)
  const isSelf = target.id === (session.user.id ?? null)

  // (1) Self-demotion guard.
  if (isSelf && targetRole !== 'admin') {
    forbidden('不可降低自己的 Admin 權限，請從 ADMIN_EMAIL_ALLOWLIST 移除此 email')
  }

  // (2) Allowlist seed demotion guard.
  if (targetIsAllowlisted && targetRole !== 'admin') {
    forbidden('此使用者為 Admin seed，請先從 ADMIN_EMAIL_ALLOWLIST 移除')
  }

  // (3) / (4) Promotion to admin without allowlist is forbidden, period.
  // The allowlist is the single source of truth for Admin seeding; see
  // design.md "為何不允許 UI 升 Admin".
  if (targetRole === 'admin' && !targetIsAllowlisted) {
    forbidden('Admin 權限僅由 ADMIN_EMAIL_ALLOWLIST env var 控制，無法由 UI 指派')
  }

  // No-op write: don't touch DB / audit, just return the current record.
  if (currentRole === targetRole) {
    return {
      data: {
        id: target.id,
        email: target.email,
        role: currentRole,
        changed: false,
      },
    }
  }

  await db.update(schema.user).set({ role: targetRole }).where(eq(schema.user.id, target.id))

  const audit = await recordRoleChange(
    { db, schema },
    {
      userId: target.id,
      fromRole: currentRole,
      toRole: targetRole,
      changedBy: session.user.id ?? 'unknown-admin',
      reason: body.reason ?? 'admin-ui',
    },
  )

  log.set({
    result: {
      targetUserId: target.id,
      fromRole: currentRole,
      toRole: targetRole,
      auditId: audit.id,
    },
  })

  return {
    data: {
      id: target.id,
      email: target.email,
      role: targetRole,
      changed: true,
      auditId: audit.id,
    },
  }
})
