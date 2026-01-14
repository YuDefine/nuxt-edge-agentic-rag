import { describe, expect, it, vi } from 'vitest'

import {
  McpRateLimitExceededError,
  consumeMcpToolRateLimit,
  createKvRateLimitStore,
} from '../../server/utils/mcp-rate-limit'

describe('mcp rate limit', () => {
  it('consumes rate limits through a KV-backed store', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ count: 1, windowStart: 0 })),
      put: vi.fn().mockResolvedValue(undefined),
    }

    const result = await consumeMcpToolRateLimit({
      environment: 'local',
      now: 60_000,
      store: createKvRateLimitStore(kv),
      tokenId: 'token-1',
      tool: 'askKnowledge',
    })

    expect(result.allowed).toBe(true)
    expect(kv.get).toHaveBeenCalledWith('mcp:local:askKnowledge:token-1')
    expect(kv.put).toHaveBeenCalledWith(
      'mcp:local:askKnowledge:token-1',
      JSON.stringify({ count: 2, windowStart: 0 }),
      { expirationTtl: 300 }
    )
  })

  it('throws 429 when the MCP tool exceeds its fixed window', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ count: 30, windowStart: 0 })),
      put: vi.fn(),
    }

    await expect(
      consumeMcpToolRateLimit({
        environment: 'local',
        now: 60_000,
        store: createKvRateLimitStore(kv),
        tokenId: 'token-1',
        tool: 'askKnowledge',
      })
    ).rejects.toThrowError(
      new McpRateLimitExceededError('Rate limit exceeded for askKnowledge', 429, 240000)
    )
    expect(kv.put).not.toHaveBeenCalled()
  })
})
