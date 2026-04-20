/**
 * passkey-authentication — shared translator for WebAuthn / passkey
 * plugin errors into 繁中 copy.
 *
 * `@better-auth/passkey` + browser WebAuthn raise errors with raw English
 * messages (e.g. "The operation is not allowed at this time because the
 * page does not have focus"). Those strings **NEVER** belong in UI — they
 * confuse end-users and leak browser implementation detail. This helper
 * is the single place that maps error code / name / known English
 * fragments to friendly 繁中, with a generic fallback when the mapping
 * is not known.
 *
 * Use this helper for every passkey-related error surface
 * (`PasskeyRegisterDialog`, `DeleteAccountDialog`, `index.vue` login).
 */

type PasskeyErrorShape = {
  code?: string
  message?: string
  status?: number
  name?: string
}

/**
 * Variants:
 *   - `'register'` — passkey registration ceremony (adding / passkey-first)
 *   - `'login'` — sign-in via existing passkey
 *   - `'reauth'` — step-up reauthentication (e.g. before delete)
 */
export type PasskeyErrorVariant = 'register' | 'login' | 'reauth'

function cancelMessage(variant: PasskeyErrorVariant): string {
  switch (variant) {
    case 'register':
      return '註冊流程被取消，請重試'
    case 'login':
      return '登入已取消或逾時，請重試或改用 Google 登入'
    case 'reauth':
      return '重新驗證已取消，請重試'
    default:
      return '操作已取消，請重試'
  }
}

function genericMessage(variant: PasskeyErrorVariant): string {
  switch (variant) {
    case 'register':
      return 'Passkey 註冊失敗，請稍後再試或改用 Google 登入'
    case 'login':
      return 'Passkey 登入失敗，請改用 Google 登入'
    case 'reauth':
      return '重新驗證失敗，請重試'
    default:
      return 'Passkey 操作失敗，請稍後再試'
  }
}

/**
 * Translate a passkey error into 繁中. Never returns the raw `err.message`
 * — if the input matches a known code / name, we return a specific copy,
 * otherwise we fall back to a generic message for the variant.
 */
export function describePasskeyError(err: unknown, variant: PasskeyErrorVariant = 'login'): string {
  if (!err || typeof err !== 'object') {
    return genericMessage(variant)
  }
  const e = err as PasskeyErrorShape

  // Browser WebAuthn DOMException names
  if (e.name === 'NotAllowedError') {
    return cancelMessage(variant)
  }
  if (e.name === 'InvalidStateError') {
    return '此裝置已註冊過 passkey，請改用登入流程'
  }
  if (e.name === 'TimeoutError') {
    return '作業系統未在時限內回應，請重試'
  }
  if (e.name === 'SecurityError') {
    return '瀏覽器拒絕此 passkey 操作，請確認網址與網域一致後再試'
  }

  // Plugin / server error codes
  switch (e.code) {
    case 'AUTH_CANCELLED':
    case 'REGISTRATION_CANCELLED':
    case 'ERROR_CEREMONY_ABORTED':
      return cancelMessage(variant)
    case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED':
    case 'PREVIOUSLY_REGISTERED':
      return '此 passkey 已註冊過，請改用登入'
    case 'YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY':
    case 'PASSKEY_FIRST_NICKNAME_TAKEN':
      return '此暱稱已被使用，請改用其他名稱'
    case 'PASSKEY_FIRST_NICKNAME_REQUIRED':
      return '請先輸入暱稱再建立 Passkey'
    case 'PASSKEY_FIRST_NICKNAME_INVALID':
      return '暱稱格式不符合規則，請重新輸入'
    case 'FAILED_TO_VERIFY_REGISTRATION':
    case 'UNABLE_TO_CREATE_SESSION':
    case 'PASSKEY_FIRST_CREATE_USER_FAILED':
    case 'PASSKEY_FIRST_CREATE_SESSION_FAILED':
    case 'PASSKEY_FIRST_USER_LOOKUP_FAILED':
      return '驗證失敗，請重試或改用 Google 登入'
    case 'ERROR_INVALID_DOMAIN':
    case 'ERROR_INVALID_RP_ID':
      return '瀏覽器網域與 passkey 設定不符，請確認網址後重試'
    case 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT':
    case 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT':
      return '此裝置尚不支援 passkey 驗證，請改用 Google 登入'
    default:
      break
  }

  // Known raw English fragments — these slip through when the plugin
  // wraps a DOMException without a dedicated code.
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
  if (msg.includes('does not have focus')) {
    return '請讓頁面保持在前景後再重試 passkey 驗證'
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return '作業系統未在時限內回應，請重試'
  }
  if (msg.includes('cancel') || msg.includes('aborted')) {
    return cancelMessage(variant)
  }
  if (msg.includes('not supported')) {
    return '此裝置或瀏覽器尚不支援 passkey，請改用 Google 登入'
  }

  return genericMessage(variant)
}
