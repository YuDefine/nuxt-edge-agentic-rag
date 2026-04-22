import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { parseCookies, serializeSignedCookie } from 'better-call'
import { consola } from 'consola'

import {
  createKnowledgeRuntimeConfig,
  type KnowledgeRuntimeConfigInput,
} from '../../shared/schemas/knowledge-runtime'
import { serializeBetterAuthLogArg } from './better-auth-safe-logger'

interface PasskeyVerifyAuthenticationBody {
  response: AuthenticationResponsePayload
}

interface PasskeyVerifyAuthenticationRuntimeConfig {
  knowledge?: KnowledgeRuntimeConfigInput
  passkey?: {
    rpId?: string
    rpName?: string
  }
}

interface AuthenticationResponsePayload {
  clientExtensionResults?: Record<string, unknown>
  id: string
  rawId?: string
  type?: 'public-key'
  response: {
    authenticatorData: string
    clientDataJSON: string
    signature: string
    userHandle?: string | null
  }
}

interface PasskeyPluginOptions {
  advanced?: {
    webAuthnChallengeCookie?: string
  }
  authentication?: {
    afterVerification?: (...args: unknown[]) => unknown
  }
  origin?: string | string[] | null
  rpID?: string
}

interface BetterAuthCookieDefinition {
  attributes: BetterAuthCookieAttributes
  name: string
}

interface BetterAuthCookieAttributes {
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  partitioned?: boolean
  path?: string
  prefix?: 'host' | 'secure'
  sameSite?: 'lax' | 'none' | 'strict'
  secure?: boolean
}

interface BetterAuthPasskeyRecord {
  counter: number
  credentialID: string
  id: string
  publicKey: string
  transports?: string | null
  userId: string
}

interface BetterAuthSessionRecord {
  createdAt?: Date | string
  expiresAt?: Date | string
  id?: string
  ipAddress?: string | null
  token: string
  updatedAt?: Date | string
  userAgent?: string | null
  userId: string
}

interface BetterAuthUserRecord {
  banExpires?: Date | string | null
  banReason?: string | null
  banned?: boolean
  createdAt?: Date | string
  displayName?: string | null
  email?: string | null
  emailVerified?: boolean
  id: string
  image?: string | null
  isAnonymous?: boolean
  name?: string | null
  phoneNumber?: string | null
  phoneNumberVerified?: boolean
  role?: string | null
  twoFactorEnabled?: boolean
  updatedAt?: Date | string
  username?: string | null
}

interface BetterAuthVerifyContext {
  adapter: {
    findOne: (input: {
      model: string
      where: Array<{ field: string; value: string }>
    }) => Promise<unknown>
    update: (input: {
      model: string
      update: { counter: number }
      where: Array<{ field: string; value: string }>
    }) => Promise<unknown>
  }
  authCookies: {
    dontRememberToken: BetterAuthCookieDefinition
    sessionToken: BetterAuthCookieDefinition
  }
  createAuthCookie: (name: string) => BetterAuthCookieDefinition
  internalAdapter: {
    createSession: (userId: string) => Promise<unknown>
    deleteVerificationByIdentifier: (identifier: string) => Promise<unknown>
    findUserById: (userId: string) => Promise<unknown>
    findVerificationValue: (identifier: string) => Promise<{ value: string } | null>
  }
  secret: string
  sessionConfig: {
    expiresIn: number
  }
}

interface BetterAuthInstanceLike {
  $context?: Promise<unknown> | unknown
  options?: {
    plugins?: Array<{ id?: string; options?: PasskeyPluginOptions }>
  }
}

type PasskeyVerificationCredential = Parameters<
  typeof verifyAuthenticationResponse
>[0]['credential']

const passkeyVerifyAuthLog = consola.withTag('passkey-verify-authentication')

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
    response: response as AuthenticationResponsePayload,
  }
}

function readRecordProperty<T>(record: unknown, key: string): T | undefined {
  if (!record || (typeof record !== 'object' && typeof record !== 'function')) return undefined

  try {
    return (record as Record<string, T>)[key]
  } catch {
    return undefined
  }
}

function requireStringProperty(record: unknown, key: string, label: string): string {
  const value = readRecordProperty<string>(record, key)
  if (typeof value === 'string' && value.length > 0) return value

  throw new PasskeyVerifyAuthenticationRouteError({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    message: `${label} unavailable`,
  })
}

function requireNumberProperty(record: unknown, key: string, label: string): number {
  const value = readRecordProperty<number>(record, key)
  if (typeof value === 'number' && Number.isFinite(value)) return value

  throw new PasskeyVerifyAuthenticationRouteError({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    message: `${label} unavailable`,
  })
}

function toOptionalResponseField(record: unknown, key: string): unknown {
  const value = readRecordProperty<unknown>(record, key)
  return value === undefined ? undefined : value
}

