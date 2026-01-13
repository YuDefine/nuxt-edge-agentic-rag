interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export async function pruneKnowledgeRetentionWindow(input: {
  database: D1DatabaseLike
  now?: Date
  retentionDays?: number
}): Promise<void> {
  const now = input.now ?? new Date()
  const retentionDays = input.retentionDays ?? 180
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = now.toISOString()

  await input.database.prepare('DELETE FROM messages WHERE created_at <= ?').bind(cutoff).run()

  await input.database.prepare('DELETE FROM query_logs WHERE created_at <= ?').bind(cutoff).run()

  await input.database
    .prepare('DELETE FROM citation_records WHERE expires_at <= ?')
    .bind(nowIso)
    .run()

  await input.database
    .prepare(
      [
        'UPDATE mcp_tokens',
        "SET token_hash = 'redacted:' || id,",
        "    name = '[redacted]',",
        "    scopes_json = '[]',",
        "    revoked_reason = COALESCE(revoked_reason, 'retention-expired')",
        'WHERE COALESCE(revoked_at, expires_at, created_at) <= ?',
        "  AND (status = 'revoked' OR status = 'expired' OR expires_at IS NOT NULL)",
      ].join('\n')
    )
    .bind(cutoff)
    .run()
}
