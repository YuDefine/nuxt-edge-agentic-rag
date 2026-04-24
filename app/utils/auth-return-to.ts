// Generic post-login return-to helpers + safe-redirect validator.
//
// Design: openspec/changes/auth-redirect-refactor/design.md
// Capability: openspec/specs/auth-redirect/spec.md
//
// These helpers cover the "unauthenticated user was captured by
// middleware and redirected to /login?redirect=<path>" flow. MCP
// connector authorisation has its own double-handshake bridge in
// `./mcp-connector-return-to.ts` — the two MUST NOT share keys.

const GENERIC_RETURN_TO_KEY = 'auth:return-to'
const MAX_REDIRECT_LENGTH = 2048

function hasSessionStorage(): boolean {
  return typeof sessionStorage !== 'undefined'
}

/**
 * Validate a `?redirect=` query value before navigating to it.
 *
 * Accepts input only when ALL conditions hold:
 * - non-empty string of at most {@link MAX_REDIRECT_LENGTH} (2048) characters
 * - starts with `/`
 * - does NOT start with `//` (blocks protocol-relative URLs)
 * - does NOT match `^[a-z]+:` (blocks any scheme — `http:`, `javascript:`,
 *   `data:`, etc.)
 *
 * Callers MUST fall back to `/` when the function returns `null`; this is
 * the open-redirect defence path.
 *
 * See design decision "Return-To Query Param Validation" for why a
 * bare-prefix validator is preferred over an allowlist or a
 * `URL`-constructor based check.
 */
export function parseSafeRedirect(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_REDIRECT_LENGTH) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  if (/^[a-z]+:/i.test(raw)) return null
  return raw
}

/**
 * Compose the `/login` URL that auth middleware should navigate to when
 * it intercepts an unauthenticated request. Returns:
 * - `null` when the user is already on `/login` — middleware should NOT
 *   redirect to avoid an infinite loop.
 * - `'/login'` (no query) when the origin path is `/` — the root is the
 *   chat page and carries no useful redirect target.
 * - `'/login?redirect=<encoded fullPath>'` otherwise, preserving the
 *   query string the user was trying to reach.
 *
 * Pure function — no side effects. Tested exhaustively so middleware
 * stays a thin wrapper around it.
 */
export function buildLoginRedirectUrl(to: { path: string; fullPath: string }): string | null {
  if (to.path === '/login') return null
  if (to.path === '/') return '/login'
  return `/login?redirect=${encodeURIComponent(to.fullPath)}`
}

function saveReturnTo(key: string, path: string): void {
  if (!hasSessionStorage()) return
  sessionStorage.setItem(key, path)
}

function peekReturnTo(key: string): string | null {
  if (!hasSessionStorage()) return null
  return sessionStorage.getItem(key)
}

function clearReturnTo(key: string): void {
  if (!hasSessionStorage()) return
  sessionStorage.removeItem(key)
}

function consumeReturnTo(key: string): string | null {
  const value = peekReturnTo(key)
  if (value) {
    clearReturnTo(key)
  }
  return value
}

/**
 * Save a generic post-login return-to path. Used when a flow will lose
 * the URL query string across a cross-domain hop (Google OAuth). Passkey
 * / same-origin flows should read `route.query.redirect` directly and
 * NOT call this. No-op during SSR or when sessionStorage is unavailable.
 */
export function saveGenericReturnTo(path: string): void {
  saveReturnTo(GENERIC_RETURN_TO_KEY, path)
}

/** Peek the stored generic return-to path without clearing it. */
export function peekGenericReturnTo(): string | null {
  return peekReturnTo(GENERIC_RETURN_TO_KEY)
}

/**
 * Read-and-clear the stored generic return-to path. The returned value
 * MUST still be revalidated through {@link parseSafeRedirect} before the
 * caller navigates — the stored value may have originated from an
 * untrusted query string before the OAuth hop.
 */
export function consumeGenericReturnTo(): string | null {
  return consumeReturnTo(GENERIC_RETURN_TO_KEY)
}

/** Explicit clear. Rarely needed because `consume` is destructive. */
export function clearGenericReturnTo(): void {
  clearReturnTo(GENERIC_RETURN_TO_KEY)
}
