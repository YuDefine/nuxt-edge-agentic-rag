/**
 * Safely parse a JSON string that is expected to hold an array of strings.
 *
 * Returns `[]` on any malformed input — non-array, non-string elements, or
 * unparseable JSON. Used by DB-reading code where a row column is typed
 * `TEXT` but the contract is "JSON array of strings" (e.g. `scopes_json`,
 * `risk_flags_json`, `allowed_access_levels_json`).
 */
export function parseStringArrayJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}
