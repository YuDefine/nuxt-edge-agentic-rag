import { describe, expect, it } from 'vitest'

import { assertNever } from '../../shared/utils/assert-never'

/**
 * Unit tests for Admin Query Log UI pure logic:
 * - QueryLogStatusBadge config (switch + assertNever)
 * - Channel label translation
 * - Redaction-safe field projection: ensure no raw-query shaped keys
 *   can escape through display helpers.
 */

type QueryLogStatus = 'accepted' | 'blocked' | 'limited' | 'rejected'

function getStatusConfig(status: QueryLogStatus) {
  switch (status) {
    case 'accepted':
      return { color: 'success' as const, label: '已接受' }
    case 'blocked':
      return { color: 'error' as const, label: '已阻擋' }
    case 'limited':
      return { color: 'warning' as const, label: '限流' }
    case 'rejected':
      return { color: 'neutral' as const, label: '已拒絕' }
    default:
      return assertNever(status, 'QueryLogStatusBadge')
  }
}

describe('query log status badge logic', () => {
  it('returns success for accepted', () => {
    expect(getStatusConfig('accepted')).toEqual({ color: 'success', label: '已接受' })
  })

  it('returns error for blocked', () => {
    expect(getStatusConfig('blocked')).toEqual({ color: 'error', label: '已阻擋' })
  })

  it('returns warning for limited', () => {
    expect(getStatusConfig('limited')).toEqual({ color: 'warning', label: '限流' })
  })

  it('returns neutral for rejected', () => {
    expect(getStatusConfig('rejected')).toEqual({ color: 'neutral', label: '已拒絕' })
  })

  it('throws on unknown status (exhaustiveness)', () => {
    expect(() => getStatusConfig('other' as QueryLogStatus)).toThrow(
      /Unhandled value in QueryLogStatusBadge/,
    )
  })
})

type QueryLogChannel = 'web' | 'mcp'

function getChannelLabel(channel: QueryLogChannel): string {
  switch (channel) {
    case 'web':
      return 'Web'
    case 'mcp':
      return 'MCP'
    default:
      return assertNever(channel, 'getChannelLabel')
  }
}

describe('query log channel labelling', () => {
  it('labels web channel', () => {
    expect(getChannelLabel('web')).toBe('Web')
  })

  it('labels mcp channel', () => {
    expect(getChannelLabel('mcp')).toBe('MCP')
  })

  it('throws on unknown channel (exhaustiveness)', () => {
    expect(() => getChannelLabel('other' as QueryLogChannel)).toThrow(
      /Unhandled value in getChannelLabel/,
    )
  })
})

/**
 * Redaction-safe projection.
 *
 * The detail UI must NEVER surface `query_text` / `queryText` / `raw_query` /
 * `rawQuery`. The server API already strips those fields, but the projection
 * helper enforces the rule at the display layer too.
 */

interface RawRow {
  id: string
  channel: string
  queryRedactedText: string
  // eslint-disable-next-line @typescript-eslint/naming-convention
  query_text?: string
  // eslint-disable-next-line @typescript-eslint/naming-convention
  raw_query?: string
  queryText?: string
  rawQuery?: string
  [extra: string]: unknown
}

function projectForDisplay(row: RawRow) {
  // Only explicit whitelist fields are exposed — matches server redaction contract.
  return {
    channel: row.channel,
    id: row.id,
    queryRedactedText: row.queryRedactedText,
  }
}

describe('query log display projection (redaction)', () => {
  it('drops any raw-query shaped keys that may accidentally be present', () => {
    const row: RawRow = {
      channel: 'web',
      id: 'ql-1',
      query_text: 'LEAK',
      queryRedactedText: '[redacted]',
      queryText: 'LEAK',
      rawQuery: 'LEAK',
      raw_query: 'LEAK',
    }

    const projected = projectForDisplay(row)

    expect(projected).not.toHaveProperty('query_text')
    expect(projected).not.toHaveProperty('queryText')
    expect(projected).not.toHaveProperty('raw_query')
    expect(projected).not.toHaveProperty('rawQuery')
    expect(projected.queryRedactedText).toBe('[redacted]')
  })
})
