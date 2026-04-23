/**
 * observability-and-debug §1.2 — debug-safe derived fields exposed on
 * `query_logs`.
 *
 * These enum shapes are the ONLY allowed values for `decision_path` /
 * `refusal_reason` on persisted rows. Production code MUST use
 * `switch + assertDecisionPathNever` / `assertRefusalReasonNever` when
 * branching on these values so adding a new path triggers a compile error at
 * every consumer (see `.claude/rules/development.md` Exhaustiveness Rule).
 *
 * `null` is reserved for "not measured / not applicable". Consumers must not
 * coerce null into a sentinel like `'unknown'` — the debug surface depends on
 * NULL retaining its "no data" meaning.
 */

export interface OutcomeBreakdown {
  answered: number
  refused: number
  forbidden: number
  error: number
}

export const DECISION_PATH_VALUES = [
  /**
   * Retrieval top-score met `directAnswerMin` on the first pass. Answer
   * produced without invoking the judge or self-correction.
   */
  'direct_answer',
  /**
   * Judge ran and returned `shouldAnswer: true`. Answer produced from the
   * first-pass evidence (no reformulation needed).
   */
  'judge_pass',
  /**
   * Judge ran and returned `shouldAnswer: false` without a reformulated
   * query. Orchestration refused instead of answering.
   */
  'judge_pass_refuse',
  /**
   * Judge returned `shouldAnswer: false` with a reformulated query, the
   * retry pass met `directAnswerMin`, and an answer was produced from the
   * retry evidence.
   */
  'self_correction_retry',
  /**
   * Judge asked for reformulation, the retry pass still failed to meet the
   * answering threshold, and orchestration refused.
   */
  'self_correction_refuse',
  /**
   * Input was blocked by the audit layer (credential / sensitive pattern)
   * before retrieval ever ran. Query log was written with status `blocked`.
   */
  'restricted_blocked',
  /**
   * First-pass retrieval score fell below `judgeMin` so the orchestration
   * refused without running the judge (no evidence worth evaluating).
   */
  'no_citation_refuse',
  /**
   * Reserved for policy-layer refusals above audit (e.g. future sensitive
   * governance rule). Not emitted by the current pipeline but kept in the
   * enum so UI can render it when future rules land.
   */
  'sensitive_refuse',
  /**
   * Pipeline threw / crashed. Latency fields are null because we cannot
   * trust partial timing after an error.
   */
  'pipeline_error',
] as const

export type DecisionPath = (typeof DECISION_PATH_VALUES)[number]

export const REFUSAL_REASON_VALUES = [
  /** Audit layer blocked input for credential / secret exposure. */
  'restricted_scope',
  /** No retrieval evidence cleared the citation threshold. */
  'no_citation',
  /** Reserved for future sensitive-topic governance refusals. */
  'sensitive_governance',
  /** Judge / retry still produced below-threshold evidence. */
  'low_confidence',
  /** Pipeline threw; refusal is surfaced to the user as a generic error. */
  'pipeline_error',
] as const

export type RefusalReason = (typeof REFUSAL_REASON_VALUES)[number]

/**
 * assertNever helper scoped to DecisionPath. Using a dedicated helper here
 * avoids a runtime dependency on `~/utils/assert-never` from shared/ (which
 * is allowed to run in both server and client contexts).
 */
export function assertDecisionPathNever(value: never, context: string): never {
  throw new Error(`Unhandled DecisionPath in ${context}: ${JSON.stringify(value)}`)
}

export function assertRefusalReasonNever(value: never, context: string): never {
  throw new Error(`Unhandled RefusalReason in ${context}: ${JSON.stringify(value)}`)
}
