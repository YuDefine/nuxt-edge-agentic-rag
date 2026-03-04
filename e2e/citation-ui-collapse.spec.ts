import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BASE = 'http://localhost:3000'
const SCREENSHOT_DIR = path.join(__dirname, '../screenshots/local/citation-ui-collapse')

// Mock data
const MOCK_SESSION = {
  user: {
    id: 'test-admin-id',
    name: 'Admin',
    email: 'admin@test.local',
    role: 'admin',
    image: null,
  },
  session: {
    id: 'test-session-id',
    token: 'test-token',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
}

const MOCK_CHAT_RESPONSE = {
  data: {
    answer:
      '採購流程通常包含以下步驟：\n1. 需求確認：由需求部門填寫採購申請單\n2. 預算審核：財務部門確認預算是否充足\n3. 尋訪供應商：採購部門尋找合適的供應商並取得報價\n4. 比價評估：比較至少3家供應商的報價和品質\n5. 採購核准：依金額大小送相關主管審核\n6. 簽訂合約：與選定供應商簽訂採購合約\n7. 驗收入庫：收貨後進行品質驗收',
    citations: [
      { citationId: 'cit_mock_001', rank: 1 },
      { citationId: 'cit_mock_002', rank: 2 },
      { citationId: 'cit_mock_003', rank: 3 },
    ],
    refused: false,
  },
}

const MOCK_CITATION_RESPONSE = {
  data: {
    citationId: 'cit_mock_001',
    citationLocator: 'title:採購作業規範;page:3',
    documentTitle: '採購作業規範 2024',
    documentId: 'doc_mock_001',
    versionNumber: 2,
    isCurrentVersion: true,
    chunkText:
      '採購流程說明：\n第一步、需求部門填寫採購申請單，並經主管簽核後送交採購部。\n第二步、採購部門依據申請內容進行市場詢價，原則上應取得三家以上廠商報價。\n第三步、依金額進行簽核，5萬元以下由採購主管核准，5萬元以上需副總核准，50萬元以上需總經理核准。',
    admin: {
      documentVersionId: 'docver_mock_001',
      queryLogId: 'qlog_mock_abc123',
      sourceChunkId: 'chunk_mock_xyz789',
      expiresAt: '2026-05-19T06:42:00.000Z',
    },
  },
}

async function setupAllMocks(page: Page) {
  // Mock session endpoint (used by SSR plugin to determine loggedIn)
  await page.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SESSION),
    })
  })

  // Mock chat API
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CHAT_RESPONSE),
    })
  })

  // Mock citation detail API
  await page.route('**/api/citations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CITATION_RESPONSE),
    })
  })

  // Mock conversation history API (sidebar)
  await page.route('**/api/conversations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], pagination: { total: 0, page: 1, pageSize: 20 } }),
    })
  })
}

