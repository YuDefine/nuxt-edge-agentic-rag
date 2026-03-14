import type { H3Event } from 'h3'

import { normaliseRole, type Role } from '#shared/types/auth'
import { assertNever } from '#shared/utils/assert-never'

import { getGuestPolicy } from './guest-policy'
import type { McpAuthContext } from './mcp-middleware'

export class McpRoleGateError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: 'GUEST_ASK_DISABLED' | 'ACCOUNT_PENDING' | 'UNKNOWN_TOKEN_OWNER',
  ) {
    super(message)
    this.name = 'McpRoleGateError'
  }
}

/**
 * Tool names that remain usable for Guests under `browse_only` policy. Anything
 * outside this allowlist (currently only `askKnowledge`) is refused so the
 * browse-only policy translates into "look but don't ask".
 */
const BROWSE_ONLY_ALLOWED_TOOLS = new Set<string>([
  'listCategories',
  'searchKnowledge',
  'getDocumentChunk',
])

interface UserRoleLookup {
  lookupRoleByUserId(userId: string): Promise<Role | null>
}

/**
 * B16 §6.2.b — Evaluate token-creator role × `guest_policy` before a tool
 * handler runs. Must be invoked **after** `runMcpMiddleware` populated
 * `event.context.mcpAuth`.
 *
 * Rules:
 *   - `token.createdByUserId === null` → legacy system seed; treat as admin.
 *     (Tokens created before migration 0006 have no FK; refusing them would
 *     break legacy integrations mid-deploy.)
 *   - `admin` / `member` → pass (no policy lookup).
 *   - `guest`:
 *       - `same_as_member` → pass.
 *       - `browse_only`    → pass only for browse-allowed tools;
 *                             `askKnowledge` throws 403 GUEST_ASK_DISABLED.
 *       - `no_access`      → every tool throws 403 ACCOUNT_PENDING.
 */
export async function gateMcpToolAccess(
  event: H3Event,
  params: {
    auth: McpAuthContext
    toolName: string | undefined
    userRoleLookup: UserRoleLookup
  },
): Promise<void> {
  // `auth.token` may be missing entirely in older test harnesses that stubbed
  // `requireMcpBearerToken` before `token` was part of the auth context.
  // Treat that (and explicit null/undefined on `createdByUserId`) as "system
  // seed" — the same bypass legacy tokens created before migration 0006 get.
  const creatorId = params.auth.token?.createdByUserId
  if (creatorId === null || creatorId === undefined) {
    return
  }

  const role = await params.userRoleLookup.lookupRoleByUserId(creatorId)
  if (role === null) {
    throw new McpRoleGateError('MCP token references an unknown user', 403, 'UNKNOWN_TOKEN_OWNER')
  }

  if (role === 'admin' || role === 'member') {
    return
  }

  // role === 'guest' — policy decides.
  const policy = await getGuestPolicy(event)
  switch (policy) {
    case 'same_as_member':
      return
    case 'browse_only': {
      const toolName = params.toolName ?? ''
      if (BROWSE_ONLY_ALLOWED_TOOLS.has(toolName)) {
        return
      }
      throw new McpRoleGateError('訪客僅可瀏覽公開文件，無法提問', 403, 'GUEST_ASK_DISABLED')
    }
    case 'no_access':
      throw new McpRoleGateError('帳號待管理員審核', 403, 'ACCOUNT_PENDING')
    default:
      return assertNever(policy, 'gateMcpToolAccess.guest_policy')
  }
}

/**
 * Default production lookup: JOIN `user.role` via drizzle. Kept out of the gate
 * function so tests can stub the lookup without touching better-auth state.
 *
 * Returns `null` only when the row is missing; any present `role` column is
 * routed through `normaliseRole` so legacy `'user'` rows map to `'member'`
 * and unknown strings fall back to `'guest'` (least privilege) — same
 * policy as `require-role.ts`.
 */
export function createDefaultUserRoleLookup(): UserRoleLookup {
  return {
    async lookupRoleByUserId(userId: string): Promise<Role | null> {
      const { db, schema } = await import('hub:db')
      const { eq } = await import('drizzle-orm')
      const rows = await db
        .select({ role: schema.user.role })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
        .limit(1)
      if (rows.length === 0) return null
      return normaliseRole(rows[0]?.role)
    },
  }
}
