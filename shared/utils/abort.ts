/**
 * Abort signal helpers shared between browser, Workers, and Node test runtime.
 * `DOMException` is available natively in all three, so no polyfill is needed.
 */

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

export function createAbortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}
