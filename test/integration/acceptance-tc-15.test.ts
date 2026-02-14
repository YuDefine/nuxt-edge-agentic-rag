import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { loadAcceptanceFixtureDataset } from '../acceptance/fixtures/loader'
import { createAcceptanceActorFixture } from '../acceptance/helpers/auth'
import {
  createAiSearchBindingFake,
  createCloudflareBindingsFixture,
  createD1BindingFake,
  createKvBindingFake,
  createWorkersAiBindingFake,
} from '../acceptance/helpers/bindings'
import { getAcceptanceRegistryEntry } from '../acceptance/registry/manifest'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

interface Tc15TestState {
  actor: ReturnType<typeof createAcceptanceActorFixture> | null
  bindings: ReturnType<typeof createCloudflareBindingsFixture> | null
  readBody: ReturnType<typeof vi.fn>
  runtimeConfig: ReturnType<typeof createKnowledgeRuntimeConfig> | null
}

// TC-15 高風險治理情境：含 credential pattern（如 sk-... api_key=...）必須觸發 shouldBlock
// 原文不得以任何形式寫入 messages / query_logs，也不得送入 Workers AI
const tc15Mocks = vi.hoisted(
  (): Tc15TestState => ({
    actor: null,
    bindings: null,
    readBody: vi.fn(),
    runtimeConfig: null,
  })
)

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/cloudflare-bindings', () => ({
  getCloudflareEnv: () => tc15Mocks.bindings ?? {},
  getRequiredD1Binding: () => (tc15Mocks.bindings ?? {}).DB,
  getRequiredKvBinding: () => (tc15Mocks.bindings ?? {}).KV,
}))

vi.mock('../../server/utils/knowledge-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-runtime')>()

  return {
    ...actual,
    getKnowledgeRuntimeConfig: () => tc15Mocks.runtimeConfig,
    getRuntimeAdminAccess: () => tc15Mocks.actor?.isAdmin ?? false,
  }
})

// hub:db 在測試環境無法 resolve，轉由 fake D1 binding 提供底層資料庫
vi.mock('../../server/utils/database', () => ({
  getD1Database: async () => (tc15Mocks.bindings ?? {}).DB,
}))

installNuxtRouteTestGlobals()

