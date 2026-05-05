import { buildDemoSeed, type DemoEnvironment, type DemoSeed } from './demo-seed-data'

export class MCPSessionDurableObject {
  fetch(): Response {
    return new Response('demo seed worker does not serve MCP sessions', { status: 404 })
  }
}

interface Env {
  AI?: {
    autorag: (indexName: string) => {
      search: (request: Record<string, unknown>) => Promise<{
        data?: Array<{
          attributes?: { file?: Record<string, unknown> }
          content?: Array<{ text?: string; type?: string }>
          score?: number
        }>
      }>
    }
  }
  BLOB: R2Bucket
  DB: D1Database
  DEMO_SEED_TOKEN?: string
  NUXT_KNOWLEDGE_AI_SEARCH_INDEX?: string
  NUXT_KNOWLEDGE_ENVIRONMENT?: string
}

type D1Value = null | number | string

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const token = request.headers.get('x-demo-seed-token')
    if (!env.DEMO_SEED_TOKEN) {
      return jsonResponse(
        { error: 'demo seed worker missing DEMO_SEED_TOKEN binding — refusing to write' },
        500,
      )
    }
    if (token !== env.DEMO_SEED_TOKEN) {
      return jsonResponse({ error: 'unauthorized' }, 403)
    }

    const runtimeEnvironment = normalizeEnvironment(env.NUXT_KNOWLEDGE_ENVIRONMENT)
    const body =
      request.method === 'POST'
        ? ((await request.json().catch(() => ({}))) as { dryRun?: boolean; environment?: string })
        : { dryRun: true }
    const requestedEnvironment = normalizeEnvironment(body.environment) ?? runtimeEnvironment
    if (!requestedEnvironment) {
      return jsonResponse({ error: 'missing environment' }, 400)
    }
    if (runtimeEnvironment && requestedEnvironment !== runtimeEnvironment) {
      return jsonResponse(
        {
          error: 'environment mismatch',
          requestedEnvironment,
          runtimeEnvironment,
        },
        400,
      )
    }

    const seed = await buildDemoSeed({ environment: requestedEnvironment })
    if (url.pathname === '/ai-search') {
      return verifyAiSearch(url, env)
    }

    if (request.method !== 'POST' || body.dryRun) {
      return jsonResponse({ dryRun: true, summary: seed.summary })
    }

    const d1 = await applyD1Seed(env.DB, seed)
    const r2 = await applyR2Seed(env.BLOB, seed)
    return jsonResponse({
      dryRun: false,
      d1,
      r2,
      summary: seed.summary,
    })
  },
}

async function verifyAiSearch(url: URL, env: Env): Promise<Response> {
  if (!env.AI || !env.NUXT_KNOWLEDGE_AI_SEARCH_INDEX) {
    return jsonResponse({ error: 'missing AI Search binding or index name' }, 500)
  }

  const query = url.searchParams.get('query') ?? 'PR 和 PO 的差別'
  const accessLevel =
    url.searchParams.get('accessLevel') === 'restricted' ? 'restricted' : 'internal'
  const response = await env.AI.autorag(env.NUXT_KNOWLEDGE_AI_SEARCH_INDEX).search({
    filters: {
      filters: [
        { key: 'status', type: 'eq', value: 'active' },
        { key: 'version_state', type: 'eq', value: 'current' },
        { key: 'access_level', type: 'eq', value: accessLevel },
      ],
      type: 'and',
    },
    max_num_results: 5,
    query,
    ranking_options: { score_threshold: 0.1 },
    rewrite_query: false,
  })

  const chunks = (response.data ?? []).map((entry) => {
    const file = entry.attributes?.file ?? {}
    return {
      accessLevel: readString(file.access_level),
      citationLocator: readString(file.citation_locator),
      documentVersionId: readString(file.document_version_id),
      score: typeof entry.score === 'number' ? entry.score : 0,
      status: readString(file.status),
      text: entry.content?.find((item) => item.type === 'text')?.text ?? '',
      versionState: readString(file.version_state),
    }
  })

  return jsonResponse({
    accessLevel,
    chunks,
    matched: chunks.filter(
      (chunk) =>
        chunk.accessLevel === accessLevel &&
        chunk.citationLocator &&
        chunk.documentVersionId &&
        chunk.status === 'active' &&
        chunk.versionState === 'current',
    ).length,
    query,
  })
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeEnvironment(value: string | undefined): DemoEnvironment | null {
  return value === 'production' || value === 'staging' ? value : null
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: JSON_HEADERS,
    status,
  })
}

