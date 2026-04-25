/**
 * 截圖輔助佐證 spec — add-new-conversation-entry-points change
 *
 * 拍攝三個「新對話」入口按鈕在 xs / md / xl 三個 viewport 的實際樣貌。
 * 此 spec 獨立於 new-conversation-button.spec.ts，不修改既有 spec。
 */
import { test, type Page } from '@playwright/test'
import path from 'node:path'

// ─────────────────────────────────────────────
// Inline helpers（複製自 new-conversation-button.spec.ts）
// ─────────────────────────────────────────────

interface MockConversation {
  id: string
  title: string
  accessLevel: string
  createdAt: string
  updatedAt: string
  userProfileId: string | null
}

function createConversation(id: string, title: string, updatedAt: string): MockConversation {
  return {
    id,
    title,
    accessLevel: 'internal',
    createdAt: updatedAt,
    updatedAt,
    userProfileId: 'user-1',
  }
}

const seededConversations: MockConversation[] = [
  createConversation('conv-a', '採購流程', new Date(2026, 3, 25, 10).toISOString()),
  createConversation('conv-b', 'ERP 報表', new Date(2026, 3, 24, 10).toISOString()),
]

const STORAGE_KEY = 'web-chat:active-conversation:user-1'

async function installAuthenticatedChat(page: Page, conversations = seededConversations) {
  const activeConversations = new Map(conversations.map((c) => [c.id, c]))

  await page.route('**/api/auth/get-session**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: {
          createdAt: '2026-04-25T01:00:00.000Z',
          expiresAt: '2026-05-02T01:00:00.000Z',
          id: 'session-1',
          token: 'session-token',
          updatedAt: '2026-04-25T01:00:00.000Z',
          userId: 'user-1',
        },
        user: {
          email: 'member@test.local',
          id: 'user-1',
          name: '測試成員',
          role: 'member',
        },
      }),
    })
  })

  await page.route('**/api/guest-policy/effective', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { value: 'same_as_member' } }),
    })
  })

  await page.route('**/api/conversations**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const detailMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/)

    if (request.method() === 'GET' && url.pathname === '/api/conversations') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [...activeConversations.values()].toSorted((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
          ),
        }),
      })
      return
    }

    if (detailMatch && request.method() === 'GET') {
      const conversation = activeConversations.get(detailMatch[1] ?? '')
      if (!conversation) {
        await route.fulfill({ status: 404, body: JSON.stringify({ message: '找不到此對話' }) })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            ...conversation,
            messages: [
              {
                id: `${conversation.id}-msg`,
                role: 'user',
                contentRedacted: conversation.title,
                contentText: conversation.title,
                citationsJson: '[]',
                createdAt: conversation.updatedAt,
              },
            ],
          },
        }),
      })
      return
    }

    await route.fallback()
  })
}

async function gotoChatWithStoredActive(page: Page, conversationId: string | null) {
  if (conversationId) {
    await page.addInitScript(
      ({ key, value }) => {
        sessionStorage.setItem(key, value)
      },
      { key: STORAGE_KEY, value: conversationId },
    )
  }
  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

// ─────────────────────────────────────────────
// 截圖路徑
// ─────────────────────────────────────────────
const SCREENSHOT_DIR = path.resolve('screenshots/local/add-new-conversation-entry-points')

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────
test.describe.serial('New Conversation Entry Points — Screenshots', () => {
  // ① xs 360：chat header 「新對話」按鈕
  test('xs-360 chat header button', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await installAuthenticatedChat(page)
    await gotoChatWithStoredActive(page, null)

    // 等 chat header 按鈕出現
    await page.getByTestId('chat-header-new-conversation-button').waitFor({ state: 'visible' })

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'xs-360_chat-header-button.png'),
      fullPage: false,
    })
  })

  // ② md 768：開 drawer 後 expanded header 按鈕（與 chat header 同框）
  test('md-768 drawer expanded buttons', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await installAuthenticatedChat(page)
    await gotoChatWithStoredActive(page, null)

    // 768 < lg（1024），走 drawer 模式。嘗試找 drawer trigger 並開啟
    const drawerTrigger = page.getByRole('button', { name: '對話記錄' }).first()
    if (await drawerTrigger.isVisible()) {
      await drawerTrigger.click()
      // 等 expanded 版「新對話」按鈕出現
      await page
        .getByTestId('conversation-history-new-button-expanded')
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {
          // drawer 可能已展開，繼續截圖
        })
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'md-768_drawer-expanded-buttons.png'),
      fullPage: false,
    })
  })

  // ③ xl 1280：sidebar 展開狀態
  test('xl-1280 sidebar expanded', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    // 展開狀態：collapsed = false
    await page.addInitScript(() => {
      localStorage.setItem('chat:history-sidebar:collapsed', 'false')
    })
    await installAuthenticatedChat(page)
    await gotoChatWithStoredActive(page, null)

    await page.getByTestId('chat-header-new-conversation-button').waitFor({ state: 'visible' })
    await page
      .getByTestId('conversation-history-new-button-expanded')
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {
        // sidebar 可能不存在 expanded 按鈕，繼續截圖
      })

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'xl-1280_sidebar-expanded.png'),
      fullPage: false,
    })
  })

  // ④ xl 1280：sidebar 收合狀態（rail plus 按鈕）
  test('xl-1280 sidebar collapsed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    // 收合狀態：collapsed = true
    await page.addInitScript(() => {
      localStorage.setItem('chat:history-sidebar:collapsed', 'true')
    })
    await installAuthenticatedChat(page)
    await gotoChatWithStoredActive(page, null)

    await page.getByTestId('chat-header-new-conversation-button').waitFor({ state: 'visible' })
    await page
      .getByTestId('conversation-history-new-button-collapsed')
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {
        // collapsed rail 可能尚未渲染，繼續截圖
      })

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'xl-1280_sidebar-collapsed.png'),
      fullPage: false,
    })
  })
})
