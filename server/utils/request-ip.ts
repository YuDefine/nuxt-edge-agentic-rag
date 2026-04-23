import type { H3Event } from 'h3'

/**
 * Resolve the client IP for rate limiting. Prefers the Cloudflare-specific
 * header when available, falls back to `x-forwarded-for` handled by h3, and
 * finally returns `'unknown'` so rate-limit keys remain deterministic instead
 * of throwing.
 */
export function resolveClientIp(event: H3Event): string {
  return (
    getHeader(event, 'cf-connecting-ip') ??
    getRequestIP(event, { xForwardedFor: true }) ??
    'unknown'
  )
}
