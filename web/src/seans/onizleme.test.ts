import { describe, expect, it } from 'vitest'
import ornekler from './onizlemeOrnekleri.json'
import { AZAMI_ONIZLEME, notOnizlemesi } from './onizleme'

// Ortak örnekler: aynı dosyayı sunucunun `onizleme_ortak_ornekleri_saglar`
// testi de okuyor (`include_str!`). Bir taraf kuralı değiştirip dosyayı
// güncellerse diğer tarafın testi kırılır — iki uygulamanın sessizce
// ayrışmasının tek bekçisi bu dosya.
describe('notOnizlemesi — sunucuyla ORTAK örnekler', () => {
  it('örnek dosyası boş değil (boş dosya aşağıdaki döngüyü totolojik yapardı)', () => {
    expect(ornekler.length).toBeGreaterThanOrEqual(10)
  })

  for (const o of ornekler) {
    it(o.ad, () => {
      expect(notOnizlemesi(o.icerik)).toBe(o.beklenen)
    })
  }

  it('azami uzunluk sunucuyla aynı düz sayı', () => {
    expect(AZAMI_ONIZLEME).toBe(120)
  })
})
