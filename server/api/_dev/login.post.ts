import { randomBytes, scryptSync } from 'node:crypto'
import { useLogger } from 'evlog'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getRuntimeAdminAccess } from '#server/utils/knowledge-runtime'
import { getDrizzleDb } from '#server/utils/database'

/**
 * Development-only login endpoint for testing.
 *
 * Creates a test user if not exists, then signs them in.
 * Role is automatically set based on ADMIN_EMAIL_ALLOWLIST.
 *
 * SECURITY: Only available when NUXT_KNOWLEDGE_ENVIRONMENT=local.
 * Any non-local environment will reject all requests.
 *
 * Usage:
 *   # Create and login as admin (if email is in ADMIN_EMAIL_ALLOWLIST)
 *   curl -X POST http://localhost:3000/api/_dev/login \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"admin@test.local","password":"testpass123"}'
 *
 *   # Create and login as regular user
 *   curl -X POST http://localhost:3000/api/_dev/login \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"user@test.local","password":"testpass123"}'
 */

/**
 * Update user role directly in database.
 * Used to sync role with admin allowlist after login/signup.
 */
async function updateUserRole(userId: string, role: string): Promise<void> {
  const { db, schema } = await getDrizzleDb()
  await db.update(schema.user).set({ role }).where(eq(schema.user.id, userId))
}

function hashCredentialPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const key = scryptSync(password.normalize('NFKC'), salt, 64, {
    N: 16384,
    p: 1,
    r: 16,
    maxmem: 128 * 16384 * 16 * 2,
  })

  return `${salt}:${key.toString('hex')}`
}

async function ensureCredentialAccount(email: string, password: string): Promise<void> {
  const normalizedEmail = email.toLowerCase()
  const { db, schema } = await getDrizzleDb()

  const [existingUser] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, normalizedEmail))
    .limit(1)

  if (!existingUser) {
    return
  }

  const [credentialAccount] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(
      and(eq(schema.account.userId, existingUser.id), eq(schema.account.providerId, 'credential')),
    )
    .limit(1)

  if (credentialAccount) {
    return
  }

  const now = new Date()
  try {
    await db.insert(schema.account).values({
      id: crypto.randomUUID(),
      accountId: existingUser.id,
      providerId: 'credential',
      userId: existingUser.id,
      password: hashCredentialPassword(password),
      createdAt: now,
      updatedAt: now,
    })
  } catch (error) {
    // Tolerate concurrent dev-login races where another request inserted the
    // credential account between the SELECT and INSERT. SQLite raises
    // SQLITE_CONSTRAINT (`UNIQUE constraint failed`) in that case; surface
    // anything else.
    const message = error instanceof Error ? error.message : ''
    if (!/unique constraint/i.test(message)) {
      throw error
    }
  }
}

const bodySchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  name: z.string().min(1).optional(),
})

type DevLoginUser = {
  id: string
  email: string
  name?: string | null
  role?: string | null
}

type DevLoginAuthPayload = {
  user?: DevLoginUser
  message?: string
}

function getAuthPayloadMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('message' in payload)) {
    return ''
  }

  const message = payload.message
  return typeof message === 'string' ? message : ''
}

function isConcurrentSignUpConflict(status: number, payload: unknown): boolean {
  if (status === 409) {
    return true
  }

  return /already exists|unique constraint|failed to create user/i.test(
    getAuthPayloadMessage(payload),
  )
}

async function trySignInEmail(
  auth: ReturnType<typeof serverAuth>,
  email: string,
  password: string,
) {
  return await auth.api.signInEmail({
    body: {
      email,
      password,
    },
    asResponse: true,
  })
}

async function finishSignedInResponse(
  event: Parameters<typeof appendResponseHeader>[0],
  response: Response,
  role: string,
  action: 'signed_in' | 'created_and_signed_in',
  log: {
    error: (error: Error, context?: Record<string, unknown>) => void
  },
) {
  const data = (await response.json()) as DevLoginAuthPayload

  if (data.user && data.user.role !== role) {
    try {
      await updateUserRole(data.user.id, role)
    } catch (error) {
      log.error(error as Error, { step: 'update-user-role' })
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: 'Failed to sync user role',
      })
    }
  }

  const setCookieHeader = response.headers.get('set-cookie')
  if (setCookieHeader) {
    appendResponseHeader(event, 'set-cookie', setCookieHeader)
  }

  return {
    success: true,
    action,
    user: data.user
      ? {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role,
        }
      : undefined,
  }
}

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  // Gate: only allow in local environment
  const runtimeConfig = useRuntimeConfig()
  const knowledgeEnv = runtimeConfig.knowledge?.environment ?? 'local'

  if (knowledgeEnv !== 'local') {
    throw createError({
      statusCode: 403,
      message: 'Dev login is only available in local environment',
    })
  }

  const body = await readValidatedBody(event, bodySchema.parse)
  const password = body.password ?? runtimeConfig.devLoginPassword

  const auth = serverAuth(event)

  // Determine role based on admin allowlist.
  // Non-admin dev accounts default to `'member'` (B16 three-tier canonical
  // value). Legacy `'user'` was retired by migration 0006 — writing it here
  // would pollute the DB with values the rest of the app rejects.
  const isAdmin = getRuntimeAdminAccess(body.email)
  const role = isAdmin ? 'admin' : 'member'
  const displayName = body.name ?? (body.email.split('@')[0] as string)

  try {
    await ensureCredentialAccount(body.email, password)
  } catch (error) {
    log.error(error as Error, { step: 'ensure-credential-account' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Failed to prepare credential account',
    })
  }

  // Try to sign in first (user might already exist)
  try {
    const signInResponse = await trySignInEmail(auth, body.email, password)

    if (signInResponse.ok) {
      return await finishSignedInResponse(event, signInResponse, role, 'signed_in', log)
    }
  } catch {
    // Sign in failed, try to create user
  }

  // User doesn't exist, create them
  try {
    const signUpResponse = await auth.api.signUpEmail({
      body: {
        email: body.email,
        password,
        name: displayName,
        // passkey-authentication: `user.displayName` is a required field
        // declared on `auth.config.ts`. Dev login reuses the OAuth-style
        // display name (first segment of the local-part) so dev seed
        // accounts get a stable, readable nickname.
        displayName,
      },
      asResponse: true,
    })

    if (!signUpResponse.ok) {
      const errorData = (await signUpResponse.json().catch(() => ({}))) as DevLoginAuthPayload

      if (isConcurrentSignUpConflict(signUpResponse.status, errorData)) {
        try {
          const retrySignInResponse = await trySignInEmail(auth, body.email, password)
          if (retrySignInResponse.ok) {
            return await finishSignedInResponse(event, retrySignInResponse, role, 'signed_in', log)
          }
        } catch (retryError) {
          log.error(retryError as Error, { step: 'dev-login-signin-after-conflict' })
        }
      }

      throw createError({
        statusCode: signUpResponse.status,
        message: getAuthPayloadMessage(errorData) || 'Failed to create user',
      })
    }

    return await finishSignedInResponse(event, signUpResponse, role, 'created_and_signed_in', log)
  } catch (error: unknown) {
    if (error instanceof Error && 'statusCode' in error) {
      throw error
    }
    log.error(error as Error, { step: 'dev-login-signup' })
    throw createError({
      statusCode: 500,
      message: 'Failed to create user',
    })
  }
})
