/**
 * Database utilities for accessing D1 via hub:db
 *
 * NuxtHub provides Drizzle ORM via `hub:db`. For stores that need raw D1 API,
 * use `getD1Database()` to get the underlying D1 client.
 */

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
 * Preferred way to access database for new code
 */
export async function getDrizzleDb() {
  return import('hub:db')
}
