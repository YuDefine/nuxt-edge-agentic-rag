import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@libsql/client'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../server/database/migrations', import.meta.url))

function loadMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .toSorted()
}

describe('fresh D1 bootstrap migration stack', () => {
  it('applies every migration on an empty database without missing better-auth tables', async () => {
    const client = createClient({ url: ':memory:' })

    for (const fileName of loadMigrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS_DIR, fileName), 'utf8')
      await expect(client.executeMultiple(sql)).resolves.toBeUndefined()
    }

    const tables = await client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('user', 'account', 'session', 'mcp_tokens', 'passkey', 'member_role_changes')
      ORDER BY name
    `)
    const tableNames = tables.rows.map((row) => String((row as { name: string }).name))

    expect(tableNames).toEqual([
      'account',
      'mcp_tokens',
      'member_role_changes',
      'passkey',
      'session',
      'user',
    ])

    const userColumns = await client.execute(`PRAGMA table_info("user")`)
    const userColumnNames = userColumns.rows.map((row) => String((row as { name: string }).name))
    expect(userColumnNames).toContain('display_name')
    expect(userColumnNames).toContain('role')

    const tokenFks = await client.execute(`PRAGMA foreign_key_list(mcp_tokens)`)
    expect(tokenFks.rows).toHaveLength(1)
    expect((tokenFks.rows[0] as Record<string, unknown>).from).toBe('created_by_user_id')
    expect((tokenFks.rows[0] as Record<string, unknown>).on_delete).toBe('CASCADE')
  })
})
