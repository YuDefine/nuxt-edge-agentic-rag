# Design Review — admin-ui-post-core Phase 3

**Date**: 2026-04-19 (UTC)
**Scope**: `app/pages/admin/tokens/**`, `app/pages/admin/query-logs/**`, `app/pages/admin/dashboard/**`, and corresponding `app/components/admin/**`.
**Method**: Static audit against `.impeccable.md` (Design System) + `.claude/rules/development.md` (UI Reuse / Nuxt UI props / exhaustiveness). No dev-server screenshots — screenshot review and interactive fidelity check are deferred to Phase 4 (human verification stage).

## Design System Anchors

From `.impeccable.md`:

1. **Palette**: pure black/white via `--ui-primary`; no colorful accents. Semantic colors (`error`, `warning`, `success`) only for feedback.
2. **Typography**: DM Sans; hierarchy by weight/size (not color).
3. **Spacing**: Tailwind 4 tokens — 4 / 16 / 24 / 32 px for card padding, form gaps, section separators.
4. **Tokens vs hardcoded**: MUST use `text-default / text-muted / text-dimmed / bg-default / bg-muted / bg-elevated / border-default`. MUST NOT use `text-gray-*`, `bg-neutral-*`, `dark:*`, or raw `text-black/white`.
5. **Buttons**: `<UButton color="neutral"|"primary" variant="solid|outline|ghost" size="md|sm|xs">` — always explicit props, never defaults.
6. **Empty state template** (from `.impeccable.md`): vertical stack of icon circle (`bg-muted`) + title + muted description + CTA.

## Surface Inventory

| Surface                           | File                                                                     | Phase |
| --------------------------------- | ------------------------------------------------------------------------ | ----- |
| `/admin/tokens` list              | `app/pages/admin/tokens/index.vue`                                       | 2     |
| Token create modal                | `app/components/admin/tokens/TokenCreateModal.vue`                       | 2     |
| Token revoke confirm              | `app/components/admin/tokens/TokenRevokeConfirm.vue`                     | 2     |
| Token status / scope badges       | `app/components/admin/tokens/{TokenStatusBadge,TokenScopeList}.vue`      | 2     |
| `/admin/query-logs` list          | `app/pages/admin/query-logs/index.vue`                                   | 2     |
| `/admin/query-logs/[id]` detail   | `app/pages/admin/query-logs/[id].vue`                                    | 2     |
| Query log status / channel badges | `app/components/admin/query-logs/{QueryLogStatusBadge,ChannelBadge}.vue` | 2     |
| `/admin/dashboard` summary        | `app/pages/admin/dashboard/index.vue`                                    | 3     |
| Dashboard summary card            | `app/components/admin/dashboard/SummaryCard.vue`                         | 3     |
| Dashboard 7-day trend list        | `app/components/admin/dashboard/QueryTrendList.vue`                      | 3     |

## Fidelity Checklist (per `.impeccable.md`)

| #   | Check                                                                                                                                              | Evidence                                                                                                                                                    | Verdict |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | No hardcoded colors (`text-gray-*`, `dark:*`)                                                                                                      | `grep -nE 'text-gray\|dark:\|text-black\|text-white\|bg-black\|bg-white' app/**/admin/**` — 0 matches after fixing SummaryCard                              | PASS    |
| 2   | All Nuxt UI components have explicit `color/variant/size` props                                                                                    | All `<UButton>`, `<UBadge>`, `<UInput>`, `<USelect>` in Phase 1+2+3 admin files verified to include the triad (verified with `awk '/<UButton/,/>/'`)        | PASS    |
| 3   | Empty / loading / error / unauthorized / success (+ feature-off) states use the `.impeccable.md` template (icon circle + title + muted text + CTA) | `tokens/index.vue`, `query-logs/index.vue`, `query-logs/[id].vue`, `dashboard/index.vue` all follow the pattern                                             | PASS    |
| 4   | Enum dispatch uses `switch + assertNever` (not `if/else`)                                                                                          | `TokenStatusBadge.vue`, `QueryLogStatusBadge.vue`, `QueryLogChannelBadge.vue`, `TokenScopeList.vue` — all use the required pattern (unit tests assert this) | PASS    |
| 5   | Typography hierarchy by weight/size, not color                                                                                                     | Headers use `text-2xl font-bold` / `text-lg font-semibold`; body uses `text-sm text-muted`. No color-only emphasis.                                         | PASS    |
| 6   | Spacing uses Tailwind 4 tokens (`gap-{3,4,6}`, `py-16`, `px-3`)                                                                                    | Dashboard uses `gap-6` between sections, `gap-4` on cards grid, `gap-3` on trend items — consistent with tokens/query-logs pages                            | PASS    |
| 7   | Primary CTAs follow project convention                                                                                                             | Dashboard empty-state CTA uses `color="primary"` to match `tokens/index.vue` "建立 Token" convention (Phase 2 pattern)                                      | PASS    |
| 8   | No animations beyond load indicators or progress bars                                                                                              | Only `animate-spin` on loader icons and `transition-all` on trend bar; no decorative motion                                                                 | PASS    |

