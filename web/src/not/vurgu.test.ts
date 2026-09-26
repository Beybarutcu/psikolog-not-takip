import { describe, expect, it } from 'vitest'
// Sunucunun arama kuralı metin olarak (`?raw`, `vite.config.ts`
// `server.fs.allow` bu dizini açıyor; emsal `seans/sablon.test.ts`).
import aramaKaynagi from '../../../core/src/store/search.rs?raw'
import { ASGARI_VURGU, eslesmeAraliklari, katla, vurguParcalari } from './vurgu'

// Sunucudaki `store::search::katla_karakter` ile AYNI küme (KATLANAN_HARFLER).
const KATLANAN: Array<[string, string]> = [
  ['ı', 'i'], ['İ', 'i'], ['I', 'i'], ['i', 'i'], ['ş', 's'], ['Ş', 's'], ['ğ', 'g'],
  ['Ğ', 'g'], ['ü', 'u'], ['Ü', 'u'], ['ö', 'o'], ['Ö', 'o'], ['ç', 'c'], ['Ç', 'c'],
]

describe('katla', () => {
  for (const [harf, ascii] of KATLANAN) it(`${harf} -> ${ascii}`, () => expect(katla(harf)).toBe(ascii))
  it('ASCII büyük harf küçülür, diğerleri değişmez; uzunluk KORUNUR (konum eşlemesi buna dayanır)', () => {
    expect(katla('KAYGI Âb')).toBe('kaygi Âb')
    for (const m of ['Işık ÇAĞRI şĞüÜöÖçÇ', 'KAYGI kaygı', 'İstanbul', 'emoji 😀 x']) {
      expect(katla(m).length).toBe(m.length)
    }
  })
})

// Preflight F21: istemci katlaması sunucununkinin KOPYASI; ikisi yalnızca
// yorumla bağlı kalsaydı sunucuya eklenen bir harf (ya da değişen asgari
// uzunluk) vurguyu sessizce aramadan ayırırdı — arama bulur, vurgu
// işaretlemez. Sunucunun `katla_karakter` kolları ve `ASGARI_SORGU` kaynak
// metninden okunup istemciyle karşılaştırılır.
describe('sunucunun katlama kuralıyla aynı (core/src/store/search.rs)', () => {
  const govde = /fn katla_karakter\(k: char\) -> char \{([\s\S]*?)\n\}/.exec(aramaKaynagi)?.[1] ?? ''
  const sunucuEslemesi: Array<[string, string]> = [...govde.matchAll(/((?:'[^']'\s*\|\s*)*'[^']')\s*=>\s*'([^'])'/g)].flatMap(
    ([, harfler, hedef]) => [...harfler.matchAll(/'([^'])'/g)].map(([, h]) => [h, hedef] as [string, string]),
  )

  it('sunucu kaynağı gerçekten okundu (boş okuma iddiaları yeşile çevirmesin)', () => {
    expect(sunucuEslemesi.length).toBeGreaterThanOrEqual(14)
    expect(govde).toContain('to_ascii_lowercase')
  })
  it('sunucunun her katlama kolu istemcide aynı sonucu verir; istemci tablosu sunucununkiyle aynı küme', () => {
    for (const [harf, hedef] of sunucuEslemesi) expect(katla(harf), harf).toBe(hedef)
    expect(new Set(sunucuEslemesi.map(([h]) => h))).toEqual(new Set(KATLANAN.map(([h]) => h)))
  })
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
