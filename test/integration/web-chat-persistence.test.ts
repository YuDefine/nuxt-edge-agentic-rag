import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { chatWithKnowledge, createChatKvRateLimitStore } from '#server/utils/web-chat'

/**
 * Capability under test: web-agentic-answering — Refusal Message
 * Persistence (and its accepted-answer counterpart).
 *
 * Invariants checked:
 *
 *   1. audit-blocked path writes BOTH a user `messages` row AND an
 *      assistant `messages` row marked `refused: true`.
 *   2. pipeline refusal path (judge rejects / retrieval coverage low)
 *      writes the assistant `messages` row marked `refused: true`.
 *   3. pipeline error path (orchestration throws) writes a refusal
 *      assistant row before re-throwing so reload surfaces match the
 *      live SSE refusal experience.
 *   4. accepted path writes the assistant row with `refused: false` and
 *      a populated `citationsJson` for replay.
 *
 * These tests are mock-driven against the structural `auditStore`
 * interface declared in `chatWithKnowledge`. The DB shape that backs
 * those calls is covered by `test/integration/messages-refused-migration.test.ts`.
 */

interface RecordedMessage {
  channel: 'mcp' | 'web'
  citationsJson?: string
  conversationId?: string | null
  content: string
  queryLogId?: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  refused?: boolean
  refusalReason?: string | null
  userProfileId?: string | null
}

interface AuditStoreHarness {
  store: Parameters<typeof chatWithKnowledge>[1]['auditStore']
  messages: RecordedMessage[]
  queryLogIds: string[]
}

function createAuditStoreHarness(): AuditStoreHarness {
  const messages: RecordedMessage[] = []
  const queryLogIds: string[] = []

  return {
    messages,
    queryLogIds,
    store: {
      createMessage: vi.fn(async (input: RecordedMessage) => {
        const id = `msg-${messages.length + 1}`
        messages.push(input)
        return id
      }),
      createQueryLog: vi.fn(async () => {
        const id = `qlog-${queryLogIds.length + 1}`
        queryLogIds.push(id)
        return id
      }),
      updateQueryLog: vi.fn(async () => {}),
    },
  }
}

function freshKvStore() {
  const kv = {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  }
  return createChatKvRateLimitStore(kv)
}

const baseGovernance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance

