import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSTA_KALMA_MS, YENIDEN_KONTROL_MS, useBostaKalmaKontrolu } from './bostaKalma'

// Dal incelemesi I3: sunucudaki boşta kalma kilidi ekrana ulaşmıyordu.
// Bu testler kancanın "ne zaman sorar" davranışını doğruluyor; "kilitliyse
// ekran kalkar" kısmı App.test.tsx'te (gerçek unmount) doğrulanıyor.

function Sonda({ etkin, kontrolEt }: { etkin: boolean; kontrolEt: () => Promise<unknown> }) {
  useBostaKalmaKontrolu(etkin, kontrolEt)
  return <p>sonda</p>
}

describe('useBostaKalmaKontrolu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('süre dolmadan sunucuya sormaz', async () => {
    const kontrolEt = vi.fn().mockResolvedValue(undefined)
    render(<Sonda etkin kontrolEt={kontrolEt} />)

    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS - 1000))
    expect(kontrolEt).not.toHaveBeenCalled()
  })

  it('kullanıcı etkinliği olmadan süre dolunca sunucuya sorar', async () => {
    const kontrolEt = vi.fn().mockResolvedValue(undefined)
    render(<Sonda etkin kontrolEt={kontrolEt} />)

    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS))
    expect(kontrolEt).toHaveBeenCalledTimes(1)
  })

  it('kullanıcı etkinliği sayacı baştan başlatır', async () => {
    const kontrolEt = vi.fn().mockResolvedValue(undefined)
    render(<Sonda etkin kontrolEt={kontrolEt} />)

    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS - 1000))
    // Terapist klavyeye dokunuyor: oturum boşta değil.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'a' })
    })
    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS - 1000))
    expect(kontrolEt).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(kontrolEt).toHaveBeenCalledTimes(1)
  })

  it('sunucu hâlâ açık derse daha kısa aralıkla tekrar sorar', async () => {
    const kontrolEt = vi.fn().mockResolvedValue(undefined)
    render(<Sonda etkin kontrolEt={kontrolEt} />)

    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS))
    expect(kontrolEt).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(YENIDEN_KONTROL_MS))
    expect(kontrolEt).toHaveBeenCalledTimes(2)
  })

  it('sorma başarısız olsa bile yoklama durmaz', async () => {
    const kontrolEt = vi.fn().mockRejectedValue(new Error('ağ hatası'))
    render(<Sonda etkin kontrolEt={kontrolEt} />)

    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS))
    expect(kontrolEt).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(YENIDEN_KONTROL_MS))
    expect(kontrolEt).toHaveBeenCalledTimes(2)
  })

  it('oturum açık değilken hiç sormaz', async () => {
    const kontrolEt = vi.fn().mockResolvedValue(undefined)
    render(<Sonda etkin={false} kontrolEt={kontrolEt} />)

    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS * 3))
    expect(kontrolEt).not.toHaveBeenCalled()
  })

  it('bileşen kaldırıldıktan sonra sormaz (kilit ekranında yoklama sürmez)', async () => {
    const kontrolEt = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(<Sonda etkin kontrolEt={kontrolEt} />)

    unmount()
    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS * 2))
    expect(kontrolEt).not.toHaveBeenCalled()
  })
})
