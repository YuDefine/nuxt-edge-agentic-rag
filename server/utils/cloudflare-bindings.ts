import type { UploadedObjectMetadata } from './staged-upload'

type CloudflareBoundEvent = {
  context: Record<string, unknown> & {
    cloudflare?: {
      env?: Record<string, unknown>
    }
  }
}

interface R2BucketLike {
  head(key: string): Promise<UploadedObjectMetadata | null>
  get(key: string): Promise<{ text(): Promise<string> } | null>
  put(key: string, value: string): Promise<unknown>
}

interface D1PreparedStatementLike {
  all<T>(): Promise<{ results?: T[] }>
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>
  prepare(query: string): D1PreparedStatementLike
}

interface KvBindingLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export function getCloudflareEnv(event: CloudflareBoundEvent) {
  return (
    event.context.cloudflare?.env ??
    (globalThis as { __env__?: Record<string, unknown> }).__env__ ??
    {}
  )
}

export function getRequiredR2BucketBinding(
  event: CloudflareBoundEvent,
  bindingName: string
): R2BucketLike {
  const env = getCloudflareEnv(event)
  const binding = env[bindingName]

  if (!binding || typeof (binding as { head?: unknown }).head !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `Cloudflare R2 binding "${bindingName}" is not available`,
    })
  }

  return binding as R2BucketLike
}

export function getRequiredD1Binding(
  event: CloudflareBoundEvent,
  bindingName: string
): D1DatabaseLike {
  const env = getCloudflareEnv(event)
  const binding = env[bindingName]

  if (!binding || typeof (binding as { prepare?: unknown }).prepare !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `Cloudflare D1 binding "${bindingName}" is not available`,
    })
  }

  return binding as D1DatabaseLike
}

export function getRequiredKvBinding(
  event: CloudflareBoundEvent,
  bindingName: string
): KvBindingLike {
  const env = getCloudflareEnv(event)
  const binding = env[bindingName]

  if (
    !binding ||
    typeof (binding as { get?: unknown }).get !== 'function' ||
    typeof (binding as { put?: unknown }).put !== 'function'
  ) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `Cloudflare KV binding "${bindingName}" is not available`,
    })
  }

  return binding as KvBindingLike
}
