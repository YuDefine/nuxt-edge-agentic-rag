import type { VerifiedKnowledgeEvidence } from '#server/utils/knowledge-retrieval'

export interface WorkersAiBindingLike {
  run(model: string, payload: Record<string, unknown>): Promise<unknown>
}

export interface WorkersAiUsageSnapshot {
  cachedPromptTokens: number | null
  completionTokens: number | null
  promptTokens: number | null
  totalTokens: number | null
}

export interface WorkersAiRunTelemetry {
  latencyMs: number
  model: string
  modelRole: string
  usage: WorkersAiUsageSnapshot | null
}

const DEFAULT_MODEL_BY_ROLE = Object.freeze({
  agentJudge: '@cf/moonshotai/kimi-k2.5',
  defaultAnswer: '@cf/meta/llama-4-scout-17b-16e-instruct',
})

const JUDGE_RESPONSE_SCHEMA = {
  additionalProperties: false,
  properties: {
    reformulatedQuery: {
      type: 'string',
    },
    shouldAnswer: {
      type: 'boolean',
    },
  },
  required: ['shouldAnswer'],
  type: 'object',
} as const

export function createWorkersAiAnswerAdapter(input: {
  binding: WorkersAiBindingLike
  modelByRole?: Partial<Record<string, string>>
  onUsage?: (telemetry: WorkersAiRunTelemetry) => void
}) {
  return async function workersAiAnswer(inputShape: {
    evidence: VerifiedKnowledgeEvidence[]
    modelRole: string
    query: string
    retrievalScore: number
  }): Promise<string> {
    const model = resolveModelId(inputShape.modelRole, input.modelByRole)
    const startedAt = Date.now()
    const response = await input.binding.run(model, {
      max_completion_tokens: 400,
      messages: [
        {
          content:
            '你是知識庫回答器。只能根據提供的證據回答，不可補充未出現在證據中的事實。請直接輸出答案文字，不要加前言或 Markdown 標題。',
          role: 'system',
        },
        {
          content: buildAnswerPrompt(inputShape),
          role: 'user',
        },
      ],
      temperature: 0.1,
    })

    input.onUsage?.({
      latencyMs: Date.now() - startedAt,
      model,
      modelRole: inputShape.modelRole,
      usage: readUsageSnapshot(response),
    })

    return readTextResponse(response)
  }
}

export function createWorkersAiJudgeAdapter(input: {
  binding: WorkersAiBindingLike
  modelByRole?: Partial<Record<string, string>>
  onUsage?: (telemetry: WorkersAiRunTelemetry) => void
}) {
  return async function workersAiJudge(inputShape: {
    evidence: VerifiedKnowledgeEvidence[]
    query: string
    retrievalScore: number
  }): Promise<{
    reformulatedQuery?: string
    shouldAnswer: boolean
  }> {
    const modelRole = 'agentJudge'
    const model = resolveModelId(modelRole, input.modelByRole)
    const startedAt = Date.now()
    const response = await input.binding.run(model, {
      max_completion_tokens: 200,
      messages: [
        {
          content:
            '你是知識問答的 judge。請判斷現有證據是否足以回答使用者問題。若不足且值得重試，可提供 reformulatedQuery；否則省略該欄位。',
          role: 'system',
        },
        {
          content: buildJudgePrompt(inputShape),
          role: 'user',
        },
      ],
      response_format: {
        json_schema: JUDGE_RESPONSE_SCHEMA,
        type: 'json_schema',
      },
      temperature: 0,
    })

    input.onUsage?.({
      latencyMs: Date.now() - startedAt,
      model,
      modelRole,
      usage: readUsageSnapshot(response),
    })

    return readJudgeResponse(response)
  }
}

function buildAnswerPrompt(input: {
  evidence: VerifiedKnowledgeEvidence[]
  query: string
  retrievalScore: number
}): string {
  const evidenceText = input.evidence
    .map((item, index) =>
      [
        `[${index + 1}] ${item.documentTitle}`,
        `Locator: ${item.citationLocator}`,
        `Score: ${item.score}`,
        item.chunkText,
      ].join('\n'),
    )
    .join('\n\n')

  return [
    `問題：${input.query}`,
    `retrievalScore：${input.retrievalScore}`,
    '證據：',
    evidenceText,
  ].join('\n\n')
}

