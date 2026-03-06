import { z } from 'zod'
import { eq } from 'drizzle-orm'
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

const bodySchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
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
  const auth = serverAuth(event)

  // Determine role based on admin allowlist
  const isAdmin = getRuntimeAdminAccess(body.email)
  const role = isAdmin ? 'admin' : 'user'
  const displayName = body.name ?? (body.email.split('@')[0] as string)

  // Try to sign in first (user might already exist)
  try {
    const signInResponse = await auth.api.signInEmail({
      body: {
        email: body.email,
        password: body.password,
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
        password: body.password,
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
