import { describe, expect, it } from 'vitest'
import ornekler from '../../core/src/store/katlama_ornekleri.json'
// Sunucunun katlama kuralı metin olarak (`?raw`; emsal `not/vurgu.test.ts`).
import aramaKaynagi from '../../core/src/store/search.rs?raw'
import katlaKaynagi from './katla.ts?raw'
import { katla } from './katla'

const kodNoktasi = (m: string) => [...m].length

// Tasarım §5.2: kural İKİ dilde yazılı; bu dosyayı
// `search.rs::tests::katlama_ortak_ornekleri_saglar` de okur. Kuralı bir
// tarafta değiştirip dosyayı güncelleyen, öbür tarafın testini kırar.
describe('katla — sunucuyla ORTAK örnekler (tasarım §5.2)', () => {
  it('örnek dosyası tam (boş dosya döngüyü totolojik yapardı)', () => {
    expect(ornekler.length).toBeGreaterThanOrEqual(22)
  })
  it('tasarımın zorunlu örnekleri dosyada', () => {
    const girdiler = ornekler.map((o) => o.girdi)
    for (const z of ['İpek', 'IŞIK', 'ŞAHİN ĞÜÖÇ', 'Kâzım', 'ÂDEM', 'İstanbul']) expect(girdiler, z).toContain(z)
  })
  for (const o of ornekler) {
    it(`${JSON.stringify(o.girdi)} -> ${JSON.stringify(o.katli)}; kod noktası ve UTF-16 uzunluğu korunur`, () => {
      const k = katla(o.girdi)
      expect(k).toBe(o.katli)
      expect(kodNoktasi(k)).toBe(kodNoktasi(o.girdi))
      // Vurgu (`not/vurgu.ts::eslesmeAraliklari`) katlanmış metindeki
      // UTF-16 konumunu ham metinde kullanır.
      expect(k.length).toBe(o.girdi.length)
    })
  }
})

// Sunucudaki `KATLANAN_HARFLER` ile AYNI küme.
const KATLANAN: Array<[string, string]> = [
  ['ı', 'i'], ['İ', 'i'], ['I', 'i'], ['i', 'i'], ['ş', 's'], ['Ş', 's'], ['ğ', 'g'],
  ['Ğ', 'g'], ['ü', 'u'], ['Ü', 'u'], ['ö', 'o'], ['Ö', 'o'], ['ç', 'c'], ['Ç', 'c'],
]

describe('katla — harf tablosu', () => {
  for (const [harf, ascii] of KATLANAN) it(`${harf} -> ${ascii}`, () => expect(katla(harf)).toBe(ascii))
})

// Preflight F21 (eskiden `not/vurgu.test.ts`'te): istemci kuralı sunucununkinin
// KOPYASI; ikisi yalnızca yorumla bağlı kalsaydı sunucuya eklenen bir harf
// aramayı listeden/vurgudan sessizce ayırırdı.
describe('sunucunun katlama kollarıyla aynı (core/src/store/search.rs)', () => {
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
})

// Tasarım §5.2: `'İ'.toLowerCase()` iki kod noktası üretir. Kural davranışla
// da ölçülüyor; bu yapısal iddia, ASCII kolunu `toLowerCase`'e geri döndüren
// ve yalnızca ASCII girdiyle sınanan bir değişikliği yakalar. Yorumlar
// çıkarılır: modül başlığı bu adları gerekçe olarak anıyor.
describe('katla.ts yapısı', () => {
  it('üretim kodunda toLowerCase / toLocaleLowerCase YOK', () => {
    const kod = katlaKaynagi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(kod).toContain('export function katla')
    expect(kod).not.toMatch(/toLowerCase|toLocaleLowerCase/)
  })
})
