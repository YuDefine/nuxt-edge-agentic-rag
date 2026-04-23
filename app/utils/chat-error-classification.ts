export type ChatErrorKind =
  | 'abort'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'unknown'

export const STATUS_TO_KIND: Partial<Record<number, ChatErrorKind>> = {
  401: 'unauthorized',
  429: 'rate_limit',
  504: 'timeout',
}

export function readChatErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const obj = error as { statusCode?: unknown; status?: unknown }
  if (typeof obj.statusCode === 'number') return obj.statusCode
  if (typeof obj.status === 'number') return obj.status
  return undefined
}

function isAbortLike(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

export function classifyChatError(error: unknown): ChatErrorKind {
  if (isAbortLike(error)) return 'abort'

  const status = readChatErrorStatus(error)
  if (status !== undefined) {
    const mapped = STATUS_TO_KIND[status]
    if (mapped) return mapped
    if (status >= 500 && status < 600) return 'network'
  }

  if (error instanceof TypeError) return 'network'
  return 'unknown'
}
