#!/usr/bin/env -S npx tsx
/**
 * Cleanup legacy per-document normalized-text R2 objects.
 *
 * Background:
 *   pre-B3 sync flow wrote one large object per version at:
 *     normalized/<env>/<documentId>/<versionId>.txt
 *   B3 switched to per-chunk objects at:
 *     normalized-text/<versionId>/<NNNN>.txt
 *   This script removes the legacy `normalized/` prefix so AutoRAG no longer
 *   indexes objects without chunk-level customMetadata. It never touches
 *   `normalized-text/` (new layout) or `staged/` (upload originals).
 *
 * Env vars (auto-read from .env if NUXT_KNOWLEDGE_UPLOADS_* are present):
 *   CF_ACCOUNT_ID          | NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID       | NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY   | NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME         | NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME (fallback: agentic-rag-documents)
 *
 * Usage:
 *   npx tsx scripts/cleanup-legacy-normalized-r2.mts --dry-run
 *   npx tsx scripts/cleanup-legacy-normalized-r2.mts
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'

const LEGACY_PREFIX = 'normalized/'

function loadDotEnv(): Record<string, string> {
  const result: Record<string, string> = {}
  try {
    const raw = readFileSync('.env', 'utf-8')
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!match) continue
      const [, key, rawValue] = match
      if (!key || rawValue === undefined) continue
      const value = rawValue.replace(/^["']|["']$/g, '')
      if (!(key in process.env)) {
        result[key] = value
      }
    }
  } catch {
    // .env 不存在直接跳過
  }
  return result
}

function resolveEnv(): {
  accessKeyId: string
  accountId: string
  bucket: string
  secretAccessKey: string
} {
  const dotenv = loadDotEnv()
  const pick = (primary: string, fallback: string): string =>
    process.env[primary] ?? dotenv[primary] ?? process.env[fallback] ?? dotenv[fallback] ?? ''

  const accountId = pick('CF_ACCOUNT_ID', 'NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID')
  const accessKeyId = pick('R2_ACCESS_KEY_ID', 'NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID')
  const secretAccessKey = pick('R2_SECRET_ACCESS_KEY', 'NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY')
  const bucket =
    pick('R2_BUCKET_NAME', 'NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME') || 'agentic-rag-documents'

  const missing: string[] = []
  if (!accountId) missing.push('CF_ACCOUNT_ID / NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID')
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID / NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID')
  if (!secretAccessKey)
    missing.push('R2_SECRET_ACCESS_KEY / NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY')
  if (missing.length > 0) {
    console.error('[error] 以下環境變數未設定（可放 .env 的 NUXT_KNOWLEDGE_UPLOADS_*）：')
    for (const key of missing) console.error(`  - ${key}`)
    process.exit(1)
  }

  return { accessKeyId, accountId, bucket, secretAccessKey }
}

async function listAll(
  client: S3Client,
  bucket: string
): Promise<Array<{ Key: string; Size: number }>> {
  const objects: Array<{ Key: string; Size: number }> = []
  let continuationToken: string | undefined
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        Prefix: LEGACY_PREFIX,
      })
    )
    for (const entry of response.Contents ?? []) {
      if (entry.Key) objects.push({ Key: entry.Key, Size: entry.Size ?? 0 })
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
  } while (continuationToken)
  return objects
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(prompt)
    return answer.trim() === 'YES'
  } finally {
    rl.close()
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const { accessKeyId, accountId, bucket, secretAccessKey } = resolveEnv()

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`
  const client = new S3Client({
    credentials: { accessKeyId, secretAccessKey },
    endpoint,
    forcePathStyle: true,
    region: 'auto',
  })

  console.log(`=== Bucket: ${bucket}`)
  console.log(`=== Endpoint: ${endpoint}`)
  console.log(`=== Scanning prefix: ${LEGACY_PREFIX}`)

  const objects = await listAll(client, bucket)
  if (objects.length === 0) {
    console.log('legacy prefix 下沒有物件，無需清理。')
    return
  }

  for (const obj of objects) {
    console.log(`  ${obj.Key}  (${obj.Size} bytes)`)
  }
  console.log(`\n共 ${objects.length} 個 legacy 物件。`)

  if (dryRun) {
    console.log('dry-run 模式：不執行實際刪除。')
    return
  }

  const confirmed = await confirm(`\n確認要刪除上述 ${objects.length} 個物件？輸入 YES 繼續：`)
  if (!confirmed) {
    console.log('取消。')
    process.exit(1)
  }

  console.log('=== 批次刪除中 ===')
  for (let i = 0; i < objects.length; i += 1000) {
    const batch = objects.slice(i, i + 1000)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((obj) => ({ Key: obj.Key })) },
      })
    )
    console.log(`已刪除 ${Math.min(i + batch.length, objects.length)} / ${objects.length}`)
  }

  const remaining = await listAll(client, bucket)
  if (remaining.length === 0) {
    console.log('完成：legacy prefix 已清空。新 per-chunk 物件保留在 normalized-text/ prefix。')
  } else {
    console.error(`警告：仍有 ${remaining.length} 個殘留物件，請檢查權限。`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