function logPasskeyVerifyAuthenticationFailure(stage: string, error: unknown): void {
  passkeyVerifyAuthLog.error(
    `[passkey verify-authentication] stage=${stage} ${serializeBetterAuthLogArg(error)}`,
  )
}

function createPasskeyRouteError(
  statusCode: number,
  statusMessage: string,
  message = statusMessage,
): PasskeyVerifyAuthenticationRouteError {
  return new PasskeyVerifyAuthenticationRouteError({
    message,
    statusCode,
    statusMessage,
  })
}

async function requireVerifyContext(auth: unknown): Promise<BetterAuthVerifyContext> {
  const context = await (auth as BetterAuthInstanceLike).$context

  if (
    !context ||
    typeof context !== 'object' ||
    typeof readRecordProperty<unknown>(context, 'adapter') !== 'object' ||
    typeof readRecordProperty<unknown>(context, 'internalAdapter') !== 'object' ||
    typeof readRecordProperty<unknown>(context, 'createAuthCookie') !== 'function'
  ) {
    throw new PasskeyVerifyAuthenticationRouteError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Passkey authentication unavailable',
    })
  }

  return context as BetterAuthVerifyContext
}

function requirePasskeyPluginOptions(auth: unknown): PasskeyPluginOptions {
  const plugins = (auth as BetterAuthInstanceLike).options?.plugins ?? []
  const passkeyPlugin = plugins.find((plugin) => plugin?.id === 'passkey')

  if (!passkeyPlugin?.options) {
    throw new PasskeyVerifyAuthenticationRouteError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Passkey authentication unavailable',
    })
  }

  return passkeyPlugin.options
}

function resolveExpectedOrigin(
  passkeyOptions: PasskeyPluginOptions,
  requestUrl: URL | string,
  headers: Headers,
): string | string[] {
  if (Array.isArray(passkeyOptions.origin) && passkeyOptions.origin.length > 0) {
    return passkeyOptions.origin
  }

  if (typeof passkeyOptions.origin === 'string' && passkeyOptions.origin.length > 0) {
    return passkeyOptions.origin
  }

  const originHeader = headers.get('origin')
  if (originHeader && originHeader.length > 0) return originHeader

  const url = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl
  if (url.origin && url.origin.length > 0) return url.origin

  throw createPasskeyRouteError(400, 'Passkey authentication payload invalid', 'origin missing')
}

function resolvePasskeyChallengeCookieName(
  context: BetterAuthVerifyContext,
  passkeyOptions: PasskeyPluginOptions,
): string {
  return context.createAuthCookie(
    passkeyOptions.advanced?.webAuthnChallengeCookie ?? 'better-auth-passkey',
  ).name
}

async function importCookieSecret(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  )
}

async function verifySignedCookieValue(
  cookieValue: string,
  secret: string,
): Promise<string | null> {
  const signatureSeparator = cookieValue.lastIndexOf('.')
  if (signatureSeparator <= 0) return null

  const unsignedValue = cookieValue.slice(0, signatureSeparator)
  const base64Signature = cookieValue.slice(signatureSeparator + 1)

  try {
    const key = await importCookieSecret(secret)
    const signatureBinary = atob(base64Signature)
    const signature = Uint8Array.from(signatureBinary, (character) => character.charCodeAt(0))
    const verified = await crypto.subtle.verify(
      { hash: 'SHA-256', name: 'HMAC' },
      key,
      signature,
      new TextEncoder().encode(unsignedValue),
    )

    return verified ? unsignedValue : null
  } catch {
    return null
  }
}

async function getVerifiedSignedCookie(
  headers: Headers,
  cookieName: string,
  secret: string,
): Promise<string | null> {
  const cookieHeader = headers.get('cookie')
  if (!cookieHeader) return null

  const cookieValue = parseCookies(cookieHeader).get(cookieName)
  if (!cookieValue) return null

  return verifySignedCookieValue(cookieValue, secret)
}

async function createSessionCookieHeader(
  cookieDefinition: BetterAuthCookieDefinition,
  secret: string,
  token: string,
  maxAge?: number,
): Promise<string> {
  return serializeSignedCookie(cookieDefinition.name, token, secret, {
    ...cookieDefinition.attributes,
    ...(maxAge === undefined ? {} : { maxAge }),
  })
}

function toResponseSessionRecord(session: unknown): BetterAuthSessionRecord {
  return {
    createdAt: toOptionalResponseField(session, 'createdAt') as Date | string | undefined,
    expiresAt: toOptionalResponseField(session, 'expiresAt') as Date | string | undefined,
    id: toOptionalResponseField(session, 'id') as string | undefined,
    ...(toOptionalResponseField(session, 'ipAddress') !== undefined
      ? { ipAddress: toOptionalResponseField(session, 'ipAddress') as string | null }
      : {}),
    token: requireStringProperty(session, 'token', 'session token'),
    updatedAt: toOptionalResponseField(session, 'updatedAt') as Date | string | undefined,
    ...(toOptionalResponseField(session, 'userAgent') !== undefined
      ? { userAgent: toOptionalResponseField(session, 'userAgent') as string | null }
      : {}),
    userId: requireStringProperty(session, 'userId', 'session user'),
  }
}

