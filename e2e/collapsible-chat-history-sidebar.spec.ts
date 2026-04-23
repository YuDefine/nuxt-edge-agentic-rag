import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirnameCompat = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirnameCompat, '..')
const SCREENSHOT_DIR = path.resolve(REPO_ROOT, 'screenshots/collapsible-chat-history-sidebar')

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

interface MockConversation {
  id: string
  title: string
  accessLevel: string
  createdAt: string
  updatedAt: string
  userProfileId: string | null
}

const seededConversations: MockConversation[] = [
  createConversation('today', '今天的對話', new Date(2026, 3, 24, 10).toISOString()),
  createConversation('yesterday', '昨天的對話', new Date(2026, 3, 23, 10).toISOString()),
  createConversation('week', '本週的對話', new Date(2026, 3, 20, 10).toISOString()),
  createConversation('month', '本月的對話', new Date(2026, 3, 4, 10).toISOString()),
  createConversation('earlier', '更早的對話', new Date(2026, 2, 20, 10).toISOString()),
]

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

async function installAuthenticatedChat(page: Page, conversations = seededConversations) {
  const activeConversations = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  )

  await page.route('**/api/auth/get-session**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: {
          createdAt: '2026-04-24T01:00:00.000Z',
          expiresAt: '2026-05-01T01:00:00.000Z',
          id: 'session-1',
          token: 'session-token',
          updatedAt: '2026-04-24T01:00:00.000Z',
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
                id: `${conversation.id}-message`,
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

    if (detailMatch && request.method() === 'DELETE') {
      activeConversations.delete(detailMatch[1] ?? '')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            alreadyDeleted: false,
            conversationId: detailMatch[1],
            deletedAt: '2026-04-24T02:00:00.000Z',
          },
        }),
      })
      return
    }

    await route.fallback()
  })
}

async function capture(page: Page, name: string) {
  await page.screenshot({
    fullPage: true,
    path: path.resolve(SCREENSHOT_DIR, name),
  })
}

async function tabUntilFocused(page: Page, selector: string, attempts = 12) {
  const target = page.locator(selector)
  for (let index = 0; index < attempts; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) {
      return
    }

    await page.keyboard.press('Tab')
  }
}

