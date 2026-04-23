export type DateInput = Date | string | number | null | undefined

export interface FormatDateTimeOptions {
  fallback?: string
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

export function formatDateTime(value: DateInput, options: FormatDateTimeOptions = {}): string {
  const { fallback = '—' } = options
  const d = toDate(value)
  if (!d) return fallback
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function formatShortDateTime(value: DateInput, options: FormatDateTimeOptions = {}): string {
  const { fallback = '—' } = options
  const d = toDate(value)
  if (!d) return fallback
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function formatTimeShort(value: DateInput, options: FormatDateTimeOptions = {}): string {
  const { fallback = '—' } = options
  const d = toDate(value)
  if (!d) return fallback
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