function toResponseUserRecord(user: unknown): BetterAuthUserRecord {
  return {
    ...(toOptionalResponseField(user, 'banExpires') !== undefined
      ? { banExpires: toOptionalResponseField(user, 'banExpires') as Date | string | null }
      : {}),
    ...(toOptionalResponseField(user, 'banReason') !== undefined
      ? { banReason: toOptionalResponseField(user, 'banReason') as string | null }
      : {}),
    ...(toOptionalResponseField(user, 'banned') !== undefined
      ? { banned: toOptionalResponseField(user, 'banned') as boolean }
      : {}),
    createdAt: toOptionalResponseField(user, 'createdAt') as Date | string | undefined,
    ...(toOptionalResponseField(user, 'displayName') !== undefined
      ? { displayName: toOptionalResponseField(user, 'displayName') as string | null }
      : {}),
    ...(toOptionalResponseField(user, 'email') !== undefined
      ? { email: toOptionalResponseField(user, 'email') as string | null }
      : {}),
    ...(toOptionalResponseField(user, 'emailVerified') !== undefined
      ? { emailVerified: toOptionalResponseField(user, 'emailVerified') as boolean }
      : {}),
    id: requireStringProperty(user, 'id', 'user'),
    ...(toOptionalResponseField(user, 'image') !== undefined
      ? { image: toOptionalResponseField(user, 'image') as string | null }
      : {}),
    ...(toOptionalResponseField(user, 'isAnonymous') !== undefined
      ? { isAnonymous: toOptionalResponseField(user, 'isAnonymous') as boolean }
      : {}),
    ...(toOptionalResponseField(user, 'name') !== undefined
      ? { name: toOptionalResponseField(user, 'name') as string | null }
      : {}),
    ...(toOptionalResponseField(user, 'phoneNumber') !== undefined
      ? { phoneNumber: toOptionalResponseField(user, 'phoneNumber') as string | null }
      : {}),
    ...(toOptionalResponseField(user, 'phoneNumberVerified') !== undefined
      ? { phoneNumberVerified: toOptionalResponseField(user, 'phoneNumberVerified') as boolean }
      : {}),
    ...(toOptionalResponseField(user, 'role') !== undefined
      ? { role: toOptionalResponseField(user, 'role') as string | null }
      : {}),
    ...(toOptionalResponseField(user, 'twoFactorEnabled') !== undefined
      ? { twoFactorEnabled: toOptionalResponseField(user, 'twoFactorEnabled') as boolean }
      : {}),
    updatedAt: toOptionalResponseField(user, 'updatedAt') as Date | string | undefined,
    ...(toOptionalResponseField(user, 'username') !== undefined
      ? { username: toOptionalResponseField(user, 'username') as string | null }
      : {}),
  }
}

