import { describe, expect, it } from 'vitest'
import { blokKonumu, cakismaSutunlari } from './blokYerlesimi'

type R = { id: number; baslangic: string; bitis: string }

const r = (id: number, bas: string, bit: string, gun = '2026-09-07'): R => ({
  id,
  baslangic: `${gun}T${bas}`,
  bitis: `${gun}T${bit}`,
})

describe('blokKonumu', () => {
  // 1 dakika = 1 px: beklenen değerler okunur kalsın. Yükseklikten düşülen
  // 2 px, art arda iki seansı ayıran alt boşluk.
  const SATIR = 60

  it('50 dakikalık seans saatin 50 dakikasını kaplar', () => {
    const k = blokKonumu(r(1, '10:00', '10:50'), SATIR, 21)
    expect(k.ust).toBe(0)
    expect(k.yukseklik).toBe(50 - 2)
  })

  it('tam olmayan saatte başlayan blok hücrenin içinden başlar', () => {
    const k = blokKonumu(r(1, '11:30', '12:20'), SATIR, 21)
    expect(k.ust).toBe(30)
    expect(k.yukseklik).toBe(50 - 2)
  })

  it('90 dakikalık seans bir buçuk saati kaplar', () => {
    const k = blokKonumu(r(1, '14:00', '15:30'), SATIR, 21)
    expect(k.yukseklik).toBe(90 - 2)
  })

  it('satır yüksekliğiyle orantılı ölçeklenir', () => {
    const k = blokKonumu(r(1, '10:15', '11:05'), 36, 21)
    expect(k.ust).toBe(9) // 15/60 * 36
    expect(k.yukseklik).toBe(30 - 2) // 50/60 * 36
  })

  it('ızgaranın bitişini aşan blok ızgaranın sonunda kesilir', () => {
    // 20:30'da başlayan 50 dakikalık seans: ızgara 21:00'de bitiyor.
    const k = blokKonumu(r(1, '20:30', '21:20'), SATIR, 21)
    expect(k.yukseklik).toBe(30 - 2)
  })

  it('çok kısa bir randevu da okunabilir bir yükseklikte kalır', () => {
    const k = blokKonumu(r(1, '10:00', '10:05'), 36, 21)
    expect(k.yukseklik).toBeGreaterThanOrEqual(18)
  })

  it('bitişi başlangıcından önce olan bozuk kayıt da görünür kalır', () => {
    const k = blokKonumu(r(1, '10:00', '09:00'), 36, 21)
    expect(k.yukseklik).toBeGreaterThanOrEqual(18)
  })
})

describe('cakismaSutunlari', () => {
  it('çakışmayan randevular tam genişlikte, tek sütunda', () => {
    const s = cakismaSutunlari([r(1, '10:00', '10:50'), r(2, '11:00', '11:50')])
    expect(s.get(1)).toEqual({ sutun: 0, sutunSayisi: 1 })
    expect(s.get(2)).toEqual({ sutun: 0, sutunSayisi: 1 })
  })

  it('biri bitince başlayan randevular çakışma sayılmaz', () => {
    const s = cakismaSutunlari([r(1, '10:00', '10:50'), r(2, '10:50', '11:40')])
    expect(s.get(1)).toEqual({ sutun: 0, sutunSayisi: 1 })
    expect(s.get(2)).toEqual({ sutun: 0, sutunSayisi: 1 })
  })

  it('çakışan bir çift biter bitmez başlayan randevu tam genişliğe döner', () => {
    // 1 ve 2 çakışıyor (yarım genişlik); 3, 2'nin bittiği dakikada başlıyor ve
    // o kümeye KATILMAMALI — katılsaydı boş bir saatte yarım genişlikte kalırdı.
    const s = cakismaSutunlari([
      r(1, '10:00', '10:50'),
      r(2, '10:30', '11:00'),
      r(3, '11:00', '11:50'),
    ])
    expect(s.get(2)).toEqual({ sutun: 1, sutunSayisi: 2 })
    expect(s.get(3)).toEqual({ sutun: 0, sutunSayisi: 1 })
  })

  it('çakışan iki randevu yan yana yarım genişlikte', () => {
    const s = cakismaSutunlari([r(1, '10:00', '10:50'), r(2, '10:30', '11:20')])
    expect(s.get(1)).toEqual({ sutun: 0, sutunSayisi: 2 })
    expect(s.get(2)).toEqual({ sutun: 1, sutunSayisi: 2 })
  })

  it('sıra girdi sırasından değil başlangıç saatinden gelir', () => {
    const s = cakismaSutunlari([r(2, '10:30', '11:20'), r(1, '10:00', '10:50')])
    expect(s.get(1)).toEqual({ sutun: 0, sutunSayisi: 2 })
    expect(s.get(2)).toEqual({ sutun: 1, sutunSayisi: 2 })
  })

  it('boşalan sütun yeniden kullanılır, küme genişliği en kalabalık andır', () => {
    // 1: 10:00-12:00 uzun; 2: 10:00-10:50; 3: 11:00-11:50 (2'nin sütununa oturur).
    const s = cakismaSutunlari([
      r(1, '10:00', '12:00'),
      r(2, '10:00', '10:50'),
      r(3, '11:00', '11:50'),
    ])
    expect(s.get(1)).toEqual({ sutun: 0, sutunSayisi: 2 })
    expect(s.get(2)).toEqual({ sutun: 1, sutunSayisi: 2 })
    expect(s.get(3)).toEqual({ sutun: 1, sutunSayisi: 2 })
  })

  it('ayrı kümeler birbirinin genişliğini etkilemez', () => {
    const s = cakismaSutunlari([
      r(1, '10:00', '10:50'),
      r(2, '10:30', '11:20'),
      r(3, '14:00', '14:50'),
    ])
    expect(s.get(3)).toEqual({ sutun: 0, sutunSayisi: 1 })
  })

  it('farklı günlerdeki aynı saat çakışma değildir', () => {
    const s = cakismaSutunlari([
      r(1, '10:00', '10:50', '2026-09-07'),
      r(2, '10:00', '10:50', '2026-09-08'),
    ])
    expect(s.get(1)).toEqual({ sutun: 0, sutunSayisi: 1 })
    expect(s.get(2)).toEqual({ sutun: 0, sutunSayisi: 1 })
  })
})
