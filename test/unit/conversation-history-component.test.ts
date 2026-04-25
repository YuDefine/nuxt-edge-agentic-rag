import { h, shallowRef } from 'vue'
import { mountSuspended, mockComponent } from '@nuxt/test-utils/runtime'
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

const historyMock = {
  conversations: shallowRef<ChatConversationSummary[]>([]),
  deleteConversationById: vi.fn(),
  deleteInFlightId: shallowRef<string | null>(null),
  isLoading: shallowRef(false),
  refresh: vi.fn().mockResolvedValue(true),
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
          'button',
          {
            'data-testid': 'bucket-toggle',
            type: 'button',
            onClick: () => emit('update:open', !props.open),
          },
          slots.default?.({ open: props.open }),
        ),
        props.open ? h('div', { 'data-testid': 'bucket-body' }, slots.content?.()) : null,
      ])
  },
})

describe('ConversationHistory', () => {
  beforeEach(() => {
    process.env.TZ = 'Asia/Taipei'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T12:00:00.000+08:00'))
    historyMock.conversations.value = []
    historyMock.deleteInFlightId.value = null
    historyMock.isLoading.value = false
    historyMock.refresh.mockClear()
    historyMock.selectConversation.mockClear()
    historyMock.deleteConversationById.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function mountConversationHistory(props = {}) {
    const module = await import('~/components/chat/ConversationHistory.vue')
    return mountSuspended(module.default, { props })
  }

  it('renders a collapsed interactive rail without conversation rows', async () => {
    historyMock.conversations.value = [
      createConversation('今日對話', new Date(2026, 3, 24, 10).toISOString()),
      createConversation('稍早對話', new Date(2026, 3, 20, 10).toISOString()),
    ]

    const wrapper = await mountConversationHistory({
      collapsed: true,
    })

    expect(wrapper.find('[data-testid="conversation-history-rail"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).not.toContain('今日對話')

    await wrapper.find('[data-testid="conversation-history-rail"]').trigger('click')

    expect(wrapper.emitted('expand-request')).toBeDefined()
    expect(wrapper.emitted('expand-request')).toHaveLength(1)
  })

  it('groups conversations by recency with recent buckets open by default', async () => {
    historyMock.conversations.value = [
      createConversation('今日對話', new Date(2026, 3, 24, 10).toISOString()),
      createConversation('更早對話', new Date(2026, 2, 20, 10).toISOString()),
    ]

    const wrapper = await mountConversationHistory()

    expect(wrapper.text()).toContain('今天')
    expect(wrapper.text()).toContain('更早')
    expect(wrapper.text()).toContain('今日對話')
    expect(wrapper.text()).not.toContain('更早對話')
  })

  it('keeps the empty state outside the grouping path', async () => {
    const wrapper = await mountConversationHistory()

    expect(wrapper.text()).toContain('尚無已保存對話。送出第一個問題後，這裡會出現對話歷史。')
    expect(wrapper.find('[data-testid="bucket"]').exists()).toBe(false)
  })

  it('keeps conversation selection wired to the existing history contract', async () => {
    historyMock.conversations.value = [
      createConversation('今日對話', new Date(2026, 3, 24, 10).toISOString()),
    ]

    const wrapper = await mountConversationHistory()

    await wrapper.get('[data-testid="conversation-row-button"]').trigger('click')

    expect(historyMock.selectConversation).toHaveBeenCalledWith('今日對話')
  })

  it('emits new-conversation-request from the collapsed rail plus button (Explicit New Conversation Entry Points)', async () => {
    const wrapper = await mountConversationHistory({ collapsed: true })

    const collapsedNewButton = wrapper.get(
      '[data-testid="conversation-history-new-button-collapsed"]',
    )

    await collapsedNewButton.trigger('click')

    expect(wrapper.emitted('new-conversation-request')).toBeDefined()
    expect(wrapper.emitted('new-conversation-request')).toHaveLength(1)
    // 修綁定後 collapsed plus button 不再呼叫 requestExpand
    expect(wrapper.emitted('expand-request')).toBeUndefined()
  })

  it('emits new-conversation-request from the expanded header button (Explicit New Conversation Entry Points)', async () => {
    const wrapper = await mountConversationHistory()

    const expandedNewButton = wrapper.get(
      '[data-testid="conversation-history-new-button-expanded"]',
    )

    await expandedNewButton.trigger('click')

    expect(wrapper.emitted('new-conversation-request')).toBeDefined()
    expect(wrapper.emitted('new-conversation-request')).toHaveLength(1)
  })

  it('disables both new-conversation buttons when props.disabled is true', async () => {
    const collapsedWrapper = await mountConversationHistory({
      collapsed: true,
      disabled: true,
    })
    const expandedWrapper = await mountConversationHistory({ disabled: true })

    expect(
      collapsedWrapper
        .get('[data-testid="conversation-history-new-button-collapsed"]')
        .attributes('disabled'),
    ).toBeDefined()
    expect(
      expandedWrapper
        .get('[data-testid="conversation-history-new-button-expanded"]')
        .attributes('disabled'),
    ).toBeDefined()
  })
})
