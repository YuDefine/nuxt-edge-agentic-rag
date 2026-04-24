#!/usr/bin/env node
/**
 * Dev-only CLI: mint a long-lived MCP Bearer token into the local D1 / sqlite
 * database for eval / manual testing.
 *
 * Refuses to run outside NUXT_KNOWLEDGE_ENVIRONMENT=local to prevent
 * accidental writes to staging / production databases.
 *
 * Usage:
 *   pnpm mint:dev-mcp-token [--email <admin-email>] [--ttl-days <n>]
 *
 * Prints the plaintext token to stdout (single line, shell-pipe friendly).
 * All logs go to stderr.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { argv, env, exit, stderr, stdout } from 'node:process'

const DEFAULT_DB_PATH = '.data/db/sqlite.db'
const DEFAULT_TTL_DAYS = 30
const DEFAULT_SCOPES = [
  'knowledge.ask',
  'knowledge.search',
  'knowledge.category.list',
  'knowledge.citation.read',
] as const

interface CliOptions {
  dbPath: string
  email: string
  ttlDays: number
}

function fail(msg: string): never {
  stderr.write(`mint-dev-mcp-token: ${msg}\n`)
  exit(1)
}

function parseArgs(): CliOptions {
  const args = argv.slice(2)
  let email = env.EVAL_MCP_TOKEN_USER_EMAIL?.trim() ?? ''
  let ttlDays = DEFAULT_TTL_DAYS
  const dbPath = env.MINT_DEV_TOKEN_DB_PATH?.trim() || DEFAULT_DB_PATH

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    const next = args[i + 1]
    if (arg === '--email' && next) {
      email = next
      i += 1
    } else if (arg === '--ttl-days' && next) {
      ttlDays = Number(next)
      if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
        fail('--ttl-days must be a positive number')
      }
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      stderr.write(
        `Usage: pnpm mint:dev-mcp-token [--email <admin-email>] [--ttl-days <n>]\n` +
          `  --email       admin email that owns the token (defaults to EVAL_MCP_TOKEN_USER_EMAIL or first entry of ADMIN_EMAIL_ALLOWLIST)\n` +
          `  --ttl-days    token lifetime in days (default: ${DEFAULT_TTL_DAYS})\n`,
      )
      exit(0)
    }
  }

  if (!email) {
    const allowlist = (env.ADMIN_EMAIL_ALLOWLIST ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    email = allowlist[0] ?? ''
  }

  if (!email) {
    fail(
      'admin email is required. Pass --email <email>, set EVAL_MCP_TOKEN_USER_EMAIL, or populate ADMIN_EMAIL_ALLOWLIST in .env.',
    )
  }

  return { dbPath, email, ttlDays }
}

function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function main(): void {
  const environment = (env.NUXT_KNOWLEDGE_ENVIRONMENT ?? '').trim() || 'local'
  if (environment !== 'local') {
    fail(`refusing to run with NUXT_KNOWLEDGE_ENVIRONMENT=${environment}; this CLI is local-only.`)
  }

  const { dbPath, email, ttlDays } = parseArgs()
  const db = new DatabaseSync(dbPath)

  try {
    const userRow = db.prepare('SELECT id FROM user WHERE email = ?').get(email) as
      | { id: string }
      | undefined

    if (!userRow?.id) {
      fail(
        `no user found with email ${email}. Sign in once (e.g. via /_dev/login) so the user row exists before minting a token.`,
      )
    }

    const plaintextToken = randomBytes(24).toString('base64url')
    const tokenHash = hashMcpToken(plaintextToken)
    const now = new Date()
    const id = randomUUID()
    const createdAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000).toISOString()
    const name = `dev-eval-token-${createdAt.slice(0, 10)}`
    const scopesJson = JSON.stringify([...new Set(DEFAULT_SCOPES)])

    db.prepare(
      `INSERT INTO mcp_tokens
         (id, token_hash, name, scopes_json, environment, status,
          expires_at, last_used_at, revoked_at, revoked_reason,
          created_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, NULL, NULL, ?, ?)`,
    ).run(id, tokenHash, name, scopesJson, environment, expiresAt, createdAt, userRow.id)

    stdout.write(`${plaintextToken}\n`)
    stderr.write(
      `minted MCP token id=${id} email=${email} expiresAt=${expiresAt} scopes=${DEFAULT_SCOPES.join(',')}\n`,
    )
  } finally {
    db.close()
  }
}

main()
