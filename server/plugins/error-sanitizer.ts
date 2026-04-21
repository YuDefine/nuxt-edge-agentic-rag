import { consola } from 'consola'

/**
 * Global error sanitizer — last line of defence against sensitive error
 * surface leaking into HTTP responses.
 *
 * The primary guard is per-handler try/catch (see
 * `.claude/agents/references/project-review-rules.md` § 錯誤訊息洩漏防護).
 * This plugin catches anything that slips through: drizzle/libsql errors
 * whose `message` embeds the failed SQL, uncaught DB exceptions, H3
 * errors carrying raw data payloads, etc.
 *
 * Behaviour:
 *   - Full original error is logged server-side via consola with tag
 *     `error-sanitizer` so evlog drain still captures stack + query.
 *   - Before the error reaches the response writer, `message` / `stack`
 *     are stripped / replaced if they match sensitive patterns.
 *   - `data` is dropped if it looks like a raw Error or carries a
 *     `stack` / `query` key.
 */

const log = consola.withTag('error-sanitizer')

// Patterns that indicate sensitive server-side detail leaked into the
// error message. Kept conservative — only match things that cannot be
// user-friendly copy.
const SENSITIVE_PATTERNS = [
  /Failed query:/i,
  /\bselect\s+.*\s+from\s+/i,
  /\binsert\s+into\s+/i,
  /\bupdate\s+.*\s+set\s+/i,
  /\bdelete\s+from\s+/i,
  /SQLITE_/i,
  /SQLite3::/i,
  /node_modules\//i,
  /\/Users\//,
  /at\s+\w+\s+\(/,
]

const GENERIC_MESSAGE = '伺服器暫時無法處理此請求，請稍後再試'

function looksSensitive(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return SENSITIVE_PATTERNS.some((rx) => rx.test(value))
}

function sanitizeError(error: unknown): void {
  if (!error || typeof error !== 'object') return
  const err = error as {
    message?: unknown
    stack?: unknown
    statusMessage?: unknown
    data?: unknown
  }

  const original = {
    message: typeof err.message === 'string' ? err.message : undefined,
    statusMessage: typeof err.statusMessage === 'string' ? err.statusMessage : undefined,
    stack: typeof err.stack === 'string' ? err.stack : undefined,
    data: err.data,
  }

  if (looksSensitive(original.message)) {
    err.message = GENERIC_MESSAGE
  }
  if (looksSensitive(original.statusMessage)) {
    err.statusMessage = 'Internal Server Error'
  }
  // Never let the stack string reach the response body — H3 strips it in
  // production but in dev mode it is reflected. Clearing here ensures
  // consistent behaviour across environments.
  err.stack = undefined

  // Drop any `data` payload that looks like a raw error or carries
  // server-side internals. Allow plain objects that don't include
  // stack/query/internal fields.
  if (err.data && typeof err.data === 'object') {
    const d = err.data as Record<string, unknown>
    if (
      'stack' in d ||
      'query' in d ||
      'params' in d ||
      d instanceof Error ||
      looksSensitive(typeof d.message === 'string' ? d.message : undefined)
    ) {
      err.data = undefined
    }
  }

  // Log the original for server-side debugging even after sanitising the
  // response-bound copy.
  if (original.message || original.stack) {
    log.error('sanitised error before response', {
      originalMessage: original.message,
      originalStatusMessage: original.statusMessage,
      hasStack: Boolean(original.stack),
      hadData: typeof original.data !== 'undefined',
    })
  }
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error) => {
    sanitizeError(error)
  })

  // The `beforeResponse` hook fires after an error is converted to a
  // response object; mutating the response body here is the last window
  // before bytes go out.
  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    const body = (response as { body?: unknown }).body
    if (!body || typeof body !== 'object') return
    const b = body as Record<string, unknown>
    if (looksSensitive(typeof b.message === 'string' ? b.message : undefined)) {
      b.message = GENERIC_MESSAGE
    }
    if (looksSensitive(typeof b.statusMessage === 'string' ? b.statusMessage : undefined)) {
      b.statusMessage = 'Internal Server Error'
    }
    if (Array.isArray(b.stack)) b.stack = undefined
    if (typeof b.stack === 'string') b.stack = undefined
    if (b.data && typeof b.data === 'object') {
      const d = b.data as Record<string, unknown>
      if ('stack' in d || 'query' in d || 'params' in d) {
        b.data = undefined
      }
    }
  })
})
