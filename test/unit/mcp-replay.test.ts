import { describe, expect, it, vi } from 'vitest'

import { McpReplayError, getDocumentChunk } from '../../server/utils/mcp-replay'

describe('mcp replay', () => {
  it('replays a historical citation snapshot that is still within retention', async () => {
    const result = await getDocumentChunk(
      {
        auth: {
          scopes: ['knowledge.citation.read'],
          tokenId: 'token-1',
        },
        citationId: 'citation-1',
      },
      {
        replayStore: {
          findReplayableCitationById: vi.fn().mockResolvedValue({
            accessLevel: 'internal',
            chunkTextSnapshot: 'Historical chunk snapshot',
            citationId: 'citation-1',
            citationLocator: 'lines 4-8',
          }),
        },
      }
    )

    expect(result).toEqual({
      chunkText: 'Historical chunk snapshot',
      citationId: 'citation-1',
      citationLocator: 'lines 4-8',
    })
  })

  it('returns 403 for restricted citations when the token lacks restricted read scope', async () => {
    await expect(
      getDocumentChunk(
        {
          auth: {
            scopes: ['knowledge.citation.read'],
            tokenId: 'token-1',
          },
          citationId: 'citation-restricted',
        },
        {
          replayStore: {
            findReplayableCitationById: vi.fn().mockResolvedValue({
              accessLevel: 'restricted',
              chunkTextSnapshot: 'Do not leak this text.',
              citationId: 'citation-restricted',
              citationLocator: 'lines 1-2',
            }),
          },
        }
      )
    ).rejects.toEqual(
      new McpReplayError('The requested citation requires knowledge.restricted.read', 403)
    )
  })

  it('returns 404 when the citation is absent or no longer replayable', async () => {
    await expect(
      getDocumentChunk(
        {
          auth: {
            scopes: ['knowledge.citation.read', 'knowledge.restricted.read'],
            tokenId: 'token-2',
          },
          citationId: 'missing-citation',
        },
        {
          replayStore: {
            findReplayableCitationById: vi.fn().mockResolvedValue(null),
          },
        }
      )
    ).rejects.toEqual(new McpReplayError('The requested citation was not found', 404))
  })
})
