# Design Review — observability-and-debug Phase 3

**Date**: 2026-04-19
**Mode**: Analytical (no dev server, no screenshots per Phase 3 scope)
**Surfaces reviewed**:

- `app/pages/admin/debug/latency/index.vue`
- `app/pages/admin/debug/query-logs/[id].vue`
- `app/components/debug/DecisionPathBadge.vue`
- `app/components/debug/ScorePanel.vue`
- `app/components/debug/EvidencePanel.vue`
- `app/components/debug/LatencySummaryCards.vue`
- `app/components/debug/OutcomeBreakdown.vue`

## Method

Surfaces are internal, Admin + flag-gated debug pages with static server
truth — no user-generated content, no content that mixes with end-user UI.
This review inspects structure / visual hierarchy / state coverage /
consistency against the project `impeccable`-style conventions from
`app/components/documents/AccessLevelBadge.vue` and
`app/pages/admin/documents/index.vue` (reference surfaces for admin UI).

## Design Fidelity Report

| Dimension                    | Status | Evidence                                                                                                                                                |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component Consistency        | PASS   | Every Nuxt UI component declares `color`, `variant`, `size` explicitly (no defaults relied on).                                                         |
| Exhaustiveness (enum safety) | PASS   | `switch + assertDecisionPathNever` / `assertRefusalReasonNever` in `app/utils/debug-labels.ts`.                                                         |
| State Coverage               | PASS   | Four states — loading, unauthorized, empty or not-found, error — covered in both pages via typed `UiPageState`.                                         |
| NULL discipline              | PASS   | `formatNullableNumber` / `formatScore` / `describeDecisionPath` / `describeRefusalReason` all return explicit `未測量` / `—` for null, never fabricate. |
| Typography hierarchy         | PASS   | `h1` = page title (`text-2xl font-bold`), card headers = `h3 text-base`, data labels = `text-xs uppercase muted`, values = `text-lg font-semibold`.     |
| Spacing rhythm               | PASS   | `flex flex-col gap-6` page stack; cards use consistent `gap-4` internal grid; no ad-hoc `mt-X` overrides.                                               |
| Colour semantics             | PASS   | Badges use semantic map: `success` = answered paths, `warning` = refused paths, `error` = blocked / pipeline errors, `neutral` = unmeasured.            |
| Responsive behaviour         | PASS   | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-2` in latency page; score panel uses `grid-cols-1 sm:grid-cols-3`.                                             |
| Accessibility                | PASS   | Icons paired with text labels; `aria-label` via `<section aria-label>`; colour not the sole indicator (text labels accompany all badges).               |

No DRIFT items. Fidelity Score: 9/9.

## Noted Conventions & Decisions

1. **No chart library** — the outcome breakdown uses CSS bars
   (`bg-muted` track + colour-coded fill) to keep the debug bundle slim and
   avoid a new dependency. If future growth warrants, introduce `nuxt-charts`
   (already a dep) behind a lazy import.
2. **Badge colour map** — kept intentionally narrow to 3 success / 4 warning
   / 2 error states so that colour blind users can fall back on the text
   label. The mapping lives in a single `switch` inside
   `app/utils/debug-labels.ts` so a future skin change lands in one place.
3. **Two-pane layout on latency page** — first the numeric cards (fast scan
   for regressions), then the outcome breakdown (explains _why_ latency is
   high). This ordering mirrors `docs/verify/PRODUCTION_BUG_PATTERNS.md`
   workflow: start with symptoms, drill into causes.
4. **Day selector reuses USelectMenu + `interface DayOption`** — avoids
   `as const` assertion readonly-tuple errors with Nuxt UI.
5. **Admin middleware only** — the pages run `definePageMeta({ middleware:
['admin'] })` for a UX redirect. The real enforcement lives server-side in
   `requireInternalDebugAccess` (admin + prod flag). This matches the
   existing `/admin/documents` pattern.

## Cross-Change Consistency

The debug surfaces deliberately avoid overlapping the admin-ui
`/admin/query-logs` / `/admin/dashboard` / `/admin/tokens` routes introduced
by the sibling `admin-ui-post-core` change:

- Different URL prefix (`/admin/debug/*` vs `/admin/*`).
- Different server store (`createQueryLogDebugStore` vs
  `createQueryLogAdminStore`) — the admin one stays redaction-safe and
  debug-free.
- Different access gate (`requireInternalDebugAccess` vs
  `requireRuntimeAdminSession`).

If admin-ui later exposes a link from its query-log detail page to the debug
detail, it should be a separate follow-up change that decides whether to
share the layout shell.

## Skipped (Phase 3 scope)

- §5.3 `/review-screenshot` — requires a running dev server + auth session;
  deferred to the main branch after Phase 1 + 2 + 3 merge per tasks.md.
- `/audit` skill — not executed in worktree; the static checks above cover
  the critical dimensions (exhaustiveness, state coverage, null discipline,
  redaction). Any follow-up should re-run `/audit` from the main branch.

## Recommendations (non-blocking)

1. If the production flag is ever flipped during an incident, the
   `/admin/debug/latency` page will auto-refetch on day selector change but
   NOT auto-poll. Consider a future `setInterval`-free Pinia Colada
   `refetchInterval` if the team wants near-real-time visibility.
2. The citation panel (`EvidencePanel.vue`) shows only `sourceChunkId` —
   a future iteration could join `citation_records` to display the
   `chunkTextSnapshot` for triaging refusals. Left out of this change to
   keep the §2.3 surface minimal and redaction-safe by default.
