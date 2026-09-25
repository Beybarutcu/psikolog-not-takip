import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { simdiYerel, useDakikalikSimdi } from './yerelGun'

afterEach(() => vi.useRealTimers())

describe('tek şimdi kaynağı', () => {
  it('simdiYerel yerel duvar saatini 16 karakterle verir', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 24, 9, 5))
    expect(simdiYerel()).toBe('2026-09-24T09:05')
  })

  it('useDakikalikSimdi dakikada bir ilerler, gece yarısını geçer', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 8, 24, 23, 59))
    const { result } = renderHook(() => useDakikalikSimdi())
    expect(result.current).toBe('2026-09-24T23:59')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe('2026-09-25T00:00')
  })
})