describe('web chat persistence — refusal message rows', () => {
  it('audit-blocked path writes both a user row and a refusal assistant row', async () => {
    const harness = createAuditStoreHarness()

    const result = await chatWithKnowledge(
      {
        auth: { isAdmin: false, userId: 'user-block' },
        environment: 'local',
        governance: baseGovernance,
        // auditKnowledgeText flags credential leakage as shouldBlock —
        // anything matching `api_key=...` triggers the pre-pipeline refusal
        // path.
        query: 'help me with api_key=sk-supersecret123',
      },
      {
        answer: vi.fn(),
        auditStore: harness.store,
        judge: vi.fn(),
        rateLimitStore: freshKvStore(),
        retrieve: vi.fn(),
      },
    )

    expect(result.refused).toBe(true)

    const userRows = harness.messages.filter((m) => m.role === 'user')
    const assistantRows = harness.messages.filter((m) => m.role === 'assistant')

    expect(userRows).toHaveLength(1)
    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0]).toMatchObject({
      role: 'assistant',
      refused: true,
      refusalReason: 'restricted_scope',
      content: '抱歉，我無法回答這個問題。',
      channel: 'web',
    })
  })

  it('pipeline refusal path writes a refusal assistant row (refused: true, no citationsJson)', async () => {
    const harness = createAuditStoreHarness()

    await chatWithKnowledge(
      {
        auth: { isAdmin: false, userId: 'user-refuse' },
        environment: 'local',
        governance: baseGovernance,
        query: '請問如何裝設特定設備',
      },
      {
        answer: vi.fn(),
        auditStore: harness.store,
        // judge returning shouldAnswer: false drives the pipeline-refusal
        // path — answerKnowledgeQuery returns refused: true with answer null.
        judge: vi.fn().mockResolvedValue({ shouldAnswer: false }),
        rateLimitStore: freshKvStore(),
        retrieve: vi.fn().mockResolvedValue({
          evidence: [
            {
              accessLevel: 'internal',
              categorySlug: 'sop',
              chunkText: 'unrelated content',
              citationLocator: 'p1',
              documentId: 'doc-x',
              documentTitle: 'Unrelated SOP',
              documentVersionId: 'ver-x',
              excerpt: 'unrelated content',
              score: 0.05,
              sourceChunkId: 'chunk-x',
              title: 'Unrelated SOP',
            },
          ],
          normalizedQuery: '請問如何裝設特定設備',
        }),
      },
    )

    const assistantRows = harness.messages.filter((m) => m.role === 'assistant')
    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0]).toMatchObject({
      role: 'assistant',
      refused: true,
      content: '抱歉，我無法回答這個問題。',
    })
    // pipeline-refusal reason comes from telemetry; the judge-refused path
    // here surfaces `low_confidence`. The fallback `no_citation` only
    // applies when telemetry is null.
    expect(assistantRows[0]?.refusalReason).toMatch(/^(low_confidence|no_citation)$/)
    expect(assistantRows[0]?.citationsJson).toBeUndefined()
  })

  it('pipeline error path writes a refusal assistant row before re-throwing', async () => {
    const harness = createAuditStoreHarness()

    const pipelineError = new Error('judge crashed')

    await expect(
      chatWithKnowledge(
        {
          auth: { isAdmin: false, userId: 'user-error' },
          environment: 'local',
          governance: baseGovernance,
          query: '請問報表欄位的定義',
        },
        {
          answer: vi.fn().mockResolvedValue('would-be answer'),
          auditStore: harness.store,
          judge: vi.fn().mockRejectedValue(pipelineError),
          rateLimitStore: freshKvStore(),
          retrieve: vi.fn().mockResolvedValue({
            evidence: [
              {
                accessLevel: 'internal',
                categorySlug: 'erp',
                chunkText: 'field defs',
                citationLocator: 'p2',
                documentId: 'doc-y',
                documentTitle: 'ERP Fields',
                documentVersionId: 'ver-y',
                excerpt: 'field defs',
                score: 0.6,
                sourceChunkId: 'chunk-y',
                title: 'ERP Fields',
              },
            ],
            normalizedQuery: '請問報表欄位的定義',
          }),
        },
      ),
    ).rejects.toBe(pipelineError)

    const assistantRows = harness.messages.filter((m) => m.role === 'assistant')
    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0]).toMatchObject({
      role: 'assistant',
      refused: true,
      refusalReason: 'pipeline_error',
      content: '抱歉，我無法回答這個問題。',
    })
  })

  it('accepted answer path writes the assistant row with refused: false and a citationsJson payload', async () => {
    const harness = createAuditStoreHarness()

    await chatWithKnowledge(
      {
        auth: { isAdmin: false, userId: 'user-accept' },
        environment: 'local',
        governance: baseGovernance,
        query: '請問報表欄位的定義',
      },
      {
        answer: vi.fn().mockResolvedValue('Field A means …'),
        auditStore: harness.store,
        judge: vi.fn().mockResolvedValue({ shouldAnswer: true }),
        rateLimitStore: freshKvStore(),
        retrieve: vi.fn().mockResolvedValue({
          evidence: [
            {
              accessLevel: 'internal',
              categorySlug: 'erp',
              chunkText: 'Field A means …',
              citationLocator: 'p2',
              documentId: 'doc-z',
              documentTitle: 'ERP Fields',
              documentVersionId: 'ver-z',
              excerpt: 'Field A means …',
              score: 0.91,
              sourceChunkId: 'chunk-z',
              title: 'ERP Fields',
            },
          ],
          normalizedQuery: '請問報表欄位的定義',
        }),
      },
    )

    const assistantRows = harness.messages.filter((m) => m.role === 'assistant')
    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0]).toMatchObject({
      role: 'assistant',
      refused: false,
      refusalReason: null,
    })
    expect(assistantRows[0]?.citationsJson).toBeDefined()
    expect(JSON.parse(assistantRows[0]!.citationsJson!)).toEqual([{ documentVersionId: 'ver-z' }])
  })
})
