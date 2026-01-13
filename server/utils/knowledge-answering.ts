import type { VerifiedKnowledgeEvidence } from './knowledge-retrieval'

const ANSWER_THRESHOLD = 0.7
const JUDGE_THRESHOLD = 0.45

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
    persistCitations: (
      citations: Array<{
        chunkTextSnapshot: string
        citationLocator: string
        documentVersionId: string
        sourceChunkId: string
      }>
    ) => Promise<Array<{ citationId: string; sourceChunkId: string }>>
    retrieve: (input: { allowedAccessLevels: string[]; query: string }) => Promise<{
      evidence: VerifiedKnowledgeEvidence[]
      normalizedQuery: string
    }>
  }
): Promise<{
  answer: string | null
  citations: Array<{ citationId: string; sourceChunkId: string }>
  refused: boolean
  retrievalScore: number
}> {
  const firstPass = await options.retrieve({
    allowedAccessLevels: input.allowedAccessLevels,
    query: input.query,
  })
  const initialScore = computeRetrievalScore(firstPass.evidence)

  if (initialScore >= ANSWER_THRESHOLD) {
    return answerWithCitations(
      firstPass.evidence,
      input.query,
      initialScore,
      options.answer,
      options.persistCitations
    )
  }

  if (initialScore < JUDGE_THRESHOLD) {
    return refuse(initialScore)
  }

  const judgment = await options.judge({
    evidence: firstPass.evidence,
    query: input.query,
    retrievalScore: initialScore,
  })

  if (judgment.shouldAnswer) {
    return answerWithCitations(
      firstPass.evidence,
      input.query,
      initialScore,
      options.answer,
      options.persistCitations
    )
  }

  if (!judgment.reformulatedQuery) {
    return refuse(initialScore)
  }

  const retryPass = await options.retrieve({
    allowedAccessLevels: input.allowedAccessLevels,
    query: judgment.reformulatedQuery,
  })
  const retryScore = computeRetrievalScore(retryPass.evidence)

  if (retryScore >= ANSWER_THRESHOLD) {
    return answerWithCitations(
      retryPass.evidence,
      judgment.reformulatedQuery,
      retryScore,
      options.answer,
      options.persistCitations
    )
  }

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
  ) => Promise<Array<{ citationId: string; sourceChunkId: string }>>
): Promise<{
  answer: string
  citations: Array<{ citationId: string; sourceChunkId: string }>
  refused: false
  retrievalScore: number
}> {
  const responseText = await answer({
    evidence,
    modelRole: selectAnswerModelRole(evidence),
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

function selectAnswerModelRole(evidence: VerifiedKnowledgeEvidence[]): string {
  const distinctDocuments = new Set(evidence.map((item) => item.documentId))

  return distinctDocuments.size <= 1 ? 'defaultAnswer' : 'agentJudge'
}
