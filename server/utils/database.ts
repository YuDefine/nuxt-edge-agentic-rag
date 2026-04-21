/**
 * Database utilities for accessing D1 via hub:db
 *
 * NuxtHub provides Drizzle ORM via `hub:db`. For stores that need raw D1 API,
 * use `getD1Database()` to get the underlying D1 client.
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  all<T>(): Promise<{ results?: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>
  prepare(query: string): D1PreparedStatementLike
}

const authSchema = {
  user: sqliteTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),
    image: text('image'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
    role: text('role'),
    banned: integer('banned', { mode: 'boolean' }),
    banReason: text('banReason'),
    banExpires: integer('banExpires', { mode: 'timestamp_ms' }),
    display_name: text('display_name').notNull(),
  }),
  account: sqliteTable(
    'account',
    {
      id: text('id').primaryKey(),
      accountId: text('accountId').notNull(),
      providerId: text('providerId').notNull(),
      userId: text('userId').notNull(),
      accessToken: text('accessToken'),
      refreshToken: text('refreshToken'),
      idToken: text('idToken'),
      accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
      refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
      scope: text('scope'),
      password: text('password'),
      createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
      updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
    },
    (table) => [index('account_userId_idx').on(table.userId)],
  ),
}

type HubDbModuleLike = Awaited<ReturnType<typeof importHubDb>>

type DrizzleSchema = HubDbModuleLike['schema'] & typeof authSchema

export interface DrizzleDbModuleLike {
  db: HubDbModuleLike['db']
  schema: DrizzleSchema
}

async function importHubDb() {
  return import('hub:db')
}

/**
 * Get the underlying D1 database client from hub:db
 *
 * Use this for stores that need raw D1 API (.prepare(), .bind(), etc.)
 * For new code, prefer using Drizzle ORM directly via `import { db, schema } from 'hub:db'`
 */
export async function getD1Database(): Promise<D1DatabaseLike> {
  const { db } = await import('hub:db')
  // $client is the underlying D1 database instance
  return db.$client as unknown as D1DatabaseLike
}

/**
 * Get Drizzle ORM database and schema
 *
 * Preferred way to access database for new code.
 */
export async function getDrizzleDb(): Promise<DrizzleDbModuleLike> {
  const hubDb = await importHubDb()
  return {
    db: hubDb.db,
    schema: {
      ...authSchema,
      ...hubDb.schema,
    } as DrizzleSchema,
  }
}
