import { describe, expect, it } from 'vitest'
import ornekler from '../../core/src/store/borc_ornekleri.json'
import { borcaGirerMi, borcToplami } from './borc'

// Ortak örnekler: aynı dosyayı `ozet.rs::borc_ortak_ornekleri_saglar` de
// okuyor. Kuralı bir tarafta değiştirip dosyayı güncelleyen, öbür tarafın
// testini kırar.
describe('borcaGirerMi — sunucuyla ORTAK örnekler', () => {
  it('örnek dosyası tam (boş dosya döngüyü totolojik yapardı)', () => {
    expect(ornekler.length).toBeGreaterThanOrEqual(24)
  })
  for (const o of ornekler) {
    it(o.ad, () => {
      expect(borcaGirerMi({ durum: o.durum, odendi: o.odendi, ucret: o.ucret })).toBe(o.borca_girer)
    })
  }
  it('borcToplami yalnızca borca girenleri toplar', () => {
    const hepsi = ornekler.map((o) => ({ durum: o.durum, odendi: o.odendi, ucret: o.ucret }))
    const beklenen = ornekler.filter((o) => o.borca_girer).reduce((t, o) => t + (o.ucret ?? 0), 0)
    expect(beklenen).toBe(90000) // ön koşul: iki kol da (geldi, gelmedi) sayıldı
    expect(borcToplami(hepsi)).toBe(beklenen)
  })
})
