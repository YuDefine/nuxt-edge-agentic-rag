import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatDateTime, formatShortDateTime, formatTimeShort } from '~~/app/utils/format-datetime'

describe('formatDateTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T09:05:07.000+08:00'))
    process.env.TZ = 'Asia/Taipei'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders YYYY/M/D HH:mm:ss with unpadded month/day and padded time', () => {
    expect(formatDateTime(new Date('2026-04-24T09:05:07.000+08:00'))).toBe('2026/4/24 09:05:07')
  })

  it('accepts ISO string input', () => {
    expect(formatDateTime('2026-12-31T23:59:59.000+08:00')).toBe('2026/12/31 23:59:59')
  })

  it('accepts numeric timestamp input', () => {
    const ts = new Date('2026-01-02T03:04:05.000+08:00').getTime()
    expect(formatDateTime(ts)).toBe('2026/1/2 03:04:05')
  })

  it('returns em dash for null / undefined / empty string', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('')).toBe('—')
  })

  it('returns em dash for invalid input (never echoes raw ISO)', () => {
    expect(formatDateTime('not-a-date')).toBe('—')
  })

  it('honors custom fallback', () => {
    expect(formatDateTime(null, { fallback: '時間未知' })).toBe('時間未知')
  })
})

describe('formatShortDateTime', () => {
  beforeEach(() => {
    process.env.TZ = 'Asia/Taipei'
  })

  it('renders M/D HH:mm without year and seconds', () => {
    expect(formatShortDateTime('2026-04-24T09:05:00.000+08:00')).toBe('4/24 09:05')
  })

  it('returns em dash for invalid input', () => {
    expect(formatShortDateTime('not-a-date')).toBe('—')
  })

  it('honors custom fallback', () => {
    expect(formatShortDateTime(null, { fallback: '時間未知' })).toBe('時間未知')
  })
})

describe('formatTimeShort', () => {
  beforeEach(() => {
    process.env.TZ = 'Asia/Taipei'
  })

  it('renders HH:mm in 24hr without meridiem prefix', () => {
    expect(formatTimeShort('2026-04-24T21:30:00.000+08:00')).toBe('21:30')
  })

  it('pads single-digit hours and minutes', () => {
    expect(formatTimeShort('2026-04-24T03:07:00.000+08:00')).toBe('03:07')
  })

  it('returns em dash for invalid input', () => {
    expect(formatTimeShort('bogus')).toBe('—')
  })
})
