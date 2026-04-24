# Design Review — auth-redirect-refactor

**Date**: 2026-04-24
**Affected surfaces**: `app/pages/auth/login.vue`, `app/pages/index.vue`
**Breakpoints**: xs 360 / md 768 / xl 1280
**Color modes**: light + dark

## Scope

This change makes `/auth/login` an independent full-page login surface and
narrows `/` to chat-only. `index.vue` visual scope is a **subtraction** — the
previous `v-if="!loggedIn"` login branch and its handlers are removed; the
signed-in chat experience is byte-for-byte the template block that existed
before. No net-new visual invention on `/`; the design review therefore
concentrates on `/auth/login` where the UI was materially reshaped.

The `/` signed-in path is covered by the tasks.md `## 人工檢查` block (7.3)
which the user performs in their own browser with a real session.

## Screenshots

| Breakpoint | Color mode | Path                                                          |
| ---------- | ---------- | ------------------------------------------------------------- |
| xs 360     | light      | `screenshots/local/auth-redirect-refactor/login-light-xs.png` |
| md 768     | light      | `screenshots/local/auth-redirect-refactor/login-light-md.png` |
| xl 1280    | light      | `screenshots/local/auth-redirect-refactor/login-light-xl.png` |
| xs 360     | dark       | `screenshots/local/auth-redirect-refactor/login-dark-xs.png`  |
| md 768     | dark       | `screenshots/local/auth-redirect-refactor/login-dark-md.png`  |
| xl 1280    | dark       | `screenshots/local/auth-redirect-refactor/login-dark-xl.png`  |

## Design Fidelity Report

Scored against `.impeccable.md` (brand: 簡約 / 高效 / 可靠; aesthetic: 純黑白極簡主義).

| #   | Dimension                                       | Score | Evidence                                                                              |
| --- | ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------- |
| 1   | Brand personality — 簡約                        | Match | Page holds icon + H1 + subtitle + 3 buttons + divider. No decoration.                 |
| 2   | Brand personality — 高效                        | Match | Google CTA is the first tappable target; no scroll-to-action required.                |
| 3   | Brand personality — 可靠                        | Match | Error alert is `v-if`-guarded; passkey feature-flag dual-gate preserved.              |
| 4   | Aesthetic — 純黑白極簡                          | Match | Light: black CTA, white card. Dark: white CTA, dark card. Zero chroma.                |
| 5   | Anti-reference — no gradient / colored button   | Match | No gradients. Only `color="neutral"` + `color="error"` (error path, not rendered).    |
| 6   | System-follow light/dark                        | Match | `UColorModeButton` present; dark/light screenshots demonstrate clean switch.          |
| 7   | Semantic color (system feedback only)           | Match | `UAlert` is conditional; idle state renders no semantic color.                        |
| 8   | Nuxt UI semantic classes (no `text-black` etc.) | Match | Grep shows only `text-default` / `text-muted` — no raw `black` / `white` / `gray-*`.  |
| 9   | Radius 0.375rem consistency                     | Match | Card + buttons share the same rounded visual; no sharp or oversized corners.          |
| 10  | Responsive — xs card full-width, md+ centered   | Match | `max-w-md w-full` behavior correct at all 3 breakpoints.                              |
| 11  | Typography hierarchy                            | Match | H1 `text-2xl font-bold`; subtitle `text-sm text-muted`; divider `text-xs text-muted`. |
| 12  | Horizontal overflow                             | Match | None at xs/md/xl in either color mode.                                                |

**Fidelity Score: 12/12 Match** — no DRIFT.

## Findings

No Critical findings. No Warning findings that block this change.

### Minor (informational)

- **UColorModeButton uses `absolute` positioning** (`app/layouts/auth.vue:3`).
  Harmless for the current login page (content fits in viewport). If future
  work adds scrollable content to the auth layout, consider `fixed top-4 right-4`
  so the control does not vanish on scroll. Not in scope for this change — the
  layout existed before and the positioning is unchanged here.

## Cross-Change Observations

None flagged. The auth layout existed before this change and is shared only with
`/auth/callback` and `/auth/mcp/authorize`. Both surfaces inherit the same
visual foundation and remain consistent.

## Verdict

Design Gate: **PASS**. No DRIFT in `design-review.md`; Fidelity 12/12; zero
Critical. Ready to proceed to `/audit` (tasks 6.5) and manual verification
(tasks 7.x).
