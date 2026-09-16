import { describe, expect, it } from 'vitest'
import { tlMetni } from './para'

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
