const TOOL_MATCH_WEIGHT = 60
const ARGUMENTS_MATCH_WEIGHT = 40

export interface ParseSchema<TArgs> {
  parse(value: unknown): TArgs
}

export interface ScoreSampleInput<TArgs> {
  expectedTool: string
  expectedArgsCheck: (args: TArgs) => boolean
  actualTool: string | undefined
  actualArgs: unknown
  inputSchema: ParseSchema<TArgs>
}

export interface ScoreSampleResult {
  score: number
  toolMatch: boolean
  argumentsMatch: boolean
  error?: string
}

export function scoreSample<TArgs>({
  expectedTool,
  expectedArgsCheck,
  actualTool,
  actualArgs,
  inputSchema,
}: ScoreSampleInput<TArgs>): ScoreSampleResult {
  const toolMatch = actualTool === expectedTool

  if (!toolMatch) {
    return {
      score: 0,
      toolMatch: false,
      argumentsMatch: false,
    }
  }

  try {
    const parsedArgs = inputSchema.parse(actualArgs)
    const argumentsMatch = expectedArgsCheck(parsedArgs)

    return {
      score: TOOL_MATCH_WEIGHT + (argumentsMatch ? ARGUMENTS_MATCH_WEIGHT : 0),
      toolMatch: true,
      argumentsMatch,
    }
  } catch (error) {
    return {
      score: TOOL_MATCH_WEIGHT,
      toolMatch: true,
      argumentsMatch: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
