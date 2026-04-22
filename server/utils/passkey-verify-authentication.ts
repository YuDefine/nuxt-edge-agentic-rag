import { createError } from 'h3'

import {
  createKnowledgeRuntimeConfig,
  type KnowledgeRuntimeConfigInput,
} from '../../shared/schemas/knowledge-runtime'

interface PasskeyVerifyAuthenticationBody {
  response: Record<string, unknown>
}

interface PasskeyVerifyAuthenticationRuntimeConfig {
  knowledge?: KnowledgeRuntimeConfigInput
  passkey?: {
    rpId?: string
    rpName?: string
  }
}

type PasskeyVerifyAuthenticationInvoker = (input: {
  asResponse: true
  body: PasskeyVerifyAuthenticationBody
  headers: Headers
}) => Promise<Response>

export function isPasskeyVerifyAuthenticationEnabled(
  runtimeConfig: PasskeyVerifyAuthenticationRuntimeConfig,
): boolean {
  const knowledge = createKnowledgeRuntimeConfig(runtimeConfig.knowledge)
  const passkeyRpConfig = runtimeConfig.passkey ?? {}

  return (
    knowledge.features.passkey === true && Boolean(passkeyRpConfig.rpId && passkeyRpConfig.rpName)
  )
}

export function parsePasskeyVerifyAuthenticationBody(
  body: unknown,
): PasskeyVerifyAuthenticationBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Passkey authentication payload invalid',
    })
  }

  const response = (body as { response?: unknown }).response

  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Passkey authentication payload invalid',
    })
  }

  return {
    // Materialize a plain top-level record before handing control back
    // to Better Auth. The generic `/api/auth/**` router path is where
    // production currently surfaces the opaque Worker `ownKeys` crash;
    // forwarding a plain record through the direct server API avoids
    // that adapter boundary.
    response: Object.fromEntries(Object.entries(response)),
  }
}

function requirePasskeyVerifyAuthenticationInvoker(
  auth: unknown,
): PasskeyVerifyAuthenticationInvoker {
  const verifyPasskeyAuthentication = (
    auth as {
      api?: {
        verifyPasskeyAuthentication?: unknown
      }
    }
  )?.api?.verifyPasskeyAuthentication

  if (typeof verifyPasskeyAuthentication !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Passkey authentication unavailable',
    })
  }

  return verifyPasskeyAuthentication as PasskeyVerifyAuthenticationInvoker
}

export async function forwardPasskeyVerifyAuthentication(
  auth: unknown,
  headers: Headers,
  body: unknown,
): Promise<Response> {
  return requirePasskeyVerifyAuthenticationInvoker(auth)({
    asResponse: true,
    body: parsePasskeyVerifyAuthenticationBody(body),
    headers,
  })
}
