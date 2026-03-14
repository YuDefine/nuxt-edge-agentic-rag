import {
  isAdminEmailAllowlisted,
  normalizeEmailAddress,
  parseAdminEmailAllowlist,
} from '#shared/schemas/knowledge-runtime'

export function normalizeAllowlistEmail(email: string): string {
  return normalizeEmailAddress(email)
}

export function parseRuntimeAdminAllowlist(input?: string | string[]): string[] {
  return parseAdminEmailAllowlist(input)
}

export function hasRuntimeAdminAccess(
  email: string | null | undefined,
  allowlist: string | string[],
): boolean {
  return isAdminEmailAllowlisted(email, parseRuntimeAdminAllowlist(allowlist))
}
