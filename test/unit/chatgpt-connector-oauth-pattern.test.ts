import { describe, expect, it } from 'vitest'

import {
  CHATGPT_CONNECTOR_LEGACY_REDIRECT_URI,
  isAllowedChatGptConnectorRedirectUri,
} from '#server/utils/mcp-chatgpt-registration'

describe('isAllowedChatGptConnectorRedirectUri — restricted path segment character set (TD-020)', () => {
  describe('accepts', () => {
    it.each([
      {
        label: 'ASCII alphanumeric with hyphen and underscore',
        uri: 'https://chatgpt.com/connector/oauth/connector-abc_123',
      },
      { label: 'lowercase with hyphen', uri: 'https://chatgpt.com/connector/oauth/a-b' },
      { label: 'uppercase with underscore', uri: 'https://chatgpt.com/connector/oauth/A_B_C' },
      { label: 'mixed case and digits', uri: 'https://chatgpt.com/connector/oauth/aB1_-2cD' },
      { label: 'single character', uri: 'https://chatgpt.com/connector/oauth/a' },
      {
        label: '64 character segment (upper boundary)',
        uri: `https://chatgpt.com/connector/oauth/${'a'.repeat(64)}`,
      },
    ])('accepts $label', ({ uri }) => {
      expect(isAllowedChatGptConnectorRedirectUri(uri)).toBe(true)
    })

    it('accepts the legacy redirect URI (independent equality check)', () => {
      expect(isAllowedChatGptConnectorRedirectUri(CHATGPT_CONNECTOR_LEGACY_REDIRECT_URI)).toBe(true)
    })
  })

  describe('rejects (tightened by TD-020)', () => {
    it.each([
      { label: 'dot in segment', uri: 'https://chatgpt.com/connector/oauth/foo.bar' },
      { label: 'Unicode CJK character', uri: 'https://chatgpt.com/connector/oauth/漢字id' },
      { label: 'segment with space', uri: 'https://chatgpt.com/connector/oauth/foo bar' },
      { label: 'plus sign', uri: 'https://chatgpt.com/connector/oauth/a+b' },
      { label: 'percent-encoded character', uri: 'https://chatgpt.com/connector/oauth/foo%20bar' },
      {
        label: '65 character segment (just over boundary)',
        uri: `https://chatgpt.com/connector/oauth/${'a'.repeat(65)}`,
      },
    ])('rejects $label', ({ uri }) => {
      expect(isAllowedChatGptConnectorRedirectUri(uri)).toBe(false)
    })
  })

  describe('still rejects pre-existing violations (regression coverage)', () => {
    it('rejects wrong origin even if segment is clean', () => {
      expect(isAllowedChatGptConnectorRedirectUri('https://evil.com/connector/oauth/abc')).toBe(
        false,
      )
    })

    it('rejects query string even if segment is clean', () => {
      expect(
        isAllowedChatGptConnectorRedirectUri('https://chatgpt.com/connector/oauth/abc?x=1'),
      ).toBe(false)
    })

    it('rejects fragment even if segment is clean', () => {
      expect(
        isAllowedChatGptConnectorRedirectUri('https://chatgpt.com/connector/oauth/abc#frag'),
      ).toBe(false)
    })

    it('rejects empty segment', () => {
      expect(isAllowedChatGptConnectorRedirectUri('https://chatgpt.com/connector/oauth/')).toBe(
        false,
      )
    })

    it('rejects malformed URL string', () => {
      expect(isAllowedChatGptConnectorRedirectUri('not-a-url')).toBe(false)
    })

    it('rejects wrong prefix', () => {
      expect(isAllowedChatGptConnectorRedirectUri('https://chatgpt.com/oauth/abc')).toBe(false)
    })
  })
})
