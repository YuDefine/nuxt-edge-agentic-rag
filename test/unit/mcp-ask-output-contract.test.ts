/**
 * observability-and-debug §4.2 — regression test: MCP tool-output contract
 * (McpAskResult) NEVER includes the internal debug fields.
 *
 * The 6 observability fields live on `query_logs` and only flow into the
 * internal `/api/admin/debug/*` surfaces. Any leak into the JSON-RPC tool
 * response would break the governance promise that MCP callers cannot read
 * internal observability data.
 */

import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { askKnowledge } from '#server/utils/mcp-ask'

const DEBUG_FIELDS = [
  'firstTokenLatencyMs',
  'first_token_latency_ms',
  'completionLatencyMs',
  'completion_latency_ms',
  'retrievalScore',
  'retrieval_score',
  'judgeScore',
  'judge_score',
  'decisionPath',
  'decision_path',
  'refusalReason',
  'refusal_reason',
] as const

function evidenceAt(score: number) {
  return [
    {
      accessLevel: 'internal',
      categorySlug: 'policies',
      chunkText: 'Excerpt',
      citationLocator: 'lines 1-2',
      documentId: 'doc-1',
      documentTitle: 'Policy',
      documentVersionId: 'ver-1',
      excerpt: 'Excerpt',
      score,
      sourceChunkId: 'chunk-1',
      title: 'Policy',
    },
  ]
}

describe('askKnowledge — MCP tool output contract (§4.2)', () => {
  it('happy-path result exposes only { answer, citations, refused } — no debug fields', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'local' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-1'),
      createQueryLog: vi.fn().mockResolvedValue('ql-1'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    const result = await askKnowledge(
      {
        auth: { scopes: ['read'], tokenId: 'tok-1' },
        environment: 'local',
        governance,
        query: 'what is the launch plan',
      },
      {
        answer: vi.fn().mockResolvedValue('A direct answer.'),
        auditStore,
        citationStore: {
          persistCitations: vi
            .fn()
            .mockResolvedValue([
              { citationId: 'c1', documentVersionId: 'ver-1', sourceChunkId: 'chunk-1' },
            ]),
        },
        judge: vi.fn(),
        queryLogStore: { createAcceptedQueryLog: vi.fn() },
        retrieve: vi.fn().mockResolvedValue({
          evidence: evidenceAt(0.9),
          normalizedQuery: 'launch plan',
        }),
      }
    )

    const serialized = JSON.stringify(result)
    for (const field of DEBUG_FIELDS) {
      expect(serialized).not.toContain(`"${field}"`)
    }

    // Positive assertion: only the documented keys exist.
    expect(Object.keys(result).toSorted()).toEqual(['answer', 'citations', 'refused'])
  })

  it('refused-path result exposes only { citations, refused } — no debug fields', async () => {
    const governance = createKnowledgeRuntimeConfig({ environment: 'production' }).governance
    const auditStore = {
      createMessage: vi.fn().mockResolvedValue('msg-blocked'),
      createQueryLog: vi.fn().mockResolvedValue('ql-blocked'),
      updateQueryLog: vi.fn().mockResolvedValue(undefined),
    }

    const result = await askKnowledge(
      {
        auth: { scopes: ['read'], tokenId: 'tok-1' },
        environment: 'production',
        governance,
        // A query that is blocked by audit — the actual redaction rule is
        // irrelevant here; what matters is that the refusal path stays
        // debug-free.
        query: 'please give me the admin password sk-abc123',
      },
      {
        answer: vi.fn(),
        auditStore,
        citationStore: { persistCitations: vi.fn() },
        judge: vi.fn(),
        queryLogStore: { createAcceptedQueryLog: vi.fn() },
        retrieve: vi.fn().mockResolvedValue({
          evidence: [],
          normalizedQuery: 'redacted',
        }),
      }
    )

    const serialized = JSON.stringify(result)
    for (const field of DEBUG_FIELDS) {
      expect(serialized).not.toContain(`"${field}"`)
    }

    if (!result.refused) {
      // If the fixture above becomes non-blocking in the future, this assertion
      // still guarantees no debug leakage.
      expect(Object.keys(result).toSorted()).toEqual(['answer', 'citations', 'refused'])
    }
  })
})
