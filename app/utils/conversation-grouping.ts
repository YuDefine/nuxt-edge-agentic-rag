import type { ChatConversationSummary } from '~/types/chat'

export type ConversationRecencyBucket = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier'

export interface ConversationRecencyGroup {
  bucket: ConversationRecencyBucket
  label: string
  conversations: ChatConversationSummary[]
}

const BUCKETS = [
  { bucket: 'today', label: '今天' },
  { bucket: 'yesterday', label: '昨天' },
  { bucket: 'thisWeek', label: '本週' },
  { bucket: 'thisMonth', label: '本月' },
  { bucket: 'earlier', label: '更早' },
] satisfies Array<{
  bucket: ConversationRecencyBucket
  label: string
}>

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function groupConversationsByRecency(
  conversations: ChatConversationSummary[],
  now: Date,
): ConversationRecencyGroup[] {
  const grouped = new Map<ConversationRecencyBucket, ChatConversationSummary[]>(
    BUCKETS.map(({ bucket }) => [bucket, []]),
  )

  for (const conversation of conversations) {
    const bucket = getRecencyBucket(conversation.updatedAt, now)
    grouped.get(bucket)?.push(conversation)
  }

  return BUCKETS.flatMap(({ bucket, label }) => {
    const bucketConversations = grouped.get(bucket) ?? []
    if (bucketConversations.length === 0) {
      return []
    }

    return [
      {
        bucket,
        label,
        conversations: bucketConversations,
      },
    ]
  })
}

function getRecencyBucket(value: unknown, now: Date): ConversationRecencyBucket {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'earlier'
  }

  const updatedAt = new Date(value)
  if (Number.isNaN(updatedAt.getTime())) {
    return 'earlier'
  }

  const daysAgo = getLocalCalendarDayDifference(updatedAt, now)
  if (daysAgo <= 0) {
    return 'today'
  }
  if (daysAgo === 1) {
    return 'yesterday'
  }
  if (daysAgo <= 7) {
    return 'thisWeek'
  }
  if (daysAgo <= 30) {
    return 'thisMonth'
  }

  return 'earlier'
}

function getLocalCalendarDayDifference(value: Date, now: Date): number {
  const valueStart = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

  return Math.floor((nowStart - valueStart) / MS_PER_DAY)
}
