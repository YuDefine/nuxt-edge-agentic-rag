import { describe, expect, it } from 'vitest'

import type { ChatConversationSummary } from '~/types/chat'
import { groupConversationsByRecency } from '~/utils/conversation-grouping'

function createConversation(
  id: string,
  updatedAt: ChatConversationSummary['updatedAt'],
): ChatConversationSummary {
  return {
    id,
    title: id,
    accessLevel: 'internal',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt,
    userProfileId: 'user-1',
  }
}

function localDate(daysAgo: number, hour = 12, minute = 0): string {
  return new Date(2026, 3, 24 - daysAgo, hour, minute).toISOString()
}

describe('groupConversationsByRecency', () => {
  const now = new Date(2026, 3, 24, 12, 0)

  it('groups conversations into fixed recency buckets and omits empty buckets', () => {
    const groups = groupConversationsByRecency(
      [
        createConversation('today', localDate(0, 8)),
        createConversation('yesterday', localDate(1, 23, 59)),
        createConversation('this-week-2-days', localDate(2, 23, 59)),
        createConversation('this-week-7-days', localDate(7, 0)),
        createConversation('this-month-8-days', localDate(8, 12)),
        createConversation('this-month-30-days', localDate(30, 12)),
        createConversation('earlier-31-days', localDate(31, 12)),
      ],
      now,
    )

    expect(groups.map((group) => [group.bucket, group.label, group.conversations.length])).toEqual([
      ['today', '今天', 1],
      ['yesterday', '昨天', 1],
      ['thisWeek', '本週', 2],
      ['thisMonth', '本月', 2],
      ['earlier', '更早', 1],
    ])
  })

  it('returns an empty array for an empty conversation list', () => {
    expect(groupConversationsByRecency([], now)).toEqual([])
  })

  it('places missing empty or invalid updatedAt values into earlier without throwing', () => {
    const groups = groupConversationsByRecency(
      [
        createConversation('empty', ''),
        createConversation('invalid', 'not-a-date'),
        createConversation('null', null as unknown as string),
      ],
      now,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      bucket: 'earlier',
      label: '更早',
    })
    expect(groups[0]?.conversations.map((conversation) => conversation.id)).toEqual([
      'empty',
      'invalid',
      'null',
    ])
  })
})
