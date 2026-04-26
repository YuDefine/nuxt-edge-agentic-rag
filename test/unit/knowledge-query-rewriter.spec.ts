import { describe, expect, it, vi } from 'vitest'

import {
  isQueryRewritingEnabled,
  rewriteForRetrieval,
  type RewriterStatus,
} from '#server/utils/knowledge-query-rewriter'
import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import type { WorkersAiBindingLike } from '#server/utils/workers-ai'
import { assertNever } from '#shared/utils/assert-never'

function makeRuntimeConfig(features?: { queryRewriting?: boolean }) {
  return createKnowledgeRuntimeConfig({
    environment: 'staging',
    features: {
      queryRewriting: features?.queryRewriting ?? true,
    },
  })
}

function makeBinding(impl: WorkersAiBindingLike['run']): WorkersAiBindingLike {
  return { run: impl }
}

describe('isQueryRewritingEnabled', () => {
  it('mirrors runtimeConfig.features.queryRewriting', () => {
    expect(isQueryRewritingEnabled(makeRuntimeConfig({ queryRewriting: true }))).toBe(true)
    expect(isQueryRewritingEnabled(makeRuntimeConfig({ queryRewriting: false }))).toBe(false)
  })
})

describe('rewriteForRetrieval - success path', () => {
  it('returns rewritten query and status=success on a well-formed structured response', async () => {
    const binding = makeBinding(async () => ({
      response: { rewritten: 'PO 採購單與 PR 請購單的角色差異' },
      usage: {
        prompt_tokens: 120,
        completion_tokens: 24,
        total_tokens: 144,
      },
    }))

    const result = await rewriteForRetrieval('PO 和 PR 差別', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result).toEqual({
      rewrittenQuery: 'PO 採購單與 PR 請購單的角色差異',
      status: 'success',
    })
  })

  it('also accepts top-level rewritten field (Workers AI shape variant)', async () => {
    const binding = makeBinding(async () => ({
      rewritten: '請假申請流程',
    }))

    const result = await rewriteForRetrieval('怎麼請假', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result.status).toBe('success')
    expect(result.rewrittenQuery).toBe('請假申請流程')
  })

  it('emits onUsage telemetry with judge model role and snapshot', async () => {
    const binding = makeBinding(async () => ({
      response: { rewritten: 'foo' },
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }))
    const onUsage = vi.fn()

    await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
      onUsage,
    })

    expect(onUsage).toHaveBeenCalledTimes(1)
    const telemetry = onUsage.mock.calls[0]?.[0]
    expect(telemetry).toMatchObject({
      modelRole: 'agentJudge',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    expect(typeof telemetry.latencyMs).toBe('number')
  })
})

describe('rewriteForRetrieval - fallback paths', () => {
  it('falls back to original query with status=fallback_timeout on AbortError', async () => {
    const binding = makeBinding(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })

    const result = await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result).toEqual({
      rewrittenQuery: '原問題',
      status: 'fallback_timeout',
    })
  })

  it('falls back to original query with status=fallback_timeout when message says timeout', async () => {
    const binding = makeBinding(async () => {
      throw new Error('Request timed out after 5000ms')
    })

    const result = await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result.status).toBe('fallback_timeout')
    expect(result.rewrittenQuery).toBe('原問題')
  })

  it('falls back to original query with status=fallback_error on generic LLM failure', async () => {
    const binding = makeBinding(async () => {
      throw new Error('Workers AI returned 500')
    })

    const result = await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result).toEqual({
      rewrittenQuery: '原問題',
      status: 'fallback_error',
    })
  })

  it('falls back to original query with status=fallback_parse on missing rewritten field', async () => {
    const binding = makeBinding(async () => ({
      response: { somethingElse: 'oops' },
    }))

    const result = await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result).toEqual({
      rewrittenQuery: '原問題',
      status: 'fallback_parse',
    })
  })

  it('falls back to original query with status=fallback_parse on empty rewritten string', async () => {
    const binding = makeBinding(async () => ({
      response: { rewritten: '   ' },
    }))

    const result = await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result.status).toBe('fallback_parse')
    expect(result.rewrittenQuery).toBe('原問題')
  })

  it('falls back to original query with status=fallback_parse on non-string rewritten', async () => {
    const binding = makeBinding(async () => ({
      response: { rewritten: 42 },
    }))

    const result = await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result.status).toBe('fallback_parse')
  })

  it('falls back to original query with status=fallback_parse on null response', async () => {
    const binding = makeBinding(async () => null)

    const result = await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result.status).toBe('fallback_parse')
  })
})

describe('rewriteForRetrieval - never throws contract', () => {
  it('returns a RewriterResult even when binding throws synchronously', async () => {
    const binding = makeBinding(() => {
      throw new Error('sync explosion')
    })

    const result = await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result.rewrittenQuery).toBe('原問題')
    expect(['fallback_error', 'fallback_timeout']).toContain(result.status)
  })

  it('returns a RewriterResult even when binding throws non-Error value', async () => {
    const binding = makeBinding(async () => {
      throw 'string thrown'
    })

    const result = await rewriteForRetrieval('原問題', {
      ai: binding,
      runtimeConfig: makeRuntimeConfig(),
    })

    expect(result.status).toBe('fallback_error')
  })
})

describe('rewriteForRetrieval - status enum exhaustiveness', () => {
  it('every RewriterStatus value is handled by switch + assertNever', () => {
    const statuses: RewriterStatus[] = [
      'success',
      'fallback_timeout',
      'fallback_error',
      'fallback_parse',
    ]

    function classify(status: RewriterStatus): 'ok' | 'fallback' {
      switch (status) {
        case 'success':
          return 'ok'
        case 'fallback_timeout':
        case 'fallback_error':
        case 'fallback_parse':
          return 'fallback'
        default:
          return assertNever(status, 'classify')
      }
    }

    for (const status of statuses) {
      expect(classify(status)).toBeDefined()
    }
  })
})