async function applyD1Seed(db: D1Database, seed: DemoSeed): Promise<{ statements: number }> {
  const statements: D1PreparedStatement[] = []
  const environment = seed.summary.environment

  statements.push(
    db.prepare('DELETE FROM citation_records WHERE id LIKE ?').bind(`${prefix(environment)}%`),
    db.prepare('DELETE FROM messages WHERE id LIKE ?').bind(`${prefix(environment)}%`),
    db.prepare('DELETE FROM query_logs WHERE id LIKE ?').bind(`${prefix(environment)}%`),
    db.prepare('DELETE FROM conversations WHERE id LIKE ?').bind(`${prefix(environment)}%`),
    db.prepare('DELETE FROM source_chunks WHERE id LIKE ?').bind(`${prefix(environment)}%`),
    db.prepare('DELETE FROM document_versions WHERE id LIKE ?').bind(`${prefix(environment)}%`),
    db.prepare('DELETE FROM documents WHERE id LIKE ?').bind(`${prefix(environment)}%`),
    db.prepare('DELETE FROM mcp_tokens WHERE id LIKE ?').bind(`${prefix(environment)}%`),
    db.prepare('DELETE FROM member_role_changes WHERE id LIKE ?').bind(`${prefix(environment)}%`),
    db
      .prepare('DELETE FROM passkey WHERE id LIKE ? OR userId LIKE ?')
      .bind(`${prefix(environment)}%`, `${prefix(environment)}user-%`),
    db
      .prepare('DELETE FROM session WHERE id LIKE ? OR userId LIKE ?')
      .bind(`${prefix(environment)}%`, `${prefix(environment)}user-%`),
    db
      .prepare('DELETE FROM account WHERE id LIKE ? OR userId LIKE ?')
      .bind(`${prefix(environment)}%`, `${prefix(environment)}user-%`),
    db.prepare('DELETE FROM user_profiles WHERE id LIKE ?').bind(`${prefix(environment)}user-%`),
    db.prepare('DELETE FROM "user" WHERE id LIKE ?').bind(`${prefix(environment)}user-%`),
    db.prepare('DELETE FROM system_settings WHERE key LIKE ?').bind(`demo.${environment}.%`),
  )

  for (const user of seed.users) {
    statements.push(
      insert(
        db,
        '"user"',
        [
          'id',
          'name',
          'email',
          'emailVerified',
          'image',
          'createdAt',
          'updatedAt',
          'role',
          'banned',
          'banReason',
          'banExpires',
          'display_name',
        ],
        [
          user.id,
          user.name,
          user.email,
          user.emailVerified,
          user.image,
          user.createdAt,
          user.updatedAt,
          user.role,
          user.banned,
          user.banReason,
          user.banExpires,
          user.displayName,
        ],
      ),
    )
  }

  for (const profile of seed.userProfiles) {
    statements.push(
      insert(
        db,
        'user_profiles',
        [
          'id',
          'email_normalized',
          'display_name',
          'role_snapshot',
          'admin_source',
          'created_at',
          'updated_at',
        ],
        [
          profile.id,
          profile.emailNormalized,
          profile.displayName,
          profile.roleSnapshot,
          profile.adminSource,
          profile.createdAt,
          profile.updatedAt,
        ],
      ),
    )
  }

  for (const row of seed.accounts) {
    statements.push(
      insert(
        db,
        'account',
        [
          'id',
          'userId',
          'accountId',
          'providerId',
          'accessToken',
          'refreshToken',
          'accessTokenExpiresAt',
          'refreshTokenExpiresAt',
          'scope',
          'password',
          'idToken',
          'createdAt',
          'updatedAt',
        ],
        values(row, [
          'id',
          'userId',
          'accountId',
          'providerId',
          'accessToken',
          'refreshToken',
          'accessTokenExpiresAt',
          'refreshTokenExpiresAt',
          'scope',
          'password',
          'idToken',
          'createdAt',
          'updatedAt',
        ]),
      ),
    )
  }

  for (const row of seed.sessions) {
    statements.push(
      insert(
        db,
        'session',
        ['id', 'userId', 'token', 'expiresAt', 'ipAddress', 'userAgent', 'createdAt', 'updatedAt'],
        values(row, [
          'id',
          'userId',
          'token',
          'expiresAt',
          'ipAddress',
          'userAgent',
          'createdAt',
          'updatedAt',
        ]),
      ),
    )
  }

  for (const row of seed.passkeys) {
    statements.push(
      insert(
        db,
        'passkey',
        [
          'id',
          'name',
          'publicKey',
          'userId',
          'credentialID',
          'counter',
          'deviceType',
          'backedUp',
          'transports',
          'createdAt',
          'aaguid',
        ],
        values(row, [
          'id',
          'name',
          'publicKey',
          'userId',
          'credentialID',
          'counter',
          'deviceType',
          'backedUp',
          'transports',
          'createdAt',
          'aaguid',
        ]),
      ),
    )
  }

  for (const row of seed.systemSettings) {
    if (row.key === 'guest_policy') {
      statements.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO system_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
          )
          .bind(row.key, row.value, row.updated_at, row.updated_by),
      )
    } else {
      statements.push(
        db
          .prepare(
            [
              'INSERT INTO system_settings (key, value, updated_at, updated_by)',
              'VALUES (?, ?, ?, ?)',
              'ON CONFLICT(key) DO UPDATE SET',
              'value = excluded.value,',
              'updated_at = excluded.updated_at,',
              'updated_by = excluded.updated_by',
            ].join(' '),
          )
          .bind(row.key, row.value, row.updated_at, row.updated_by),
      )
    }
  }

  for (const row of seed.memberRoleChanges) {
    statements.push(
      insert(
        db,
        'member_role_changes',
        ['id', 'user_id', 'from_role', 'to_role', 'changed_by', 'reason', 'created_at'],
        values(row, [
          'id',
          'user_id',
          'from_role',
          'to_role',
          'changed_by',
          'reason',
          'created_at',
        ]),
      ),
    )
  }

  for (const token of seed.mcpTokens) {
    statements.push(
      insert(
        db,
        'mcp_tokens',
        [
          'id',
          'token_hash',
          'name',
          'scopes_json',
          'environment',
          'status',
          'expires_at',
          'last_used_at',
          'revoked_at',
          'revoked_reason',
          'created_at',
          'created_by_user_id',
        ],
        [
          token.id,
          token.tokenHash,
          token.name,
          token.scopesJson,
          token.environment,
          token.status,
          token.expiresAt,
          token.lastUsedAt,
          token.revokedAt,
          token.revokedReason,
          token.createdAt,
          token.createdByUserId,
        ],
      ),
    )
  }

  for (const document of seed.documents) {
    statements.push(
      insert(
        db,
        'documents',
        [
          'id',
          'slug',
          'title',
          'category_slug',
          'access_level',
          'status',
          'current_version_id',
          'created_by_user_id',
          'created_at',
          'updated_at',
          'archived_at',
        ],
        [
          document.id,
          document.slug,
          document.title,
          document.categorySlug,
          document.accessLevel,
          document.status,
          document.currentVersionId,
          document.createdByUserId,
          document.createdAt,
          document.updatedAt,
          document.archivedAt,
        ],
      ),
    )
  }

  for (const version of seed.documentVersions) {
    statements.push(
      insert(
        db,
        'document_versions',
        [
          'id',
          'document_id',
          'version_number',
          'source_r2_key',
          'normalized_text_r2_key',
          'metadata_json',
          'smoke_test_queries_json',
          'index_status',
          'sync_status',
          'is_current',
          'published_at',
          'created_at',
          'updated_at',
        ],
        [
          version.id,
          version.documentId,
          version.versionNumber,
          version.sourceR2Key,
          version.normalizedTextR2Key,
          version.metadataJson,
          version.smokeTestQueriesJson,
          version.indexStatus,
          version.syncStatus,
          version.isCurrent ? 1 : 0,
          version.publishedAt,
          version.createdAt,
          version.updatedAt,
        ],
      ),
    )
  }

  for (const chunk of seed.sourceChunks) {
    statements.push(
      insert(
        db,
        'source_chunks',
        [
          'id',
          'document_version_id',
          'chunk_index',
          'chunk_hash',
          'chunk_text',
          'citation_locator',
          'access_level',
          'metadata_json',
          'created_at',
        ],
        [
          chunk.id,
          chunk.documentVersionId,
          chunk.chunkIndex,
          chunk.chunkHash,
          chunk.chunkText,
          chunk.citationLocator,
          chunk.accessLevel,
          chunk.metadataJson,
          chunk.createdAt,
        ],
      ),
    )
  }

  for (const conversation of seed.conversations) {
    statements.push(
      insert(
        db,
        'conversations',
        [
          'id',
          'user_profile_id',
          'access_level',
          'title',
          'created_at',
          'updated_at',
          'deleted_at',
        ],
        [
          conversation.id,
          conversation.userProfileId,
          conversation.accessLevel,
          conversation.title,
          conversation.createdAt,
          conversation.updatedAt,
          conversation.deletedAt,
        ],
      ),
    )
  }

  for (const log of seed.queryLogs) {
    statements.push(
      insert(
        db,
        'query_logs',
        [
          'id',
          'channel',
          'user_profile_id',
          'mcp_token_id',
          'environment',
          'query_redacted_text',
          'risk_flags_json',
          'allowed_access_levels_json',
          'redaction_applied',
          'config_snapshot_version',
          'status',
          'created_at',
          'first_token_latency_ms',
          'completion_latency_ms',
          'retrieval_score',
          'judge_score',
          'decision_path',
          'refusal_reason',
          'workers_ai_runs_json',
          'rewriter_status',
          'rewritten_query',
        ],
        [
          log.id,
          log.channel,
          log.userProfileId,
          log.mcpTokenId,
          log.environment,
          log.queryRedactedText,
          log.riskFlagsJson,
          log.allowedAccessLevelsJson,
          log.redactionApplied ? 1 : 0,
          log.configSnapshotVersion,
          log.status,
          log.createdAt,
          log.firstTokenLatencyMs,
          log.completionLatencyMs,
          log.retrievalScore,
          log.judgeScore,
          log.decisionPath,
          log.refusalReason,
          log.workersAiRunsJson,
          log.rewriterStatus,
          log.rewrittenQuery,
        ],
      ),
    )
  }

  for (const message of seed.messages) {
    statements.push(
      insert(
        db,
        'messages',
        [
          'id',
          'conversation_id',
          'query_log_id',
          'user_profile_id',
          'channel',
          'role',
          'content_redacted',
          'content_text',
          'citations_json',
          'risk_flags_json',
          'redaction_applied',
          'refused',
          'refusal_reason',
          'created_at',
        ],
        [
          message.id,
          message.conversationId,
          message.queryLogId,
          message.userProfileId,
          message.channel,
          message.role,
          message.contentRedacted,
          message.contentText,
          message.citationsJson,
          message.riskFlagsJson,
          message.redactionApplied ? 1 : 0,
          message.refused ? 1 : 0,
          message.refusalReason,
          message.createdAt,
        ],
      ),
    )
  }

  for (const citation of seed.citationRecords) {
    statements.push(
      insert(
        db,
        'citation_records',
        [
          'id',
          'query_log_id',
          'document_version_id',
          'source_chunk_id',
          'citation_locator',
          'chunk_text_snapshot',
          'created_at',
          'expires_at',
        ],
        [
          citation.id,
          citation.queryLogId,
          citation.documentVersionId,
          citation.sourceChunkId,
          citation.citationLocator,
          citation.chunkTextSnapshot,
          citation.createdAt,
          citation.expiresAt,
        ],
      ),
    )
  }

  await runBatches(db, statements)
  return { statements: statements.length }
}

