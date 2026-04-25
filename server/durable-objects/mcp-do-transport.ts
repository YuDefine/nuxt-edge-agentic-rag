import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  JSONRPCMessage,
  JSONRPCResponse,
  MessageExtraInfo,
  RequestId,
} from '@modelcontextprotocol/sdk/types.js'

interface PendingResolver {
  resolve: (response: JSONRPCMessage) => void
  reject: (reason: unknown) => void
}

/**
 * DoJsonRpcTransport — Pivot C（Phase 2 decision）實作。
 *
 * 符合 MCP SDK `Transport` interface 的 minimal shim，~30 行核心邏輯。
 * 設計理由：Phase 1 diag spike 實證 `WebStandardStreamableHTTPServerTransport`
 * 在 Cloudflare Workers 會觸發 `Reflect.ownKeys(env)` TypeError（SDK 在 parse
 * path 反射 env binding proxy）。本 shim 只做「HTTP request body ↔
 * JSONRPCMessage」橋接，**不碰 env**，根除該 bug 家族。
 *
 * 使用模式（DO fetch handler）：
 *   1. `await transport.dispatch(incomingMessage, extra)` — 送進 SDK
 *      並回傳對應 id 的 response；notifications（無 id）回 null
 *   2. SDK 處理完後會呼 `transport.send(response)`，本 class 查 id 並解對應
 *      resolver
 */
export interface DoJsonRpcTransportOptions {
  /**
   * Invoked when the SDK calls `transport.send()` with a server-initiated
   * notification or request (messages without an `id` correlator). Routes to
   * the DO's SSE event queue so `useMcpLogger().notify.*` and
   * `server.sendLoggingMessage()` surface to connected clients via GET /mcp
   * streams (spec 2025-11-25 §Streamable HTTP > Listening for Messages).
   * If omitted, notifications are dropped silently (stateless-compatible
   * fallback).
   */
  onServerNotification?: (message: JSONRPCMessage) => Promise<void>
}

export class DoJsonRpcTransport implements Transport {
  private readonly options: DoJsonRpcTransportOptions
  private pending = new Map<RequestId, PendingResolver>()
  private _closed = false

  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void
  onclose?: () => void
  onerror?: (error: Error) => void
  sessionId?: string

  constructor(options: DoJsonRpcTransportOptions = {}) {
    this.options = options
  }

  async start(): Promise<void> {
    // No-op — transport is request-driven, not stream-driven.
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this._closed) {
      return
    }

    if (!isJsonRpcResponse(message)) {
      // Server-initiated notification/request — route to SSE queue via the
      // configured hook (set by `mcp-session.ts` to `enqueueSseEvent` +
      // live push to active SSE writers).
      if (this.options.onServerNotification) {
        await this.options.onServerNotification(message)
      }
      return
    }

    const resolver = this.pending.get(message.id)
    if (!resolver) {
      return
    }

    this.pending.delete(message.id)
    resolver.resolve(message)
  }

  async close(): Promise<void> {
    if (this._closed) {
      return
    }
    this._closed = true
    for (const resolver of this.pending.values()) {
      resolver.reject(new Error('Transport closed before response'))
    }
    this.pending.clear()
    this.onclose?.()
  }

  /**
   * Dispatches an incoming JSON-RPC message through the SDK via onmessage.
   * For requests, returns a Promise that resolves when send() receives a
   * response with the same id. For notifications (no id), resolves to null
   * immediately after onmessage returns.
   */
  dispatch(message: JSONRPCMessage, extra?: MessageExtraInfo): Promise<JSONRPCMessage | null> {
    if (!this.onmessage) {
      return Promise.reject(new Error('Transport has no onmessage handler'))
    }

    const id = 'id' in message ? message.id : undefined
    if (id === undefined) {
      this.onmessage(message, extra)
      return Promise.resolve(null)
    }

    return new Promise<JSONRPCMessage | null>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (response) => resolve(response),
        reject,
      })
      try {
        this.onmessage?.(message, extra)
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }
}

function isJsonRpcResponse(message: JSONRPCMessage): message is JSONRPCResponse {
  return 'id' in message && ('result' in message || 'error' in message)
}
