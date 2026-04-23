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

interface LibsqlResultLike {
  lastInsertRowid?: bigint | number | null
  rows?: Record<string, unknown>[]
  rowsAffected?: number
}

interface LibsqlStatementLike {
  args?: unknown[]
  sql: string
}

interface LibsqlClientLike {
  batch(statements: LibsqlStatementLike[]): Promise<unknown>
  execute(statement: LibsqlStatementLike | string, args?: unknown[]): Promise<LibsqlResultLike>
}

interface AdaptedPreparedStatement extends D1PreparedStatementLike {
  toLibsqlStatement(): LibsqlStatementLike
}

export const authSchema = {
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
      accessTokenExpiresAt: integer('accessTokenExpiresAt', {
        mode: 'timestamp_ms',
      }),
      refreshTokenExpiresAt: integer('refreshTokenExpiresAt', {
        mode: 'timestamp_ms',
      }),
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

function isD1DatabaseLike(value: unknown): value is D1DatabaseLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'prepare' in value &&
    typeof value.prepare === 'function' &&
    'batch' in value &&
    typeof value.batch === 'function'
  )
}

function isLibsqlClientLike(value: unknown): value is LibsqlClientLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'execute' in value &&
    typeof value.execute === 'function' &&
    'batch' in value &&
    typeof value.batch === 'function'
  )
}

function isAdaptedPreparedStatement(
  value: D1PreparedStatementLike,
): value is AdaptedPreparedStatement {
  return 'toLibsqlStatement' in value && typeof value.toLibsqlStatement === 'function'
}

function createAdaptedPreparedStatement(
  client: LibsqlClientLike,
  sql: string,
): AdaptedPreparedStatement {
  let boundArgs: unknown[] = []

  async function execute(): Promise<LibsqlResultLike> {
    return client.execute({
      sql,
      args: boundArgs,
    })
  }

  return {
    bind(...values: unknown[]) {
      boundArgs = values
      return this
    },
    async all<T>() {
      const result = await execute()
      return {
        results: (result.rows ?? []) as T[],
      }
    },
    async first<T>() {
      const result = await execute()
      return ((result.rows ?? [])[0] ?? null) as T | null
    },
    run() {
      return execute()
    },
    toLibsqlStatement() {
      return {
        sql,
        args: boundArgs,
      }
    },
  }
}

function createD1DatabaseAdapter(client: LibsqlClientLike): D1DatabaseLike {
  return {
    async batch(statements) {
      return client.batch(
        statements.map((statement) => {
          if (isAdaptedPreparedStatement(statement)) {
            return statement.toLibsqlStatement()
          }

          throw new TypeError('Expected statements created by getD1Database() libsql adapter')
        }),
      )
    },
    prepare(query) {
      return createAdaptedPreparedStatement(client, query)
    },
  }
}

/**
 * Get the underlying D1 database client from hub:db
 *
 * Use this for stores that need raw D1 API (.prepare(), .bind(), etc.)
 * For new code, prefer using Drizzle ORM directly via `import { db, schema } from 'hub:db'`
 */
export async function getD1Database(): Promise<D1DatabaseLike> {
  const { db } = await import('hub:db')

  if (isD1DatabaseLike(db)) {
    return db
  }

  const client = (db as { $client?: unknown }).$client

  if (isD1DatabaseLike(client)) {
    return client
  }

  // Local dev patches `hub:db` to libsql so raw D1 stores still need a
  // compatibility layer for `.prepare().bind().all()/first()/run()`.
  if (isLibsqlClientLike(client)) {
    return createD1DatabaseAdapter(client)
  }

  throw new TypeError('hub:db does not expose a D1-compatible database client')
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
