# Design Tokens — Contrast Audit

Scope: WCAG AA contrast audit of the Tailwind / Nuxt UI 4 design tokens in use by
this project. Produced as part of `responsive-and-a11y-foundation` Phase A
(§7 — **WCAG AA Contrast For Tailwind Theme Tokens**).

- **WCAG AA body text**: ≥ 4.5:1 (small text), ≥ 3:1 (large ≥ 18pt or ≥ 14pt bold)
- **WCAG AA UI components / graphical objects**: ≥ 3:1
- Token names map to Nuxt UI 4's `--ui-*` CSS custom properties (source:
  `node_modules/@nuxt/ui/dist/runtime/index.css`). Palette values come from
  Tailwind CSS's default `neutral-*` scale (we use the default `neutral`
  family via `app.config.ts → ui.colors.neutral = 'neutral'`).

## Light mode

| Token pair                                             | Ratio      | WCAG-AA Body (4.5:1) | WCAG-AA UI (3:1) | Notes                                                                    |
| ------------------------------------------------------ | ---------- | -------------------- | ---------------- | ------------------------------------------------------------------------ |
| `text` on `bg` (neutral-700 on white)                  | 10.37:1    | PASS                 | PASS             | Primary body text.                                                       |
| `text-highlighted` on `bg` (neutral-900 on white)      | 17.93:1    | PASS                 | PASS             | Headings, emphasized text.                                               |
| `text-toned` on `bg` (neutral-600 on white)            | 7.81:1     | PASS                 | PASS             | Secondary text.                                                          |
| `text-muted` on `bg` (neutral-500 on white)            | 4.74:1     | PASS                 | PASS             | Helper / caption text — used widely (e.g. `UFormField :help`).           |
| `text-dimmed` on `bg` (neutral-400 on white)           | **2.52:1** | **FAIL**             | FAIL             | **Incidental decoration only** — DO NOT use for essential body copy.     |
| `text` on `bg-muted` (neutral-700 on neutral-50)       | 9.93:1     | PASS                 | PASS             | Card bodies.                                                             |
| `text` on `bg-elevated` (neutral-700 on neutral-100)   | 9.51:1     | PASS                 | PASS             | Elevated surfaces.                                                       |
| `text-muted` on `bg-elevated` (neutral-500 on n-100)   | 4.35:1     | **FAIL-narrow**      | PASS             | Caption text on chips / cards — pass for UI, marginal for body.          |
| `text` on `bg-accented` (neutral-700 on neutral-200)   | 8.23:1     | PASS                 | PASS             | Hover / pressed states.                                                  |
| `text-muted` on `bg-accented` (neutral-500 on n-200)   | 3.76:1     | FAIL                 | PASS             | **Avoid muted helper text on accented backgrounds.**                     |
| `text-inverted` on `bg-primary` (white on black)       | 21.00:1    | PASS                 | PASS             | Primary buttons (ui-primary: black in light).                            |
| `border` on `bg` (neutral-200 on white)                | 1.26:1     | n/a                  | **FAIL-if-sole** | Decorative separator OK; for input outlines pair with focus ring (21:1). |
| `border-accented` on `bg` (neutral-300 on white)       | 1.48:1     | n/a                  | **FAIL-if-sole** | Same as above — must not be the only cue for essential UI controls.      |
| Focus ring (ui-primary=black) on `bg` (black on white) | 21.00:1    | n/a                  | PASS             | Keyboard focus indicator — meets AAA.                                    |
| `color="error"` icon / bg (red-500 on white)           | 3.76:1     | FAIL                 | PASS             | OK for non-text UI (icons, borders) but **avoid as body text color**.    |
| White text on `color="error"` bg (white on red-500)    | 3.76:1     | FAIL                 | PASS             | Large-text only; for small body label use `variant="outline"`.           |

## Dark mode

