/**
 * workers-ai-grounded-answering §S-RW / §S-FB / §S-FF
 * (change rag-query-rewriting)
 *
 * Optional LLM-based query rewriting that runs after `normalizeKnowledgeQuery`
 * and before the AI Search call inside `retrieveVerifiedEvidence`. The
 * rewriter transforms a user query into a "title-restatement form" that more
 * closely matches the phrasing found in indexed documents — a workaround for
 * the empirically-observed query↔index lexical-overlap gap where the same
 * embedding model scores 0.72 on title-restatement queries but 0.38 on
 * sub-knowledge question forms (see TD-060 diagnosis note).
 *
 * The rewriter is gated by `runtimeConfig.features.queryRewriting`. All four
 * retrieval entry points (`web-chat.ts`, `mcp-ask.ts`, `mcp-search.ts`,
 * `knowledge-answering.ts`) MUST consult this same `isQueryRewritingEnabled`
 * helper rather than reading the flag directly, so flag-state interpretation
 * stays consistent across the surface.
 */

import type { KnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import type { WorkersAiBindingLike, WorkersAiRunTelemetry } from '#server/utils/workers-ai'

export function isQueryRewritingEnabled(runtimeConfig: KnowledgeRuntimeConfig): boolean {
  return runtimeConfig.features.queryRewriting
}

export type RewriterStatus = 'success' | 'fallback_timeout' | 'fallback_error' | 'fallback_parse'

export interface RewriterResult {
  rewrittenQuery: string
  status: RewriterStatus
}

export type RewriteForRetrieval = (normalizedQuery: string) => Promise<RewriterResult>

/**
 * §S-FB (change rag-query-rewriting): hard wall-clock budget for the
 * rewriter LLM call. The Workers AI binding does not accept an abort
 * signal, so we race against this timer and let the underlying request
 * complete in the background. 3000 ms keeps comfortably below the
 * Workers 30 s CPU ceiling and the rewriter is supposed to be cheap
 * (single short prompt + 256 completion tokens).
 */
const REWRITER_TIMEOUT_MS = 3000

const REWRITER_SYSTEM_PROMPT =
  '你是知識索引的查詢重述器。把使用者問題改寫成「索引文件裡可能出現的題目句式」。' +
  '不要新增、不要假設、不要擴展同義詞。只做形式正規化。回傳 JSON：{"rewritten": "..."}。'

const REWRITER_USER_EXAMPLES = [
  '範例：',
  '- "PO 和 PR 差別" → {"rewritten": "PO 採購單與 PR 請購單的角色差異"}',
  '- "庫存不足怎麼辦" → {"rewritten": "庫存不足處理流程"}',
  '- "怎麼請假" → {"rewritten": "請假申請流程"}',
].join('\n')

const REWRITER_RESPONSE_SCHEMA = {
  additionalProperties: false,
  properties: {
    rewritten: { type: 'string' },
  },
  required: ['rewritten'],
  type: 'object',
} as const

function buildRewriterUserPrompt(normalizedQuery: string): string {
  return [REWRITER_USER_EXAMPLES, '', `使用者問題：${normalizedQuery}`].join('\n')
}

function classifyError(error: unknown): 'fallback_timeout' | 'fallback_error' {
  if (error instanceof Error) {
    if (/timed?\s*out|abort|aborted/i.test(error.message) || error.name === 'AbortError') {
      return 'fallback_timeout'
    }
  }
  return 'fallback_error'
}

function parseRewriterResponse(response: unknown): string | null {
  if (response === null || typeof response !== 'object') {
    return null
  }
  const direct = response as { response?: unknown; rewritten?: unknown }
  const candidate =
    direct.rewritten !== undefined
      ? direct
      : direct.response && typeof direct.response === 'object'
        ? (direct.response as { rewritten?: unknown })
        : null
  if (!candidate) {
    return null
  }
  const value = (candidate as { rewritten?: unknown }).rewritten
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readUsageSnapshotShallow(response: unknown): WorkersAiRunTelemetry['usage'] {
  if (response === null || typeof response !== 'object') {
    return null
  }
  const usage = (response as { usage?: unknown }).usage
  if (usage === null || typeof usage !== 'object') {
    return null
  }
  const u = usage as {
    cached_prompt_tokens?: unknown
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
  }
  return {
    cachedPromptTokens: typeof u.cached_prompt_tokens === 'number' ? u.cached_prompt_tokens : null,
    promptTokens: typeof u.prompt_tokens === 'number' ? u.prompt_tokens : null,
    completionTokens: typeof u.completion_tokens === 'number' ? u.completion_tokens : null,
    totalTokens: typeof u.total_tokens === 'number' ? u.total_tokens : null,
  }
}

export async function rewriteForRetrieval(
  normalizedQuery: string,
  options: {
    ai: WorkersAiBindingLike
    runtimeConfig: KnowledgeRuntimeConfig
    onUsage?: (telemetry: WorkersAiRunTelemetry) => void
  },
): Promise<RewriterResult> {
  const startedAt = Date.now()
  const model = options.runtimeConfig.governance.models.agentJudge

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    const aiCall = options.ai.run(model, {
      max_completion_tokens: 256,
      messages: [
        { content: REWRITER_SYSTEM_PROMPT, role: 'system' },
        { content: buildRewriterUserPrompt(normalizedQuery), role: 'user' },
      ],
      response_format: {
        json_schema: REWRITER_RESPONSE_SCHEMA,
        type: 'json_schema',
      },
      temperature: 0,
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`rewriter timed out after ${REWRITER_TIMEOUT_MS}ms`))
      }, REWRITER_TIMEOUT_MS)
    })

    const response = await Promise.race([aiCall, timeoutPromise])

    options.onUsage?.({
      latencyMs: Date.now() - startedAt,
      model,
      modelRole: 'agentJudge',
      usage: readUsageSnapshotShallow(response),
    })

    const rewritten = parseRewriterResponse(response)
    if (rewritten === null) {
      return { rewrittenQuery: normalizedQuery, status: 'fallback_parse' }
    }
    return { rewrittenQuery: rewritten, status: 'success' }
  } catch (error) {
    options.onUsage?.({
      latencyMs: Date.now() - startedAt,
      model,
      modelRole: 'agentJudge',
      usage: null,
    })
    const status = classifyError(error)
    return { rewrittenQuery: normalizedQuery, status }
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }
  }
}
