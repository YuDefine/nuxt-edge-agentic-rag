import type { KnowledgeGovernanceConfig } from '#shared/schemas/knowledge-runtime'
import type { DecisionPath, RefusalReason } from '#shared/types/observability'
import type { VerifiedKnowledgeEvidence } from './knowledge-retrieval'

/**
 * observability-and-debug §1.2 — optional telemetry sink.
 *
 * `answerKnowledgeQuery` never stores any observability state itself; callers
 * (web-chat / mcp-ask) own the `query_logs` row and decide what to persist.
 * The telemetry callback is the only way internal branch selection
 * (`direct_answer` vs `judge_pass_refuse` vs `no_citation_refuse` …) leaks
 * out — so the debug surface can show which path actually ran without the UI
 * replaying retrieval / judge / self-correction.
 */
export interface KnowledgeAnsweringTelemetry {
  decisionPath: DecisionPath
  refusalReason: RefusalReason | null
  /** Final retrieval score at the point a decision was taken (0-1). */
  retrievalScore: number
  /** Judge confidence when the judge ran, else null. */
  judgeScore: number | null
}

export async function answerKnowledgeQuery(
  input: {
    allowedAccessLevels: string[]
    query: string
  },
  options: {
    answer: (input: {
      evidence: VerifiedKnowledgeEvidence[]
      modelRole: string
      query: string
      retrievalScore: number
    }) => Promise<string>
    judge: (input: {
      evidence: VerifiedKnowledgeEvidence[]
      query: string
      retrievalScore: number
    }) => Promise<{
      reformulatedQuery?: string
      shouldAnswer: boolean
    }>
    /**
     * Optional observability sink. When supplied, `answerKnowledgeQuery`
     * reports the chosen decision path + derived scores before returning so
     * callers can persist them on the `query_logs` row. Undefined = no-op
     * (existing callers and tests are unaffected).
     */
    onDecision?: (telemetry: KnowledgeAnsweringTelemetry) => void
    persistCitations: (
      citations: Array<{
        chunkTextSnapshot: string
        citationLocator: string
        documentVersionId: string
        sourceChunkId: string
      }>
    ) => Promise<Array<{ citationId: string; documentVersionId: string; sourceChunkId: string }>>
    governance: Pick<KnowledgeGovernanceConfig, 'models' | 'thresholds'>
    retrieve: (input: { allowedAccessLevels: string[]; query: string }) => Promise<{
      evidence: VerifiedKnowledgeEvidence[]
      normalizedQuery: string
    }>
  }
): Promise<{
  answer: string | null
  citations: Array<{ citationId: string; documentVersionId: string; sourceChunkId: string }>
  refused: boolean
  retrievalScore: number
}> {
  const firstPass = await options.retrieve({
    allowedAccessLevels: input.allowedAccessLevels,
    query: input.query,
  })
  const initialScore = computeRetrievalScore(firstPass.evidence)

  if (initialScore >= options.governance.thresholds.directAnswerMin) {
    options.onDecision?.({
      decisionPath: 'direct_answer',
      refusalReason: null,
      retrievalScore: initialScore,
      judgeScore: null,
    })
    return answerWithCitations(
      firstPass.evidence,
      input.query,
      initialScore,
      options.governance,
      options.answer,
      options.persistCitations
    )
  }

  if (initialScore < options.governance.thresholds.judgeMin) {
    options.onDecision?.({
      decisionPath: 'no_citation_refuse',
      refusalReason: 'no_citation',
      retrievalScore: initialScore,
      judgeScore: null,
    })
    return refuse(initialScore)
  }

  const judgment = await options.judge({
    evidence: firstPass.evidence,
    query: input.query,
    retrievalScore: initialScore,
  })
  // Judge API does not surface a numeric confidence today (§1.2 spec: judge
  // score is "null when judge did not emit one"). Once the judge exposes a
  // probability, feed it through here. For now the presence of the judge call
  // itself is encoded in `decisionPath`, and `judgeScore` stays null.
  const judgeScore: number | null = null

  if (judgment.shouldAnswer) {
    options.onDecision?.({
      decisionPath: 'judge_pass',
      refusalReason: null,
      retrievalScore: initialScore,
      judgeScore,
    })
    return answerWithCitations(
      firstPass.evidence,
      input.query,
      initialScore,
      options.governance,
      options.answer,
      options.persistCitations
    )
  }

  if (!judgment.reformulatedQuery) {
    options.onDecision?.({
      decisionPath: 'judge_pass_refuse',
      refusalReason: 'low_confidence',
      retrievalScore: initialScore,
      judgeScore,
    })
    return refuse(initialScore)
  }

  const retryPass = await options.retrieve({
    allowedAccessLevels: input.allowedAccessLevels,
    query: judgment.reformulatedQuery,
  })
  const retryScore = computeRetrievalScore(retryPass.evidence)

  if (retryScore >= options.governance.thresholds.directAnswerMin) {
    options.onDecision?.({
      decisionPath: 'self_correction_retry',
      refusalReason: null,
      retrievalScore: retryScore,
      judgeScore,
    })
    return answerWithCitations(
      retryPass.evidence,
      judgment.reformulatedQuery,
      retryScore,
      options.governance,
      options.answer,
      options.persistCitations
    )
  }

  options.onDecision?.({
    decisionPath: 'self_correction_refuse',
    refusalReason: 'low_confidence',
    retrievalScore: retryScore,
    judgeScore,
  })
  return refuse(retryScore)
}

