/**
 * Hybrid Table Fallback Below md — Playwright e2e.
 *
 * Verifies the DocumentListTable hybrid behaviour:
 *  a) >= 768px: all columns visible inside UTable
 *  b) < 768px: only title/status + `[Open →]` action visible per row
 *  c) clicking `[Open →]` opens the detail drawer with the remaining columns
 *  d) closing the drawer restores focus to the originating `[Open →]` button
 *
 * The spec is defined here so the Phase A subagent can sign off the red
 * state. It runs against `/admin/documents`, which requires an admin
 * session — Phase B will wire the seeded admin login + mock data before
 * running this in CI.
 */
import { expect, test } from '@playwright/test'

test.describe('DocumentListTable — Hybrid Table Fallback Below md', () => {
  test.beforeEach(async ({ page }) => {
    // Admin auth setup lives in Phase B (helpers.ts gains an admin seed).
    // For now we navigate and assume the dev-login helper is in place.
    await page.goto('/admin/documents')
  })

  test('shows all columns at >= 768px (md+)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByRole('columnheader', { name: '分類' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '權限' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '目前版本' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '更新時間' })).toBeVisible()
  })

  test('hides secondary columns below md and shows Open detail button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    // Primary columns visible
    await expect(page.getByRole('columnheader', { name: '標題' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '狀態' })).toBeVisible()
    // Secondary columns hidden
    await expect(page.getByRole('columnheader', { name: '分類' })).not.toBeVisible()
    await expect(page.getByRole('columnheader', { name: '更新時間' })).not.toBeVisible()
    // Open detail button present (at least one)
    const openButtons = page.getByRole('button', { name: /開啟詳情|Open/ })
    await expect(openButtons.first()).toBeVisible()
  })

  test('clicking [Open →] opens drawer with secondary columns; Esc restores focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const openButton = page.getByRole('button', { name: /開啟詳情|Open/ }).first()
    await openButton.focus()
    await openButton.click()

    // Drawer shows secondary metadata
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText(/分類|Category/)).toBeVisible()
    await expect(drawer.getByText(/更新時間|Updated/)).toBeVisible()

    // Esc closes drawer and focus returns to the originating button
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
    await expect(openButton).toBeFocused()
  })
})
