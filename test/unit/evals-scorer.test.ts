import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { scoreSample } from '../evals/helpers/scorer'

describe('scoreSample', () => {
  const schema = z.object({
    query: z.string().min(1),
  })

  it('scores 100 when the tool and arguments pass', () => {
    const result = scoreSample({
      expectedTool: 'askKnowledge',
      expectedArgsCheck: (args) => args.query.includes('SOP'),
      actualTool: 'askKnowledge',
      actualArgs: { query: 'SOP 發布流程' },
      inputSchema: schema,
    })

    expect(result.score).toBe(100)
    expect(result.toolMatch).toBe(true)
    expect(result.argumentsMatch).toBe(true)
  })

  it('scores 60 when the tool matches but the argument content check fails', () => {
    const result = scoreSample({
      expectedTool: 'askKnowledge',
      expectedArgsCheck: (args) => args.query.includes('SOP'),
      actualTool: 'askKnowledge',
      actualArgs: { query: '課程分類' },
      inputSchema: schema,
    })

    expect(result.score).toBe(60)
    expect(result.toolMatch).toBe(true)
    expect(result.argumentsMatch).toBe(false)
  })

  it('scores 0 when the tool does not match', () => {
    const result = scoreSample({
      expectedTool: 'askKnowledge',
      expectedArgsCheck: (args) => args.query.includes('SOP'),
      actualTool: 'searchKnowledge',
      actualArgs: { query: 'SOP 發布流程' },
      inputSchema: schema,
    })

    expect(result.score).toBe(0)
    expect(result.toolMatch).toBe(false)
    expect(result.argumentsMatch).toBe(false)
  })

  it('scores 60 when input schema parsing throws', () => {
    const result = scoreSample({
      expectedTool: 'askKnowledge',
      expectedArgsCheck: (args) => args.query.includes('SOP'),
      actualTool: 'askKnowledge',
      actualArgs: { query: '' },
      inputSchema: schema,
    })

    expect(result.score).toBe(60)
    expect(result.toolMatch).toBe(true)
    expect(result.argumentsMatch).toBe(false)
  })
})
