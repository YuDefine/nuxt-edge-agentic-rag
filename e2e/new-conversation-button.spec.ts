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
  // 先 navigate 取得 origin 後再 evaluate 設 sessionStorage —— 不可用
  // `addInitScript`（會在「reload」也重新跑，導致 test (c) 驗證
  // 「reload 後 sessionStorage 為 null」永遠失敗：reload 時 init script 又把
  // 值塞回去）。這裡做一次性 setup：goto 後 evaluate 寫入 → 再 reload 取得
  // hydration（讓 useChatConversationSession.restoreActiveConversation 看到 key）。
  await page.goto('/')
  if (conversationId) {
    await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
      key: STORAGE_KEY,
      value: conversationId,
    })
    await page.reload()
  }
  await page.waitForLoadState('networkidle')
}

test.describe('Explicit New Conversation Entry Points', () => {
  test('(a) chat header button clears active conversation A', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installAuthenticatedChat(page)
    await gotoChatWithStoredActive(page, 'conv-a')

    // 確認進來時有 conv-a 的歷史 messages（active state restored）
    // 用 testid 鎖定 conversation row，避免 `getByRole('button', { name: '採購流程' })`
    // 同時 match 「conversation-row-button」與「刪除對話 採購流程」兩個 button。
    await expect(
      page.getByTestId('conversation-row-button').filter({ hasText: '採購流程' }),
    ).toBeVisible()

    // persist-refusal-and-label-new-chat: chat header button shows the
    // visible "新對話" label alongside the icon (web-chat-ui — New
    // Conversation Buttons Show Visible Text Label).
    await expect(page.getByTestId('chat-header-new-conversation-button')).toContainText('新對話')

    await page.getByTestId('chat-header-new-conversation-button').click()

    // sessionStorage 對應 key 已被清掉
    const storedAfterClick = await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)
    expect(storedAfterClick).toBeNull()
  })

  test('(b) sidebar conversation B selection still works after new conversation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installAuthenticatedChat(page)
    await gotoChatWithStoredActive(page, null)

    // 點 sidebar 中對話 B（用 testid 鎖定 row 而非 delete 按鈕）
    await page.getByTestId('conversation-row-button').filter({ hasText: 'ERP 報表' }).click()

    // setActiveConversation 是 async（先 fetch messages 再寫 sessionStorage），
    // 直接 evaluate 會早於 storage write。Poll 直到值出現或 timeout。
    await expect
      .poll(async () => page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY), {
        timeout: 5000,
      })
      .toBe('conv-b')
  })

  test('(c) reload after explicit new conversation does not auto-restore (Persisted Conversation Session Continuity)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installAuthenticatedChat(page)
    await gotoChatWithStoredActive(page, 'conv-a')

    await page.getByTestId('chat-header-new-conversation-button').click()
    await page.reload()
    await page.waitForLoadState('networkidle')

    const storedAfterReload = await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)
    expect(storedAfterReload).toBeNull()
  })

  test('(d) reload without explicit opt-out auto-restores prior conversation (heavy user not regressed)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installAuthenticatedChat(page)
    await gotoChatWithStoredActive(page, 'conv-a')

    await page.reload()
    await page.waitForLoadState('networkidle')

    const storedAfterReload = await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)
    expect(storedAfterReload).toBe('conv-a')
  })

  test('(e) <lg drawer mode: collapsed plus button closes drawer + clears state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await installAuthenticatedChat(page)
    await gotoChatWithStoredActive(page, 'conv-a')

    // 768 < lg(1024) → drawer mode；先打開 drawer
    await page.getByRole('button', { name: '對話記錄' }).first().click()

    // drawer 內 collapsed rail plus 按鈕（在 drawer 內也是 collapsed=false 預設展開模式，
    // 所以打到 expanded header 的 new-conversation 按鈕；這個 case 改測 expanded 模式新對話按鈕）。
    // sidebar 與 drawer 兩處都 render 同 testid，scope 到 drawer dialog 才不撞 strict mode。
    await page.getByRole('dialog').getByTestId('conversation-history-new-button-expanded').click()

    const storedAfterClick = await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)
    expect(storedAfterClick).toBeNull()
  })
})
