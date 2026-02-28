#!/usr/bin/env npx tsx
/**
 * Staging Retention Prune Script (governance §2.4)
 *
 * Calls `POST /api/admin/retention/prune` with an optional shortened-TTL
 * override (`--retention-days`) so staging / local operators can prove the
 * coordinated cleanup path works without waiting 180 real days.
 *
 * The server side rejects any `retentionDays` override when the runtime
 * environment is `production`; this script does not enforce that itself but
 * prints a conservative warning if `--base-url` looks like the production
 * host.
 *
 * Usage:
 *   # Regular prune (no override) against staging
 *   npx tsx scripts/staging-retention-prune.ts \
 *     --base-url https://agentic-staging.yudefine.com.tw \
 *     --cookie "$ADMIN_SESSION_COOKIE"
 *
 *   # Shortened-TTL verification (1 day) against local
 *   npx tsx scripts/staging-retention-prune.ts \
 *     --base-url http://localhost:3010 \
 *     --cookie "$ADMIN_SESSION_COOKIE" \
 *     --retention-days 1
 *
 * Options:
 *   --base-url, -u       API base URL (required)
 *   --cookie, -c         Admin session cookie (required; env ADMIN_SESSION_COOKIE)
 *   --retention-days, -r Optional retentionDays override (1..180). Staging only.
 *   --help, -h           Show help
 */

interface ParsedArgs {
  baseUrl?: string
  cookie?: string
  retentionDays?: number
  help?: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--base-url':
      case '-u':
        result.baseUrl = args[++i]
        break
      case '--cookie':
      case '-c':
        result.cookie = args[++i]
        break
      case '--retention-days':
      case '-r': {
        const raw = args[++i]
        const value = Number(raw)
        if (!Number.isInteger(value) || value <= 0) {
          console.error(`Error: --retention-days must be a positive integer, received ${raw}`)
          process.exit(1)
        }
        result.retentionDays = value
        break
      }
      case '--help':
      case '-h':
        result.help = true
        break
      default:
        // ignore unknown args rather than failing; future-friendly.
        break
    }
  }
  return result
}

function printHelp(): void {
  console.log(`
Staging Retention Prune (governance §2.4)

Usage:
  npx tsx scripts/staging-retention-prune.ts --base-url <url> --cookie <cookie> [--retention-days <n>]

Options:
  --base-url, -u       API base URL (required, e.g. https://agentic-staging.yudefine.com.tw)
  --cookie, -c         Admin session cookie (required; or env ADMIN_SESSION_COOKIE)
  --retention-days, -r Optional shortened retention (1..180). Staging / local only.
  --help, -h           Show this help.

Notes:
  - Any --retention-days override is REJECTED by production; use only against
    local / staging.
  - The server response includes the effective retentionDays and deleted row
    counts so the verification harness can record which threshold was used.
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const baseUrl = args.baseUrl
  const cookie = args.cookie || process.env.ADMIN_SESSION_COOKIE

  if (!baseUrl) {
    console.error('Error: --base-url is required')
    printHelp()
    process.exit(1)
  }

  if (!cookie) {
    console.error('Error: --cookie (or env ADMIN_SESSION_COOKIE) is required')
    printHelp()
    process.exit(1)
  }

  if (args.retentionDays !== undefined && /agentic\.yudefine\.com\.tw/i.test(baseUrl)) {
    // Conservative warning; server will reject regardless.
    console.warn(
      'Warning: --retention-days override against what looks like the production host. ' +
        'The server will reject the override; rerun against staging or drop the flag.'
    )
  }

  const cookieHeader = cookie.includes('=') ? cookie : `better-auth.session_token=${cookie}`
  const requestBody =
    args.retentionDays !== undefined ? JSON.stringify({ retentionDays: args.retentionDays }) : '{}'

  console.log(`Calling POST ${baseUrl}/api/admin/retention/prune`)
  if (args.retentionDays !== undefined) {
    console.log(`  retentionDays override: ${args.retentionDays}`)
  }

  try {
    const response = await fetch(`${baseUrl}/api/admin/retention/prune`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: requestBody,
    })

    const payload = (await response.json().catch(() => ({}))) as {
      data?: {
        retentionDays: number
        cutoff: string
        deleted: Record<string, number>
        errors: Array<{ step: string; message: string }>
      }
      message?: string
    }

    if (!response.ok) {
      console.error(`Failed (HTTP ${response.status}): ${payload.message ?? response.statusText}`)
      process.exit(1)
    }

    const data = payload.data
    if (!data) {
      console.error('Unexpected response shape (no `data` field):', payload)
      process.exit(1)
    }

    console.log('Success')
    console.log(`  retentionDays: ${data.retentionDays}`)
    console.log(`  cutoff:        ${data.cutoff}`)
    console.log(`  deleted:       ${JSON.stringify(data.deleted)}`)
    console.log(`  errors:        ${data.errors.length}`)
    for (const err of data.errors) {
      console.log(`    - [${err.step}] ${err.message}`)
    }

    process.exit(data.errors.length === 0 ? 0 : 2)
  } catch (error) {
    console.error('Request failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

void main()
