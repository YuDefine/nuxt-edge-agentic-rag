// Vue import routes this spec into the Nuxt/happy-dom test project so
// sessionStorage is available.
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

void ref

import {
  DELETE_REAUTH_WINDOW_MS,
  PENDING_DELETE_REAUTH_KEY,
  consumePendingDeleteReauth,
  setPendingDeleteReauth,
} from '~/utils/auth-return-to'

describe('pending delete reauth storage', () => {
  beforeEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
  })

  it('returns true once after a freshly stored signal is consumed', () => {
    setPendingDeleteReauth()

    expect(consumePendingDeleteReauth()).toBe(true)
    expect(sessionStorage.getItem(PENDING_DELETE_REAUTH_KEY)).toBeNull()
    expect(consumePendingDeleteReauth()).toBe(false)
  })

  it('returns false and clears the signal when it is older than five minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T08:00:00.000Z'))

    setPendingDeleteReauth()

    vi.setSystemTime(new Date(Date.now() + DELETE_REAUTH_WINDOW_MS + 1))

    expect(consumePendingDeleteReauth()).toBe(false)
    expect(sessionStorage.getItem(PENDING_DELETE_REAUTH_KEY)).toBeNull()
  })

  it('returns false when no pending signal exists', () => {
    expect(consumePendingDeleteReauth()).toBe(false)
  })

  it('returns false and clears malformed stored JSON', () => {
    sessionStorage.setItem(PENDING_DELETE_REAUTH_KEY, '{not-json')

    expect(consumePendingDeleteReauth()).toBe(false)
    expect(sessionStorage.getItem(PENDING_DELETE_REAUTH_KEY)).toBeNull()
  })
})
