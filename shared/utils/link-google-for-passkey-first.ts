import { assertNever } from './assert-never'

export const LINK_GOOGLE_FOR_PASSKEY_FIRST_CALLBACK_PATH =
  '/api/auth/account/link-google-for-passkey-first/callback'
export const LINK_GOOGLE_FOR_PASSKEY_FIRST_ENTRY_PATH =
  '/api/auth/account/link-google-for-passkey-first'
export const LINK_GOOGLE_FOR_PASSKEY_FIRST_SETTINGS_PATH = '/account/settings'
export const LINK_GOOGLE_FOR_PASSKEY_FIRST_SUCCESS_KEY = 'linked'
export const LINK_GOOGLE_FOR_PASSKEY_FIRST_SUCCESS_VALUE = 'google'
export const LINK_GOOGLE_FOR_PASSKEY_FIRST_ERROR_KEY = 'linkError'

export const LINK_GOOGLE_FOR_PASSKEY_FIRST_ERROR_CODES = [
  'INVALID_ENTRY_STATE',
  'STATE_MISMATCH',
  'STATE_EXPIRED',
  'SESSION_MISMATCH',
  'GOOGLE_TOKEN_EXCHANGE',
  'GOOGLE_ID_TOKEN_INVALID',
  'EMAIL_NOT_VERIFIED',
  'EMAIL_ALREADY_LINKED',
  'DB_WRITE_FAILED',
] as const

export type LinkGoogleForPasskeyFirstErrorCode =
  (typeof LINK_GOOGLE_FOR_PASSKEY_FIRST_ERROR_CODES)[number]

export function isLinkGoogleForPasskeyFirstErrorCode(
  value: unknown,
): value is LinkGoogleForPasskeyFirstErrorCode {
  return (
    typeof value === 'string' &&
    LINK_GOOGLE_FOR_PASSKEY_FIRST_ERROR_CODES.includes(value as LinkGoogleForPasskeyFirstErrorCode)
  )
}

export function getLinkGoogleForPasskeyFirstStatusCode(
  code: LinkGoogleForPasskeyFirstErrorCode,
): 400 | 401 | 409 | 500 | 502 {
  switch (code) {
    case 'INVALID_ENTRY_STATE':
    case 'EMAIL_NOT_VERIFIED':
      return 400
    case 'STATE_MISMATCH':
    case 'STATE_EXPIRED':
    case 'SESSION_MISMATCH':
      return 401
    case 'EMAIL_ALREADY_LINKED':
      return 409
    case 'GOOGLE_TOKEN_EXCHANGE':
    case 'GOOGLE_ID_TOKEN_INVALID':
      return 502
    case 'DB_WRITE_FAILED':
      return 500
    default:
      return assertNever(code, 'getLinkGoogleForPasskeyFirstStatusCode')
  }
}

export function getLinkGoogleForPasskeyFirstMessage(
  code: LinkGoogleForPasskeyFirstErrorCode,
  _input: { email?: string | null } = {},
): string {
  switch (code) {
    case 'INVALID_ENTRY_STATE':
      return '此流程僅限 Passkey-only 帳號。'
    case 'STATE_MISMATCH':
      return '連線已失效，請重試綁定。'
    case 'STATE_EXPIRED':
      return '連線已過期，請重試綁定。'
    case 'SESSION_MISMATCH':
      return '連線已失效，請重新登入後再試。'
    case 'GOOGLE_TOKEN_EXCHANGE':
      return '無法向 Google 驗證，請稍後再試。'
    case 'GOOGLE_ID_TOKEN_INVALID':
      return 'Google 回傳資料無效，請重試。'
    case 'EMAIL_NOT_VERIFIED':
      return '此 Google 帳號尚未驗證 email，請先完成 Google 驗證後再綁定。'
    case 'EMAIL_ALREADY_LINKED':
      return '此 Google 帳號已綁定於另一組帳號。請改用 Google 登入該帳號後新增 Passkey。'
    case 'DB_WRITE_FAILED':
      return '綁定失敗，請稍後再試。'
    default:
      return assertNever(code, 'getLinkGoogleForPasskeyFirstMessage')
  }
}

export function buildLinkGoogleForPasskeyFirstErrorRedirect(
  code: LinkGoogleForPasskeyFirstErrorCode,
  _input: { email?: string | null } = {},
): string {
  const params = new URLSearchParams({
    [LINK_GOOGLE_FOR_PASSKEY_FIRST_ERROR_KEY]: code,
  })

  return `${LINK_GOOGLE_FOR_PASSKEY_FIRST_SETTINGS_PATH}?${params.toString()}`
}

export function buildLinkGoogleForPasskeyFirstSuccessRedirect(): string {
  return `${LINK_GOOGLE_FOR_PASSKEY_FIRST_SETTINGS_PATH}?${LINK_GOOGLE_FOR_PASSKEY_FIRST_SUCCESS_KEY}=${LINK_GOOGLE_FOR_PASSKEY_FIRST_SUCCESS_VALUE}`
}
