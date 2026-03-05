/**
 * observability-and-debug §2.1 — tests for the DecisionPathBadge labelling
 * helpers. Covers every value of `DecisionPath` so exhaustiveness failures
 * are caught by the test suite, not just at render time.
 */

import { describe, expect, it } from 'vitest'

import { DECISION_PATH_VALUES, REFUSAL_REASON_VALUES } from '#shared/types/observability'
import {
  describeDecisionPath,
  describeRefusalReason,
  decisionPathLabel,
  decisionPathColor,
  refusalReasonLabel,
} from '../../app/utils/debug-labels'

describe('decisionPathLabel', () => {
  it('returns a non-empty Chinese label for every DecisionPath value', () => {
    for (const path of DECISION_PATH_VALUES) {
      const label = decisionPathLabel(path)
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('produces distinct labels across the enum (no accidental duplicates)', () => {
    const labels = DECISION_PATH_VALUES.map(decisionPathLabel)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('decisionPathColor', () => {
  it('returns a valid Nuxt UI badge color for every DecisionPath', () => {
    const allowed = new Set(['success', 'warning', 'error', 'info', 'neutral'])
    for (const path of DECISION_PATH_VALUES) {
      expect(allowed.has(decisionPathColor(path))).toBe(true)
    }
  })

  it('marks pipeline_error as error (critical failure)', () => {
    expect(decisionPathColor('pipeline_error')).toBe('error')
  })

  it('marks restricted_blocked as error (audit forbade)', () => {
    expect(decisionPathColor('restricted_blocked')).toBe('error')
  })

  it('marks direct_answer as success', () => {
    expect(decisionPathColor('direct_answer')).toBe('success')
  })
})

describe('describeDecisionPath', () => {
  it('renders an "未測量" fallback when value is null', () => {
    expect(describeDecisionPath(null)).toEqual({
      color: 'neutral',
      label: '未測量',
    })
  })

  it('returns full metadata for a known path', () => {
    const meta = describeDecisionPath('direct_answer')
    expect(meta.color).toBe('success')
    expect(meta.label.length).toBeGreaterThan(0)
  })
})

describe('refusalReasonLabel', () => {
  it('covers every RefusalReason value', () => {
    for (const r of REFUSAL_REASON_VALUES) {
      expect(refusalReasonLabel(r).length).toBeGreaterThan(0)
    }
  })
})

describe('describeRefusalReason', () => {
  it('renders "未測量" for null', () => {
    expect(describeRefusalReason(null).label).toBe('未測量')
  })

  it('returns label + color for known value', () => {
    const meta = describeRefusalReason('no_citation')
    expect(meta.label.length).toBeGreaterThan(0)
    expect(['warning', 'error', 'neutral', 'info']).toContain(meta.color)
  })
})
