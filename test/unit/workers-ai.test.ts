import { describe, expect, it, vi } from 'vitest'

import {
  createWorkersAiAnswerAdapter,
  createWorkersAiJudgeAdapter,
  createWorkersAiRunRecorder,
} from '#server/utils/workers-ai'

function evidenceAt(score: number) {
  return [
    {
      accessLevel: 'internal',
      categorySlug: 'finance',
      chunkText: '採購流程需要先建立請購單，再建立採購單。',
      citationLocator: 'lines 1-3',
      documentId: 'doc-1',
      documentTitle: '採購流程',
      documentVersionId: 'ver-1',
      excerpt: '採購流程需要先建立請購單，再建立採購單。',
      score,
      sourceChunkId: 'chunk-1',
      title: '採購流程',
    },
  ]
}

describe('workers ai adapters', () => {
  it('uses the default answer role mapping and returns the generated text', async () => {
    const binding = {
      run: vi.fn().mockResolvedValue({
        response: '請先建立請購單，再建立採購單。',
        usage: {
          prompt_tokens: 120,
          completion_tokens: 18,
          total_tokens: 138,
        },
      }),
    }

    const answer = createWorkersAiAnswerAdapter({
      binding,
    })

    await expect(
      answer({
        evidence: evidenceAt(0.9),
        modelRole: 'defaultAnswer',
        query: '採購流程是什麼？',
        retrievalScore: 0.9,
      }),
    ).resolves.toBe('請先建立請購單，再建立採購單。')

    expect(binding.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      expect.objectContaining({
        messages: expect.any(Array),
      }),
    )
  })

  it('uses the judge role mapping and parses structured json output', async () => {
    const binding = {
      run: vi.fn().mockResolvedValue({
        response: {
          shouldAnswer: true,
        },
      }),
    }

    const judge = createWorkersAiJudgeAdapter({
      binding,
    })

    await expect(
      judge({
        evidence: evidenceAt(0.56),
        query: '請比較採購與請購差異',
        retrievalScore: 0.56,
      }),
    ).resolves.toEqual({
      shouldAnswer: true,
    })

    expect(binding.run).toHaveBeenCalledWith(
      '@cf/moonshotai/kimi-k2.5',
      expect.objectContaining({
        messages: expect.any(Array),
        response_format: expect.objectContaining({
          type: 'json_schema',
        }),
      }),
    )
  })

  it('passes max_completion_tokens 1024 to avoid TD-056/061 JSON truncation', async () => {
    const binding = {
      run: vi.fn().mockResolvedValue({
        response: { shouldAnswer: true },
      }),
    }

    const judge = createWorkersAiJudgeAdapter({ binding })

    await judge({
      evidence: evidenceAt(0.56),
      query: '比較採購流程與請購流程',
      retrievalScore: 0.56,
    })

    expect(binding.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        max_completion_tokens: 1024,
      }),
    )
  })

  it('throws SyntaxError when judge JSON is truncated mid-string (TD-061 root cause)', async () => {
    const binding = {
      run: vi.fn().mockResolvedValue({
        response: '{"shouldAnswer": true, "reformulatedQuery": "採購流程的詳細步驟，包含請購、',
      }),
    }

    const judge = createWorkersAiJudgeAdapter({ binding })

    await expect(
      judge({
        evidence: evidenceAt(0.56),
        query: '請比較採購與請購',
        retrievalScore: 0.56,
      }),
    ).rejects.toThrowError(SyntaxError)
  })

  it('reports latency and usage through the telemetry hook', async () => {
    const onUsage = vi.fn()
    const binding = {
      run: vi.fn().mockResolvedValue({
        response: '這是答案。',
        usage: {
          prompt_tokens: 90,
          completion_tokens: 12,
          total_tokens: 102,
          prompt_tokens_details: {
            cached_tokens: 64,
          },
        },
      }),
    }

    const answer = createWorkersAiAnswerAdapter({
      binding,
      onUsage,
    })

    await answer({
      evidence: evidenceAt(0.88),
      modelRole: 'defaultAnswer',
      query: '給我重點',
      retrievalScore: 0.88,
    })

    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        latencyMs: expect.any(Number),
        model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        modelRole: 'defaultAnswer',
        usage: {
          cachedPromptTokens: 64,
          completionTokens: 12,
          promptTokens: 90,
          totalTokens: 102,
        },
      }),
    )
  })

  it('emits the full answer once via onTextDelta (non-streaming)', async () => {
    const binding = {
      run: vi.fn().mockResolvedValue({
        response: '請先建立請購單，再建立採購單。',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      }),
    }
    const onTextDelta = vi.fn()

    const answer = createWorkersAiAnswerAdapter({
      binding,
    })

    await expect(
      answer({
        evidence: evidenceAt(0.9),
        modelRole: 'defaultAnswer',
        onTextDelta,
        query: '採購流程是什麼？',
        retrievalScore: 0.9,
      }),
    ).resolves.toBe('請先建立請購單，再建立採購單。')

    expect(binding.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      expect.not.objectContaining({
        stream: true,
      }),
    )
    expect(onTextDelta).toHaveBeenCalledTimes(1)
    expect(onTextDelta).toHaveBeenCalledWith('請先建立請購單，再建立採購單。')
  })

  it('serializes recorded runs for query-log persistence', () => {
    const recorder = createWorkersAiRunRecorder()

    recorder.record({
      latencyMs: 187,
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      modelRole: 'defaultAnswer',
      usage: {
        cachedPromptTokens: 32,
        completionTokens: 21,
        promptTokens: 140,
        totalTokens: 161,
      },
    })

    expect(recorder.serialize()).toBe(
      JSON.stringify([
        {
          latencyMs: 187,
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          modelRole: 'defaultAnswer',
          usage: {
            cachedPromptTokens: 32,
            completionTokens: 21,
            promptTokens: 140,
            totalTokens: 161,
          },
        },
      ]),
    )
  })
})
