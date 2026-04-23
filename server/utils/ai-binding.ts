import { getCloudflareEnv } from '#server/utils/cloudflare-bindings'

type CloudflareBoundEvent = Parameters<typeof getCloudflareEnv>[0]

export interface RequireAiBindingInput {
  method: string
  message: string
}

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
