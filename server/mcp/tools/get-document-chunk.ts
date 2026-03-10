import { useLogger } from 'evlog'
import { z } from 'zod'

import { getCurrentMcpEvent } from '#server/utils/current-mcp-event'
import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getD1Database } from '#server/utils/database'
import { auditKnowledgeText } from '#server/utils/knowledge-audit'
import { getAllowedAccessLevels, getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { createMcpQueryLogStore } from '#server/utils/mcp-ask'
import { requireMcpScope } from '#server/utils/mcp-auth'
import { createMcpReplayStore, getDocumentChunk, McpReplayError } from '#server/utils/mcp-replay'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

const inputShape = {
  citationId: z.string().trim().min(1, 'citationId is required'),
}

export default defineMcpTool({
  name: 'getDocumentChunk',
  title: 'Retrieve a stored citation chunk',
  description:
    'Fetch the original chunk text for a citation id previously returned by askKnowledge / searchKnowledge.',
  inputSchema: inputShape,
  handler: async (args: { citationId: string }) => {
    const event = await getCurrentMcpEvent()
    const auth = requireMcpAuth(event)

    requireMcpScope(auth, 'knowledge.citation.read')

    const runtimeConfig = getKnowledgeRuntimeConfig()
    const database = await getD1Database()

    // Touch KV binding to mirror the legacy handler's binding-health signal.
    getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)

    try {
      return await getDocumentChunk(
        {
          auth,
          citationId: args.citationId,
        },
        {
          replayStore: createMcpReplayStore(database),
        }
      )
    } catch (replayError) {
      // Preserve the legacy handler's invariant: when replay returns 403, we
      // write a `query_logs` row with `status='blocked'` BEFORE re-throwing.
      // See `server/api/mcp/chunks/[citationId].get.ts` and the
      // `mcp-knowledge-tools` spec (Stateless Ask And Replay).
      if (replayError instanceof McpReplayError && replayError.statusCode === 403) {
        try {
          await createMcpQueryLogStore(database).createAcceptedQueryLog({
            allowedAccessLevels: getAllowedAccessLevels({
              channel: 'mcp',
              isAuthenticated: true,
              tokenScopes: auth.scopes,
            }),
            configSnapshotVersion: runtimeConfig.governance.configSnapshotVersion,
            environment: runtimeConfig.environment,
            queryText: auditKnowledgeText(`getDocumentChunk:${args.citationId}`).redactedText,
            status: 'blocked',
            tokenId: auth.tokenId,
          })
        } catch (logError) {
          const log = useLogger(event as Parameters<typeof useLogger>[0])
          log.error(logError as Error, { operation: 'mcp-replay-blocked-log' })
        }
      }

      if (replayError instanceof McpReplayError) {
        throw createError({
          statusCode: replayError.statusCode,
          statusMessage: replayError.message,
          message: replayError.message,
        })
      }

      throw replayError
    }
  },
})

function requireMcpAuth(event: {
  context: Record<string, unknown> & { mcpAuth?: McpAuthContext }
}): McpAuthContext {
  const auth = event.context.mcpAuth
  if (!auth) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'MCP auth context is missing',
    })
  }

  return auth
}
