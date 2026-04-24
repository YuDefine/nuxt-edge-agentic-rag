/**
 * Task 4.1: `server/mcp/do-transport.ts` `DoJsonRpcTransport`
 *
 * Pivot C（Phase 2 decision）實作：自寫 minimal transport 符合 MCP SDK
 * `Transport` interface (`start` / `send` / `close` + `onmessage` callback)。
 * 這個 shim 只做 JSONRPCMessage 橋接，**從未接觸 env proxy**——用於根除
 * `Reflect.ownKeys(env)` TypeError family（Phase 1 spike 發現的 root cause）。
 *
 * 本 suite 驗 transport 的核心 contract：
 * 1. `start()` / `close()` 不會拋
 * 2. `dispatch(msg, extra)` 會經由 `onmessage` 交給 SDK，SDK 回覆後由 `send`
 *    收集的 response 會以同一 JSON-RPC id 解回 `dispatch` 的 Promise
 * 3. 支援 JSON-RPC notification（no id）→ `dispatch` 不阻塞等待 response
 * 4. 支援 `onclose` callback
 */

/* eslint-disable unicorn/prefer-add-event-listener -- MCP SDK `Transport` interface uses `onmessage` / `onclose` callback properties, not DOM-style addEventListener */

import { describe, expect, it, vi } from 'vitest'

import { DoJsonRpcTransport } from '#server/durable-objects/mcp-do-transport'

import type {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
} from '@modelcontextprotocol/sdk/types.js'

describe('DoJsonRpcTransport', () => {
  it('start() and close() fulfill without throwing', async () => {
    const transport = new DoJsonRpcTransport()
    await expect(transport.start()).resolves.toBeUndefined()
    await expect(transport.close()).resolves.toBeUndefined()
  })

  it('dispatch routes request via onmessage and resolves with send() response', async () => {
    const transport = new DoJsonRpcTransport()
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: {},
    }
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    }

    transport.onmessage = vi.fn((message, extra) => {
      expect(message).toEqual(request)
      expect(extra).toEqual({ requestInfo: { headers: { 'x-test': '1' } } })
      // Simulate SDK response path: SDK pushes the response via transport.send
      queueMicrotask(() => {
        void transport.send(response)
      })
    })

    const result = await transport.dispatch(request, {
      requestInfo: { headers: { 'x-test': '1' } },
    })
    expect(result).toEqual(response)
    expect(transport.onmessage).toHaveBeenCalledTimes(1)
  })

  it('dispatch returns null for notifications (no id)', async () => {
    const transport = new DoJsonRpcTransport()
    const notification: JSONRPCMessage = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }

    transport.onmessage = vi.fn()

    const result = await transport.dispatch(notification)
    expect(result).toBeNull()
    expect(transport.onmessage).toHaveBeenCalledTimes(1)
  })

  it('onclose is invoked when close() is called', async () => {
    const transport = new DoJsonRpcTransport()
    const onclose = vi.fn()
    transport.onclose = onclose

    await transport.close()
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('concurrent dispatches keyed by JSON-RPC id resolve independently', async () => {
    const transport = new DoJsonRpcTransport()
    transport.onmessage = vi.fn()

    const pA = transport.dispatch({ jsonrpc: '2.0', id: 'a', method: 'ping', params: {} })
    const pB = transport.dispatch({ jsonrpc: '2.0', id: 'b', method: 'ping', params: {} })

    // SDK responds in reverse order
    await transport.send({ jsonrpc: '2.0', id: 'b', result: { who: 'b' } })
    await transport.send({ jsonrpc: '2.0', id: 'a', result: { who: 'a' } })

    const [resA, resB] = await Promise.all([pA, pB])
    expect(resA).toMatchObject({ id: 'a', result: { who: 'a' } })
    expect(resB).toMatchObject({ id: 'b', result: { who: 'b' } })
  })
})
