import { useLogger } from 'evlog'
import { z } from 'zod/v3'

import { getCurrentMcpEvent } from '#server/utils/current-mcp-event'
import { getRequiredD1Binding, getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
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
    const database = getRequiredD1Binding(event, runtimeConfig.bindings.d1Database)

    // Touch KV binding to mirror the legacy handler's binding-health signal.
    getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)

    // `mcp-restricted-audit-trail` spec — emit the blocked audit row INSIDE
    // `getDocumentChunk` (before 403 throw) instead of wrapping the call in a
    // post-hoc catch. Scenario 3 of the spec forbids duplicate audit rows on
    // successful restricted access: the hook only fires on the 403 path, so
    // accepted replays inherit the ask handler's `status='accepted'` row
    // without this layer writing a second one.
    try {
      return await getDocumentChunk(
        {
          auth,
          citationId: args.citationId,
        },
        {
          replayStore: createMcpReplayStore(database),
          onRestrictedScopeViolation: async ({ attemptedCitationId, tokenId, tokenScopes }) => {
            try {
              await createMcpQueryLogStore(database).createBlockedRestrictedScopeQueryLog({
                allowedAccessLevels: getAllowedAccessLevels({
                  channel: 'mcp',
                  isAuthenticated: true,
                  tokenScopes,
                }),
                configSnapshotVersion: runtimeConfig.governance.configSnapshotVersion,
                environment: runtimeConfig.environment,
                // Encode the attempted citation id in `query_redacted_text`
                // so the schema needs no new column while still preserving
                // the attempted-citation audit trail. `auditKnowledgeText`
                // keeps the string governance-safe in case the id ever
                // contains PII-adjacent content.
                queryText: auditKnowledgeText(`getDocumentChunk:${attemptedCitationId}`)
                  .redactedText,
                tokenId,
              })
            } catch (logError) {
              const log = useLogger(event as Parameters<typeof useLogger>[0])
              log.error(logError as Error, {
                operation: 'mcp-replay-blocked-log',
                tokenId,
                attemptedCitationId,
              })
              // Re-throw so `getDocumentChunk` knows the audit attempt failed.
              // The util's best-effort wrapper swallows it again to preserve
              // the 403 throw path.
              throw logError
            }
          },
        },
      )
    } catch (replayError) {
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
