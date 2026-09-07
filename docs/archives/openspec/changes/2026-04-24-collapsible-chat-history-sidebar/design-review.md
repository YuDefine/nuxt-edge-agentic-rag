# Design Review: collapsible-chat-history-sidebar

- **Date**: 2026-04-24
- **Mode**: improve
- **Spectra Change**: collapsible-chat-history-sidebar
- **Target**: `app/pages/index.vue`, `app/components/chat/ConversationHistory.vue`

## Diagnosis Summary

| Dimension     | Score | Finding                                                                                                                        |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| Visual        | 4/4   | Follows the existing black/white Nuxt UI system; no decorative color drift.                                                    |
| Interaction   | 4/4   | Sidebar collapse, rail expand, and bucket collapse are reachable through explicit controls.                                    |
| Structure     | 4/4   | Inline sidebar remains fixed width on `lg+`; drawer path remains isolated for `< lg`.                                          |
| Copy          | 4/4   | Labels are direct Traditional Chinese UI commands: 「收合對話記錄」 and 「展開對話記錄」.                                      |
| Resilience    | 4/4   | Empty state bypasses grouping; invalid dates render defensively as 「時間未知」.                                               |
| Performance   | 3/4   | Uses small computed grouping and Nuxt UI collapsibles. Width transition is spec-required and includes reduced-motion fallback. |
| Accessibility | 4/4   | Toggle buttons have ARIA labels; collapsed rail stays in the accessibility tree; no nested interactive rail controls.          |
| Consistency   | 4/4   | Uses Nuxt UI `UButton`, `UBadge`, `UTooltip`, `UCollapsible`, and semantic token classes.                                      |

## Design Fidelity Report

Source: `.impeccable.md`

| 維度                 | 狀態 | 證據                                                                                                          |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| Color Tokens         | PASS | Uses `text-muted`, `text-default`, `bg-accented`, `bg-elevated`, `border-default`, Nuxt UI `color="neutral"`. |
| Typography           | PASS | Keeps compact product UI type scale (`text-xs`, `text-sm`) matching the existing sidebar density.             |
| Spacing              | PASS | Uses project spacing scale (`gap-2`, `gap-3`, `p-1.5`, `p-2`, `p-4`) without arbitrary values.                |
| Component Usage      | PASS | Uses Nuxt UI primitives instead of custom overlays or bespoke badges.                                         |
| Interaction Patterns | PASS | Icon-only controls have labels/tooltips; recent buckets default open and older buckets default closed.        |
| Layout Fidelity      | PASS | Desktop inline sidebar remains `lg` only; mobile/tablet drawer behavior is unchanged.                         |
| Design Principles    | PASS | Supports "內容優先" by allowing chat area expansion while keeping history reachable.                          |
| Anti-references      | PASS | No gradients, decorative color, glass effects, or card-heavy structure added.                                 |

Fidelity Score: 8/8 PASS

### DRIFT 修復記錄

- [修復前] Collapsed rail used a clickable container around a button-like control → [修復後] rail history and new-conversation placeholder are separate explicit buttons — `app/components/chat/ConversationHistory.vue`.
- [修復前] Spec-required width transition did not account for motion-sensitive users → [修復後] added `motion-reduce:transition-none` — `app/pages/index.vue`, `app/components/chat/ConversationHistory.vue`.

## Planned Skills

1. `/layout app/pages/index.vue app/components/chat/ConversationHistory.vue` — verified sidebar widths, grouping rhythm, and drawer isolation.
2. `/animate app/pages/index.vue app/components/chat/ConversationHistory.vue` — kept motion restrained; added reduced-motion fallback for collapse transitions.
3. `/harden app/pages/index.vue app/components/chat/ConversationHistory.vue` — checked empty list, invalid `updatedAt`, and localStorage fallback expectations.
4. `/polish app/pages/index.vue app/components/chat/ConversationHistory.vue` — removed nested interactive rail risk and aligned controls with Nuxt UI conventions.

## Design Decisions

- Collapsed rail hides the total Badge when there are zero conversations; non-zero counts remain visible. This keeps the empty account rail quiet while the expanded state still shows the original empty-state copy.
- Bucket expansion state is component-session memory only, not persisted. This follows the spec and avoids adding another storage key.

## Verification Evidence

- `pnpm test test/unit/conversation-grouping.test.ts` — pass.
- `pnpm check` — pass.
- `pnpm audit:ux-drift` — pass.
- `playwright test e2e/collapsible-chat-history-sidebar.spec.ts` — pass; screenshots written to `screenshots/collapsible-chat-history-sidebar/`; localStorage write failure path has no `pageerror` or console error.
- `PLAYWRIGHT_SKIP_WEBSERVER=true playwright test e2e/chat-persistence.spec.ts` — pass after updating the test mock to the current SSE `/api/chat` contract.