function buildJudgePrompt(input: {
  evidence: VerifiedKnowledgeEvidence[]
  query: string
  retrievalScore: number
}): string {
  const evidenceText = input.evidence
    .map((item, index) =>
      [
        `[${index + 1}] ${item.documentTitle}`,
        `Locator: ${item.citationLocator}`,
        `Score: ${item.score}`,
        item.chunkText,
      ].join('\n'),
    )
    .join('\n\n')

  return [
    `問題：${input.query}`,
    `retrievalScore：${input.retrievalScore}`,
    '請判斷這些證據是否足以回答問題。',
    '若證據足夠，回傳 shouldAnswer=true。',
    '若證據不足但可透過更好的查詢重試，回傳 shouldAnswer=false 並提供 reformulatedQuery。',
    '若證據不足且不值得重試，回傳 shouldAnswer=false 且不要提供 reformulatedQuery。',
    '證據：',
    evidenceText,
  ].join('\n\n')
}

function resolveModelId(modelRole: string, overrides?: Partial<Record<string, string>>): string {
  const configured = overrides?.[modelRole]
  if (configured?.trim()) {
    return configured.trim()
  }

  const builtin = DEFAULT_MODEL_BY_ROLE[modelRole as keyof typeof DEFAULT_MODEL_BY_ROLE]
  if (builtin) {
    return builtin
  }

  if (modelRole.startsWith('@cf/')) {
    return modelRole
  }

  throw new Error(`Unknown Workers AI model role: ${modelRole}`)
}

function readTextResponse(response: unknown): string {
  const candidate = readResponseValue(response)

  if (typeof candidate === 'string') {
    return candidate.trim()
  }

  if (typeof candidate === 'object' && candidate !== null) {
    const nestedText = (candidate as { text?: unknown }).text
    if (typeof nestedText === 'string') {
      return nestedText.trim()
    }
  }

  throw new Error('Workers AI answer response did not contain text')
}

function readJudgeResponse(response: unknown): {
  reformulatedQuery?: string
  shouldAnswer: boolean
} {
  const candidate = readResponseValue(response)
  const parsed = normalizeStructuredResponse(candidate)

  if (typeof parsed.shouldAnswer !== 'boolean') {
    throw new Error('Workers AI judge response did not contain shouldAnswer')
  }

  const reformulatedQuery =
    typeof parsed.reformulatedQuery === 'string' && parsed.reformulatedQuery.trim()
      ? parsed.reformulatedQuery.trim()
      : undefined

  return reformulatedQuery
    ? { reformulatedQuery, shouldAnswer: parsed.shouldAnswer }
    : { shouldAnswer: parsed.shouldAnswer }
}

function readResponseValue(response: unknown): unknown {
  if (typeof response !== 'object' || response === null) {
    return response
  }

  if ('response' in response) {
    return (response as { response?: unknown }).response
  }

  if ('result' in response) {
    return readResponseValue((response as { result?: unknown }).result)
  }

  if ('choices' in response && Array.isArray((response as { choices?: unknown[] }).choices)) {
    const firstChoice = (
      response as {
        choices?: Array<{ message?: { content?: unknown } }>
      }
    ).choices?.[0]
    return firstChoice?.message?.content
  }

  return response
}

function normalizeStructuredResponse(candidate: unknown): Record<string, unknown> {
  if (typeof candidate === 'string') {
    return JSON.parse(candidate) as Record<string, unknown>
  }

  if (typeof candidate === 'object' && candidate !== null) {
    return candidate as Record<string, unknown>
  }

  throw new Error('Workers AI structured response was not JSON')
}

function readUsageSnapshot(response: unknown): WorkersAiUsageSnapshot | null {
  if (typeof response !== 'object' || response === null || !('usage' in response)) {
    return null
  }

  const usage = (response as { usage?: Record<string, unknown> }).usage
  if (!usage || typeof usage !== 'object') {
    return null
  }

  const promptTokenDetails =
    typeof usage.prompt_tokens_details === 'object' && usage.prompt_tokens_details !== null
      ? (usage.prompt_tokens_details as Record<string, unknown>)
      : null

  return {
    cachedPromptTokens: readOptionalNumber(promptTokenDetails?.cached_tokens),
    completionTokens: readOptionalNumber(usage.completion_tokens),
    promptTokens: readOptionalNumber(usage.prompt_tokens),
    totalTokens: readOptionalNumber(usage.total_tokens),
  }
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}
