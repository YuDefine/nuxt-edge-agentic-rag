import { beforeEach, describe, expect, it, vi } from 'vitest'

// §2.1 Tool Migration (TDD red → green).
//
// The toolkit wrapper in `server/mcp/tools/ask.ts` must:
// 1. Expose a name `askKnowledge` and the Zod `inputSchema` matching the
//    legacy ask HTTP body schema.
// 2. Read `event.context.mcpAuth` populated by the middleware (auth / rate
//    limit already enforced upstream) and call `requireMcpScope` for
//    `knowledge.ask`.
// 3. Delegate to the existing `askKnowledge` util for business logic.
// 4. Return the unchanged result shape — callers receive the same payload the
//    legacy POST endpoint wrapped under `data`.

describe('mcp ask tool definition', () => {
  const askKnowledgeMock = vi.fn()
  const createKnowledgeAuditStoreMock = vi.fn().mockReturnValue({})
  const createMcpQueryLogStoreMock = vi.fn().mockReturnValue({})
  const workersAiRunMock = vi.fn().mockResolvedValue({
    response: {
      shouldAnswer: false,
    },
  })
  const useEventMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    askKnowledgeMock.mockReset()
    createKnowledgeAuditStoreMock.mockReset()
    createKnowledgeAuditStoreMock.mockReturnValue({})
    createMcpQueryLogStoreMock.mockReset()
    createMcpQueryLogStoreMock.mockReturnValue({})
    workersAiRunMock.mockReset()
    workersAiRunMock.mockResolvedValue({
      response: {
        shouldAnswer: false,
      },
    })
    useEventMock.mockReset()

    vi.stubGlobal('defineMcpTool', <T>(definition: T) => definition)
    vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
      Object.assign(new Error(input.message), input),
    )

    vi.doMock('nitropack/runtime', () => ({
      useEvent: useEventMock,
    }))
    vi.doMock('#server/utils/mcp-ask', () => ({
      askKnowledge: askKnowledgeMock,
      createMcpQueryLogStore: createMcpQueryLogStoreMock,
    }))
    vi.doMock('#server/utils/ai-search', () => ({
      createCloudflareAiSearchClient: vi.fn().mockReturnValue({ search: vi.fn() }),
    }))
    vi.doMock('#server/utils/citation-store', () => ({
      createCitationStore: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/cloudflare-bindings', () => ({
      getCloudflareEnv: () => ({
        AI: {
          autorag: vi.fn().mockReturnValue({ search: vi.fn() }),
          run: workersAiRunMock,
        },
      }),
      getRequiredD1Binding: vi.fn().mockReturnValue({}),
      getRequiredKvBinding: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/database', () => ({
      getD1Database: vi.fn().mockResolvedValue({}),
    }))
    vi.doMock('#server/utils/knowledge-audit', () => ({
      auditKnowledgeText: vi.fn().mockReturnValue({ redactedText: '', shouldBlock: false }),
      createKnowledgeAuditStore: createKnowledgeAuditStoreMock,
    }))
    vi.doMock('#server/utils/knowledge-evidence-store', () => ({
      createKnowledgeEvidenceStore: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/knowledge-retrieval', () => ({
      retrieveVerifiedEvidence: vi.fn(),
    }))
    vi.doMock('#server/utils/knowledge-runtime', () => ({
      getKnowledgeRuntimeConfig: vi.fn().mockReturnValue({
        bindings: {
          aiSearchIndex: 'knowledge-index',
          d1Database: 'DB',
          rateLimitKv: 'RATE_LIMITS',
        },
        environment: 'local',
        governance: {
          configSnapshotVersion: 'v1',
          models: {
            agentJudge: 'agentJudge',
            defaultAnswer: 'defaultAnswer',
          },
          thresholds: {
            answerMin: 0.51,
            directAnswerMin: 0.71,
            judgeMin: 0.46,
          },
        },
      }),
    }))
  })

  it('exposes name `askKnowledge` and a Zod inputSchema with the `query` field', async () => {
    const mod = await import('#server/mcp/tools/ask')
    const tool = mod.default

    expect(tool.name).toBe('askKnowledge')
    expect(tool.inputSchema).toBeDefined()
    expect(tool.inputSchema.query).toBeDefined()
  })

  it('calls requireMcpScope for knowledge.ask before invoking askKnowledge util', async () => {
    const mod = await import('#server/mcp/tools/ask')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        mcpAuth: {
          scopes: ['knowledge.search'], // missing knowledge.ask
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    await expect(tool.handler({ query: 'What changed?' }, {} as never)).rejects.toMatchObject({
      statusCode: 403,
    })

    expect(askKnowledgeMock).not.toHaveBeenCalled()
  })

  it('delegates to askKnowledge util and returns the result payload unchanged', async () => {
    askKnowledgeMock.mockResolvedValue({
      answer: 'Launch moved to Tuesday.',
      citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
      refused: false,
    })

    const mod = await import('#server/mcp/tools/ask')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        cloudflare: { env: { DB: {} } },
        mcpAuth: {
          scopes: ['knowledge.ask'],
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    const result = await tool.handler({ query: 'What changed?' }, {} as never)

    expect(askKnowledgeMock).toHaveBeenCalledTimes(1)
    expect(askKnowledgeMock.mock.calls[0]?.[0]).toMatchObject({
      query: 'What changed?',
      auth: expect.objectContaining({ tokenId: 'token-1' }),
    })
    expect(result).toEqual({
      answer: 'Launch moved to Tuesday.',
      citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
      refused: false,
    })
  })

  it('injects workers-ai backed answer and judge adapters into askKnowledge', async () => {
    askKnowledgeMock.mockImplementationOnce(async (_input, options) => {
      const answer = await options.answer({
        evidence: [
          {
            chunkText: '採購流程需要先建立請購單，再建立採購單。',
            documentTitle: '採購流程',
          },
        ],
        modelRole: 'defaultAnswer',
        query: '採購流程是什麼？',
        retrievalScore: 0.9,
      })

      await options.judge({
        evidence: [{ chunkText: '採購流程需要先建立請購單，再建立採購單。' }],
        query: '請比較採購與請購差異',
        retrievalScore: 0.56,
      })

      return {
        answer,
        citations: [],
        refused: false,
      }
    })
    workersAiRunMock
      .mockResolvedValueOnce({ response: 'Workers AI answer' })
      .mockResolvedValueOnce({ response: { shouldAnswer: true } })

    const mod = await import('#server/mcp/tools/ask')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        cloudflare: { env: { DB: {} } },
        mcpAuth: {
          scopes: ['knowledge.ask'],
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    const result = await tool.handler({ query: 'What changed?' }, {} as never)

    expect(result).toEqual({
      answer: 'Workers AI answer',
      citations: [],
      refused: false,
    })
    expect(workersAiRunMock).toHaveBeenNthCalledWith(
      1,
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      expect.objectContaining({
        messages: expect.any(Array),
      }),
    )
    expect(workersAiRunMock).toHaveBeenNthCalledWith(
      2,
      '@cf/moonshotai/kimi-k2.5',
      expect.objectContaining({
        response_format: expect.objectContaining({
          type: 'json_schema',
        }),
      }),
    )
  })

  it('wraps audit-store query-log updates with serialized workers-ai telemetry', async () => {
    const auditStore = {
      createMessage: vi.fn(),
      createQueryLog: vi.fn(),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }
    const queryLogStore = {
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    createKnowledgeAuditStoreMock.mockReturnValueOnce(auditStore)
    createMcpQueryLogStoreMock.mockReturnValueOnce(queryLogStore)
    askKnowledgeMock.mockImplementationOnce(async (_input, options) => {
      await options.answer({
        evidence: [
          {
            chunkText: '採購流程需要先建立請購單，再建立採購單。',
            documentTitle: '採購流程',
          },
        ],
        modelRole: 'defaultAnswer',
        query: '採購流程是什麼？',
        retrievalScore: 0.9,
      })
      await options.auditStore?.updateQueryLog?.({
        completionLatencyMs: 310,
        decisionPath: 'direct_answer',
        firstTokenLatencyMs: null,
        judgeScore: null,
        queryLogId: 'query-log-1',
        refusalReason: null,
        retrievalScore: 0.9,
      })

      return {
        answer: 'Workers AI answer',
        citations: [],
        refused: false,
      }
    })
    workersAiRunMock.mockResolvedValueOnce({
      response: 'Workers AI answer',
      usage: {
        completion_tokens: 18,
        prompt_tokens: 120,
        prompt_tokens_details: {
          cached_tokens: 24,
        },
        total_tokens: 138,
      },
    })

    const mod = await import('#server/mcp/tools/ask')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        cloudflare: { env: { DB: {} } },
        mcpAuth: {
          scopes: ['knowledge.ask'],
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    await tool.handler({ query: 'What changed?' }, {} as never)

    expect(auditStore.updateQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        queryLogId: 'query-log-1',
        workersAiRunsJson: expect.any(String),
      }),
    )

    const workersAiRunsJson =
      vi.mocked(auditStore.updateQueryLog).mock.calls[0]?.[0]?.workersAiRunsJson ?? '[]'

    expect(JSON.parse(workersAiRunsJson)).toEqual([
      {
        latencyMs: expect.any(Number),
        model: '@cf/meta/llama-4-scout-17b-16e-instruct',
        modelRole: 'defaultAnswer',
        usage: {
          cachedPromptTokens: 24,
          completionTokens: 18,
          promptTokens: 120,
          totalTokens: 138,
        },
      },
    ])
  })
})
