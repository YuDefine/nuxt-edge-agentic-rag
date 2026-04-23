import { useLogger } from 'evlog'

import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import {
  LINK_GOOGLE_FOR_PASSKEY_FIRST_COOKIE_NAME,
  LINK_GOOGLE_FOR_PASSKEY_FIRST_TTL_SECONDS,
  buildGoogleAuthorizationUrl,
  buildLinkGoogleForPasskeyFirstCallbackUrl,
  buildLinkGoogleForPasskeyFirstStateKey,
  createLinkGoogleForPasskeyFirstError,
  createLinkGoogleForPasskeyFirstStateToken,
} from '#server/utils/link-google-for-passkey-first'

export default defineEventHandler(async function linkGoogleForPasskeyFirstInitiator(event) {
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
    operation: 'auth-link-google-for-passkey-first-initiate',
    table: 'user',
    user: { id: userId },
  })

  if (session.user.email !== null && session.user.email !== undefined) {
    throw createLinkGoogleForPasskeyFirstError('INVALID_ENTRY_STATE')
  }

  const runtimeConfig = useRuntimeConfig(event)
  const clientId = runtimeConfig.oauth?.google?.clientId

  if (!clientId) {
    log.error(new Error('missing google oauth client id'), { step: 'resolve-google-client-id' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Google OAuth 尚未設定完成',
    })
  }

  const origin = getRequestURL(event).origin
  const stateToken = createLinkGoogleForPasskeyFirstStateToken()
  const kv = getRequiredKvBinding(event, getKnowledgeRuntimeConfig().bindings.rateLimitKv)

  await kv.put(
    buildLinkGoogleForPasskeyFirstStateKey(stateToken),
    JSON.stringify({
      createdAt: new Date().toISOString(),
      nonce: stateToken,
      redirectOrigin: origin,
      userId,
    }),
    { expirationTtl: LINK_GOOGLE_FOR_PASSKEY_FIRST_TTL_SECONDS },
  )

  setCookie(event, LINK_GOOGLE_FOR_PASSKEY_FIRST_COOKIE_NAME, stateToken, {
    httpOnly: true,
    maxAge: LINK_GOOGLE_FOR_PASSKEY_FIRST_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: true,
  })

  return sendRedirect(
    event,
    buildGoogleAuthorizationUrl({
      clientId,
      redirectUri: buildLinkGoogleForPasskeyFirstCallbackUrl(origin),
      state: stateToken,
    }),
    302,
  )
})
