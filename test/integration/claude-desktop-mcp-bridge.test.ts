import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

import { afterEach, describe, expect, it } from 'vitest'

interface JsonRpcMessage {
  id?: number | string | null
  jsonrpc: '2.0'
  method?: string
  params?: Record<string, unknown>
  result?: unknown
}

interface CapturedRequest {
  authorizationHeader: string | undefined
  body: JsonRpcMessage
}

interface FramedMessageReader {
  read(): Promise<JsonRpcMessage>
}

describe('claude-desktop-mcp-bridge', () => {
  const childProcesses: ChildProcessWithoutNullStreams[] = []

  afterEach(async () => {
    await Promise.all(
      childProcesses.map(async (childProcess) => {
        if (childProcess.exitCode !== null) {
          return
        }

        childProcess.kill('SIGTERM')
        await once(childProcess, 'exit')
      }),
    )
  })

  it('forwards JSON-RPC requests to the remote /mcp endpoint with Bearer auth', async () => {
    const capturedRequests: CapturedRequest[] = []
    const server = createServer(async (request, response) => {
      await respondWithEcho(request, response, capturedRequests)
    })

    server.listen(0, '127.0.0.1')
    await once(server, 'listening')

    try {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected an ephemeral TCP port for the mock MCP server')
      }

      const bridgeProcess = spawn(
        'node',
        [
          resolve(process.cwd(), 'scripts/claude-desktop-mcp-bridge.mjs'),
          '--mcp-url',
          `http://127.0.0.1:${address.port}/mcp`,
          '--token',
          'test-token',
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      childProcesses.push(bridgeProcess)

      const stderrChunks: Buffer[] = []
      bridgeProcess.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk)
      })

      const reader = createFramedMessageReader(bridgeProcess)

      writeFramedMessage(bridgeProcess, {
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
      })

      const response = await reader.read()

      expect(response).toEqual({
        id: 1,
        jsonrpc: '2.0',
        result: {
          tools: [
            {
              description: 'Remote MCP tool echoed through the bridge',
              inputSchema: {
                additionalProperties: false,
                properties: {},
                type: 'object',
              },
              name: 'searchKnowledge',
            },
          ],
        },
      })

      expect(capturedRequests).toHaveLength(1)
      expect(capturedRequests[0]).toEqual({
        authorizationHeader: 'Bearer test-token',
        body: {
          id: 1,
          jsonrpc: '2.0',
          method: 'tools/list',
          params: {},
        },
      })

      expect(Buffer.concat(stderrChunks).toString('utf8')).toBe('')
    } finally {
      server.close()
      await once(server, 'close')
    }
  }, 10000)

  it('forwards JSON-RPC notifications without emitting a bridge response', async () => {
    const capturedRequests: CapturedRequest[] = []
    const stdoutChunks: Buffer[] = []
    const server = createServer(async (request, response) => {
      await respondWithoutJsonRpcEnvelope(request, response, capturedRequests)
    })

    server.listen(0, '127.0.0.1')
    await once(server, 'listening')

    try {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected an ephemeral TCP port for the mock MCP server')
      }

      const bridgeProcess = spawn(
        'node',
        [
          resolve(process.cwd(), 'scripts/claude-desktop-mcp-bridge.mjs'),
          '--mcp-url',
          `http://127.0.0.1:${address.port}/mcp`,
          '--token',
          'test-token',
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      childProcesses.push(bridgeProcess)

      bridgeProcess.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk)
      })

      writeFramedMessage(bridgeProcess, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: { ready: true },
      })

      await waitForRequestCount(capturedRequests, 1)
      await delay(150)

      expect(capturedRequests).toHaveLength(1)
      expect(capturedRequests[0]).toEqual({
        authorizationHeader: 'Bearer test-token',
        body: {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: { ready: true },
        },
      })
      expect(Buffer.concat(stdoutChunks).toString('utf8')).toBe('')
    } finally {
      server.close()
      await once(server, 'close')
    }
  }, 10000)

  it('rejects insecure non-local MCP URLs over plain http', async () => {
    const bridgeProcess = spawn(
      'node',
      [
        resolve(process.cwd(), 'scripts/claude-desktop-mcp-bridge.mjs'),
        '--mcp-url',
        'http://example.com/mcp',
        '--token',
        'test-token',
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    childProcesses.push(bridgeProcess)

    const stderrChunks: Buffer[] = []
    bridgeProcess.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    bridgeProcess.stdin.end()
    const [exitCode] = (await once(bridgeProcess, 'exit')) as [number | null]

    expect(exitCode).not.toBe(0)
    expect(Buffer.concat(stderrChunks).toString('utf8')).toContain('https')
  })
})

