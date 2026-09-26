import { afterEach, describe, expect, it, vi } from 'vitest'
import { okumaPenceresiniAc } from './okumaPenceresi'

afterEach(() => vi.restoreAllMocks())

/**
 * jsdom aynı pencerede gezinmeyi (`location.href = …`, `assign`, `replace`)
 * UYGULAMAZ: adres değişmez, yalnızca kendi sanal konsoluna "Not
 * implemented: navigation to another Document" hatası yayar. O konsol
 * testin `console`'u DEĞİL (Vitest ortamı kurarken Node'unkini bağlar), bu
 * yüzden `vi.spyOn(console, 'error')` gezinmeyi GÖRMEZ — Görev 8 mutasyon
 * turunda "null'da aynı pencerede gezin" mutasyonu tam bu yüzden yeşil
 * kalmıştı. Dinleyici jsdom'un KENDİ sanal konsoluna (`globalThis.jsdom`,
 * Vitest'in jsdom ortamı koyar) takılır.
 */
type SanalKonsol = {
  on(olay: 'jsdomError', dinleyici: (e: Error) => void): unknown
  off(olay: 'jsdomError', dinleyici: (e: Error) => void): unknown
}

function gezinmeleriDinle() {
  const dom = (globalThis as { jsdom?: { virtualConsole: SanalKonsol } }).jsdom
  if (dom === undefined) throw new Error('jsdom örneği yok: gezinme dinlenemez (ortam değişti mi?)')
  const gezinmeler: string[] = []
  const dinleyici = (e: Error) => {
    if (/navigation/i.test(e.message)) gezinmeler.push(e.message)
  }
  dom.virtualConsole.on('jsdomError', dinleyici)
  return { gezinmeler, birak: () => dom.virtualConsole.off('jsdomError', dinleyici) }
}

describe('okumaPenceresiniAc (tasarım P2-P3)', () => {
  it('gezinme dinleyicisi GERÇEKTEN görür (körlüğe karşı ARTI YÖN)', () => {
    const d = gezinmeleriDinle()
    try {
      window.location.href = '/?okuma=1'
      expect(d.gezinmeler).toHaveLength(1)
    } finally {
      d.birak()
    }
  })

  // Görev 6 incelemesi: masaüstünde Tauri `on_new_window`'da okuma penceresini
  // KENDİSİ kurar ve isteği reddeder (`NewWindowResponse::Deny`), yani
  // `window.open` BAŞARIDA da `null` döner. `null`u hata saymak ya "pencere
  // açılamadı" uyarısı ya da aynı pencerede `/?okuma=` adresine gezinme
  // (ana pencere okuma ekranına döner, yazılmamış not sayfası gider) üretirdi.
  it('window.open null dönünce (Tauri) hata SAYILMAZ: fırlatmaz, aynı pencere gezinmez', () => {
    const ac = vi.spyOn(window, 'open').mockReturnValue(null)
    const d = gezinmeleriDinle()
    const adres = window.location.href
    try {
      expect(() => okumaPenceresiniAc(200)).not.toThrow()
      expect(ac).toHaveBeenCalledTimes(1)
      expect(ac).toHaveBeenCalledWith('/?okuma=200', 'okuma-200')
      expect(d.gezinmeler).toEqual([])
      expect(window.location.href).toBe(adres)
    } finally {
      d.birak()
    }
  })

  it('tarayıcıda açılan (ya da aynı adla var olan) pencere öne getirilir (P3)', () => {
    const odak = vi.fn()
    vi.spyOn(window, 'open').mockReturnValue({ focus: odak } as unknown as Window)
    okumaPenceresiniAc(7)
    expect(odak).toHaveBeenCalledTimes(1)
  })
})
