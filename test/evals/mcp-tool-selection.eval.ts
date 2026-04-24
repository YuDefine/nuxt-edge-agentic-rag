import { readFile } from 'node:fs/promises'

import { anthropic } from '@ai-sdk/anthropic'
import { evalite } from 'evalite'
import { generateText, jsonSchema, tool, type ToolSet } from 'ai'
import { afterAll } from 'vitest'
import { z } from 'zod/v4'

import { DATASET, DATASET_VERSION, type EvalSample } from './fixtures/mcp-tool-selection-dataset'
import { createEvalMcpClient, getEvalMcpUrl } from './helpers/mcp-client'
import { scoreSample, type ScoreSampleResult } from './helpers/scorer'

const MODEL_ID = 'claude-sonnet-4-6'
const BASELINE_DOC_PATH = new URL('../../docs/evals/mcp-tool-selection.md', import.meta.url)
const BASELINE_TOLERANCE_POINTS = 5
type JsonSchemaInput = Parameters<typeof jsonSchema>[0]

const inputSchemas = {
  askKnowledge: z.object({
    query: z.string().trim().min(1).max(4000),
  }),
  searchKnowledge: z.object({
    query: z.string().trim().min(1).max(2000),
  }),
  listCategories: z.object({
    includeCounts: z.boolean().optional().default(false),
  }),
} satisfies Record<EvalSample['expectedTool'], z.ZodType<Record<string, unknown>>>

interface ToolSelectionOutput {
  actualTool?: string
  actualArgs: unknown
}

interface SampleRunResult {
  id: string
  expectedTool: EvalSample['expectedTool']
  actualTool?: string
  score: ScoreSampleResult
}

const sampleResults: SampleRunResult[] = []

let mcpToolsPromise: Promise<ToolSet> | undefined

evalite<EvalSample, ToolSelectionOutput>('MCP tool selection', {
  data: DATASET.map((sample) => ({
    input: sample,
  })),
  task: async (sample) => {
    ensureAnthropicApiKey()

    const tools = await getMcpTools()
    const result = await generateText({
      model: anthropic(MODEL_ID),
      tools,
      toolChoice: 'required',
      system: [
        'You are evaluating MCP tool selection for a governed knowledge-base assistant.',
        'Choose exactly one tool. Do not answer directly.',
        'Use askKnowledge for synthesized answers, searchKnowledge for source snippets, getDocumentChunk for citation replay, and listCategories for category inventory.',
      ].join(' '),
      prompt: sample.query,
      temperature: 0,
      maxRetries: 1,
    })

    const toolCall = result.toolCalls[0]

    return {
      actualTool: toolCall?.toolName,
      actualArgs: toolCall?.input,
    }
  },
  scorers: [
    {
      name: 'tool-selection-score',
      description: '60% tool-name match + 40% input-schema and fixture argument check',
      scorer: ({ input, output }) => {
        const score = scoreSample({
          expectedTool: input.expectedTool,
          expectedArgsCheck: input.expectedArgsCheck,
          actualTool: output.actualTool,
          actualArgs: output.actualArgs,
          inputSchema: inputSchemas[input.expectedTool],
        })

        sampleResults.push({
          id: input.id,
          expectedTool: input.expectedTool,
          actualTool: output.actualTool,
          score,
        })

        return {
          score: score.score / 100,
          metadata: {
            datasetVersion: DATASET_VERSION,
            expectedTool: input.expectedTool,
            actualTool: output.actualTool,
            toolMatch: score.toolMatch,
            argumentsMatch: score.argumentsMatch,
            error: score.error,
          },
        }
      },
    },
  ],
  columns: ({ input, output, scores }) => [
    { label: 'sample', value: input.id },
    { label: 'expectedTool', value: input.expectedTool },
    { label: 'actualTool', value: output.actualTool ?? '(none)' },
    { label: 'score', value: scores[0]?.score ?? 0 },
  ],
})

afterAll(async () => {
  if (sampleResults.length === 0) {
    return
  }

  const overallScore =
    sampleResults.reduce((total, result) => total + result.score.score, 0) / sampleResults.length
  const baseline = await readBaselineScore()
  const delta = baseline === undefined ? undefined : overallScore - baseline

  // eslint-disable-next-line no-console -- eval 終章摘要輸出，CI/stdout 需可見
  console.info(
    [
      `MCP tool-selection eval summary`,
      `dataset=${DATASET_VERSION}`,
      `model=${MODEL_ID}`,
      `mcpUrl=${getEvalMcpUrl()}`,
      `overall=${overallScore.toFixed(2)}`,
      baseline === undefined
        ? 'baseline=not recorded'
        : `baseline=${baseline.toFixed(2)} delta=${delta?.toFixed(2)}`,
      `lowSamples=${
        sampleResults
          .filter((result) => result.score.score < 100)
          .map(
            (result) =>
              `${result.id} expected=${result.expectedTool} actual=${result.actualTool ?? '(none)'} score=${result.score.score}`,
          )
          .join(', ') || 'none'
      }`,
    ].join('\n'),
  )

  if (baseline !== undefined && overallScore < baseline - BASELINE_TOLERANCE_POINTS) {
    // Vitest / evalite 吃掉 afterAll 內的 throw，也不會讀 `process.exitCode`。
    // 直接 `process.exit(1)` 強制 non-zero 結束，讓 Decision 5 的 regression
    // threshold 在 `pnpm eval` 正確生效。Report JSON 可能寫一半，這是可接受
    // trade-off — regression 時我們關心的是信號 / exit code，不是完整 report。
    // eslint-disable-next-line no-console -- regression banner，CI / stderr 必現
    console.error(
      `Eval regression: overall ${overallScore.toFixed(2)}% is more than ${BASELINE_TOLERANCE_POINTS}pp below baseline ${baseline.toFixed(2)}% (delta=${(delta ?? 0).toFixed(2)}pp). See lowSamples in summary above to diagnose.`,
    )
    process.exit(1)
  }
})

async function getMcpTools(): Promise<ToolSet> {
  mcpToolsPromise ??= loadMcpTools()
  return mcpToolsPromise
}

async function loadMcpTools(): Promise<ToolSet> {
  const client = await createEvalMcpClient()

  try {
    const definitions = await client.listTools()

    return Object.fromEntries(
      definitions.tools.map((definition) => [
        definition.name,
        tool({
          description: definition.description ?? definition.title ?? definition.name,
          inputSchema: jsonSchema(definition.inputSchema as JsonSchemaInput),
        }),
      ]),
    )
  } finally {
    await client.close()
  }
}

async function readBaselineScore(): Promise<number | undefined> {
  try {
    const content = await readFile(BASELINE_DOC_PATH, 'utf8')
    const match = content.match(/BASELINE_SCORE:\s*(\d+(?:\.\d+)?)/iu)

    return match?.[1] ? Number(match[1]) : undefined
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

function ensureAnthropicApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error(
      'ANTHROPIC_API_KEY is required for MCP tool-selection eval. Set it in .env or your shell before running `pnpm eval`.',
    )
  }
}
