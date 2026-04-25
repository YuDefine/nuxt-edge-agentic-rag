import { h, ref } from 'vue'
import { mockComponent, mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RefusalReason } from '#shared/types/observability'

/**
 * Capability under test: web-chat-ui — Reason-Specific Refusal Message Copy.
 *
 * `RefusalMessage.vue` renders reason-specific Traditional Chinese copy in
 * its "可能的原因" / "建議的下一步" sections when the assistant turn
 * carries a known `RefusalReason`. Unknown / missing reasons fall back to
 * the generic copy.
 */

const userRoleMock = {
  role: ref<'admin' | 'member' | 'guest'>('admin'),
  isAdmin: ref(true),
  isMember: ref(false),
  isGuest: ref(false),
}

mockNuxtImport('useUserRole', () => () => userRoleMock)

vi.mock('~/utils/format-datetime', () => ({
  formatTimeShort: vi.fn(() => '12:34'),
}))

mockComponent('UIcon', {
  props: { name: { type: String, required: true } },
  setup(props) {
    return () => h('span', { 'data-icon': props.name })
  },
})

mockComponent('UBadge', {
  setup(_, { slots }) {
    return () => h('span', { 'data-testid': 'badge' }, slots.default?.())
  },
})

mockComponent('UButton', {
  props: {
    to: { type: String, default: undefined },
    icon: { type: String, default: undefined },
  },
  setup(props, { slots, attrs }) {
    return () =>
      h('button', { 'data-icon': props.icon, 'data-to': props.to, ...attrs }, slots.default?.())
  },
})

beforeEach(() => {
  userRoleMock.role.value = 'admin'
  userRoleMock.isAdmin.value = true
})

async function mountRefusal(props: { reason?: RefusalReason | null }) {
  const module = await import('~/components/chat/RefusalMessage.vue')
  return mountSuspended(module.default, {
    props: {
      content: '抱歉，我無法回答這個問題。',
      createdAt: '2026-04-25T10:00:00.000Z',
      ...props,
    },
  })
}

describe('RefusalMessage — reason-specific copy', () => {
  it('restricted_scope shows credential-leak guidance and omits the generic catch-all', async () => {
    const wrapper = await mountRefusal({ reason: 'restricted_scope' })
    const text = wrapper.text()

    expect(text).toContain('敏感資訊')
    expect(text).toContain('API key')
    // Generic catch-all "您詢問的內容可能不在目前知識庫範圍內" is the
    // sentinel for the fallback bucket — restricted_scope MUST replace it.
    expect(text).not.toContain('您詢問的內容可能不在目前知識庫範圍內')
  })

  it('no_citation shows out-of-scope guidance', async () => {
    const wrapper = await mountRefusal({ reason: 'no_citation' })
    const text = wrapper.text()

    expect(text).toContain('沒有與您的提問相符的文件')
    expect(text).not.toContain('您詢問的內容可能不在目前知識庫範圍內')
  })

  it('low_confidence shows insufficient-evidence guidance', async () => {
    const wrapper = await mountRefusal({ reason: 'low_confidence' })
    const text = wrapper.text()

    expect(text).toContain('內容不足以支撐確切答案')
    expect(text).not.toContain('您詢問的內容可能不在目前知識庫範圍內')
  })

  it('pipeline_error shows transient-failure guidance', async () => {
    const wrapper = await mountRefusal({ reason: 'pipeline_error' })
    const text = wrapper.text()

    expect(text).toContain('暫時無法處理')
    expect(text).not.toContain('您詢問的內容可能不在目前知識庫範圍內')
  })

  it('sensitive_governance shows governance-restricted guidance', async () => {
    const wrapper = await mountRefusal({ reason: 'sensitive_governance' })
    const text = wrapper.text()

    expect(text).toContain('敏感治理範疇')
  })

  it('null reason falls back to the generic copy', async () => {
    const wrapper = await mountRefusal({ reason: null })
    const text = wrapper.text()

    expect(text).toContain('您詢問的內容可能不在目前知識庫範圍內')
    expect(text).toContain('您的帳號權限可能無法存取相關文件')
    expect(text).toContain('問題敘述可能過於模糊或過於具體')
  })

  it('omitted reason falls back to the generic copy', async () => {
    const wrapper = await mountRefusal({})
    const text = wrapper.text()

    expect(text).toContain('您詢問的內容可能不在目前知識庫範圍內')
  })

  it('hides "查看相關文件清單" for non-admin viewers regardless of reason', async () => {
    userRoleMock.role.value = 'member'
    userRoleMock.isAdmin.value = false

    const wrapper = await mountRefusal({ reason: 'no_citation' })

    expect(wrapper.text()).not.toContain('查看相關文件清單')
  })
})
