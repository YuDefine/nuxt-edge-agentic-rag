/**
 * Tailwind theme token verification (Breakpoint Token Tiers).
 *
 * Verifies that the @theme block in `app/assets/css/main.css` declares
 * `--breakpoint-xs: 360px` so the `xs:` utility activates at >= 360px while
 * the default Tailwind breakpoints (sm/md/lg/xl) remain intact.
 *
 * This is a static source check — we read the CSS file and assert the
 * token is declared. We intentionally do NOT boot a real Tailwind compile
 * in unit tests (that is covered indirectly by `pnpm build`).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const MAIN_CSS_PATH = fileURLToPath(new URL('../../app/assets/css/main.css', import.meta.url))

function loadMainCss(): string {
  return readFileSync(MAIN_CSS_PATH, 'utf8')
}

describe('Tailwind theme — Breakpoint Token Tiers', () => {
  it('declares --breakpoint-xs: 360px inside @theme block', () => {
    const css = loadMainCss()

    // Locate the @theme block content
    const themeMatch = css.match(/@theme\s*\{([\s\S]*?)\n\}/m)
    expect(themeMatch, 'main.css must contain an @theme { ... } block').toBeTruthy()

    const themeBody = themeMatch![1] ?? ''

    // Accept any casing/whitespace variations but require exact value 360px
    const hasXsBreakpoint = /--breakpoint-xs\s*:\s*360px\s*;?/.test(themeBody)
    expect(
      hasXsBreakpoint,
      'Expected `--breakpoint-xs: 360px;` inside the @theme block so the `xs:` utility activates at 360px'
    ).toBe(true)
  })

  it('does not override default Tailwind breakpoints (sm/md/lg/xl)', () => {
    const css = loadMainCss()
    const themeMatch = css.match(/@theme\s*\{([\s\S]*?)\n\}/m)
    const themeBody = themeMatch?.[1] ?? ''

    // We only add xs. If someone redefines sm/md/lg/xl here, flag it so we
    // stay aligned with Tailwind defaults (per design.md "Breakpoint 六層策略").
    const overriddenDefaults = (['sm', 'md', 'lg', 'xl', '2xl'] as const).filter((name) =>
      new RegExp(`--breakpoint-${name}\\s*:`).test(themeBody)
    )

    expect(
      overriddenDefaults,
      `Do not redefine default Tailwind breakpoints in @theme; override detected: ${overriddenDefaults.join(', ')}`
    ).toHaveLength(0)
  })
})
