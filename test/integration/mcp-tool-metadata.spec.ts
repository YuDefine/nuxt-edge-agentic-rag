import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'

import { installNuxtRouteTestGlobals } from './helpers/nuxt-route'

installNuxtRouteTestGlobals()

const expectedAnnotations = {
  askKnowledge: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  },
  getDocumentChunk: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  },
  listCategories: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  },
  searchKnowledge: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  },
}

async function loadTools() {
  const [
    { default: askKnowledgeTool },
    { default: searchKnowledgeTool },
    { default: getDocumentChunkTool },
    { default: listCategoriesTool },
  ] = await Promise.all([
    import('#server/mcp/tools/ask'),
    import('#server/mcp/tools/search'),
    import('#server/mcp/tools/get-document-chunk'),
    import('#server/mcp/tools/categories'),
  ])

  return [askKnowledgeTool, searchKnowledgeTool, getDocumentChunkTool, listCategoriesTool]
}

async function listRegisteredTools() {
  const server = new McpServer({ name: 'metadata-test-server', version: '0.0.0' })
  const client = new Client({ name: 'metadata-test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  const tools = await loadTools()

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        annotations: tool.annotations,
        description: tool.description,
        inputSchema: tool.inputSchema,
        title: tool.title,
        _meta: tool.inputExamples ? { inputExamples: tool.inputExamples } : {},
      },
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    )
  }

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  try {
    return await client.listTools()
  } finally {
    await Promise.all([client.close(), server.close()])
  }
}

describe('mcp tool discovery metadata', () => {
  it('exposes field descriptions for every tool input through tools/list', async () => {
    const result = await listRegisteredTools()

    for (const tool of result.tools) {
      for (const [fieldName, property] of Object.entries(tool.inputSchema.properties ?? {})) {
        const description = (property as { description?: unknown }).description

        expect(description, `${tool.name}.${fieldName}`).toEqual(expect.any(String))
        expect((description as string).trim()).not.toBe('')
        expect(['TBD', 'TODO']).not.toContain((description as string).trim())
      }
    }
  })

  it('exposes read-only governed-corpus annotations through tools/list', async () => {
    const result = await listRegisteredTools()

    for (const [toolName, annotations] of Object.entries(expectedAnnotations)) {
      expect(result.tools.find((tool) => tool.name === toolName)?.annotations).toEqual(annotations)
    }
  })

  it('exposes schema-valid input examples for semantically non-trivial tools', async () => {
    const [askKnowledgeTool, searchKnowledgeTool, getDocumentChunkTool] = await loadTools()
    const nonTrivialTools = [askKnowledgeTool, searchKnowledgeTool, getDocumentChunkTool]

    for (const tool of nonTrivialTools) {
      expect(tool.inputExamples?.length, `${tool.name}.inputExamples`).toBeGreaterThanOrEqual(1)

      for (const example of tool.inputExamples ?? []) {
        expect(() => z.object(tool.inputSchema).parse(example)).not.toThrow()
      }
    }
  })

  it('exposes input examples to clients via tools/list metadata', async () => {
    const result = await listRegisteredTools()

    for (const toolName of ['askKnowledge', 'searchKnowledge', 'getDocumentChunk']) {
      const tool = result.tools.find((entry) => entry.name === toolName)
      const inputExamples = tool?._meta?.inputExamples

      expect(Array.isArray(inputExamples), `${toolName}._meta.inputExamples`).toBe(true)
      expect((inputExamples as unknown[]).length).toBeGreaterThanOrEqual(1)
    }
  })
})
