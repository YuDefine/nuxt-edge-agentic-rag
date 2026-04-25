import { h } from 'vue'
import { mockComponent, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'

/**
 * Capability under test: web-chat-ui — Markdown rendering for assistant turns.
 *
 * `MarkdownContent.vue` is the runtime markdown surface used by both
 * `MessageList.vue` (final assistant messages) and `StreamingMessage.vue`
 * (live SSE deltas). Real markdown parsing is delegated to `@nuxtjs/mdc`'s
 * `<MDC>` component; here we mock it as an echo so we can assert wrapper
 * concerns: prop forwarding and streaming-cursor visibility.
 */

mockComponent('MDC', {
  props: {
    value: { type: String, default: '' },
    tag: { type: String, default: 'div' },
  },
  setup(props) {
    return () => h(props.tag, { 'data-testid': 'mdc', 'data-value': props.value })
  },
})

async function mountMarkdown(props: { content: string; streaming?: boolean }) {
  const module = await import('~/components/chat/MarkdownContent.vue')
  return mountSuspended(module.default, { props })
}

describe('ChatMarkdownContent', () => {
  it('forwards content to MDC for non-streaming render', async () => {
    const wrapper = await mountMarkdown({
      content: '**bold** and `code`',
    })

    const mdc = wrapper.find('[data-testid="mdc"]')
    expect(mdc.exists()).toBe(true)
    expect(mdc.attributes('data-value')).toBe('**bold** and `code`')
  })

  it('does not render the streaming cursor when streaming is false', async () => {
    const wrapper = await mountMarkdown({
      content: 'plain text',
      streaming: false,
    })

    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(false)
  })

  it('renders a streaming cursor when streaming is true', async () => {
    const wrapper = await mountMarkdown({
      content: 'plain text',
      streaming: true,
    })

    const cursor = wrapper.find('[aria-hidden="true"]')
    expect(cursor.exists()).toBe(true)
    expect(cursor.classes()).toContain('animate-pulse')
  })
})