export function computeRetrievalScore(evidence: VerifiedKnowledgeEvidence[]): number {
  if (evidence.length === 0) {
    return 0
  }

  const topScores = evidence
    .map((item) => item.score)
    .toSorted((left, right) => right - left)
    .slice(0, 3)
  const average = topScores.reduce((sum, score) => sum + score, 0) / topScores.length

  return Number(average.toFixed(2))
}

async function answerWithCitations(
  evidence: VerifiedKnowledgeEvidence[],
  query: string,
  retrievalScore: number,
  governance: Pick<KnowledgeGovernanceConfig, 'models'>,
  answer: (input: {
    evidence: VerifiedKnowledgeEvidence[]
    modelRole: string
    query: string
    retrievalScore: number
  }) => Promise<string>,
  persistCitations: (
    citations: Array<{
      chunkTextSnapshot: string
      citationLocator: string
      documentVersionId: string
      sourceChunkId: string
    }>
  ) => Promise<Array<{ citationId: string; documentVersionId: string; sourceChunkId: string }>>
): Promise<{
  answer: string
  citations: Array<{ citationId: string; documentVersionId: string; sourceChunkId: string }>
  refused: false
  retrievalScore: number
}> {
  const responseText = await answer({
    evidence,
    modelRole: selectAnswerModelRole(evidence, governance.models),
    query,
    retrievalScore,
  })
  const citations = await persistCitations(
    evidence.map((item) => ({
      chunkTextSnapshot: item.chunkText,
      citationLocator: item.citationLocator,
      documentVersionId: item.documentVersionId,
      sourceChunkId: item.sourceChunkId,
    }))
  )

  return {
    answer: responseText,
    citations,
    refused: false,
    retrievalScore,
  }
}

function refuse(retrievalScore: number): {
  answer: null
  citations: []
  refused: true
  retrievalScore: number
} {
  return {
    answer: null,
    citations: [],
    refused: true,
    retrievalScore,
  }
}

function selectAnswerModelRole(
  evidence: VerifiedKnowledgeEvidence[],
  modelRoles: KnowledgeGovernanceConfig['models']
): string {
  const distinctDocuments = new Set(evidence.map((item) => item.documentId))

  return distinctDocuments.size <= 1 ? modelRoles.defaultAnswer : modelRoles.agentJudge
}
