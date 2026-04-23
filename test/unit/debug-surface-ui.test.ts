import { describe, expect, it } from 'vitest'

import { buildAppNavLinks } from '~/composables/useAppNavigation'

/**
 * Unit tests for `Debug 延遲` navigation entry gating.
 *
 * Mirrors the server-side contract in `server/utils/debug-surface-guard.ts`:
 * the public flag `debugSurfaceEnabled` is an effective-access UI hint —
 * true for local/staging and for production only when the operator flips
 * `NUXT_DEBUG_SURFACE_ENABLED=true`. UI must hide the entry whenever the
 * mirror is false, so admins never land on a 403.
 */
describe('app navigation — Debug 延遲 entry gating', () => {
  it('hides Debug 延遲 for non-admin users', () => {
    const links = buildAppNavLinks({
      isAdmin: false,
      dashboardEnabled: true,
      debugSurfaceEnabled: true,
    })
    expect(links.map((l) => l.to)).not.toContain('/admin/debug/latency')
  })

  it('shows Debug 延遲 when admin and debug surface is enabled', () => {
    const links = buildAppNavLinks({
      isAdmin: true,
      dashboardEnabled: true,
      debugSurfaceEnabled: true,
    })
    expect(links.map((l) => l.to)).toContain('/admin/debug/latency')
  })

  it('hides Debug 延遲 when admin but debug surface is disabled (production + flag off)', () => {
    const links = buildAppNavLinks({
      isAdmin: true,
      dashboardEnabled: true,
      debugSurfaceEnabled: false,
    })
    expect(links.map((l) => l.to)).not.toContain('/admin/debug/latency')
  })

  it('keeps 問答 entry regardless of gating', () => {
    const links = buildAppNavLinks({
      isAdmin: false,
      dashboardEnabled: false,
      debugSurfaceEnabled: false,
    })
    expect(links.map((l) => l.to)).toContain('/')
  })
})
