/**
 * observability-and-debug §2.1 — label + color helpers for the debug UI.
 *
 * All branching on `DecisionPath` / `RefusalReason` enum values MUST use
 * `switch + assertDecisionPathNever` / `assertRefusalReasonNever` so the
 * TypeScript compiler flags missing cases when a new enum value lands (see
 * `.claude/rules/development.md` Exhaustiveness Rule).
 *
 * NEVER return a default / empty string — every enum value MUST have an
 * explicit case.
 *
 * NULL handling: `describeDecisionPath(null)` and `describeRefusalReason(null)`
 * return "未測量" (not measured). Callers MUST route null through these
 * helpers rather than coercing to a sentinel enum value (§0.1 contract).
 */

import {
  type DecisionPath,
  type RefusalReason,
  assertDecisionPathNever,
  assertRefusalReasonNever,
} from '#shared/types/observability'

type BadgeColor = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export interface BadgeMeta {
  color: BadgeColor
  label: string
}

export function decisionPathLabel(value: DecisionPath): string {
  switch (value) {
    case 'direct_answer':
      return '直接回答'
    case 'judge_pass':
      return '評審通過'
    case 'judge_pass_refuse':
      return '評審拒答'
    case 'self_correction_retry':
      return '自我修正重試'
    case 'self_correction_refuse':
      return '自我修正後拒答'
    case 'restricted_blocked':
      return '輸入阻擋'
    case 'no_citation_refuse':
      return '無證據拒答'
    case 'sensitive_refuse':
      return '敏感拒答'
    case 'pipeline_error':
      return '流程錯誤'
    default:
      return assertDecisionPathNever(value, 'decisionPathLabel')
  }
}

export function decisionPathColor(value: DecisionPath): BadgeColor {
  switch (value) {
    case 'direct_answer':
    case 'judge_pass':
    case 'self_correction_retry':
      return 'success'
    case 'judge_pass_refuse':
    case 'self_correction_refuse':
    case 'no_citation_refuse':
    case 'sensitive_refuse':
      return 'warning'
    case 'restricted_blocked':
    case 'pipeline_error':
      return 'error'
    default:
      return assertDecisionPathNever(value, 'decisionPathColor')
  }
}

export function describeDecisionPath(value: DecisionPath | null): BadgeMeta {
  if (value === null) {
    return { color: 'neutral', label: '未測量' }
  }
  return { color: decisionPathColor(value), label: decisionPathLabel(value) }
}

export function refusalReasonLabel(value: RefusalReason): string {
  switch (value) {
    case 'restricted_scope':
      return '超出允許範圍'
    case 'no_citation':
      return '找不到可用證據'
    case 'sensitive_governance':
      return '敏感政策拒答'
    case 'low_confidence':
      return '信心不足'
    case 'pipeline_error':
      return '流程錯誤'
    default:
      return assertRefusalReasonNever(value, 'refusalReasonLabel')
  }
}

export function refusalReasonColor(value: RefusalReason): BadgeColor {
  switch (value) {
    case 'restricted_scope':
    case 'sensitive_governance':
      return 'error'
    case 'no_citation':
    case 'low_confidence':
      return 'warning'
    case 'pipeline_error':
      return 'error'
    default:
      return assertRefusalReasonNever(value, 'refusalReasonColor')
  }
}

export function describeRefusalReason(value: RefusalReason | null): BadgeMeta {
  if (value === null) {
    return { color: 'neutral', label: '未測量' }
  }
  return { color: refusalReasonColor(value), label: refusalReasonLabel(value) }
}

/**
 * Format a nullable number (latency / score) for display. `null` becomes
 * "—" (unmeasured) — callers MUST NOT fabricate 0.
 */
export function formatNullableNumber(value: number | null, suffix = ''): string {
  if (value === null) {
    return '—'
  }
  return `${value}${suffix}`
}

/**
 * Format a score (0-1 float) as a percentage, null-safe.
 */
export function formatScore(value: number | null): string {
  if (value === null) {
    return '未測量'
  }
  const percent = Math.round(value * 1000) / 10
  return `${percent}%`
}
