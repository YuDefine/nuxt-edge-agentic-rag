import { expect, test, type Page } from '@playwright/test'

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
  createConversation('today', '今天的對話', new Date(2026, 3, 24, 10).toISOString()),
  createConversation('earlier', '更早的對話', new Date(2026, 2, 20, 10).toISOString()),
]

async function installAuthenticatedChat(
  page: Page,
  conversations = seededConversations,
): Promise<{ getListFetchCount: () => number }> {
  const activeConversations = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  )
  let listFetchCount = 0

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
      listFetchCount += 1
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
            messages: [],
          },
        }),
      })
      return
    }

    await route.fallback()
  })

  return {
    getListFetchCount: () => listFetchCount,
  }
}

test.describe('chat home conversation history fetch dedup', () => {
  test('signed-in user loading home triggers only one GET /api/conversations', async ({ page }) => {
    const { getListFetchCount } = await installAuthenticatedChat(page)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    // Wait for the inline sidebar to render and show a conversation row so
    // we know the fetch completed before we snapshot the count.
    await expect(page.locator('aside[aria-label="對話記錄"]')).toBeVisible()
    await expect(page.getByRole('button', { name: '今天 1' })).toBeVisible()

    expect(getListFetchCount()).toBe(1)
  })

  test('drawer and sidebar on the same entry share one GET /api/conversations', async ({
    page,
  }) => {
    const { getListFetchCount } = await installAuthenticatedChat(page)

    // Render below the lg breakpoint so the drawer is the primary surface.
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/')

    await page.getByRole('button', { name: '開啟對話記錄' }).click()
    await expect(page.getByRole('dialog', { name: '對話記錄' })).toBeVisible()
    await expect(page.getByRole('button', { name: '今天 1' })).toBeVisible()

    expect(getListFetchCount()).toBe(1)
  })
})
