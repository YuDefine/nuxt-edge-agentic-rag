import { describe, expect, it, vi } from 'vitest'

import { pruneKnowledgeRetentionWindow } from '#server/utils/knowledge-retention'

describe('knowledge retention', () => {
  it('prunes expired audit records and scrubs expired or revoked MCP token metadata after 180 days', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const database = { prepare }

    await pruneKnowledgeRetentionWindow({
      database,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(prepare).toHaveBeenCalledTimes(4)
    expect(prepare.mock.calls[0]?.[0]).toContain('DELETE FROM messages')
    expect(prepare.mock.calls[1]?.[0]).toContain('DELETE FROM query_logs')
    expect(prepare.mock.calls[2]?.[0]).toContain('DELETE FROM citation_records')
    expect(prepare.mock.calls[3]?.[0]).toContain('UPDATE mcp_tokens')

    expect(bind).toHaveBeenNthCalledWith(1, '2025-07-05T00:00:00.000Z')
    expect(bind).toHaveBeenNthCalledWith(2, '2025-07-05T00:00:00.000Z')
    expect(bind).toHaveBeenNthCalledWith(3, '2026-01-01T00:00:00.000Z')
    expect(bind).toHaveBeenNthCalledWith(4, '2025-07-05T00:00:00.000Z')
    expect(run).toHaveBeenCalledTimes(4)
  })
})