| Token pair                                               | Ratio   | WCAG-AA Body (4.5:1) | WCAG-AA UI (3:1) | Notes                                                         |
| -------------------------------------------------------- | ------- | -------------------- | ---------------- | ------------------------------------------------------------- |
| `text` on `bg` (neutral-200 on neutral-900)              | 14.23:1 | PASS                 | PASS             | Primary body text.                                            |
| `text-highlighted` on `bg` (white on neutral-900)        | 17.93:1 | PASS                 | PASS             | Headings.                                                     |
| `text-toned` on `bg` (neutral-300 on neutral-900)        | 12.09:1 | PASS                 | PASS             | Secondary text.                                               |
| `text-muted` on `bg` (neutral-400 on neutral-900)        | 7.11:1  | PASS                 | PASS             | Helper text.                                                  |
| `text-dimmed` on `bg` (neutral-500 on neutral-900)       | 3.78:1  | FAIL                 | PASS             | **Incidental decoration only** (same policy as light mode).   |
| `text` on `bg-muted` (neutral-200 on neutral-800)        | 12.01:1 | PASS                 | PASS             | Card bodies.                                                  |
| `text-muted` on `bg-muted` (neutral-400 on n-800)        | 6.00:1  | PASS                 | PASS             | Caption on cards.                                             |
| `text` on `bg-accented` (neutral-200 on neutral-700)     | 8.23:1  | PASS                 | PASS             | Hover states.                                                 |
| `text-muted` on `bg-accented` (neutral-400 on n-700)     | 4.11:1  | **FAIL-narrow**      | PASS             | Marginal for small text — prefer `text` over `text-muted`.    |
| `border` on `bg` (neutral-800 on neutral-900)            | 1.18:1  | n/a                  | **FAIL-if-sole** | Decorative separator; must pair with focus ring for controls. |
| `border-accented` on `bg` (neutral-700 on neutral-900)   | 1.73:1  | n/a                  | **FAIL-if-sole** | Decorative separator; same policy.                            |
| `text-inverted` on `bg-primary` (black on white in dark) | 21.00:1 | PASS                 | PASS             | Primary buttons invert in dark.                               |
| `color="error"` text (red-500 on neutral-900)            | 4.76:1  | PASS                 | PASS             | Safe for error messages in dark mode.                         |

## Usage policy (derived from the audit)

These are enforced via code review and the `/audit` skill, not via automated
lint (no off-the-shelf tool validates Nuxt UI token usage).

1. **NEVER** use `text-dimmed` for essential / actionable copy. Reserve for
   decorative hints where losing the hint does not degrade the task (e.g.,
   "歷史記錄將在未來版本提供"). If the copy matters, upgrade to `text-muted`.
2. **NEVER** combine `text-muted` with `bg-accented` for small body text in
   light mode (3.76:1 — fails AA). Either lighten the bg to `bg-muted`
   (4.35:1) or darken the text to `text-toned` (≥ 7.8:1).
3. **NEVER** rely solely on border colour (`border-default` / `border-muted`)
   to communicate interactive state. Pair with:
   - a focus ring (provided by `:focus-visible` via `ui-primary`, 21:1), or
   - an icon / text label, or
   - a filled background variant (`variant="soft"` / `variant="solid"`).
4. **NEVER** use `color="error"` + `variant="solid"` for a button label that
   is small (< 14pt). In light mode white-on-red-500 is 3.76:1. Prefer
   `variant="outline"` or `variant="soft"` so the text inherits `text-error`
   (which inherits from `--ui-color-error` on the primary bg — pairs with
   `bg` for 3.76:1 on UI but 4.5:1+ on larger text).
5. **ALWAYS** verify a dark-mode screenshot pass after altering a
   token-heavy component. Dark tokens are slightly looser on
   `text-muted + bg-accented` (4.11:1) — watch for helper text regressions.

## Why we do not override the tokens

The default Nuxt UI 4 neutral palette is WCAG-aligned for the **standard
usage patterns** (headings, body, primary buttons). The two risk surfaces
above (`text-dimmed`, `border-only UI`) exist by design to give the neutral
palette its full range. Overriding them globally would compress the tonal
range that the layout / typography work in §§1-5 depends on.

Instead we codify the usage policy above and let `/audit` + the manual
review checklist catch violations per-surface.

## References

- Nuxt UI 4 tokens: `node_modules/@nuxt/ui/dist/runtime/index.css`
- Project colour config: `app/app.config.ts`, `app/assets/css/main.css`
- Tailwind neutral palette:
  <https://tailwindcss.com/docs/colors#default-color-palette-reference>
- WCAG 2.1 SC 1.4.3 (contrast minimum), SC 1.4.11 (non-text contrast)

Last verified: 2026-04-19 against Tailwind 4.2.2 + Nuxt UI 4.6.1.
