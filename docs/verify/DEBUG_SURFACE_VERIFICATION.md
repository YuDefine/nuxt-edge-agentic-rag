# Debug Surface Verification

> observability-and-debug §4.3 — runbook for enabling / verifying the internal
> debug surfaces in local + staging + production. The debug pages expose internal
> query-log observability (decision_path / latency / scores / refusal reason)
> and are gated by Admin role + a production kill-switch.

## Scope

Internal debug surfaces shipped in this change:

| Route                                  | Purpose                                     |
| -------------------------------------- | ------------------------------------------- |
| `GET /api/admin/debug/query-logs/[id]` | Full debug projection of a single query_log |
| `GET /api/admin/debug/latency/summary` | Aggregate p50 / p95 + outcome breakdown     |
| `/admin/debug/query-logs/[id]`         | UI wrapper for the detail endpoint          |
| `/admin/debug/latency`                 | UI wrapper for the summary endpoint         |

All four surfaces go through the same auth helper
(`requireInternalDebugAccess`) and share a redaction-safe contract with the
existing admin endpoints — they never expose raw query text.

## Access Gate

`server/utils/debug-surface-guard.ts::requireInternalDebugAccess(event)`
enforces:

1. **Admin session** — delegates to `requireRuntimeAdminSession()`. Non-admins
   get a 403 before any environment / flag is consulted.
2. **Environment + flag** — in production (`NUXT_KNOWLEDGE_ENVIRONMENT=production`),
   the route is additionally locked behind
   `runtimeConfig.debugSurfaceEnabled` (sourced from `NUXT_DEBUG_SURFACE_ENABLED`).
3. **Non-production admins** — in `local` / `staging`, any admin can always
   reach the debug surfaces (the flag is ignored).

| Environment | Admin | `NUXT_DEBUG_SURFACE_ENABLED` | Result |
| ----------- | ----- | ---------------------------- | ------ |
| local       | yes   | n/a                          | 200    |
| staging     | yes   | n/a                          | 200    |
| production  | yes   | `false` / unset              | 403    |
| production  | yes   | `true`                       | 200    |
| any         | no    | any                          | 403    |

## Verification Steps

### Local

1. Run the dev server (`pnpm dev`) with `NUXT_KNOWLEDGE_ENVIRONMENT=local`.
2. Sign in with an email listed in `ADMIN_EMAIL_ALLOWLIST`.
3. Visit `/admin/debug/latency`. Verify:
   - Loading card appears briefly.
   - Page transitions to a card grid showing `web` / `mcp` channels (or empty
     state if no rows exist in the last 7 days).
   - NULL latency values render as `—` with the explanatory footnote; they are
     NOT rendered as `0 ms`.
   - Switching the day selector between `近 7 天` / `近 30 天` triggers a
     refresh and updates `sample-count`.
4. Click through to `/admin/debug/query-logs/<id>` for one row (URL picked from
   the local admin query-logs list page). Verify:
   - All 6 debug fields render (decision-path badge, first-token latency,
     completion latency, retrieval score %, judge score %, refusal reason
     badge).
   - Null fields render as `未測量` / `—`, never as `0` / empty.
   - The redacted query text block appears with a note when redaction was
     applied.

### Production

1. **With the flag off (default)** — sign in as an admin, visit the debug URLs.
   The page MUST render the `無權限存取` card (not the data). The network tab
   should show `403` from the API endpoint. This confirms the kill-switch is
   working before we unlock it for an incident.
2. **Unlocking during an incident** — set
   `NUXT_DEBUG_SURFACE_ENABLED=true` on the production worker (via
   `wrangler secret put NUXT_DEBUG_SURFACE_ENABLED` or the Cloudflare
   dashboard), deploy, and reload the debug page. The card grid should now
   render.
3. **Locking back down** — once the incident is over, set the secret to
   `false` (or remove it) and redeploy. Confirm the pages 403 again.

## Redaction Guarantees

The following assertions are enforced by automated tests and MUST be
preserved by any future change to the endpoints:

- `/api/chat` response never includes any of the 6 debug fields
  (`test/integration/chat-route.test.ts` — regression block).
- `/api/admin/query-logs/[id]` (the non-debug admin detail endpoint) strips
  debug fields even if the upstream store accidentally returns them
  (`test/integration/debug-surface-contract-regression.test.ts`).
- MCP tool output (`McpAskResult`) exposes only `answer` / `citations` /
  `refused` (`test/unit/mcp-ask-output-contract.test.ts`).
- Admin latency aggregation returns only numeric buckets + channel names —
  JSON.stringify over the response must not contain `query_text` /
  `rawQuery` (`test/integration/admin-debug-latency-summary-route.test.ts`).

If a future change needs to extend the MCP tool schema or the public chat
response with observability fields, it MUST land the change alongside an
update to the regression tests and a new ADR documenting the governance
trade-off.

## NULL Semantics Reminder

`query_logs.first_token_latency_ms` / `completion_latency_ms` /
`retrieval_score` / `judge_score` / `decision_path` / `refusal_reason` are
ALL nullable. NULL means "not measured / not applicable":

- Legacy rows from before the migration.
- Rows blocked by the audit layer before retrieval ran.
- Pipeline errors where partial timing cannot be trusted.

NEVER coerce NULL into a sentinel (`0`, `''`, `'unknown'`). The debug UI
relies on distinguishing NULL from low numeric values.
