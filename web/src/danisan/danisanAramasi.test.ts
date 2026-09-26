import { describe, expect, it } from 'vitest'
import { danisanSuz } from './danisanAramasi'

// Sunucu sırası (`ad_soyad COLLATE NOCASE`, yalnızca ASCII katlar): 'I' < 'İ'.
const LISTE = [
  { id: 1, ad_soyad: 'Ayşe Kaya' },
  { id: 2, ad_soyad: 'Ipek Sahin' },
  { id: 5, ad_soyad: 'Kâzım Can' },
  { id: 3, ad_soyad: 'İpek Işık' },
]
const adlar = (sorgu: string) => danisanSuz(LISTE, sorgu).map((d) => d.ad_soyad)

describe('danisanSuz (tasarım B1, §5.2)', () => {
  it('boş ya da yalnızca boşluk sorgu herkesi AYNI sırayla verir', () => {
    expect(adlar('')).toEqual(['Ayşe Kaya', 'Ipek Sahin', 'Kâzım Can', 'İpek Işık'])
    expect(adlar('   ')).toEqual(['Ayşe Kaya', 'Ipek Sahin', 'Kâzım Can', 'İpek Işık'])
  })
  it('İ/ı/I/i aynı harf: "ipek" ve "İPEK" iki İpek\'i de bulur, sıra korunur', () => {
    expect(adlar('ipek')).toEqual(['Ipek Sahin', 'İpek Işık'])
    expect(adlar('İPEK')).toEqual(['Ipek Sahin', 'İpek Işık'])
  })
  it('"IŞIK" yalnızca "İpek Işık"ı bulur (toLowerCase "ışık"ı "işik"ten ayırırdı)', () => {
    expect(adlar('IŞIK')).toEqual(['İpek Işık'])
    expect(adlar('isik')).toEqual(['İpek Işık'])
  })
  it('sorgu kırpılır; kelime içinden eşleşir; ş/s aynı harf', () => {
    expect(adlar('  ayşe ')).toEqual(['Ayşe Kaya'])
    expect(adlar('aya')).toEqual(['Ayşe Kaya'])
    expect(adlar('ŞAHİN')).toEqual(['Ipek Sahin'])
  })
  // Tasarım §5.2: `Â` → `Â` (katlanmaz), ⌘K sunucu aramasıyla AYNI kural.
  // "kazim" "Kâzım"ı BULMAZ; "kâz" bulur. Bilinçli sınır, iki aramada aynı.
  it('â katlanmaz: "kâz" bulur, "kazim" bulmaz', () => {
    expect(adlar('kâz')).toEqual(['Kâzım Can'])
    expect(adlar('kazim')).toEqual([])
  })
  it('girdi dizisi değiştirilmez', () => {
    const kopya = [...LISTE]
    danisanSuz(LISTE, 'ipek')
    expect(LISTE).toEqual(kopya)
  })
})
