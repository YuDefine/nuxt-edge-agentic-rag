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

function readMigration(fileName: string): string {
  return readFileSync(join(MIGRATIONS_DIR, fileName), 'utf8')
}

async function expectCoreTables(client: ReturnType<typeof createClient>) {
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
}

describe('fresh D1 bootstrap migration stack', () => {
  it('applies every migration on an empty database without missing better-auth tables', async () => {
    const client = createClient({ url: ':memory:' })

    for (const fileName of loadMigrationFiles()) {
      await expect(client.executeMultiple(readMigration(fileName))).resolves.toBeUndefined()
    }

    await expectCoreTables(client)
  })

  it('recovers a staging-style migration ledger drift by applying bootstrap manually before remaining migrations', async () => {
    const client = createClient({ url: ':memory:' })
    const migrationFiles = loadMigrationFiles()
    const [bootstrapFile, ...remainingFiles] = migrationFiles

    await client.executeMultiple(`
      CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      INSERT INTO d1_migrations (name) VALUES ('${bootstrapFile}');
    `)

    await expect(
      client.executeMultiple(readMigration('0002_add_admin_plugin_columns.sql')),
    ).rejects.toThrow(/no such table: user/i)

    await expect(client.executeMultiple(readMigration(bootstrapFile))).resolves.toBeUndefined()

    for (const fileName of remainingFiles) {
      await expect(client.executeMultiple(readMigration(fileName))).resolves.toBeUndefined()
    }

    await expectCoreTables(client)
  })
})
