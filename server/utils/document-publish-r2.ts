import type { H3Event } from 'h3'

import { getRequiredR2Binding } from '#server/utils/cloudflare-bindings'
import { createNormalizedTextR2KeyPrefix } from '#server/utils/document-preprocessing'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'

const NORMALIZED_TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8'

interface R2BucketWithList {
  get(key: string): Promise<{
    customMetadata?: Record<string, string>
    httpMetadata?: { contentType?: string | null }
    text(): Promise<string>
  } | null>
  list(options: {
    cursor?: string
    prefix: string
  }): Promise<{ cursor?: string; objects: Array<{ key: string }>; truncated: boolean }>
  put(
    key: string,
    value: string,
    options: {
      customMetadata?: Record<string, string>
      httpMetadata?: { contentType?: string }
    }
  ): Promise<unknown>
}

export type VersionState = 'current' | 'previous'

export async function rewriteVersionMetadata(
  event: H3Event,
  versionId: string,
  versionState: VersionState
): Promise<void> {
  const bindingName = getKnowledgeRuntimeConfig().bindings.documentsBucket
  const bucket = getRequiredR2Binding(event, bindingName) as unknown as R2BucketWithList
  const prefix = createNormalizedTextR2KeyPrefix(versionId)

  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    for (const obj of page.objects) {
      keys.push(obj.key)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  await Promise.all(
    keys.map(async (key) => {
      const existing = await bucket.get(key)
      if (!existing) return
      if (existing.customMetadata?.version_state === versionState) return

      const body = await existing.text()
      const newMeta = { ...existing.customMetadata, version_state: versionState }
      await bucket.put(key, body, {
        httpMetadata: {
          contentType: existing.httpMetadata?.contentType ?? NORMALIZED_TEXT_CONTENT_TYPE,
        },
        customMetadata: newMeta,
      })
    })
  )
}
