import { describe, expect, it } from 'vitest'
import kimlikOrnekleri from '../../../core/src/store/etiket_kimlik_ornekleri.json'
import ornekler from '../../../core/src/store/etiket_siralama_ornekleri.json'
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

  // Son inceleme M3: etiket KİMLİĞİ (normalleştirme + Türkçe küçük harf)
  // sunucuyla ORTAK örneklere bağlı (`core/src/store/tags.rs::
  // kimlik_ortak_ornekleri_saglar` aynı dosyayı okur).
  it('kimlik ortak örnekleri sağlar (sunucunun ad_anahtar kuralıyla aynı)', () => {
    const anahtar = (ad: string) => etiketAnahtari(etiketAdiNormallestir(ad))
    // Boş bir örnek dosyası bu testi TOTOLOJİK yapardı (birinci biçim).
    expect(kimlikOrnekleri.ayni_anahtar.length).toBeGreaterThanOrEqual(4)
    expect(kimlikOrnekleri.farkli_anahtar.length).toBeGreaterThanOrEqual(2)
    for (const o of kimlikOrnekleri.ayni_anahtar) {
      for (const g of o.girdiler) expect(anahtar(g), `${o.ad} / ${JSON.stringify(g)}`).toBe(o.anahtar)
    }
    for (const o of kimlikOrnekleri.farkli_anahtar) {
      expect(anahtar(o.a), o.ad).not.toBe(anahtar(o.b))
    }
  })

  // Sunucuyla ORTAK örnekler (`core/src/store/tags.rs::
  // siralama_ortak_ornekleri_saglar` aynı dosyayı okur).
  it('sıralama ortak örnekleri sağlar (Türk alfabesi, sunucuyla aynı)', () => {
    // Boş bir örnek dosyası bu testi TOTOLOJİK yapardı (birinci biçim).
    expect(ornekler.length).toBeGreaterThanOrEqual(6)
    for (const o of ornekler) {
      expect(o.girdi, `örnek zaten sıralı: ${o.ad}`).not.toEqual(o.beklenen)
      expect([...o.girdi].sort(etiketSirasi), o.ad).toEqual(o.beklenen)
    }
  })
})
