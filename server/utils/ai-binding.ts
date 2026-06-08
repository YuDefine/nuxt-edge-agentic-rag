import { getCloudflareEnv } from '#server/utils/cloudflare-bindings'

type CloudflareBoundEvent = Parameters<typeof getCloudflareEnv>[0]

export interface RequireAiBindingInput {
  method: string
  message: string
}

/**
 * Validates the Workers AI `AI` binding and a specific method on it.
 * Used for `AI.run()` (answer / judge / query rewriter).
 */
export function requireAiBinding<T>(event: CloudflareBoundEvent, input: RequireAiBindingInput): T {
  const binding = getCloudflareEnv(event).AI

  if (!binding || typeof (binding as Record<string, unknown>)[input.method] !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: input.message,
    })
  }

  return binding as T
}

/**
 * [D-ACCESSOR]: Validates the AI Search namespace binding `AI_SEARCH`
 * from `ai_search_namespaces` wrangler config. Checks that `.get` is
 * a function. Workers AI `AI.run()` still goes through `requireAiBinding`.
 */
export function requireAiSearchBinding<T>(event: CloudflareBoundEvent): T {
  const binding = getCloudflareEnv(event).AI_SEARCH

  if (!binding || typeof (binding as Record<string, unknown>).get !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Cloudflare AI Search binding "AI_SEARCH" is not available',
    })
  }

  return binding as T
}
