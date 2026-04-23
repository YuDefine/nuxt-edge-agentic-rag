import { describe, expect, it } from 'vitest'

import {
  buildChatRequestBody,
  buildConversationSessionStorageKey,
  mapConversationDetailToChatMessages,
  resolvePreferredConversationId,
} from '~/utils/chat-conversation-state'

describe('chat conversation state helpers', () => {
  it('omits conversationId for a first-turn request', () => {
    expect(buildChatRequestBody('第一次提問', null)).toEqual({
      query: '第一次提問',
    })
  })

  it('reuses the active conversationId for a follow-up request', () => {
    expect(buildChatRequestBody('第二次追問', 'conv-2')).toEqual({
      query: '第二次追問',
      conversationId: 'conv-2',
    })
  })

  it('builds a per-user session storage key for active conversation restore', () => {
    expect(buildConversationSessionStorageKey('user-9')).toBe('web-chat:active-conversation:user-9')
  })

  it('prefers the stored visible conversation during reload restore', () => {
    expect(
      resolvePreferredConversationId({
        currentConversationId: null,
        storedConversationId: 'conv-b',
        visibleConversationIds: ['conv-a', 'conv-b', 'conv-c'],
      }),
    ).toBe('conv-b')
  })

  it('falls back to the newest visible conversation when the stored id is stale', () => {
    expect(
      resolvePreferredConversationId({
        currentConversationId: null,
        storedConversationId: 'conv-missing',
        visibleConversationIds: ['conv-a', 'conv-b'],
      }),
    ).toBe('conv-a')
  })

  it('maps persisted conversation detail into UI chat messages', () => {
    expect(
      mapConversationDetailToChatMessages({
        id: 'conv-1',
        title: '採購流程',
        accessLevel: 'internal',
        createdAt: '2026-04-23T08:00:00.000Z',
        updatedAt: '2026-04-23T08:10:00.000Z',
        userProfileId: 'user-1',
        messages: [
          {
            id: 'msg-user',
            role: 'user',
            contentRedacted: '第一步怎麼做？',
            contentText: '第一步怎麼做？',
            citationsJson: '[]',
            createdAt: '2026-04-23T08:00:00.000Z',
          },
          {
            id: 'msg-assistant',
            role: 'assistant',
            contentRedacted: '先建立請購單。',
            contentText: '先建立請購單。',
            citationsJson:
              '[{"citationId":"cit-1","sourceChunkId":"chunk-1","documentVersionId":"ver-1"}]',
            createdAt: '2026-04-23T08:00:05.000Z',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'msg-user',
        role: 'user',
        content: '第一步怎麼做？',
        createdAt: '2026-04-23T08:00:00.000Z',
      },
      {
        id: 'msg-assistant',
        role: 'assistant',
        content: '先建立請購單。',
        citations: [{ citationId: 'cit-1', sourceChunkId: 'chunk-1' }],
        createdAt: '2026-04-23T08:00:05.000Z',
      },
    ])
  })

  it('renders a fixed placeholder when persisted raw content is unavailable', () => {
    expect(
      mapConversationDetailToChatMessages({
        id: 'conv-2',
        title: '遮罩測試',
        accessLevel: 'internal',
        createdAt: '2026-04-23T09:00:00.000Z',
        updatedAt: '2026-04-23T09:00:00.000Z',
        userProfileId: 'user-1',
        messages: [
          {
            id: 'msg-blocked',
            role: 'user',
            contentRedacted: '[BLOCKED:credential]',
            contentText: null,
            citationsJson: '[]',
            createdAt: '2026-04-23T09:00:00.000Z',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'msg-blocked',
        role: 'user',
        content: '此訊息因治理規則無法顯示原文。',
        createdAt: '2026-04-23T09:00:00.000Z',
      },
    ])
  })
})