async function respondWithEcho(
  request: IncomingMessage,
  response: ServerResponse,
  capturedRequests: CapturedRequest[],
): Promise<void> {
  const body = await readRequestBody(request)
  const parsedBody = JSON.parse(body) as JsonRpcMessage

  capturedRequests.push({
    authorizationHeader: request.headers.authorization,
    body: parsedBody,
  })

  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(
    JSON.stringify({
      id: parsedBody.id,
      jsonrpc: '2.0',
      result: {
        tools: [
          {
            description: 'Remote MCP tool echoed through the bridge',
            inputSchema: {
              additionalProperties: false,
              properties: {},
              type: 'object',
            },
            name: 'searchKnowledge',
          },
        ],
      },
    }),
  )
}

async function respondWithoutJsonRpcEnvelope(
  request: IncomingMessage,
  response: ServerResponse,
  capturedRequests: CapturedRequest[],
): Promise<void> {
  const body = await readRequestBody(request)
  const parsedBody = JSON.parse(body) as JsonRpcMessage

  capturedRequests.push({
    authorizationHeader: request.headers.authorization,
    body: parsedBody,
  })

  response.writeHead(204)
  response.end()
}

async function waitForRequestCount(
  capturedRequests: CapturedRequest[],
  expectedCount: number,
): Promise<void> {
  const timeoutAt = Date.now() + 2000

  while (Date.now() < timeoutAt) {
    if (capturedRequests.length >= expectedCount) {
      return
    }

    await delay(25)
  }

  throw new Error(`Timed out waiting for ${expectedCount} captured requests`)
}

function createFramedMessageReader(
  childProcess: ChildProcessWithoutNullStreams,
): FramedMessageReader {
  let buffer = Buffer.alloc(0)

  return {
    read() {
      return new Promise<JsonRpcMessage>((resolveMessage, rejectMessage) => {
        const onData = (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk])
          const message = tryExtractFramedMessage()
          if (!message) {
            return
          }

          cleanup()
          resolveMessage(message)
        }

        const onExit = (code: number | null) => {
          cleanup()
          rejectMessage(new Error(`Bridge exited before responding (exit code: ${String(code)})`))
        }

        const onError = (error: Error) => {
          cleanup()
          rejectMessage(error)
        }

        const cleanup = () => {
          childProcess.stdout.off('data', onData)
          childProcess.off('exit', onExit)
          childProcess.off('error', onError)
        }

        childProcess.stdout.on('data', onData)
        childProcess.once('exit', onExit)
        childProcess.once('error', onError)

        const initialMessage = tryExtractFramedMessage()
        if (initialMessage) {
          cleanup()
          resolveMessage(initialMessage)
        }
      })

      function tryExtractFramedMessage(): JsonRpcMessage | null {
        const separatorIndex = buffer.indexOf('\r\n\r\n')
        if (separatorIndex === -1) {
          return null
        }

        const headerBlock = buffer.slice(0, separatorIndex).toString('utf8')
        const contentLength = parseContentLength(headerBlock)
        const messageStartIndex = separatorIndex + 4
        const messageEndIndex = messageStartIndex + contentLength

        if (buffer.length < messageEndIndex) {
          return null
        }

        const payload = buffer.slice(messageStartIndex, messageEndIndex).toString('utf8')
        buffer = buffer.slice(messageEndIndex)
        return JSON.parse(payload) as JsonRpcMessage
      }
    },
  }
}

function parseContentLength(headerBlock: string): number {
  const contentLengthHeader = headerBlock
    .split('\r\n')
    .find((line) => line.toLowerCase().startsWith('content-length:'))

  if (!contentLengthHeader) {
    throw new Error(`Missing Content-Length header: ${headerBlock}`)
  }

  const contentLength = Number(contentLengthHeader.split(':')[1]?.trim())
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error(`Invalid Content-Length header: ${contentLengthHeader}`)
  }

  return contentLength
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function writeFramedMessage(
  childProcess: ChildProcessWithoutNullStreams,
  message: JsonRpcMessage,
): void {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8')
  childProcess.stdin.write(Buffer.concat([header, payload]))
}
