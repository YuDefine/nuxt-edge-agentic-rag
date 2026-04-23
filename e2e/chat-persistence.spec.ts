import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirnameCompat = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirnameCompat, '..')
const SCREENSHOT_DIR = path.resolve(REPO_ROOT, 'screenshots/chat-persistence')
const EVIDENCE_DIR = path.resolve(REPO_ROOT, 'docs/verify/evidence')
const EVIDENCE_FILE = path.resolve(EVIDENCE_DIR, 'web-chat-persistence.json')
const CREATED_CONVERSATION_ID = '11111111-1111-4111-8111-111111111111'
const SEEDED_CONVERSATION_ID = '22222222-2222-4222-8222-222222222222'
const CREATED_TITLE = '第一個持久化問題'
const SEEDED_TITLE = '先前保存的對話'

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

interface MockMessage {
  id: string
  role: 'user' | 'assistant'
  contentRedacted: string
  contentText: string | null
  citationsJson: string
  createdAt: string
}

interface MockConversation {
  id: string
  title: string
  accessLevel: string
  createdAt: string
  updatedAt: string
  userProfileId: string | null
  deletedAt: string | null
  messages: MockMessage[]
}

interface ChatRequestLog {
  conversationId?: string
  query: string
}

interface EvidenceCheckpoint {
  checkpoint: 'create' | 'reload' | 'select' | 'follow_up' | 'delete'
  assertions: string[]
  screenshot: string
}

function createMessage(input: {
  id: string
  role: 'user' | 'assistant'
  content: string
  citationsJson?: string
  createdAt: string
}): MockMessage {
  return {
    id: input.id,
    role: input.role,
    contentRedacted: input.content,
    contentText: input.content,
    citationsJson: input.citationsJson ?? '[]',
    createdAt: input.createdAt,
  }
}

function createSeededConversation(): MockConversation {
  const createdAt = '2026-04-23T08:00:00.000Z'
  const updatedAt = '2026-04-23T08:05:00.000Z'

  return {
    id: SEEDED_CONVERSATION_ID,
    title: SEEDED_TITLE,
    accessLevel: 'internal',
    createdAt,
    updatedAt,
    userProfileId: null,
    deletedAt: null,
    messages: [
      createMessage({
        id: 'seed-user-1',
        role: 'user',
        content: '先前保存的問題',
        createdAt,
      }),
      createMessage({
        id: 'seed-assistant-1',
        role: 'assistant',
        content: '先前保存的回答：這是從伺服器重建的訊息。',
        citationsJson: JSON.stringify([
          {
            citationId: 'cite-seeded-1',
            sourceChunkId: 'chunk-seeded-1',
          },
        ]),
        createdAt: updatedAt,
      }),
    ],
  }
}

function toSummary(conversation: MockConversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    accessLevel: conversation.accessLevel,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    userProfileId: conversation.userProfileId,
  }
}

function toDetail(conversation: MockConversation) {
  return {
    ...toSummary(conversation),
    messages: conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      contentRedacted: message.contentRedacted,
      contentText: message.contentText,
      citationsJson: message.citationsJson,
      createdAt: message.createdAt,
    })),
  }
}

async function captureCheckpoint(
  page: Page,
  evidence: EvidenceCheckpoint[],
  input: EvidenceCheckpoint,
): Promise<void> {
  const screenshotPath = path.resolve(REPO_ROOT, input.screenshot)

  await page.screenshot({
    fullPage: true,
    path: screenshotPath,
  })

  evidence.push(input)
}

