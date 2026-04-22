import { createError, defineEventHandler, getRequestHeaders, readBody } from 'h3'

import {
  forwardPasskeyVerifyAuthentication,
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

  return forwardPasskeyVerifyAuthentication(auth, headers, body)
})
