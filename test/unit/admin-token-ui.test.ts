import { describe, expect, it } from 'vitest'

import { assertNever } from '../../shared/utils/assert-never'

/**
 * Unit tests for Admin Token Management UI pure logic:
 * - TokenStatusBadge config selection (switch + assertNever)
 * - Token scope labelling
 *
 * These mirror the display logic in
 * `app/components/admin/tokens/TokenStatusBadge.vue` and
 * `app/pages/admin/tokens/index.vue` so any new enum value
 * forces a TypeScript compile-time failure (exhaustiveness rule).
 */

type TokenStatus = 'active' | 'revoked' | 'expired'

function getTokenStatusConfig(status: TokenStatus) {
  switch (status) {
    case 'active':
      return { color: 'success' as const, label: '啟用中' }
    case 'revoked':
      return { color: 'neutral' as const, label: '已撤銷' }
    case 'expired':
      return { color: 'warning' as const, label: '已過期' }
    default:
      return assertNever(status, 'TokenStatusBadge')
  }
}

describe('token status badge logic', () => {
  it('returns success color for active tokens', () => {
    expect(getTokenStatusConfig('active')).toEqual({ color: 'success', label: '啟用中' })
  })

  it('returns neutral color for revoked tokens', () => {
    expect(getTokenStatusConfig('revoked')).toEqual({ color: 'neutral', label: '已撤銷' })
  })

  it('returns warning color for expired tokens', () => {
    expect(getTokenStatusConfig('expired')).toEqual({ color: 'warning', label: '已過期' })
  })

  it('throws for unknown status values (exhaustiveness)', () => {
    expect(() => getTokenStatusConfig('unknown' as TokenStatus)).toThrow(
      /Unhandled value in TokenStatusBadge/,
    )
  })
})

type TokenScope =
  | 'knowledge.search'
  | 'knowledge.ask'
  | 'knowledge.citation.read'
  | 'knowledge.category.list'
  | 'knowledge.restricted.read'

const VALID_SCOPES: TokenScope[] = [
  'knowledge.search',
  'knowledge.ask',
  'knowledge.citation.read',
  'knowledge.category.list',
  'knowledge.restricted.read',
]

function getScopeLabel(scope: TokenScope): string {
  switch (scope) {
    case 'knowledge.search':
      return '搜尋'
    case 'knowledge.ask':
      return '問答'
    case 'knowledge.citation.read':
      return '引用讀取'
    case 'knowledge.category.list':
      return '分類列表'
    case 'knowledge.restricted.read':
      return '機敏讀取'
    default:
      return assertNever(scope, 'getScopeLabel')
  }
}

describe('token scope labelling', () => {
  it('provides a label for every declared scope', () => {
    for (const scope of VALID_SCOPES) {
      expect(getScopeLabel(scope)).not.toBe('')
    }
  })

  it('throws for unknown scope values (exhaustiveness)', () => {
    expect(() => getScopeLabel('unknown.scope' as TokenScope)).toThrow(
      /Unhandled value in getScopeLabel/,
    )
  })
})