async function installConversationRoutes(
  page: Page,
  options: {
    omitCreatedConversationFromNextListOnce?: boolean
  } = {},
) {
  const conversations = new Map<string, MockConversation>([
    [SEEDED_CONVERSATION_ID, createSeededConversation()],
  ])
  const chatRequests: ChatRequestLog[] = []
  const detailReadLog: string[] = []
  const deleteLog: string[] = []
  const listReadLog: string[] = []
  let omitCreatedConversationFromNextListOnce =
    options.omitCreatedConversationFromNextListOnce === true

  await page.route('**/api/guest-policy/effective', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { value: 'same_as_member' } }),
    })
  })

  await page.route('**/api/chat', async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      conversationId?: string
      query?: string
    }
    const query = body.query ?? ''

    chatRequests.push({
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      query,
    })

    if (!body.conversationId) {
      const createdAt = '2026-04-23T09:00:00.000Z'
      const updatedAt = '2026-04-23T09:00:05.000Z'
      const conversation: MockConversation = {
        id: CREATED_CONVERSATION_ID,
        title: CREATED_TITLE,
        accessLevel: 'internal',
        createdAt,
        updatedAt,
        userProfileId: null,
        deletedAt: null,
        messages: [
          createMessage({
            id: 'created-user-1',
            role: 'user',
            content: CREATED_TITLE,
            createdAt,
          }),
          createMessage({
            id: 'created-assistant-1',
            role: 'assistant',
            content: '第一輪回覆：持久化測試答案。',
            citationsJson: JSON.stringify([
              {
                citationId: 'cite-created-1',
                sourceChunkId: 'chunk-created-1',
              },
            ]),
            createdAt: updatedAt,
          }),
        ],
      }

      conversations.set(conversation.id, conversation)

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            answer: '第一輪回覆：持久化測試答案。',
            citations: [
              {
                citationId: 'cite-created-1',
                sourceChunkId: 'chunk-created-1',
              },
            ],
            conversationCreated: true,
            conversationId: CREATED_CONVERSATION_ID,
            refused: false,
          },
        }),
      })

      return
    }

    const conversation = conversations.get(body.conversationId)
    if (!conversation || conversation.deletedAt) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 404, message: '找不到此對話' }),
      })
      return
    }

    const userCreatedAt = '2026-04-23T09:01:00.000Z'
    const assistantCreatedAt = '2026-04-23T09:01:05.000Z'
    conversation.updatedAt = assistantCreatedAt
    conversation.messages.push(
      createMessage({
        id: 'created-user-2',
        role: 'user',
        content: query,
        createdAt: userCreatedAt,
      }),
      createMessage({
        id: 'created-assistant-2',
        role: 'assistant',
        content: '第二輪回覆：沿用同一個 conversationId。',
        citationsJson: JSON.stringify([
          {
            citationId: 'cite-created-2',
            sourceChunkId: 'chunk-created-2',
          },
        ]),
        createdAt: assistantCreatedAt,
      }),
    )

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          answer: '第二輪回覆：沿用同一個 conversationId。',
          citations: [
            {
              citationId: 'cite-created-2',
              sourceChunkId: 'chunk-created-2',
            },
          ],
          conversationCreated: false,
          conversationId: conversation.id,
          refused: false,
        },
      }),
    })
  })

  await page.route('**/api/conversations**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const detailMatch = url.pathname.match(/^\/api\/conversations\/([0-9a-f-]+)$/i)

    if (request.method() === 'GET' && url.pathname === '/api/conversations') {
      listReadLog.push(new Date().toISOString())
      const visible = [...conversations.values()]
        .filter((conversation) => conversation.deletedAt === null)
        .filter((conversation) => {
          if (!omitCreatedConversationFromNextListOnce) {
            return true
          }

          const shouldOmit = conversation.id === CREATED_CONVERSATION_ID
          if (shouldOmit) {
            omitCreatedConversationFromNextListOnce = false
          }

          return !shouldOmit
        })
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(toSummary)

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: visible }),
      })
      return
    }

    if (detailMatch && request.method() === 'GET') {
      const conversationId = detailMatch[1]
      detailReadLog.push(conversationId)
      const conversation = conversations.get(conversationId)

      if (!conversation || conversation.deletedAt) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 404, message: '找不到此對話' }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: toDetail(conversation) }),
      })
      return
    }

    if (detailMatch && request.method() === 'DELETE') {
      const conversationId = detailMatch[1]
      deleteLog.push(conversationId)
      const conversation = conversations.get(conversationId)

      if (!conversation) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 404, message: '找不到此對話' }),
        })
        return
      }

      const deletedAt = '2026-04-23T09:02:00.000Z'
      conversation.deletedAt = deletedAt
      conversation.updatedAt = deletedAt
      conversation.title = '[Deleted conversation]'
      conversation.messages = conversation.messages.map((message) => ({
        ...message,
        contentText: null,
      }))

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            conversationId,
            deletedAt,
            alreadyDeleted: false,
          },
        }),
      })
      return
    }

    await route.fallback()
  })

  return {
    chatRequests,
    deleteLog,
    detailReadLog,
    listReadLog,
  }
}