async function applyR2Seed(
  bucket: R2Bucket,
  seed: DemoSeed,
): Promise<{ deletedPrefixes: string[]; objects: number }> {
  const environment = seed.summary.environment
  const deletedPrefixes = [
    `demo-seed/${environment}/`,
    `normalized-text/${prefix(environment)}ver-`,
  ]
  for (const itemPrefix of deletedPrefixes) {
    await deletePrefix(bucket, itemPrefix)
  }
  await runConcurrent(seed.r2Objects, 16, async (object) => {
    await bucket.put(object.key, object.text, {
      customMetadata: object.customMetadata,
      httpMetadata: { contentType: object.contentType },
    })
  })
  return { deletedPrefixes, objects: seed.r2Objects.length }
}

function insert(
  db: D1Database,
  table: string,
  columns: string[],
  rowValues: D1Value[],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    )
    .bind(...rowValues)
}

function values(row: Record<string, string | number | null>, columns: string[]): D1Value[] {
  return columns.map((column) => row[column] ?? null)
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  const batchSize = 80
  for (let index = 0; index < statements.length; index += batchSize) {
    await db.batch(statements.slice(index, index + batchSize))
  }
}

async function deletePrefix(bucket: R2Bucket, itemPrefix: string): Promise<void> {
  let cursor: string | undefined
  do {
    const listed = await bucket.list({ cursor, limit: 1000, prefix: itemPrefix })
    const keys = listed.objects.map((object) => object.key)
    if (keys.length > 0) {
      await bucket.delete(keys)
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += concurrency) {
    await Promise.all(items.slice(index, index + concurrency).map((item) => task(item)))
  }
}

function prefix(environment: DemoEnvironment): string {
  return `demo-${environment}-`
}
