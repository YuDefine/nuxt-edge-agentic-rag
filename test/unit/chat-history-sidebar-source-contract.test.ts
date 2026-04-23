import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('app/pages/index.vue'), 'utf8')

describe('chat history sidebar source contract', () => {
  it('persists the lg sidebar collapsed state with the agreed storage key', () => {
    expect(source).toContain("useLocalStorage('chat:history-sidebar:collapsed', false,")
    expect(source).toContain('sidebarCollapsed')
  })

  it('switches the inline aside between expanded and collapsed lg widths accessibly', () => {
    expect(source).toContain("sidebarCollapsed ? 'lg:w-12' : 'lg:w-64'")
    expect(source).toContain('transition-[width] duration-200')
    expect(source).toContain("sidebarCollapsed ? '對話記錄（已收合）' : '對話記錄'")
  })

  it('renders separate expanded and collapsed controls for the inline sidebar', () => {
    expect(source).toContain('aria-label="收合對話記錄"')
    expect(source).toContain('icon="i-lucide-panel-left-close"')
    expect(source).toContain('text="展開對話記錄"')
    expect(source).toContain('aria-label="展開對話記錄"')
    expect(source).toContain('icon="i-lucide-panel-left-open"')
  })

  it('passes collapsed props only to the lg inline rail, not the drawer instance', () => {
    expect(source).toContain(':collapsed="sidebarCollapsed"')
    expect(source).toContain(':on-expand-request="expandHistorySidebar"')

    const drawerBody = source.slice(source.indexOf('id="chat-history-drawer"'))
    expect(drawerBody).toContain('<LazyChatConversationHistory')
    expect(drawerBody).not.toContain(':collapsed=')
    expect(drawerBody).not.toContain('on-expand-request')
  })
})