export async function handlePasskeyVerifyAuthentication(
  auth: unknown,
  requestUrl: URL | string,
  headers: Headers,
  body: unknown,
): Promise<Response> {
  const sanitizedBody = parsePasskeyVerifyAuthenticationBody(body)
  const context = await requireVerifyContext(auth)
  const passkeyOptions = requirePasskeyPluginOptions(auth)
  const verificationToken = await getVerifiedSignedCookie(
    headers,
    resolvePasskeyChallengeCookieName(context, passkeyOptions),
    context.secret,
  )

  if (!verificationToken) {
    throw createPasskeyRouteError(
      400,
      'Passkey authentication payload invalid',
      'challenge missing',
    )
  }

  const verificationChallenge =
    await context.internalAdapter.findVerificationValue(verificationToken)
  if (!verificationChallenge) {
    throw createPasskeyRouteError(
      400,
      'Passkey authentication payload invalid',
      'challenge missing',
    )
  }

  const expectedChallenge = (() => {
    try {
      const parsed = JSON.parse(verificationChallenge.value) as { expectedChallenge?: unknown }
      if (typeof parsed.expectedChallenge === 'string' && parsed.expectedChallenge.length > 0) {
        return parsed.expectedChallenge
      }
    } catch (error) {
      logPasskeyVerifyAuthenticationFailure('parse-challenge', error)
    }

    throw createPasskeyRouteError(
      400,
      'Passkey authentication payload invalid',
      'challenge invalid',
    )
  })()

  const passkeyRecord = await context.adapter.findOne({
    model: 'passkey',
    where: [
      {
        field: 'credentialID',
        value: sanitizedBody.response.id,
      },
    ],
  })

  if (!passkeyRecord) {
    throw createPasskeyRouteError(401, 'Unauthorized', 'passkey not found')
  }

  const expectedOrigin = resolveExpectedOrigin(passkeyOptions, requestUrl, headers)
  const expectedRpId = passkeyOptions.rpID

  if (!expectedRpId) {
    throw createPasskeyRouteError(503, 'Service Unavailable', 'Passkey RP config unavailable')
  }

  const normalizedPasskey: BetterAuthPasskeyRecord = {
    counter: requireNumberProperty(passkeyRecord, 'counter', 'passkey counter'),
    credentialID: requireStringProperty(passkeyRecord, 'credentialID', 'passkey credential'),
    id: requireStringProperty(passkeyRecord, 'id', 'passkey id'),
    publicKey: requireStringProperty(passkeyRecord, 'publicKey', 'passkey public key'),
    transports:
      typeof readRecordProperty<string | null>(passkeyRecord, 'transports') === 'string'
        ? readRecordProperty<string | null>(passkeyRecord, 'transports')
        : undefined,
    userId: requireStringProperty(passkeyRecord, 'userId', 'passkey user'),
  }

  let verification
  try {
    const transports = normalizedPasskey.transports?.split(
      ',',
    ) as PasskeyVerificationCredential['transports']

    verification = await verifyAuthenticationResponse({
      credential: {
        counter: normalizedPasskey.counter,
        id: normalizedPasskey.credentialID,
        publicKey: Buffer.from(normalizedPasskey.publicKey, 'base64'),
        transports,
      },
      expectedChallenge,
      expectedOrigin,
      expectedRPID: expectedRpId,
      requireUserVerification: false,
      response: {
        clientExtensionResults: sanitizedBody.response.clientExtensionResults ?? {},
        id: sanitizedBody.response.id,
        rawId: sanitizedBody.response.rawId ?? sanitizedBody.response.id,
        response: {
          authenticatorData: sanitizedBody.response.response.authenticatorData,
          clientDataJSON: sanitizedBody.response.response.clientDataJSON,
          signature: sanitizedBody.response.response.signature,
          ...(sanitizedBody.response.response.userHandle
            ? { userHandle: sanitizedBody.response.response.userHandle }
            : {}),
        },
        type: sanitizedBody.response.type ?? 'public-key',
      },
    })
  } catch (error) {
    logPasskeyVerifyAuthenticationFailure('webauthn-verify', error)
    throw createPasskeyRouteError(400, 'Passkey authentication failed')
  }

  if (!verification.verified) {
    throw createPasskeyRouteError(400, 'Passkey authentication failed')
  }

  try {
    await context.adapter.update({
      model: 'passkey',
      update: { counter: verification.authenticationInfo.newCounter },
      where: [
        {
          field: 'id',
          value: normalizedPasskey.id,
        },
      ],
    })
  } catch (error) {
    logPasskeyVerifyAuthenticationFailure('update-passkey-counter', error)
    throw createPasskeyRouteError(500, 'Internal Server Error', 'Unable to update passkey counter')
  }

  const sessionRecord = await context.internalAdapter.createSession(normalizedPasskey.userId)
  if (!sessionRecord) {
    throw createPasskeyRouteError(500, 'Internal Server Error', 'Unable to create session')
  }

  const userRecord = await context.internalAdapter.findUserById(normalizedPasskey.userId)
  if (!userRecord) {
    throw createPasskeyRouteError(500, 'Internal Server Error', 'User not found')
  }

  const dontRememberMe = Boolean(
    await getVerifiedSignedCookie(
      headers,
      context.authCookies.dontRememberToken.name,
      context.secret,
    ),
  )

  try {
    await context.internalAdapter.deleteVerificationByIdentifier(verificationToken)
  } catch (error) {
    logPasskeyVerifyAuthenticationFailure('delete-challenge', error)
    throw createPasskeyRouteError(500, 'Internal Server Error', 'Unable to clear passkey challenge')
  }

  const responseHeaders = new Headers({
    'content-type': 'application/json; charset=utf-8',
  })
  responseHeaders.append(
    'set-cookie',
    await createSessionCookieHeader(
      context.authCookies.sessionToken,
      context.secret,
      requireStringProperty(sessionRecord, 'token', 'session token'),
      dontRememberMe ? undefined : context.sessionConfig.expiresIn,
    ),
  )

  if (dontRememberMe) {
    responseHeaders.append(
      'set-cookie',
      await createSessionCookieHeader(
        context.authCookies.dontRememberToken,
        context.secret,
        'true',
      ),
    )
  }

  return new Response(
    JSON.stringify({
      session: toResponseSessionRecord(sessionRecord),
      user: toResponseUserRecord(userRecord),
    }),
    {
      headers: responseHeaders,
      status: 200,
    },
  )
}
