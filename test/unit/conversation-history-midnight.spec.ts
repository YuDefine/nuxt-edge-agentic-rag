import { h, shallowRef } from 'vue'
import { mockComponent, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatConversationSummary } from '~/types/chat'

function createConversation(id: string, updatedAt: string): ChatConversationSummary {
  return {
    id,
    title: id,
    accessLevel: 'internal',
    createdAt: updatedAt,
    updatedAt,
    userProfileId: 'user-1',
  }
}

const listConversations = vi.fn<[], Promise<ChatConversationSummary[]>>()

const historyMock = {
  conversations: shallowRef<ChatConversationSummary[]>([]),
  deleteConversationById: vi.fn(),
  deleteInFlightId: shallowRef<string | null>(null),
  isLoading: shallowRef(false),
  refresh: vi.fn().mockImplementation(async () => {
    historyMock.conversations.value = await listConversations()
    return true
  }),
  selectConversation: vi.fn(),
}

vi.mock('~/composables/useChatConversationHistory', () => ({
  ChatConversationHistoryInjectionKey: Symbol('ChatConversationHistory'),
  useChatConversationHistory: vi.fn(() => historyMock),
}))

vi.mock('~/utils/chat-conversation-loader', () => ({
  loadChatConversationDetail: vi.fn(),
}))

mockComponent('UBadge', {
  setup(_, { slots }) {
    return () => h('span', { 'data-testid': 'badge' }, slots.default?.())
  },
})

mockComponent('UIcon', {
  props: {
    name: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    return () => h('span', { 'data-icon': props.name })
  },
})

mockComponent('UCollapsible', {
  props: {
    open: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['update:open'],
  setup(props, { emit, slots }) {
    return () =>
      h('section', { 'data-testid': 'bucket' }, [
        h(
          'div',
          {
            'data-testid': 'bucket-trigger-wrap',
            onClick: () => emit('update:open', !props.open),
          },
          slots.default?.({ open: props.open }),
        ),
        props.open ? h('div', { 'data-testid': 'bucket-body' }, slots.content?.()) : null,
      ])
  },
})

describe('ConversationHistory midnight regrouping', () => {
  beforeEach(() => {
    process.env.TZ = 'Asia/Taipei'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T23:50:00.000+08:00'))
    historyMock.conversations.value = []
    historyMock.deleteInFlightId.value = null
    historyMock.isLoading.value = false
    listConversations.mockReset()
    historyMock.refresh.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function mountConversationHistory() {
    const module = await import('~/components/chat/ConversationHistory.vue')
    return mountSuspended(module.default)
  }

  it('reclassifies a 23:50 conversation from Today to Yesterday after midnight without refetch', async () => {
    const conversation = createConversation(
      'before-midnight',
      new Date('2026-04-24T23:50:00.000+08:00').toISOString(),
    )
    historyMock.conversations.value = [conversation]
    listConversations.mockResolvedValue([conversation])

    const wrapper = await mountConversationHistory()

    expect(wrapper.text()).toContain('今天')
    expect(wrapper.text()).not.toContain('昨天')

    const fetchCountBeforeMidnight = listConversations.mock.calls.length

    // Advance past midnight so that useNow ticks at least once into the new day.
    await vi.advanceTimersByTimeAsync(20 * 60_000)

    expect(wrapper.text()).toContain('昨天')
    expect(wrapper.text()).not.toContain('今天')
    expect(listConversations.mock.calls.length).toBe(fetchCountBeforeMidnight)
  })

  it('does not tick faster than once per minute', async () => {
    const conversation = createConversation(
      'before-midnight',
      new Date('2026-04-24T23:59:00.000+08:00').toISOString(),
    )
    historyMock.conversations.value = [conversation]
    listConversations.mockResolvedValue([conversation])

    const wrapper = await mountConversationHistory()
    const textBefore = wrapper.text()

    // Advance 30 seconds — still well before midnight and within one tick window.
    await vi.advanceTimersByTimeAsync(30_000)

    expect(wrapper.text()).toBe(textBefore)
  })
})
