import { randomBytes, scryptSync } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getRuntimeAdminAccess } from '#server/utils/knowledge-runtime'

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
  const { db, schema } = await import('hub:db')
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
  const { db, schema } = await import('hub:db')

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

export default defineEventHandler(async (event) => {
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

  await ensureCredentialAccount(body.email, password)

  // Try to sign in first (user might already exist)
  try {
    const signInResponse = await auth.api.signInEmail({
      body: {
        email: body.email,
        password,
      },
      asResponse: true,
    })

    // If sign in succeeded, check if we need to update role
    if (signInResponse.ok) {
      const data = await signInResponse.json()

      // Sync role with admin allowlist if needed
      if (data.user && data.user.role !== role) {
        await updateUserRole(data.user.id, role)
      }

      // Copy session cookies to response
      const setCookieHeader = signInResponse.headers.get('set-cookie')
      if (setCookieHeader) {
        appendResponseHeader(event, 'set-cookie', setCookieHeader)
      }

      return {
        success: true,
        action: 'signed_in',
        user: {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role,
        },
      }
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
      },
      asResponse: true,
    })

    if (!signUpResponse.ok) {
      const errorData = await signUpResponse.json().catch(() => ({}))
      throw createError({
        statusCode: signUpResponse.status,
        message: errorData.message || 'Failed to create user',
      })
    }

    const data = await signUpResponse.json()

    // Sync role with admin allowlist
    if (data.user) {
      await updateUserRole(data.user.id, role)
    }

    // Copy session cookies to response
    const setCookieHeader = signUpResponse.headers.get('set-cookie')
    if (setCookieHeader) {
      appendResponseHeader(event, 'set-cookie', setCookieHeader)
    }

    return {
      success: true,
      action: 'created_and_signed_in',
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        role,
      },
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'statusCode' in error) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to create user',
    })
  }
})
