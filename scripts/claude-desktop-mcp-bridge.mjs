#!/usr/bin/env node

const options = resolveOptions(process.argv.slice(2))

let inputBuffer = Buffer.alloc(0)
let isDraining = false

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk])
  void drainInputBuffer()
})

process.stdin.on('end', () => {
  process.exit(0)
})

process.stdin.resume()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    process.exit(0)
  })
}

async function drainInputBuffer() {
  if (isDraining) {
    return
  }

  isDraining = true

  try {
    while (true) {
      const payload = extractNextPayload()
      if (payload === null) {
        return
      }

      await handlePayload(payload)
    }
  } finally {
    isDraining = false
    if (extractNextPayloadPreviewLength() !== null) {
      void drainInputBuffer()
    }
  }
}

function extractNextPayload() {
  const previewLength = extractNextPayloadPreviewLength()
  if (previewLength === null) {
    return null
  }

  const separatorIndex = inputBuffer.indexOf('\r\n\r\n')
  const messageStartIndex = separatorIndex + 4
  const messageEndIndex = messageStartIndex + previewLength
  const payload = inputBuffer.slice(messageStartIndex, messageEndIndex).toString('utf8')
  inputBuffer = inputBuffer.slice(messageEndIndex)
  return payload
}

function extractNextPayloadPreviewLength() {
  const separatorIndex = inputBuffer.indexOf('\r\n\r\n')
  if (separatorIndex === -1) {
    return null
  }

  const headerBlock = inputBuffer.slice(0, separatorIndex).toString('utf8')
  const contentLength = parseContentLength(headerBlock)
  const messageEndIndex = separatorIndex + 4 + contentLength
  if (inputBuffer.length < messageEndIndex) {
    return null
  }

  return contentLength
}

async function handlePayload(payload) {
  let message

  try {
    message = JSON.parse(payload)
  } catch (error) {
    writeMessage({
      error: {
        code: -32700,
        message: 'Parse error',
      },
      id: null,
      jsonrpc: '2.0',
    })
    logError(error)
    return
  }

  if (message && typeof message === 'object' && !('id' in message)) {
    await forwardNotification(message)
    return
  }

  const response = await forwardMessage(message)
  writeMessage(response)
}

async function forwardNotification(message) {
  try {
    const response = await fetch(options.mcpUrl, {
      body: JSON.stringify(message),
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(options.timeoutMs),
    })

    if (!response.ok) {
      const responseText = await response.text()
      const parsedResponse = tryParseJson(responseText)
      throw new Error(
        parsedResponse?.error?.message ??
          response.statusText ??
          `Remote MCP notification failed with HTTP ${response.status}`,
      )
    }
  } catch (error) {
    logError(error)
  }
}

async function forwardMessage(message) {
  try {
    const response = await fetch(options.mcpUrl, {
      body: JSON.stringify(message),
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(options.timeoutMs),
    })

    const responseText = await response.text()
    const parsedResponse = tryParseJson(responseText)

    if (!response.ok) {
      return createJsonRpcErrorResponse(
        message?.id ?? null,
        parsedResponse?.error?.message ?? response.statusText ?? 'Remote MCP request failed',
        -32000,
        {
          body: parsedResponse ?? responseText,
          status: response.status,
        },
      )
    }

    if (parsedResponse) {
      return parsedResponse
    }

    return createJsonRpcErrorResponse(
      message?.id ?? null,
      'Remote MCP server returned a non-JSON response',
      -32603,
      { body: responseText },
    )
  } catch (error) {
    logError(error)
    return createJsonRpcErrorResponse(
      message?.id ?? null,
      error instanceof Error ? error.message : 'Remote MCP request failed',
      -32603,
    )
  }
}

function writeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`)
  process.stdout.write(payload)
}

function parseContentLength(headerBlock) {
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

function tryParseJson(value) {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function createJsonRpcErrorResponse(id, message, code, data) {
  const error = { code, message }
  if (data !== undefined) {
    error.data = data
  }

  return {
    error,
    id,
    jsonrpc: '2.0',
  }
}

function resolveOptions(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  const parsedArgs = parseArgs(argv)
  const token = parsedArgs.token ?? process.env.MCP_AUTH_TOKEN
  const rawUrl = parsedArgs.mcpUrl ?? process.env.MCP_REMOTE_URL
  const timeoutMs = Number(parsedArgs.timeoutMs ?? process.env.MCP_TIMEOUT_MS ?? 30000)

  if (!token) {
    throw new Error('Missing MCP token. Pass --token or set MCP_AUTH_TOKEN.')
  }

  if (!rawUrl) {
    throw new Error('Missing MCP URL. Pass --mcp-url or set MCP_REMOTE_URL.')
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('MCP timeout must be a positive number of milliseconds.')
  }

  return {
    mcpUrl: normalizeMcpUrl(rawUrl),
    timeoutMs,
    token,
  }
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]

    if (current === '--mcp-url') {
      parsed.mcpUrl = next
      index += 1
      continue
    }

    if (current === '--token') {
      parsed.token = next
      index += 1
      continue
    }

    if (current === '--timeout-ms') {
      parsed.timeoutMs = next
      index += 1
      continue
    }
  }

  return parsed
}

function normalizeMcpUrl(value) {
  const parsedUrl = new URL(value)
  validateMcpUrl(parsedUrl)
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '') {
    parsedUrl.pathname = '/mcp'
  }
  return parsedUrl.toString()
}

function validateMcpUrl(parsedUrl) {
  if (parsedUrl.protocol === 'https:') {
    return
  }

  if (parsedUrl.protocol === 'http:' && isLocalHostname(parsedUrl.hostname)) {
    return
  }

  throw new Error(
    'MCP URL must use https unless it points to localhost, 127.0.0.1, or ::1 for local development.',
  )
}

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function printHelp() {
  process.stdout.write(
    [
      'Claude Desktop MCP bridge',
      '',
      'Required:',
      '  --mcp-url <url>    Remote MCP endpoint or base URL (defaults /mcp when path is empty)',
      '  --token <token>    MCP Bearer token',
      '',
      'Optional:',
      '  --timeout-ms <n>   Remote request timeout in milliseconds (default: 30000)',
      '',
      'Environment variable equivalents:',
      '  MCP_REMOTE_URL, MCP_AUTH_TOKEN, MCP_TIMEOUT_MS',
      '',
    ].join('\n'),
  )
}

function logError(error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`${message}\n`)
}
