/**
 * Best-effort extraction of a human-friendly error message from a thrown
 * value. Reads `error.data.message` (server-side `createError({ data })`),
 * `error.statusMessage` (h3-style errors), then `error.message`, falling
 * back to the supplied `fallback` string.
 *
 * Intentionally narrow: any call site that needs to map specific
 * `data.reason` codes to copy should still implement that mapping
 * locally (see `app/composables/useDocumentLifecycle.ts`).
 */
interface ErrorLike {
  data?: { message?: string } | null
  message?: string | null
  statusMessage?: string | null
}

export function getErrorMessage(error: unknown, fallback: string): string {
  const err = error as ErrorLike | null | undefined
  return err?.data?.message ?? err?.statusMessage ?? err?.message ?? fallback
}
