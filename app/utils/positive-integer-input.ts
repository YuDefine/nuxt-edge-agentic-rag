export function normalizePositiveIntegerInputValue(
  value: null | number | string | undefined,
): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && value < 0) return ''

  const raw = String(value).trim()
  if (/[-+.,eE]/.test(raw)) return ''

  return raw.replace(/\D/g, '')
}

export function isBlockedPositiveIntegerInputKey(key: string): boolean {
  return key === '-' || key === '+' || key === '.' || key === ',' || key === 'e' || key === 'E'
}

export function parseOptionalPositiveIntegerInput(value: string): number | undefined {
  if (!value) return undefined

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined

  return parsed
}
