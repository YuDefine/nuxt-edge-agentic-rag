import { createError, defineEventHandler, getRequestHeaders, getRequestURL, readBody } from 'h3'

import {
  handlePasskeyVerifyAuthentication,
  PasskeyVerifyAuthenticationRouteError,
  isPasskeyVerifyAuthenticationEnabled,
} from '../../../utils/passkey-verify-authentication'

export default defineEventHandler(async (event) => {
  if (!isPasskeyVerifyAuthenticationEnabled(useRuntimeConfig(event))) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
    })
  }

  const auth = serverAuth(event)
  const body = await readBody(event)
  const headers = new Headers(getRequestHeaders(event) as HeadersInit)

  try {
    return await handlePasskeyVerifyAuthentication(auth, getRequestURL(event), headers, body)
  } catch (error) {
    if (error instanceof PasskeyVerifyAuthenticationRouteError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.statusMessage,
        message: error.message,
      })
    }

    throw error
  }
})
