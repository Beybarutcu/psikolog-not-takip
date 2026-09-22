import { describe, expect, it } from 'vitest'
import {
  etiketAdiNormallestir,
  etiketAdiUzunlugu,
  etiketAnahtari,
  etiketSirasi,
} from './etiketAdi'

// Sunucudaki `store::tags` kurallarının istemci eşleri. Yerel yama (ekleme
// sonrası sıralama) sunucunun sonraki okumasıyla aynı görünmeli.

describe('etiketAdi', () => {
  it('normalleştirme: baş/son boşluk atılır, iç boşluklar teke iner', () => {
    expect(etiketAdiNormallestir('  aile \t  içi  ')).toBe('aile içi')
    expect(etiketAdiNormallestir('   ')).toBe('')
  })

  it('uzunluk karakter (kod noktası) sayar, UTF-16 birimi ya da bayt değil', () => {
    expect(etiketAdiUzunlugu('şğü')).toBe(3)
    expect(etiketAdiUzunlugu('😀')).toBe(1)
  })

  it('anahtar Türkçe küçük harf: Kaygı/KAYGI aynı, yas/yaş farklı, I -> ı, İ -> i', () => {
    expect(etiketAnahtari('Kaygı')).toBe(etiketAnahtari('kaygı'))
    expect(etiketAnahtari('KAYGI')).toBe('kaygı')
    expect(etiketAnahtari('İlaç')).toBe('ilaç')
    expect(etiketAnahtari('yas')).not.toBe(etiketAnahtari('yaş'))
  })

  it('sıra sunucunun ORDER BY ad_anahtar ile aynı: anahtarın kod noktası sırası', () => {
    // "Zor" ham bayt sırasıyla ('Z' < 'k') başa gelirdi; anahtarla sona.
    expect(['uyku', 'Zor', 'kaygı'].sort(etiketSirasi)).toEqual(['kaygı', 'uyku', 'Zor'])
    // Türkçe alfabetik sıra DEĞİL: 'ç' (U+00E7) 'z'den sonra gelir.
    expect(['çocukluk', 'zaman'].sort(etiketSirasi)).toEqual(['zaman', 'çocukluk'])
  })
})
