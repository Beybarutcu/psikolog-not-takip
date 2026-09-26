import { describe, expect, it } from 'vitest'
// Sunucunun arama eşiği metin olarak (`?raw`, `vite.config.ts`
// `server.fs.allow` bu dizini açıyor; emsal `seans/sablon.test.ts`).
import aramaKaynagi from '../../../core/src/store/search.rs?raw'
import { ASGARI_VURGU, eslesmeAraliklari, vurguParcalari } from './vurgu'

// Katlama kuralının kendisi (harf tablosu, sunucu kolları, ortak örnekler)
// `web/src/katla.test.ts`'te (tasarım §9: ortak modül).
describe('sunucunun arama eşiğiyle aynı (core/src/store/search.rs)', () => {
  it('asgari vurgu uzunluğu sunucunun ASGARI_SORGU değeri', () => {
    const asgari = /const ASGARI_SORGU: usize = (\d+);/.exec(aramaKaynagi)?.[1]
    expect(asgari).toBeDefined()
    expect(ASGARI_VURGU).toBe(Number(asgari))
  })
})

describe('eslesmeAraliklari', () => {
  it('Türkçe harf duyarsız, iki yönlü', () => {
    expect(eslesmeAraliklari('Kaygı ve KAYGI', 'kaygi')).toEqual([[0, 5], [9, 14]])
    expect(eslesmeAraliklari('kaygi', 'KAYGI')).toEqual([[0, 5]])
  })
  it('iki karakterden kısa terim eşleşmez; terim kırpılır', () => {
    expect(eslesmeAraliklari('aaa', 'a')).toEqual([])
    expect(eslesmeAraliklari('ab ab', ' ab ')).toEqual([[0, 2], [3, 5]])
  })
  it('eşleşmeler üst üste binmez', () => expect(eslesmeAraliklari('aaaa', 'aa')).toEqual([[0, 2], [2, 4]]))
  it('emoji ve İ içeren metinde konumlar ham metinle hizalı (UTF-16 uzunluğu korunur)', () => {
    const metin = '😀 İpek geldi'
    const [[bas, son]] = eslesmeAraliklari(metin, 'ipek')
    expect(metin.slice(bas, son)).toBe('İpek')
  })
})

describe('vurguParcalari', () => {
  it('metni böler, birleşimi aslıdır', () => {
    const p = vurguParcalari('Bugün kaygı azaldı', 'KAYGI')
    expect(p).toEqual([
      { metin: 'Bugün ', vurgu: false },
      { metin: 'kaygı', vurgu: true },
      { metin: ' azaldı', vurgu: false },
    ])
    expect(p.map((x) => x.metin).join('')).toBe('Bugün kaygı azaldı')
  })
  it('eşleşme yoksa tek düz parça', () => {
    expect(vurguParcalari('abc', 'xy')).toEqual([{ metin: 'abc', vurgu: false }])
  })
})