async function installAuthenticatedSession(page: Page): Promise<void> {
  await page.route('**/api/auth/get-session**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: {
          createdAt: '2026-04-23T07:30:00.000Z',
          expiresAt: '2026-04-30T07:30:00.000Z',
          id: 'session-1',
          token: 'session-token-for-e2e',
          updatedAt: '2026-04-23T07:30:00.000Z',
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
}

test('web chat persistence covers create, reload, select, follow-up, and delete', async ({
  page,
}) => {
  test.slow()

  const evidence: EvidenceCheckpoint[] = []
  await installAuthenticatedSession(page)
  const routes = await installConversationRoutes(page)

  await page.goto('/')

  const historyPanel = page.locator('aside[aria-label="對話記錄"]')
  const chatRegion = page.locator('section[aria-label="知識庫問答"]')
  const input = page.getByRole('textbox').first()
  const sendButton = page.getByRole('button', { name: '送出' })

  await expect.poll(() => routes.listReadLog.length).toBeGreaterThan(0)
  await expect(historyPanel.getByText(SEEDED_TITLE)).toBeVisible()

  await input.fill(CREATED_TITLE)
  await sendButton.click()

  await expect(chatRegion.getByText('第一輪回覆：持久化測試答案。')).toBeVisible()
  await expect(historyPanel.getByText(CREATED_TITLE)).toBeVisible()
  await expect(chatRegion.getByRole('button', { name: '引用 1' }).first()).toBeVisible()
  expect(routes.chatRequests).toEqual([{ query: CREATED_TITLE }])

  await captureCheckpoint(page, evidence, {
    checkpoint: 'create',
    assertions: [
      '首次 /api/chat 請求未攜帶 conversationId。',
      '第一輪回答建立持久化對話並出現在歷史列表。',
      '建立後畫面可見引用按鈕，代表訊息與 citations 一起落地。',
    ],
    screenshot: 'screenshots/chat-persistence/01-create.png',
  })

  const detailReadsBeforeReload = routes.detailReadLog.length
  await page.reload()

  await expect(historyPanel.getByText(CREATED_TITLE)).toBeVisible()
  await expect(chatRegion.getByText(CREATED_TITLE)).toBeVisible()
  await expect(chatRegion.getByText('第一輪回覆：持久化測試答案。')).toBeVisible()
  await expect(chatRegion.getByRole('button', { name: '引用 1' }).first()).toBeVisible()
  expect(routes.detailReadLog.slice(detailReadsBeforeReload)).toContain(CREATED_CONVERSATION_ID)

  await captureCheckpoint(page, evidence, {
    checkpoint: 'reload',
    assertions: [
      '重新整理後，歷史列表仍可見剛建立的對話。',
      '重新整理後，訊息與引用由伺服器 detail read 重建，而非 client-only 記憶體。',
    ],
    screenshot: 'screenshots/chat-persistence/02-reload.png',
  })

  await historyPanel.locator('button').filter({ hasText: SEEDED_TITLE }).first().click()

  await expect(chatRegion.getByText('先前保存的問題')).toBeVisible()
  await expect(chatRegion.getByText('先前保存的回答：這是從伺服器重建的訊息。')).toBeVisible()
  await expect(chatRegion.getByText('第一輪回覆：持久化測試答案。')).toHaveCount(0)
  expect(routes.detailReadLog).toContain(SEEDED_CONVERSATION_ID)

  await captureCheckpoint(page, evidence, {
    checkpoint: 'select',
    assertions: [
      '選取歷史對話會用 detail API 取回該對話訊息。',
      '訊息窗格切換為所選對話內容，不再顯示其他對話的持久化訊息。',
    ],
    screenshot: 'screenshots/chat-persistence/03-select.png',
  })

  await historyPanel.locator('button').filter({ hasText: CREATED_TITLE }).first().click()
  await expect(chatRegion.getByText('第一輪回覆：持久化測試答案。')).toBeVisible()

  const listReadsBeforeFollowUp = routes.listReadLog.length
  await input.fill('第二個持久化問題')
  await sendButton.click()

  await expect(chatRegion.getByText('第二輪回覆：沿用同一個 conversationId。')).toBeVisible()
  expect(routes.chatRequests).toEqual([
    { query: CREATED_TITLE },
    {
      conversationId: CREATED_CONVERSATION_ID,
      query: '第二個持久化問題',
    },
  ])
  expect(routes.listReadLog).toHaveLength(listReadsBeforeFollowUp)

  await captureCheckpoint(page, evidence, {
    checkpoint: 'follow_up',
    assertions: [
      '續問時 /api/chat 會重用目前作用中的 conversationId。',
      '第二輪回答追加到同一個持久化對話，而不是另建 client-only session。',
      '同一對話續問不會額外重抓整份歷史清單。',
    ],
    screenshot: 'screenshots/chat-persistence/04-follow-up.png',
  })

  await page.getByRole('button', { name: `刪除對話 ${CREATED_TITLE}` }).click()
  await page.reload()

  await expect(historyPanel.getByText(CREATED_TITLE)).toHaveCount(0)
  await expect(chatRegion.getByText('第一輪回覆：持久化測試答案。')).toHaveCount(0)
  await expect(chatRegion.getByText('第二輪回覆：沿用同一個 conversationId。')).toHaveCount(0)
  await expect(historyPanel.getByText(SEEDED_TITLE)).toBeVisible()

  const deletedDetailStatus = await page.evaluate(async (conversationId) => {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      credentials: 'include',
    })

    return response.status
  }, CREATED_CONVERSATION_ID)

  const sessionStorageEntries = await page.evaluate(() => Object.entries(sessionStorage))

  expect(deletedDetailStatus).toBe(404)
  expect(routes.deleteLog).toEqual([CREATED_CONVERSATION_ID])
  expect(
    sessionStorageEntries.some(
      ([key, value]) =>
        key.startsWith('web-chat:active-conversation:') && value === CREATED_CONVERSATION_ID,
    ),
  ).toBe(false)

  await captureCheckpoint(page, evidence, {
    checkpoint: 'delete',
    assertions: [
      '刪除後，對話會從歷史列表與訊息窗格一併移除。',
      '重新整理後不會回復已刪除對話，detail read 直接回 404。',
      'sessionStorage 不再保留已刪除的 active conversation id。',
    ],
    screenshot: 'screenshots/chat-persistence/05-delete.png',
  })

  fs.writeFileSync(
    EVIDENCE_FILE,
    JSON.stringify(
      {
        command: 'pnpm exec playwright test e2e/chat-persistence.spec.ts',
        generatedAt: new Date().toISOString(),
        requestLog: routes.chatRequests,
        detailReadLog: routes.detailReadLog,
        deleteLog: routes.deleteLog,
        listReadLog: routes.listReadLog,
        checkpoints: evidence,
        spec: 'e2e/chat-persistence.spec.ts',
      },
      null,
      2,
    ),
  )
})

