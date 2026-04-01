# Responsive & A11y Foundation — Verification

Verification runbook for the `responsive-and-a11y-foundation` change. The
change is delivered in two phases so it does not collide with
`member-and-permission-management` Phase 5 (which owns layouts + admin pages
and GuestAccessGate).

- **Phase A** — foundation, hybrid table, component-level responsive tweaks,
  contrast audit, design-review flow wiring. **Does not touch layouts,
  admin/members, admin/settings, GuestAccessGate, or server code.**
- **Phase B** — layout drawers, skip-to-main link, viewport E2E baselines,
  full three-breakpoint screenshot sweep, manual keyboard walkthrough. Runs
  **after** member-perm Phase 5 lands so layouts/default.vue and chat.vue
  edits are one coherent pass.

## Phase A — scope (this verification covers)

| Area                                  | Reference                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailwind `--breakpoint-xs: 360px`     | `app/assets/css/main.css`, `test/unit/tailwind-theme.test.ts`                                                                                                           |
| `@nuxt/a11y` dev-only module          | `nuxt.config.ts` (module auto-handles dev-only via `enabled` option), `package.json` devDependency                                                                      |
| Hybrid Table Fallback Below md        | `app/components/documents/DocumentListTable.vue`, `test/unit/responsive-table.test.ts`, `e2e/table-fallback.spec.ts`                                                    |
| Component responsive adjustments (§5) | `app/components/documents/UploadWizard.vue`, `app/components/chat/MessageList.vue`, `app/components/chat/ConversationHistory.vue`, `app/pages/admin/documents/[id].vue` |
| WCAG AA contrast audit (§7)           | `docs/design-tokens.md`                                                                                                                                                 |
| Design Review flow integration (§8)   | `.spectra.yaml` (adds `responsive_check` + `a11y_check` between targeted_skills and audit)                                                                              |

### Phase A verification steps (complete)

1. **Tailwind theme**

   ```bash
   pnpm exec vp test run test/unit/tailwind-theme.test.ts
   ```

   Expect: 2 passed.

2. **DocumentListTable hybrid contract**

   ```bash
   pnpm exec vp test run test/unit/responsive-table.test.ts
   ```

   Expect: 3 passed. Confirms primary / secondary column split, USlideover
   presence, focus restore wiring.

3. **`pnpm check` (format + lint + typecheck + vue-component-resolution)**

   ```bash
   pnpm check
   ```

   Expect: all green.

4. **Contrast audit**
   Review `docs/design-tokens.md`. Usage policy is enforced by code review +
   `/audit` skill. No token overrides required (default Nuxt UI 4 neutral
   palette is WCAG-aligned for standard usage; `text-dimmed` is documented
   as decorative-only).

5. **Design Review flow** — verify `.spectra.yaml` `design.review_steps`
   includes `responsive_check` and `a11y_check` between `targeted_skills`
   and `audit`.

## Phase B — deferred (runs after member-perm Phase 5)

These items were deliberately not executed in Phase A to avoid file
collisions with `member-and-permission-management` Phase 5. They must be
picked up by the Phase B follow-up subagent once member-perm Phase 5 has
landed `app/layouts/default.vue`, admin members/settings pages, and
GuestAccessGate.

| § (tasks.md)   | Task                                                                                                                                                                             | Collides-with                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| §1.5           | `pnpm dev` + `pnpm build` — confirm @nuxt/a11y loads in dev and is absent from production bundle                                                                                 | none; defer to Phase B for efficiency |
| §2 (all)       | Viewport baseline E2E (`test/e2e/viewport-baseline.spec.ts`)                                                                                                                     | layouts + admin pages                 |
| §3 (all)       | Layout drawer-at-md (`app/layouts/default.vue`, `app/layouts/chat.vue`, `useLayoutDrawer.ts`)                                                                                    | layouts, member-perm §5               |
| §5.5           | `app/pages/index.vue` signed-in chat landing responsive sweep                                                                                                                    | GuestAccessGate integration           |
| §5.6           | xs / md / xl baseline screenshots across all changed surfaces                                                                                                                    | requires §3 drawers first             |
| §6 (all)       | Keyboard navigation + skip-to-main link (`test/e2e/keyboard-nav.spec.ts`, `test/e2e/skip-to-main.spec.ts`, layouts edits)                                                        | layouts, member-perm §5               |
| §8.2 (partial) | Extend `.claude/rules/proactive-skills.md` Design Review Task Template with responsive + a11y checkboxes (edit was blocked by file-guard; documented here as a manual follow-up) | —                                     |
| §8.3           | dummy-change propose test                                                                                                                                                        | blocked by §8.2 edit                  |
| §8.4           | `.claude/CLAUDE.md` Design Review step-count sync (if referenced)                                                                                                                | depends on §8.2                       |
| §9.2           | Nuxt devtools @nuxt/a11y panel smoke                                                                                                                                             | requires `pnpm dev`                   |
| §9.3           | Staging bundle-size check (`wrangler deploy --dry-run`)                                                                                                                          | staging access                        |
| §9.4           | `screenshot-review` sweep across `/`, `/chat`, `/admin/documents`, `/admin/documents/[id]`, `/auth/login` at xs / md / xl                                                        | drawers must be in place              |
| §9.5           | Manual keyboard walkthrough                                                                                                                                                      | requires §3 + §6                      |
| §10 (all)      | Full Design Review (impeccable teach → design improve → targeted skills → responsive_check → a11y_check → audit → screenshot)                                                    | requires all UI deltas                |
| §11 (all)      | Manual human review in staging                                                                                                                                                   | staging deploy                        |

## Known blockers (Phase A → Phase B handoff)

1. **`.claude/rules/proactive-skills.md` edit denied.** The file is likely
   frozen by `guard`. The Design Review Task Template still shows seven
   checkboxes (N.1 … N.7) instead of the intended nine (N.5 responsive +
   N.6 a11y inserted between the existing N.4 targeted_skills and N.5
   audit). The `.spectra.yaml` half of §8 did land, so new proposals will
   inherit the extra review_steps — the manual follow-up is limited to
   the task-template snippet used when authoring a new change's
   `tasks.md`. User or an unfrozen session needs to apply the edit.

2. **Phase A cannot run `pnpm dev` / `pnpm build` end-to-end** in the
   current environment (no browser / no wrangler-linked secrets in this
   subagent), so §1.5 — "confirm @nuxt/a11y module loads in dev and is
   excluded from production bundle" — is deferred to the Phase B subagent
   which will have dev + deploy access.

## References

- Change root:
  `openspec/changes/responsive-and-a11y-foundation/`
- Tasks: `openspec/changes/responsive-and-a11y-foundation/tasks.md`
- Design: `openspec/changes/responsive-and-a11y-foundation/design.md`
- Contrast audit: `docs/design-tokens.md`
- Nuxt UI 4 token source:
  `node_modules/@nuxt/ui/dist/runtime/index.css`

Last updated: 2026-04-19 (Phase A complete; Phase B pending).