test.describe('collapsible chat history sidebar', () => {
  for (const [width, name] of [
    [360, 'xs'],
    [768, 'md'],
    [1024, 'lg'],
    [1440, 'xl'],
  ] as const) {
    test(`captures ${name} viewport without horizontal overflow`, async ({ page }) => {
      await installAuthenticatedChat(page)
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')

      if (width < 1024) {
        await page.getByRole('button', { name: '開啟對話記錄' }).click()
        await expect(page.getByRole('dialog', { name: '對話記錄' })).toBeVisible()
      } else {
        await expect(page.locator('aside[aria-label="對話記錄"]')).toBeVisible()
      }

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )

      expect(hasHorizontalOverflow).toBe(false)
      await capture(page, `${name}-viewport.png`)
    })
  }

  test('desktop grouping, collapse persistence, tooltip, keyboard, and delete behavior work', async ({
    page,
  }) => {
    await installAuthenticatedChat(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    const expandedSidebar = page.locator('aside[aria-label="對話記錄"]')
    await expect(expandedSidebar.getByRole('button', { name: '今天 1' })).toBeVisible()
    await expect(expandedSidebar.getByRole('button', { name: '昨天 1' })).toBeVisible()
    await expect(expandedSidebar.getByRole('button', { name: '本週 1' })).toBeVisible()
    await expect(expandedSidebar.getByRole('button', { name: '本月 1' })).toBeVisible()
    await expect(expandedSidebar.getByRole('button', { name: '更早 1' })).toBeVisible()
    await expect(expandedSidebar.getByText('本月的對話')).toHaveCount(0)

    await capture(page, 'desktop-expanded-light.png')

    await page.getByRole('button', { name: '更早 1' }).click()
    await expect(page.getByText('更早的對話')).toBeVisible()

    await page.getByRole('button', { name: '收合對話記錄' }).click()
    await expect(page.locator('aside[aria-label="對話記錄（已收合）"]')).toBeVisible()
    await expect(
      page.locator('aside[aria-label="對話記錄（已收合）"]').getByText('5'),
    ).toBeVisible()
    await expect(
      page.evaluate(() => localStorage.getItem('chat:history-sidebar:collapsed')),
    ).resolves.toBe('true')

    await page.getByRole('button', { name: '展開對話記錄' }).first().hover()
    await expect(page.locator('[role="tooltip"]').filter({ hasText: '展開對話記錄' })).toBeVisible()
    await capture(page, 'desktop-collapsed-light.png')

    await page.getByTestId('conversation-history-rail').click()
    await expect(page.locator('aside[aria-label="對話記錄"]')).toBeVisible()
    await expect(page.getByText('更早的對話')).toBeVisible()

    await page.getByRole('button', { name: '收合對話記錄' }).click()
    await page.reload()
    await expect(page.locator('aside[aria-label="對話記錄（已收合）"]')).toBeVisible()

    await tabUntilFocused(page, '[data-testid="chat-history-expand-toggle"]')
    await expect(page.getByTestId('chat-history-expand-toggle')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('aside[aria-label="對話記錄"]')).toBeVisible()

    await page.getByRole('button', { name: '更早 1' }).click()
    await expect(page.getByText('更早的對話')).toBeVisible()

    await page.getByRole('button', { name: '刪除對話 更早的對話' }).click()
    await expect(page.getByText('更早的對話')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '更早 1' })).toHaveCount(0)

    await page.getByRole('button', { name: '收合對話記錄' }).click()
    await expect(
      page.locator('aside[aria-label="對話記錄（已收合）"]').getByText('4'),
    ).toBeVisible()
  })

  test('drawer below lg keeps expanded grouped history', async ({ page }) => {
    await installAuthenticatedChat(page)
    await page.setViewportSize({ width: 768, height: 900 })
    await page.addInitScript(() => {
      localStorage.setItem('chat:history-sidebar:collapsed', 'true')
    })
    await page.goto('/')

    await expect(page.locator('aside[aria-label^="對話記錄"]')).toHaveCount(0)
    await page.getByRole('button', { name: '開啟對話記錄' }).click()

    const drawer = page.getByRole('dialog', { name: '對話記錄' })
    await expect(drawer.getByRole('button', { name: '今天 1' })).toBeVisible()
    await expect(drawer.getByText('今天的對話')).toBeVisible()
    await expect(drawer.getByText('本月的對話')).toHaveCount(0)
    await drawer.getByRole('button', { name: '本月 1' }).click()
    await expect(drawer.getByText('本月的對話')).toBeVisible()

    await capture(page, 'drawer-md-light.png')
  })

  test('empty state and dark mode rail stay readable', async ({ page }) => {
    await installAuthenticatedChat(page, [])
    await page.addInitScript(() => {
      localStorage.setItem('nuxt-color-mode', 'dark')
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await expect(
      page.getByText('尚無已保存對話。送出第一個問題後，這裡會出現對話歷史。'),
    ).toBeVisible()
    await page.getByRole('button', { name: '收合對話記錄' }).click()
    await expect(page.locator('aside[aria-label="對話記錄（已收合）"]')).toBeVisible()
    await expect(page.locator('aside[aria-label="對話記錄（已收合）"]').getByText('0')).toHaveCount(
      0,
    )

    await capture(page, 'desktop-collapsed-dark-empty.png')
  })

  test('localStorage write failure falls back to in-memory state without user-visible errors', async ({
    page,
  }) => {
    await installAuthenticatedChat(page)
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    await page.addInitScript(() => {
      const originalSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'chat:history-sidebar:collapsed') {
          throw new Error('localStorage disabled for sidebar test')
        }

        return originalSetItem.call(this, key, value)
      }
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await page.getByRole('button', { name: '收合對話記錄' }).click()
    await expect(page.locator('aside[aria-label="對話記錄（已收合）"]')).toBeVisible()

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('targeted axe scan has no violations in expanded sidebar and collapsed rail', async ({
    page,
  }) => {
    await installAuthenticatedChat(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await expect(page.locator('aside[aria-label="對話記錄"]')).toBeVisible()
    const expandedResults = await new AxeBuilder({ page })
      .include('aside[aria-label="對話記錄"]')
      .analyze()
    expect(expandedResults.violations, JSON.stringify(expandedResults.violations, null, 2)).toEqual(
      [],
    )

    await page.getByRole('button', { name: '收合對話記錄' }).click()
    const collapsedResults = await new AxeBuilder({ page })
      .include('aside[aria-label="對話記錄（已收合）"]')
      .analyze()

    expect(
      collapsedResults.violations,
      JSON.stringify(collapsedResults.violations, null, 2),
    ).toEqual([])
  })
})
