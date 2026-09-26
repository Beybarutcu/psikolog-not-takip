import { afterEach, describe, expect, it, vi } from 'vitest'
import { okumaKimligi, okumaParametresiVarMi, okumaPenceresiniAc } from './okumaPenceresi'

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

describe('okumaKimligi (tasarım P2)', () => {
  it('geçerli kimlik', () => {
    expect(okumaKimligi('?okuma=42')).toBe(42)
    expect(okumaKimligi('?okuma=1')).toBe(1)
  })
  it('geçersiz kimlik ya da `okuma` anahtarı hiç yok -> null (bu TEK BAŞINA "ana ekran" demek değil, bkz. aşağıdaki describe)', () => {
    for (const a of ['', '?', '?okuma=', '?okuma=0', '?okuma=007', '?okuma=-1', '?okuma=1.5', '?okuma=abc', '?okuma=1234567890123456', '?baska=4']) {
      expect(okumaKimligi(a), a).toBeNull()
    }
  })
})

// Carry-over F15 (preflight.md, controller ruling Görev 6/9): Rust'taki
// `pencere.rs::okuma_kimligi` tam i64 aralığını kabul ediyor (19 haneye
// kadar), TS grameri burada yalnızca 15 hane. Tauri bu yüzden 16-19 haneli
// bir kimlikle GERÇEK bir `okuma-*` penceresi açabilir; `okumaKimligi` o
// adres için `null` döner ama bu bir "ana ekran" adresi DEĞİLDİR — adreste
// `okuma` anahtarı zaten var. `App.tsx` bu ayrımı bu fonksiyonla yapar:
// anahtar var + kimlik geçersizse ana ekrana ASLA düşmez (bkz. App.test.tsx
// "9.6"/"9.7").
describe('okumaParametresiVarMi (carry-over F15: id grameri Rust/TS uyuşmazlığı)', () => {
  it('`okuma` anahtarı VAR (değeri gramer dışı olsa da) -> true', () => {
    for (const a of [
      '?okuma=42',
      '?okuma=1234567890123456', // 16 hane: TS grameri dışı, Rust i64 içi
      '?okuma=0',
      '?okuma=-1',
      '?okuma=abc',
      '?okuma=',
      '?okuma=1&okuma=2', // tekrarlanan parametre
      '?x=1&okuma=4',
    ]) {
      expect(okumaParametresiVarMi(a), a).toBe(true)
    }
  })
  it('`okuma` anahtarı hiç yok -> false (gerçek ana ekran adresi)', () => {
    for (const a of ['', '?', '?baska=4']) {
      expect(okumaParametresiVarMi(a), a).toBe(false)
    }
  })
})
