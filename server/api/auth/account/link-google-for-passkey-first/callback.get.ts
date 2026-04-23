import { useLogger } from 'evlog'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { authSchema, getD1Database, getDrizzleDb } from '#server/utils/database'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import {
  LINK_GOOGLE_FOR_PASSKEY_FIRST_COOKIE_NAME,
  buildLinkGoogleForPasskeyFirstCallbackUrl,
  buildLinkGoogleForPasskeyFirstStateKey,
  clearLinkGoogleForPasskeyFirstState,
  parseLinkGoogleForPasskeyFirstStatePayload,
  redirectToLinkGoogleForPasskeyFirstError,
  redirectToLinkGoogleForPasskeyFirstSuccess,
  verifyGoogleIdToken,
} from '#server/utils/link-google-for-passkey-first'

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

const googleTokenResponseSchema = z.object({
  access_token: z.string().optional(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
})

export default defineEventHandler(async function linkGoogleForPasskeyFirstCallback(event) {
  const log = useLogger(event)
  const session = await requireUserSession(event)
  const userId = session.user.id

  if (!userId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: '未登入',
    })
  }

  log.set({
    operation: 'auth-link-google-for-passkey-first-callback',
    table: 'user',
    user: { id: userId },
  })

  if (session.user.email !== null && session.user.email !== undefined) {
    return redirectToLinkGoogleForPasskeyFirstError(event, 'INVALID_ENTRY_STATE')
  }

  let query: { code: string; state: string }
  try {
    query = await getValidatedQuery(event, callbackQuerySchema.parse)
  } catch {
    return redirectToLinkGoogleForPasskeyFirstError(event, 'STATE_MISMATCH')
  }

  const cookieState = getCookie(event, LINK_GOOGLE_FOR_PASSKEY_FIRST_COOKIE_NAME)
  if (!cookieState || cookieState !== query.state) {
    deleteCookie(event, LINK_GOOGLE_FOR_PASSKEY_FIRST_COOKIE_NAME, {
      path: '/',
    })
    return redirectToLinkGoogleForPasskeyFirstError(event, 'STATE_MISMATCH')
  }

  const kv = getRequiredKvBinding(event, getKnowledgeRuntimeConfig().bindings.rateLimitKv)
  const stateKey = buildLinkGoogleForPasskeyFirstStateKey(query.state)
  const rawStatePayload = await kv.get(stateKey)
  await clearLinkGoogleForPasskeyFirstState(kv, query.state)
  deleteCookie(event, LINK_GOOGLE_FOR_PASSKEY_FIRST_COOKIE_NAME, {
    path: '/',
  })

  const statePayload = parseLinkGoogleForPasskeyFirstStatePayload(rawStatePayload)
  if (!statePayload) {
    return redirectToLinkGoogleForPasskeyFirstError(event, 'STATE_EXPIRED')
  }

  if (statePayload.userId !== userId) {
    return redirectToLinkGoogleForPasskeyFirstError(event, 'SESSION_MISMATCH')
  }

  const runtimeConfig = useRuntimeConfig(event)
  const googleConfig = runtimeConfig.oauth?.google

  if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
    log.error(new Error('missing google oauth config'), {
      step: 'resolve-google-config',
    })
    return redirectToLinkGoogleForPasskeyFirstError(event, 'GOOGLE_TOKEN_EXCHANGE')
  }

  let tokenPayload: {
    access_token?: string
    id_token?: string
    refresh_token?: string
    scope?: string
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: googleConfig.clientId,
        client_secret: googleConfig.clientSecret,
        code: query.code,
        grant_type: 'authorization_code',
        redirect_uri: buildLinkGoogleForPasskeyFirstCallbackUrl(statePayload.redirectOrigin),
      }),
    })

    if (!response.ok) {
      log.error(new Error(`google token exchange failed: ${response.status}`), {
        status: response.status,
        step: 'google-token-exchange',
      })
      return redirectToLinkGoogleForPasskeyFirstError(event, 'GOOGLE_TOKEN_EXCHANGE')
    }

    tokenPayload = googleTokenResponseSchema.parse(await response.json())
  } catch (error) {
    log.error(error as Error, { step: 'google-token-exchange' })
    return redirectToLinkGoogleForPasskeyFirstError(event, 'GOOGLE_TOKEN_EXCHANGE')
  }

  const idTokenPayload = await verifyGoogleIdToken(
    tokenPayload.id_token ?? '',
    googleConfig.clientId,
  )

  if (!idTokenPayload) {
    log.error(new Error('google id_token payload is invalid'), {
      step: 'google-id-token-parse',
    })
    return redirectToLinkGoogleForPasskeyFirstError(event, 'GOOGLE_ID_TOKEN_INVALID')
  }

  if (idTokenPayload.email_verified !== true || !idTokenPayload.email) {
    return redirectToLinkGoogleForPasskeyFirstError(event, 'EMAIL_NOT_VERIFIED')
  }

  if (!idTokenPayload.sub) {
    log.error(new Error('google id_token payload missing subject'), {
      step: 'google-id-token-sub',
    })
    return redirectToLinkGoogleForPasskeyFirstError(event, 'GOOGLE_ID_TOKEN_INVALID')
  }
  const googleSubject = idTokenPayload.sub

  const database = await getD1Database()

  try {
    const emailCollision = await database
      .prepare('SELECT id FROM "user" WHERE email = ? AND id != ? LIMIT 1')
      .bind(idTokenPayload.email, userId)
      .first<{ id: string }>()

    if (emailCollision) {
      return redirectToLinkGoogleForPasskeyFirstError(event, 'EMAIL_ALREADY_LINKED')
    }

    const subjectCollision = await database
      .prepare(
        'SELECT userId FROM account WHERE providerId = ? AND accountId = ? AND userId != ? LIMIT 1',
      )
      .bind('google', googleSubject, userId)
      .first<{ userId: string }>()

    if (subjectCollision) {
      return redirectToLinkGoogleForPasskeyFirstError(event, 'EMAIL_ALREADY_LINKED')
    }
  } catch (error) {
    log.error(error as Error, { step: 'check-link-collisions' })
    return redirectToLinkGoogleForPasskeyFirstError(event, 'DB_WRITE_FAILED')
  }

  const nowMs = Date.now()
  const now = new Date(nowMs)

  try {
    const { db, schema } = await getDrizzleDb()
    const userTable = schema.user as typeof authSchema.user
    const accountTable = schema.account as typeof authSchema.account

    await db.transaction(async (tx) => {
      await tx
        .update(userTable)
        .set({
          email: idTokenPayload.email,
          image: idTokenPayload.picture ?? null,
          updatedAt: now,
        })
        .where(eq(userTable.id, userId))

      await tx.insert(accountTable).values({
        id: crypto.randomUUID(),
        accountId: googleSubject,
        providerId: 'google',
        userId,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        scope: null,
        createdAt: now,
        updatedAt: now,
      })
    })
  } catch (error) {
    log.error(error as Error, { step: 'persist-google-link' })
    return redirectToLinkGoogleForPasskeyFirstError(event, 'DB_WRITE_FAILED')
  }

  return redirectToLinkGoogleForPasskeyFirstSuccess(event)
})