test('chat history actions stay locked while a response is still in flight', async ({ page }) => {
  let releaseChatResponse: (() => void) | null = null

  await installAuthenticatedSession(page)
  const routes = await installConversationRoutes(page)

  await page.route('**/api/chat', async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      conversationId?: string
      query?: string
    }

    routes.chatRequests.push({
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      query: body.query ?? '',
    })

    await new Promise<void>((resolve) => {
      releaseChatResponse = resolve
    })

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          answer: '延遲回覆完成。',
          citations: [],
          conversationCreated: false,
          conversationId: SEEDED_CONVERSATION_ID,
          refused: false,
        },
      }),
    })
  })

  await page.goto('/')

  const historyPanel = page.locator('aside[aria-label="對話記錄"]')
  const input = page.getByRole('textbox').first()
  const sendButton = page.getByRole('button', { name: '送出' })
  const seededConversationButton = historyPanel
    .locator('button')
    .filter({ hasText: SEEDED_TITLE })
    .first()
  const deleteButton = page.getByRole('button', { name: `刪除對話 ${SEEDED_TITLE}` })

  await input.fill('等待中問題')
  await sendButton.click()

  await expect(seededConversationButton).toBeDisabled()
  await expect(deleteButton).toBeDisabled()

  releaseChatResponse?.()

  await expect(page.getByText('延遲回覆完成。')).toBeVisible()
  await expect(seededConversationButton).toBeEnabled()
  await expect(deleteButton).toBeEnabled()
})

test('newly created conversation survives one stale history refresh snapshot', async ({ page }) => {
  await installAuthenticatedSession(page)
  await installConversationRoutes(page, {
    omitCreatedConversationFromNextListOnce: true,
  })

  await page.goto('/')

  const historyPanel = page.locator('aside[aria-label="對話記錄"]')
  const chatRegion = page.locator('section[aria-label="知識庫問答"]')
  const input = page.getByRole('textbox').first()
  const sendButton = page.getByRole('button', { name: '送出' })

  await input.fill(CREATED_TITLE)
  await sendButton.click()

  await expect(chatRegion.getByText('第一輪回覆：持久化測試答案。')).toBeVisible()
  await expect(historyPanel.getByText(CREATED_TITLE)).toHaveCount(0)

  await page.reload()

  await expect(chatRegion.getByText(CREATED_TITLE)).toBeVisible()
  await expect(chatRegion.getByText('第一輪回覆：持久化測試答案。')).toBeVisible()
  await expect(historyPanel.getByText(CREATED_TITLE)).toBeVisible()
})
