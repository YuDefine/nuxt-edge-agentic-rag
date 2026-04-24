export const DATASET_VERSION = '2026-04-24-v1'

export type KnowledgeToolName =
  | 'askKnowledge'
  | 'searchKnowledge'
  | 'getDocumentChunk'
  | 'listCategories'

export type QueryPattern = 'specific-topic' | 'category-flavored' | 'boundary'

export interface EvalSample {
  id: string
  query: string
  expectedTool: KnowledgeToolName
  expectedArgsCheck: (args: Record<string, unknown>) => boolean
  pattern: QueryPattern
  notes?: string
}

function includesText(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(expected.toLowerCase())
}

function citationIdEquals(args: Record<string, unknown>, citationId: string): boolean {
  return args.citationId === citationId
}

export const DATASET: EvalSample[] = [
  {
    id: 'ask-specific-launch-readiness',
    query: '請根據知識庫回答：四月里程碑發布前，launch readiness plan 要先確認哪些風險？',
    expectedTool: 'askKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, 'launch readiness'),
    pattern: 'specific-topic',
  },
  {
    id: 'ask-category-governance-review',
    query: '治理政策分類裡，發布 evidence 前需要哪些審查步驟？請整理成可直接引用的答案。',
    expectedTool: 'askKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, 'evidence'),
    pattern: 'category-flavored',
  },
  {
    id: 'ask-boundary-broad-summary',
    query: '我不確定文件名稱，只想問知識庫：目前專題報告治理流程的重點是什麼？',
    expectedTool: 'askKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, '治理'),
    pattern: 'boundary',
  },
  {
    id: 'search-specific-launch-risks',
    query: '幫我找出提到 April launch readiness risks 的來源片段，不要先幫我總結。',
    expectedTool: 'searchKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, 'launch readiness'),
    pattern: 'specific-topic',
  },
  {
    id: 'search-category-evidence-publishing',
    query: '在 governance policy 類別中搜尋 evidence publishing requirements 相關段落。',
    expectedTool: 'searchKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, 'evidence publishing'),
    pattern: 'category-flavored',
  },
  {
    id: 'search-boundary-keywords-only',
    query: '只搜尋關鍵字：retention cleanup audit trail。',
    expectedTool: 'searchKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, 'retention'),
    pattern: 'boundary',
  },
  {
    id: 'chunk-specific-citation',
    query: '請打開 citation_01HZXAMPLE0000000000000000 的原始 chunk 文字。',
    expectedTool: 'getDocumentChunk',
    expectedArgsCheck: (args) => citationIdEquals(args, 'citation_01HZXAMPLE0000000000000000'),
    pattern: 'specific-topic',
  },
  {
    id: 'chunk-category-citation-from-governance',
    query: '治理政策答案裡引用的 citation_01HZXAMPLE0000000000000001，幫我重播原文。',
    expectedTool: 'getDocumentChunk',
    expectedArgsCheck: (args) => citationIdEquals(args, 'citation_01HZXAMPLE0000000000000001'),
    pattern: 'category-flavored',
  },
  {
    id: 'chunk-boundary-replay-only',
    query: '不要搜尋也不要摘要，只取回 citation_01HZXAMPLE0000000000000002。',
    expectedTool: 'getDocumentChunk',
    expectedArgsCheck: (args) => citationIdEquals(args, 'citation_01HZXAMPLE0000000000000002'),
    pattern: 'boundary',
  },
  {
    id: 'categories-specific-visible-list',
    query: '目前我可以看到哪些知識分類？',
    expectedTool: 'listCategories',
    expectedArgsCheck: (args) => args.includeCounts === undefined || args.includeCounts === false,
    pattern: 'specific-topic',
  },
  {
    id: 'categories-category-counts',
    query: '請列出 governance 和 project report 相關分類，最好包含每個分類的文件數。',
    expectedTool: 'listCategories',
    expectedArgsCheck: (args) => args.includeCounts === true,
    pattern: 'category-flavored',
  },
  {
    id: 'categories-boundary-empty-inventory',
    query: '先不要查文件內容，只盤點分類清單。',
    expectedTool: 'listCategories',
    expectedArgsCheck: (args) =>
      args.includeCounts === undefined || typeof args.includeCounts === 'boolean',
    pattern: 'boundary',
  },
]
