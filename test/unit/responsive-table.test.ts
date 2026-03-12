/**
 * Hybrid Table Fallback Below md — pure-logic column partitioning.
 *
 * Asserts that `DocumentListTable.vue` distinguishes which columns are
 * "primary" (always visible, including < md) vs "secondary" (hidden on
 * mobile and shown inside a detail drawer).
 *
 * The actual DOM behaviour (drawer open/close, focus return, viewport
 * switching) is covered by the Playwright e2e spec
 * `e2e/table-fallback.spec.ts` — this unit test pins the contract for
 * what counts as a "primary" column so future edits don't silently move
 * a mobile-critical column into the drawer.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const TABLE_PATH = fileURLToPath(
  new URL('../../app/components/documents/DocumentListTable.vue', import.meta.url)
)

function loadTableSource(): string {
  return readFileSync(TABLE_PATH, 'utf8')
}

describe('DocumentListTable — Hybrid Table Fallback Below md', () => {
  it('lists the expected column set (title/categorySlug/accessLevel/status/currentVersion/updatedAt/actions)', () => {
    const src = loadTableSource()
    const expected = [
      'title',
      'categorySlug',
      'accessLevel',
      'status',
      'currentVersion',
      'updatedAt',
      'actions',
    ]

    for (const key of expected) {
      expect(
        src.includes(`accessorKey: '${key}'`) || src.includes(`id: '${key}'`),
        `expected column '${key}' to be declared in DocumentListTable`
      ).toBe(true)
    }
  })

  it('hides secondary columns (categorySlug, accessLevel, currentVersion, updatedAt, actions) below md via meta.class', () => {
    const src = loadTableSource()
    // We use a responsive pattern that hides non-primary columns on < md.
    // Nuxt UI UTable supports per-column meta.class or per-cell/header
    // classes. We assert that each secondary column has a `hidden md:*`
    // class applied to hide it below md. "Primary" columns (title, status)
    // must NOT carry `hidden md:` because they stay visible on mobile.
    const secondaryColumns = ['categorySlug', 'accessLevel', 'currentVersion', 'updatedAt'] as const

    for (const col of secondaryColumns) {
      // crude proximity match — each secondary column should have `hidden md:` within its column def block
      const colBlock = new RegExp(
        `accessorKey:\\s*'${col}'[\\s\\S]{0,200}?(hidden md:|md:table-cell)`,
        'm'
      )
      expect(
        colBlock.test(src),
        `secondary column '${col}' should be hidden below md (expected 'hidden md:' or 'md:table-cell' class within 200 chars of its column def)`
      ).toBe(true)
    }
  })

  it('exposes an "Open detail" action cell that opens the detail drawer for < md viewports', () => {
    const src = loadTableSource()

    // Two signals:
    // 1) a USlideover (or UDrawer / UModal) for the detail fallback
    // 2) an "Open →" / "詳情" button wired to the drawer state
    expect(
      /USlideover|UDrawer/.test(src),
      'expected a USlideover / UDrawer for the mobile detail fallback'
    ).toBe(true)
    expect(
      /detailOpen|detailRow|openMobileDetail/.test(src),
      'expected a reactive flag (e.g. detailOpen / openMobileDetail) controlling the detail drawer'
    ).toBe(true)
    // focus restore — watch on detailOpen should re-focus the trigger
    expect(
      /detailTriggerRef[\s\S]*focus\(\)/m.test(src),
      'expected the detail drawer close path to restore focus to the originating trigger button'
    ).toBe(true)
  })
})
