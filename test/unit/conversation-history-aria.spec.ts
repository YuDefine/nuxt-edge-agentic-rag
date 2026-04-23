import { h, shallowRef } from 'vue'
import { mockComponent, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('ConversationHistory aria-expanded', () => {
  beforeEach(() => {
    historyMock.conversations.value = []
    historyMock.deleteInFlightId.value = null
    historyMock.isLoading.value = false
    historyMock.refresh.mockClear()
    historyMock.selectConversation.mockClear()
    historyMock.deleteConversationById.mockClear()
  })

  async function mountConversationHistory(props = {}) {
    const module = await import('~/components/chat/ConversationHistory.vue')
    return mountSuspended(module.default, { props })
  }

  it('bucket toggle button exposes aria-expanded="true" when bucket is open by default', async () => {
    historyMock.conversations.value = [
      createConversation('今日對話', new Date(2026, 3, 24, 10).toISOString()),
    ]

    const wrapper = await mountConversationHistory()

    const toggle = wrapper.get('button[aria-expanded]')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.text()).toContain('今天')
  })

  it('bucket toggle button exposes aria-expanded="false" when bucket is collapsed by default', async () => {
    historyMock.conversations.value = [
      createConversation('更早對話', new Date(2026, 2, 20, 10).toISOString()),
    ]

    const wrapper = await mountConversationHistory()

    const toggles = wrapper.findAll('button[aria-expanded]')
    const earlier = toggles.find((node) => node.text().includes('更早'))
    expect(earlier).toBeDefined()
    expect(earlier!.attributes('aria-expanded')).toBe('false')
  })

  it('aria-expanded flips synchronously when the bucket open state changes', async () => {
    historyMock.conversations.value = [
      createConversation('更早對話', new Date(2026, 2, 20, 10).toISOString()),
    ]

    const wrapper = await mountConversationHistory()

    const earlierToggle = wrapper
      .findAll('button[aria-expanded]')
      .find((node) => node.text().includes('更早'))
    expect(earlierToggle).toBeDefined()
    expect(earlierToggle!.attributes('aria-expanded')).toBe('false')

    const trigger = wrapper
      .findAll('[data-testid="bucket-trigger-wrap"]')
      .find((node) => node.text().includes('更早'))
    expect(trigger).toBeDefined()
    await trigger!.trigger('click')

    const reopened = wrapper
      .findAll('button[aria-expanded]')
      .find((node) => node.text().includes('更早'))
    expect(reopened!.attributes('aria-expanded')).toBe('true')
  })
})
