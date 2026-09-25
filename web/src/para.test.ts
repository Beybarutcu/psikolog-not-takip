import { describe, expect, it } from 'vitest'
import {
  AZAMI_UCRET_KURUS, UCRET_BICIM_HATASI, UCRET_SINIR_HATASI, tlMetni, tlSayisi, ucretOku,
} from './para'

// `tlMetni` uygulamadaki tek para biçimi (kart, panel, özet). `Intl`'e
// bağlı DEĞİL: buradaki tam eşitlik, macOS webview'inin basacağı metnin
// aynısını ölçüyor (bkz. `para.ts` başlığı).
describe('tlMetni', () => {
  it('kurusu virgullu TL metnine cevirir', () => {
    expect(tlMetni(45000)).toBe('450,00 TL')
    expect(tlMetni(0)).toBe('0,00 TL')
  })

  it('kurus basamaklarini KAYBETMEZ ve iki haneye tamamlar', () => {
    // Tam sayıya yuvarlayan bir mutasyon 450,50'yi 450,00 yapar; sıfır
    // doldurmayı unutan bir mutasyon 0,01'i 0,1 yapar.
    expect(tlMetni(45050)).toBe('450,50 TL')
    expect(tlMetni(1)).toBe('0,01 TL')
    expect(tlMetni(99)).toBe('0,99 TL')
    expect(tlMetni(99999)).toBe('999,99 TL')
  })

  it('binlik ayiriciyi NOKTA olarak ve YALNIZCA uc hanede bir koyar', () => {
    // İki yön: gereken yerde ayraç VAR, gerekmeyen yerde YOK.
    expect(tlMetni(100000)).toBe('1.000,00 TL')
    expect(tlMetni(180000)).toBe('1.800,00 TL')
    expect(tlMetni(315000)).toBe('3.150,00 TL')
    expect(tlMetni(1234567)).toBe('12.345,67 TL')
    expect(tlMetni(123456789)).toBe('1.234.567,89 TL')
    expect(tlMetni(100000000000)).toBe('1.000.000.000,00 TL')
  })

  it('negatif tutarda isaret basta, ayraclar korunur', () => {
    expect(tlMetni(-150)).toBe('-1,50 TL')
    expect(tlMetni(-123456)).toBe('-1.234,56 TL')
  })

  it('beklenmedik ondalik kurus tam sayiya yuvarlanir', () => {
    expect(tlMetni(45049.6)).toBe('450,50 TL')
  })
})

describe('ucretOku — Türkçe yazım (tasarım A5)', () => {
  // Tasarımdaki tablonun TAMAMI. Tek satır bile eksik kalırsa kural
  // o satırda sessizce başka bir şey yapabilir.
  const gecerli: [string, number | null][] = [
    ['', null], ['   ', null],
    ['1.250', 125000], ['1250', 125000], ['1.250,50', 125050],
    ['450,5', 45050], ['450.50', 45050], ['1.25', 125], ['0450', 45000],
    ['0', 0], ['0,00', 0], ['1250 TL', 125000], ['1250TL', 125000],
    ['₺1250', 125000], ['tl 1250', 125000], ['  450  ', 45000],
    ['1.000.000', AZAMI_UCRET_KURUS],
  ]
  for (const [girdi, beklenen] of gecerli) {
    it(`"${girdi}" -> ${beklenen}`, () => {
      expect(ucretOku(girdi)).toEqual({ kurus: beklenen })
    })
  }

  const bicimHatasi = [
    '1.250.50', '1250.500', '12.50,00', '1.2345', '.5', ',5', '5.', '5,',
    '4TL50', '-5', 'abc', 'TL 5 TL', '1,250,00', '12.5.000',
  ]
  for (const girdi of bicimHatasi) {
    it(`"${girdi}" biçim hatası`, () => {
      expect(ucretOku(girdi)).toEqual({ hata: UCRET_BICIM_HATASI })
    })
  }

  it('üst sınırın bir kuruş üstü sınır hatası verir', () => {
    expect(ucretOku('1.000.000,01')).toEqual({ hata: UCRET_SINIR_HATASI })
    expect(ucretOku('99999999999999999999')).toEqual({ hata: UCRET_SINIR_HATASI })
  })

  it('sınır sabiti sunucudaki AZAMI_UCRET ile aynı düz sayı', () => {
    expect(AZAMI_UCRET_KURUS).toBe(100_000_000)
  })

  it('biçimle -> oku aynı değeri verir (0..AZAMI arası, sınırlar dahil)', () => {
    const degerler = [0, 1, 9, 10, 99, 100, 101, 999, 1000, 45000, 45050, 125050,
      999_999, 1_000_000, 12_345_678, AZAMI_UCRET_KURUS - 1, AZAMI_UCRET_KURUS]
    // Ayrıca sabit adımlı bir tarama (rastgele değil: sonuç tekrarlanabilir).
    for (let k = 0; k <= AZAMI_UCRET_KURUS; k += 9_876_543) degerler.push(k)
    for (const k of degerler) {
      expect(ucretOku(tlSayisi(k))).toEqual({ kurus: k })
    }
  })
})