test.describe('Desktop citation UI @ 1920x1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('訊息下只有晶片列，點擊晶片彈出置中 Modal', async ({ page }) => {
    await setupAllMocks(page)

    // Navigate — mocks are active, SSR will see mocked session
    await page.goto(`${BASE}/`)
    await page.waitForLoadState('networkidle')

    // Screenshot: page after load (should show chat UI, not login)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop/00-page-load.png` })

    // Wait for chat textarea (confirms we're on the chat page, not login page)
    const textarea = page.locator('textarea#chat-message-input')
    await expect(textarea).toBeVisible({ timeout: 10_000 })

    // Screenshot: empty state / suggestion list
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop/01-empty-state.png` })

    // Submit question
    await textarea.fill('採購流程的步驟是什麼')
    await page.keyboard.press('Enter')

    // Wait for citation chips to appear
    await page.waitForSelector('button:has-text("引用 1")', { timeout: 15_000 })

    // Screenshot: response + citation chips
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop/02-response-with-citation-chips.png` })

    // ✅ Check 1: Only citation chips, no expanded card list below message
    const chips = page.locator('button').filter({ hasText: /^引用 \d+$/ })
    await expect(chips).toHaveCount(3)

    // Check no old-style expanded card list
    const expandedList = page.locator(
      '[data-testid="citation-card-list"], .citation-cards, details:has(.citation-card)'
    )
    await expect(expandedList).toHaveCount(0)

    // ✅ Check 2: Chip style — has file-text icon + "引用 N" text
    const firstChip = chips.first()
    await expect(
      firstChip.locator('.i-lucide-file-text, [class*="lucide:file-text"], svg')
    ).toBeVisible()

    // Click citation chip 1
    await firstChip.click()

    // ✅ Check 3: Desktop → UModal (renders as [role=dialog] centered)
    const modal = page.locator('[role="dialog"]')
    await expect(modal).toBeVisible({ timeout: 8_000 })

    // Screenshot: modal open
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop/03-citation-modal-open.png` })

    // Verify modal content
    await expect(modal).toContainText('引用內容')
    await expect(modal).toContainText('採購作業規範 2024')
    await expect(modal).toContainText('版本 v2')
    await expect(modal).toContainText('最新版')
    await expect(modal).toContainText('採購流程說明')

    // ✅ Check 4: Admin audit fields visible (admin role)
    const adminBlock = modal.locator('[data-testid="citation-admin-fields"]')
    await expect(adminBlock).toBeVisible()
    await expect(adminBlock).toContainText('qlog_mock_abc123')
    await expect(adminBlock).toContainText('chunk_mock_xyz789')

    // Screenshot: modal with admin fields
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop/04-modal-with-admin-audit.png` })

    // ✅ Check 5: Close button works (footer 關閉 button)
    await modal.locator('button', { hasText: '關閉' }).click()
    await page.waitForTimeout(600)
    await expect(modal).not.toBeVisible()

    // Screenshot: after close
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop/05-modal-closed.png` })

    // Reopen and test X button in header
    await firstChip.click()
    await expect(modal).toBeVisible({ timeout: 5_000 })

    // X button: icon button in modal header (has lucide-x icon)
    const xBtn = modal
      .locator('button')
      .filter({ has: page.locator('[class*="lucide-x"], [class*="lucide:x"], .i-lucide-x') })
      .first()
    if ((await xBtn.count()) > 0) {
      await xBtn.click()
      await page.waitForTimeout(600)
      await expect(modal).not.toBeVisible()
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop/06-after-x-close.png` })
  })
})

test.describe('Mobile citation UI @ 375x667', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('Mobile 點擊晶片彈出 Bottom Sheet (UDrawer)', async ({ page }) => {
    await setupAllMocks(page)

    await page.goto(`${BASE}/`)
    await page.waitForLoadState('networkidle')

    // Screenshot: mobile page load
    await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile/00-page-load.png` })

    // Wait for chat textarea
    const textarea = page.locator('textarea#chat-message-input')
    await expect(textarea).toBeVisible({ timeout: 10_000 })

    // Screenshot: mobile empty state
    await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile/01-empty-state.png` })

    // Submit question
    await textarea.fill('採購流程的步驟是什麼')
    await page.keyboard.press('Enter')

    // Wait for citation chips
    await page.waitForSelector('button:has-text("引用 1")', { timeout: 15_000 })

    // Screenshot: mobile response + citation chips
    await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile/02-response-with-citation-chips.png` })

    // Assert citation chips exist
    const chips = page.locator('button').filter({ hasText: /^引用 \d+$/ })
    await expect(chips).toHaveCount(3)

    // Click citation chip
    await chips.first().click()

    // ✅ Check: Mobile → UDrawer (bottom sheet)
    // UDrawer from @nuxt/ui v3 uses reka-ui under the hood
    // It renders with [role=dialog] + [data-state=open] or [data-vaul-drawer-visible]
    const drawerOrModal = page
      .locator(
        '[role="dialog"][data-state="open"], [role="dialog"]:visible, [data-vaul-drawer-visible="true"]'
      )
      .first()
    await expect(drawerOrModal).toBeVisible({ timeout: 8_000 })

    // Screenshot: bottom sheet open
    await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile/03-bottom-sheet-open.png` })

    // Verify content
    await expect(drawerOrModal).toContainText('引用內容')
    await expect(drawerOrModal).toContainText('採購作業規範 2024')

    // Wait for content to fully load
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile/04-drawer-content-loaded.png` })

    // Test close
    const closeBtn = page.locator('[role="dialog"] button', { hasText: '關閉' })
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
      await page.waitForTimeout(600)
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile/05-drawer-closed.png` })
  })
})
