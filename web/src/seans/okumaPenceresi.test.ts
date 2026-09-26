import { afterEach, describe, expect, it, vi } from 'vitest'
import { okumaPenceresiniAc } from './okumaPenceresi'

afterEach(() => vi.restoreAllMocks())

describe('okumaPenceresiniAc (tasarım P2-P3)', () => {
  // Görev 6 incelemesi: masaüstünde Tauri `on_new_window`'da okuma penceresini
  // KENDİSİ kurar ve isteği reddeder (`NewWindowResponse::Deny`), yani
  // `window.open` BAŞARIDA da `null` döner. `null`u hata saymak ya "pencere
  // açılamadı" uyarısı ya da aynı pencerede `/?okuma=` adresine gezinme
  // (ana pencere okuma ekranına döner, yazılmamış not sayfası gider) üretirdi.
  it('window.open null dönünce (Tauri) hata SAYILMAZ: fırlatmaz, aynı pencere gezinmez', () => {
    const ac = vi.spyOn(window, 'open').mockReturnValue(null)
    // jsdom aynı pencerede gezinme denemesini ("location.href = …",
    // `assign`, `replace`) konsola "Not implemented: navigation" diye
    // bildirir; adres jsdom'da değişmez, bu yüzden konsol da izleniyor.
    const konsol = vi.spyOn(console, 'error')
    const adres = window.location.href
    expect(() => okumaPenceresiniAc(200)).not.toThrow()
    expect(ac).toHaveBeenCalledTimes(1)
    expect(ac).toHaveBeenCalledWith('/?okuma=200', 'okuma-200')
    expect(window.location.href).toBe(adres)
    expect(konsol).not.toHaveBeenCalled()
  })

  it('tarayıcıda açılan (ya da aynı adla var olan) pencere öne getirilir (P3)', () => {
    const odak = vi.fn()
    vi.spyOn(window, 'open').mockReturnValue({ focus: odak } as unknown as Window)
    okumaPenceresiniAc(7)
    expect(odak).toHaveBeenCalledTimes(1)
  })
})
