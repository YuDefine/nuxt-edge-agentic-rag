import { describe, expect, it, vi } from 'vitest'

import { McpReplayError, getDocumentChunk } from '#server/utils/mcp-replay'

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
      },
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
        },
      ),
    ).rejects.toEqual(
      new McpReplayError(
        'The requested citation requires knowledge.restricted.read',
        403,
        'restricted_scope_required',
      ),
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
        },
      ),
    ).rejects.toEqual(
      new McpReplayError('The requested citation was not found', 404, 'chunk_not_found'),
    )
  })

  it('returns 404 with chunk_retention_expired when the snapshot was scrubbed but row survives', async () => {
    // Defensive guard for retention-cleanup-governance §2.3: if a future
    // governance sweep also scrubs citation_records.chunk_text_snapshot, the
    // surviving row has an empty snapshot. Status stays 404 per
    // mcp-knowledge-tools spec; only the `reason` distinguishes it from a
    // genuinely missing row.
    let caught: unknown
    try {
      await getDocumentChunk(
        {
          auth: {
            scopes: ['knowledge.citation.read'],
            tokenId: 'token-3',
          },
          citationId: 'citation-scrubbed',
        },
        {
          replayStore: {
            findReplayableCitationById: vi.fn().mockResolvedValue({
              accessLevel: 'internal',
              chunkTextSnapshot: '',
              citationId: 'citation-scrubbed',
              citationLocator: 'lines 1-2',
            }),
          },
        },
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(McpReplayError)
    expect(caught).toMatchObject({
      statusCode: 404,
      reason: 'chunk_retention_expired',
      message: 'The requested citation was not found',
    })
  })

  it('attaches reason=chunk_not_found by default on citation-missing errors', async () => {
    let caught: unknown
    try {
      await getDocumentChunk(
        {
          auth: { scopes: ['knowledge.citation.read'], tokenId: 'token-4' },
          citationId: 'gone',
        },
        {
          replayStore: {
            findReplayableCitationById: vi.fn().mockResolvedValue(null),
          },
        },
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ statusCode: 404, reason: 'chunk_not_found' })
  })

  it('attaches reason=restricted_scope_required on 403 errors', async () => {
    let caught: unknown
    try {
      await getDocumentChunk(
        {
          auth: { scopes: ['knowledge.citation.read'], tokenId: 'token-5' },
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
        },
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ statusCode: 403, reason: 'restricted_scope_required' })
  })
})
