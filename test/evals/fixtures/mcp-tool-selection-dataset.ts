export const DATASET_VERSION = '2026-04-24-v2'

export type KnowledgeToolName = 'askKnowledge' | 'searchKnowledge' | 'listCategories'

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

export const DATASET: EvalSample[] = [
  // --- askKnowledge ×4：要合成答案、問「怎麼做 / 是什麼 / 為什麼」 ---
  {
    id: 'ask-specific-launch-risk',
    query: '我們這個月底要發版，發版前應該先注意哪些風險？',
    expectedTool: 'askKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, '發版'),
    pattern: 'specific-topic',
  },
  {
    id: 'ask-specific-incident-report',
    query: '產品上線後如果出問題要怎麼通報？有沒有標準流程？',
    expectedTool: 'askKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, '通報'),
    pattern: 'specific-topic',
  },
  {
    id: 'ask-category-review-steps',
    query: '文件要公開給大家看之前，通常要經過哪些審查步驟？',
    expectedTool: 'askKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, '審查'),
    pattern: 'category-flavored',
  },
  {
    id: 'ask-boundary-onboarding-overview',
    query: '我剛加入團隊，想知道我們文件治理的重點流程是什麼？',
    expectedTool: 'askKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, '治理'),
    pattern: 'boundary',
  },

  // --- searchKnowledge ×4：要原文段落、強調「不整理」「看原文」 ---
  {
    id: 'search-specific-launch-risk-passage',
    query: '幫我找文件裡有提到「發版風險」的原始段落，不用先整理。',
    expectedTool: 'searchKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, '發版'),
    pattern: 'specific-topic',
  },
  {
    id: 'search-specific-acceptance-passage',
    query: '文件裡有哪幾段講到「驗收標準」？原文貼給我看就好。',
    expectedTool: 'searchKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, '驗收'),
    pattern: 'specific-topic',
  },
  {
    id: 'search-category-evidence-publishing',
    query: '治理政策這一類裡，有提到證據發布條件的段落嗎？原文貼給我。',
    expectedTool: 'searchKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, '證據'),
    pattern: 'category-flavored',
  },
  {
    id: 'search-boundary-audit-keywords',
    query: '搜「稽核紀錄清理」這幾個字看有沒有跳出什麼段落。',
    expectedTool: 'searchKnowledge',
    expectedArgsCheck: (args) => includesText(args.query, '稽核'),
    pattern: 'boundary',
  },

  // --- listCategories ×4：問分類 / 清單 ---
  {
    id: 'categories-specific-visible-list',
    query: '我現在可以看到哪些分類？',
    expectedTool: 'listCategories',
    expectedArgsCheck: (args) => args.includeCounts === undefined || args.includeCounts === false,
    pattern: 'specific-topic',
  },
  {
    id: 'categories-specific-topic-areas',
    query: '網站上有哪幾個主題區？',
    expectedTool: 'listCategories',
    expectedArgsCheck: (args) => args.includeCounts === undefined || args.includeCounts === false,
    pattern: 'specific-topic',
  },
  {
    id: 'categories-category-with-counts',
    query: '可以列出所有分類嗎？順便告訴我每個分類有幾份文件。',
    expectedTool: 'listCategories',
    expectedArgsCheck: (args) => args.includeCounts === true,
    pattern: 'category-flavored',
  },
  {
    id: 'categories-boundary-inventory-only',
    query: '先不用查內容，只想知道分類清單有什麼。',
    expectedTool: 'listCategories',
    expectedArgsCheck: (args) =>
      args.includeCounts === undefined || typeof args.includeCounts === 'boolean',
    pattern: 'boundary',
  },
]
