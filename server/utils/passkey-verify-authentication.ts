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

type PasskeyVerifyAuthenticationHandler = (request: Request) => Promise<Response>

interface PasskeyVerifyAuthenticationRouteErrorInput {
  message?: string
  statusCode: number
  statusMessage: string
}

export class PasskeyVerifyAuthenticationRouteError extends Error {
  readonly statusCode: number
  readonly statusMessage: string

  constructor(input: PasskeyVerifyAuthenticationRouteErrorInput) {
    super(input.message ?? input.statusMessage)
    this.name = 'PasskeyVerifyAuthenticationRouteError'
    this.statusCode = input.statusCode
    this.statusMessage = input.statusMessage
  }
}

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
    throw new PasskeyVerifyAuthenticationRouteError({
      statusCode: 400,
      statusMessage: 'Passkey authentication payload invalid',
    })
  }

  const response = (body as { response?: unknown }).response

  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new PasskeyVerifyAuthenticationRouteError({
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
): PasskeyVerifyAuthenticationHandler {
  const handler = (auth as { handler?: unknown }).handler

  if (typeof handler !== 'function') {
    throw new PasskeyVerifyAuthenticationRouteError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Passkey authentication unavailable',
    })
  }

  return handler as PasskeyVerifyAuthenticationHandler
}

export async function forwardPasskeyVerifyAuthentication(
  auth: unknown,
  requestUrl: URL | string,
  headers: Headers,
  body: unknown,
): Promise<Response> {
  const sanitizedBody = parsePasskeyVerifyAuthenticationBody(body)
  const forwardedHeaders = new Headers(headers)
  forwardedHeaders.set('content-type', 'application/json')

  return requirePasskeyVerifyAuthenticationInvoker(auth)(
    new Request(requestUrl, {
      method: 'POST',
      headers: forwardedHeaders,
      body: JSON.stringify(sanitizedBody),
    }),
  )
}