describe('acceptance high-risk redaction does not persist raw text (TC-15)', () => {
  const cases = loadAcceptanceFixtureDataset('seed').cases.filter(
    (entry) => entry.registryId === 'TC-15'
  )

  beforeEach(() => {
    tc15Mocks.actor = createAcceptanceActorFixture('user')
    tc15Mocks.bindings = null
    tc15Mocks.readBody.mockReset()
    tc15Mocks.runtimeConfig = createKnowledgeRuntimeConfig({
      bindings: {
        aiSearchIndex: 'knowledge-index',
        d1Database: 'DB',
        documentsBucket: 'DOCUMENTS',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    })

    vi.stubGlobal('readValidatedBody', tc15Mocks.readBody)
    vi.stubGlobal('requireUserSession', vi.fn().mockResolvedValue(tc15Mocks.actor?.webSession))
  })

  it.each(cases)('blocks %s and persists only redacted text', async (fixture) => {
    const registryEntry = getAcceptanceRegistryEntry(fixture.registryId) as {
      expectedHttpStatus: string
      id: string
      primaryOutcome: string
    } | null

    tc15Mocks.bindings = createTc15Bindings()
    tc15Mocks.readBody.mockResolvedValue({ query: fixture.prompt })

    expect(registryEntry).toMatchObject({
      expectedHttpStatus: '200',
      id: 'TC-15',
      primaryOutcome: 'refused',
    })
    expect(fixture.expectedOutcome).toBe('refused')
    expect(fixture.channel).toBe('web')

    // fixture prompt 必須含 credential pattern，才能命中 shouldBlock 路徑
    expect(
      /sk-[A-Za-z0-9]{10,}|api[_ -]?key\s*[:=]|password\s*[:=]|secret\s*[:=]|\btoken\s*[:=]/i.test(
        fixture.prompt
      )
    ).toBe(true)

    const { default: handler } = await import('../../server/api/chat.post')
    const result = await handler(createRouteEvent())

    // Refused path 必須回 refused:true、answer 為 null、無 citation
    expect(result).toEqual({
      data: {
        answer: null,
        citations: [],
        refused: true,
      },
    })

    const d1 = (tc15Mocks.bindings ?? {}).DB as ReturnType<typeof createD1BindingFake>
    const workersAi = (tc15Mocks.bindings ?? {}).WORKERS_AI as ReturnType<
      typeof createWorkersAiBindingFake
    >
    const aiBinding = (tc15Mocks.bindings ?? {}).AI as ReturnType<typeof createAiSearchBindingFake>

    const queryLogInsert = d1.calls.find((call) => call.query.includes('INSERT INTO query_logs'))
    const messageInsert = d1.calls.find((call) => call.query.includes('INSERT INTO messages'))

    // 必須寫入 query_logs，且 status='blocked'、redaction_applied=1、query_redacted_text 為遮罩版
    expect(queryLogInsert).toBeDefined()
    expect(queryLogInsert?.values).toEqual(
      expect.arrayContaining(['blocked', '[BLOCKED:credential]', 1])
    )

    // query_redacted_text 欄位位置（第 6 個 bind 參數）
    const queryRedactedText = queryLogInsert?.values[5]
    expect(queryRedactedText).toBe('[BLOCKED:credential]')
    expect(typeof queryRedactedText).toBe('string')
    // query_logs 的原始文字不得落地
    assertDoesNotContainRawPrompt(queryRedactedText as string, fixture.prompt)

    const riskFlagsJson = queryLogInsert?.values[6]
    expect(typeof riskFlagsJson).toBe('string')
    const riskFlags = JSON.parse(riskFlagsJson as string) as string[]
    expect(riskFlags).toContain('credential')

    // messages.content_redacted 必須是遮罩版；檢查所有 bind value 均不含原文
    expect(messageInsert).toBeDefined()
    for (const value of messageInsert?.values ?? []) {
      if (typeof value !== 'string') {
        continue
      }
      assertDoesNotContainRawPrompt(value, fixture.prompt)
    }

    // Workers AI 與 AI Search 不得在拒答路徑被呼叫（原文沒機會外洩到 LLM）
    expect(workersAi.calls).toHaveLength(0)
    expect(aiBinding.calls).toHaveLength(0)

    // 全部 D1 bind values 不得含原始 prompt 片段
    for (const call of d1.calls) {
      for (const value of call.values) {
        if (typeof value !== 'string') {
          continue
        }
        assertDoesNotContainRawPrompt(value, fixture.prompt)
      }
    }
  })
})

function assertDoesNotContainRawPrompt(value: string, prompt: string): void {
  // 挑出 prompt 中長度 >= 6 的英數字 token，視為可能的敏感原文片段
  const sensitiveTokens = prompt.match(/[A-Za-z0-9][A-Za-z0-9_-]{5,}/g) ?? []
  for (const token of sensitiveTokens) {
    if (token.toLowerCase() === 'password' || token.toLowerCase() === 'secret') {
      // 「password」「secret」等英文關鍵字可能出現在 risk flag JSON，不強制檢查
      continue
    }
    expect(value).not.toContain(token)
  }
}

function createTc15Bindings() {
  const d1 = createD1BindingFake({
    responders: [
      {
        match: /INSERT INTO query_logs/,
        resolve: () => ({ run: { success: true } }),
      },
      {
        match: /INSERT INTO messages/,
        resolve: () => ({ run: { success: true } }),
      },
    ],
  })
  const kv = createKvBindingFake()
  const ai = createAiSearchBindingFake()
  const workersAi = createWorkersAiBindingFake()

  return createCloudflareBindingsFixture({
    ai,
    d1,
    kv,
    workersAi,
  })
}