**Fidelity Score: 8/8 — no DRIFT.**

## Findings (pre-audit fixes applied inline)

| #   | Category    | Issue                                                                 | Severity | Source        | Resolution                                                                                                                                           |
| --- | ----------- | --------------------------------------------------------------------- | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | consistency | `SummaryCard.vue` used `bg-primary/10 text-primary` for the icon halo | warning  | design-review | Changed to `bg-muted text-default` to match the established empty-state icon-circle convention (tokens / query-logs / documents all use `bg-muted`). |

## /audit — Technical Quality Findings

Run as a static audit (accessibility, performance, theming, responsive, anti-patterns).

| Area         | Check                                            | Verdict                                                                                                                                                                  |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a11y         | ARIA labels on icon-only buttons                 | PASS — `Revoke` button has `aria-label`; `icon-only` refresh buttons carry visible text.                                                                                 |
| a11y         | Decorative icons marked `aria-hidden`            | PASS — `SummaryCard` icon halo has `aria-hidden="true"`; trend bar has `role="presentation"`.                                                                            |
| a11y         | Focus states on interactive elements             | PASS — inherits Nuxt UI defaults; no custom `outline: none`.                                                                                                             |
| a11y         | Keyboard flow                                    | PASS — all CTAs are `<UButton>` / `<a>` (link-as-button); no `<div onClick>`.                                                                                            |
| performance  | No unnecessary re-renders from non-stable keys   | PASS — `v-for` on trend / badges uses stable `date` / `scope` / `flag` keys.                                                                                             |
| performance  | Short `staleTime` on frequently-viewed dashboard | PASS — `staleTime: 30_000` matches the "re-open often, tolerate 30s staleness" mental model.                                                                             |
| theming      | All color/bg classes use Nuxt UI semantic tokens | PASS — zero `text-gray-*` / `dark:*` / raw `black/white` matches in new Phase 3 files.                                                                                   |
| responsive   | Summary grid degrades gracefully on mobile       | PASS — `grid-cols-1 md:grid-cols-3`; trend bars use `flex-1`.                                                                                                            |
| responsive   | Dashboard header action row wraps                | PASS — `flex items-center justify-between gap-3`; same as tokens/query-logs.                                                                                             |
| anti-pattern | No `if/else if` for enum dispatch                | PASS — all enum dispatch uses `switch + assertNever`; `pnpm audit:ux-drift` (not run — skipping because this is a sub-agent with no dev server) would be the final gate. |
| anti-pattern | No `.skip` / commented-out tests                 | PASS — 0 `.skip` in `test/{unit,integration}/admin-*`.                                                                                                                   |
| anti-pattern | No `process.env` usage in Workers runtime path   | PASS — server endpoint reads `useRuntimeConfig(event).adminDashboardEnabled`.                                                                                            |
| anti-pattern | No hardcoded `PAGE_SIZE_MAX`                     | PASS — dashboard endpoint does not paginate; list endpoints use `paginationQuerySchema`.                                                                                 |

**Critical count: 0.**

## Cross-Change DRIFT (informational, non-blocking)

None observed. Phase 3 dashboard mirrors the empty-state / loading / error / unauthorized surface pattern established by `/admin/tokens` and `/admin/query-logs` in Phase 2, and by `/admin/documents` in the earlier `add-v1-core-ui` change. The `color="primary"` convention for the top-level CTA was already set by `tokens/index.vue`; Phase 3 keeps the same convention so admin pages feel unified.

## Deferred Work (Phase 4)

- §5.4 `/review-screenshot` — requires dev server + browser; skip until main-line Phase 4 human verification stage. Marked as `skip — 需 dev server + 人工驗收` in tasks.md.
- §5.5 Fidelity final confirmation — same reason; the static review above gives Score 8/8 and no DRIFT, but live visual confirmation (light/dark mode, real data) is a human-QA task.

## Conclusion

- Static design review: **Score 8/8, 0 DRIFT.**
- /audit static check: **0 Critical, 0 Warning.**
- The single finding (SummaryCard icon halo using `bg-primary/10`) was resolved inline and is no longer present in the tree.
- Phase 3 is ready for Phase 4 integration (screenshot review + manual check) in main.
