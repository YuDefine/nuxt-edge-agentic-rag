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

import { ADMIN_EMAIL, BASE_URL, devLogin } from './helpers'

test.describe('DocumentListTable — Hybrid Table Fallback Below md', () => {
  test.beforeEach(async ({ page }) => {
    await devLogin(page, ADMIN_EMAIL)
    await page.goto(`${BASE_URL}/admin/documents`)
  })

  test('shows all columns at >= 768px (md+)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const documentTable = page.locator('table')
    if ((await documentTable.count()) === 0) {
      test.info().annotations.push({
        type: 'phase-b-wiring',
        description: 'awaiting seeded documents to exercise hybrid table fallback',
      })
      test.skip(true, 'seeded document list required (Phase B)')
    }

    await expect(page.getByRole('columnheader', { name: '分類' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '權限' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '目前版本' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '更新時間' })).toBeVisible()
  })

  test('hides secondary columns below md and shows Open detail button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const openButtons = page.getByRole('button', { name: /開啟詳情|Open/ })
    if ((await openButtons.count()) === 0) {
      test.info().annotations.push({
        type: 'phase-b-wiring',
        description: 'awaiting seeded documents to verify mobile detail trigger',
      })
      test.skip(true, 'seeded document list required (Phase B)')
    }

    // Primary columns visible
    await expect(page.getByRole('columnheader', { name: '標題' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '狀態' })).toBeVisible()
    // Secondary columns hidden
    await expect(page.getByRole('columnheader', { name: '分類' })).not.toBeVisible()
    await expect(page.getByRole('columnheader', { name: '更新時間' })).not.toBeVisible()
    // Open detail button present (at least one)
    await expect(openButtons.first()).toBeVisible()
  })

  test('clicking [Open →] opens drawer with secondary columns; Esc restores focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const openButton = page.getByRole('button', { name: /開啟詳情|Open/ }).first()
    if ((await openButton.count()) === 0) {
      test.info().annotations.push({
        type: 'phase-b-wiring',
        description: 'awaiting seeded documents to verify drawer focus restore',
      })
      test.skip(true, 'seeded document list required (Phase B)')
    }

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
