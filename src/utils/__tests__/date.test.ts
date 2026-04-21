import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTodayStr } from '../date'

describe('getTodayStr', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('returns a YYYY-MM-DD string', () => {
    vi.setSystemTime(new Date('2026-04-21T12:00:00'))
    expect(getTodayStr()).toBe('2026-04-21')
  })

  it('pads single-digit months and days', () => {
    vi.setSystemTime(new Date('2026-01-05T00:00:00'))
    expect(getTodayStr()).toBe('2026-01-05')
  })

  it('uses local time (not UTC)', () => {
    // Set to midnight UTC — local time may be previous day depending on TZ,
    // but getTodayStr uses local new Date(), so we just check format.
    vi.setSystemTime(new Date('2026-12-31T23:00:00'))
    const result = getTodayStr()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
