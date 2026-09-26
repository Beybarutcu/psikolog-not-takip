import { describe, expect, it } from 'vitest'

// =========================================================================
// YAPISAL TEST — `dangerouslySetInnerHTML` / `innerHTML` / `outerHTML` /
// `insertAdjacentHTML` web/src üretim kodunda YOK. Markdown çevirici bu
// görevin HTML-üretmeme kısıtını (bkz. görev brief'i, genel kısıtlar) yapısal
// olarak da zorlar; test dosyaları hariç tutulur çünkü meşru olarak bu
// dizgileri (ör. `DosyaBilgileri.test.tsx` içindeki `document.body.innerHTML`
// iddiaları) içerirler. Dosya kümesi `import.meta.glob` ile `web/src`'den
// özyinelemeli türetilir (`istemciRaporUretimi.test.ts` emsali); asgari
// dosya sayısı koruması `AyarlarSekmesi.test.tsx` emsalinin aynısı — glob
// boşa düşerse sıfır dosya taranıp yeşil kalmasın diye.
//
// Tasarım S7: saklanan not HTML'i okuma görünümünde bile `innerHTML` ile
// basılmaz (`not/NotOkuma.tsx`); bu tarama o sözün yapısal bekçisidir ve
// şablon kodunu da (`components/`, `hooks/`, `lib/`) kapsar.
//
// `outerHTML`/`insertAdjacentHTML` bugün `web/src`'de HİÇ geçmiyor (tarama
// bu ikisi eklenince de yeşil kalır) — bunları eklemek olağan bir sonraki
// adımı (`el.outerHTML = ...`, `el.insertAdjacentHTML(...)`) da kapsar.
// `document.write` zaten `istemciRaporUretimi.test.ts`'te yasak; burada
// tekrarlanmıyor.
// =========================================================================

const tumKaynaklar = import.meta.glob(['./**/*.ts', './**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Hariç tutma OLABİLDİĞİNCE DAR: yalnızca test dosyaları (`.test.ts(x)`) ve
 * test kurulum dosyası (`test-kurulum.ts`). Bir dizini ya da geniş bir deseni
 * (ör. `danisan/**`) dışarıda bırakmak yanlış olurdu — ihlalin gerçekleşeceği
 * kavşağı da dışarıda bırakırdı.
 */
const uretimKaynaklari = Object.fromEntries(
  Object.entries(tumKaynaklar).filter(
    ([yol]) => !/\.test\.[cm]?[jt]sx?$/.test(yol) && !yol.endsWith('/test-kurulum.ts'),
  ),
)

describe('yapısal: dangerouslySetInnerHTML / innerHTML web/src üretim kodunda yok', () => {
  const yollar = Object.keys(uretimKaynaklari)

  /**
   * Asgari sayı koruması (`AyarlarSekmesi.test.tsx` emsali). Glob boşa
   * düşerse (yanlış kök, yanlış desen) bu test SIFIR dosya tarar ve
   * aşağıdaki iddia hiçbir şeyi ölçmeden koşulsuz YEŞİL kalırdı. Eşik
   * bugünkü üretim dosyası sayısının (şablon koduyla 172) belirgin altında
   * ama "boş tarama" ile "gerçek tarama"yı kesin ayıracak kadar yüksek.
   */
  it('taranan dosya sayısı asgari korumayı karşılar', () => {
    expect(yollar.length).toBeGreaterThan(100)
  })

  it('taranan dosyalar arasında test dosyası yok ve bilinen bir üretim dosyası VAR', () => {
    // Okuma boş değil, hariç tutma da gerçekten çalışıyor: körlüğe karşı.
    expect(yollar.some((y) => /\.test\.[cm]?[jt]sx?$/.test(y))).toBe(false)
    expect(yollar).toContain('./seans/sablon.ts')
  })

  for (const yol of yollar) {
    it(`${yol} dangerouslySetInnerHTML/innerHTML/outerHTML/insertAdjacentHTML içermiyor`, () => {
      const kaynak = uretimKaynaklari[yol]
      expect(kaynak.includes('dangerouslySetInnerHTML')).toBe(false)
      expect(kaynak.includes('innerHTML')).toBe(false)
      expect(kaynak.includes('outerHTML')).toBe(false)
      expect(kaynak.includes('insertAdjacentHTML')).toBe(false)
    })
  }
})
