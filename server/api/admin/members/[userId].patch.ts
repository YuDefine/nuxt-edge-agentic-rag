import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { getDrizzleDb } from '#server/utils/database'
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

/**
 * passkey-authentication §14.3 — request body schema.
 *
 * `.strict()` ensures unknown fields (e.g. a stray `displayName` or
 * `email` in the body) produce a 400 rather than being silently ignored.
 * Admin role changes MUST NOT accept identity fields as input —
 * `display_name` is immutable and `email` is driven by provider links,
 * not admin edits. The strict mode makes that invariant structurally
 * enforced rather than relying on a reviewer to spot the omission.
 */
const bodySchema = z
  .object({
    role: z.enum(ROLE_VALUES),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()

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

  const { db, schema } = await getDrizzleDb()
  const { eq } = await import('drizzle-orm')

  let target
  try {
    ;[target] = await db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        role: schema.user.role,
      })
      .from(schema.user)
      .where(eq(schema.user.id, targetUserId))
      .limit(1)
  } catch (error) {
    log.error(error as Error, { step: 'fetch-target-user' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入使用者資訊，請稍後再試',
    })
  }

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

  // (2.5) passkey-authentication §14.1 — NULL email cannot be admin.
  //
  // The allowlist is email-keyed; a passkey-first user (email = NULL)
  // can never be on it, so admin promotion is impossible. Check (3)/(4)
  // below would also reject this path, but the message is confusingly
  // generic. This check gives the admin UI a precise error: they know
  // to either wait for the user to link Google (which may put them on
  // the allowlist) or to promote them to Member instead.
  if (targetRole === 'admin' && !target.email) {
    forbidden('此使用者沒有 email，無法升為管理員；請先請對方綁定 Google 帳號並加入 allowlist')
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

  let audit
  try {
    await db.update(schema.user).set({ role: targetRole }).where(eq(schema.user.id, target.id))

    audit = await recordRoleChange(
      { db, schema },
      {
        userId: target.id,
        fromRole: currentRole,
        toRole: targetRole,
        changedBy: session.user.id ?? 'unknown-admin',
        reason: body.reason ?? 'admin-ui',
      },
    )
  } catch (error) {
    log.error(error as Error, { step: 'update-user-role-and-audit' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法更新使用者角色，請稍後再試',
    })
  }

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
