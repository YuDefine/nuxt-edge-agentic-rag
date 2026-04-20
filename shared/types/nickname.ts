/**
 * passkey-authentication / nickname-identity-anchor — Nickname input
 * availability states.
 *
 * Used by:
 *   - `app/components/auth/NicknameInput.vue` (emits `update:status`)
 *   - `app/components/auth/PasskeyRegisterDialog.vue` (gates submit on
 *     `status === 'available'`)
 */
export type NicknameStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error'
