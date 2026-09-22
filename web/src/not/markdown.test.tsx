/// <reference types="node" />
// `tsconfig.app.json`'ın `types` alanı yalnızca `vite/client`'ı listeliyor;
// `node:fs`/`node:path` bu yüzden aşağıdaki üçlü-slash referansı olmadan
// bilinmiyor. `@types/node` zaten bir devDependency, yeni paket eklenmiyor —
// yalnızca bu TEK dosyaya var olan tipler açılıyor (bkz. `AyarlarSekmesi.test.tsx`).
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { markdownOgeleri } from './markdown'

function ciz(kaynak: string) {
  return render(<div data-testid="kok">{markdownOgeleri(kaynak)}</div>)
}

describe('markdownOgeleri', () => {
  it('kalın ve italik satır içinde çalışır', () => {
    ciz('Bugün **çok kaygılı** ve *yorgun* görünüyordu.')
    expect(screen.getByText('çok kaygılı').tagName).toBe('STRONG')
    expect(screen.getByText('yorgun').tagName).toBe('EM')
  })

  it('üç başlık düzeyi bir kademe aşağıda çizilir', () => {
    ciz('# Bir\n## İki\n### Üç')
    expect(screen.getByText('Bir').tagName).toBe('H3')
    expect(screen.getByText('İki').tagName).toBe('H4')
    expect(screen.getByText('Üç').tagName).toBe('H5')
  })

  it('madde ve numaralı listeler ayrı listeler olur', () => {
    ciz('- elma\n- armut\n\n1. bir\n2. iki')
    expect(screen.getByText('elma').closest('ul')).not.toBeNull()
    expect(screen.getByText('bir').closest('ol')).not.toBeNull()
    expect(screen.getByText('elma').closest('ul')).toBe(screen.getByText('armut').closest('ul'))
  })

  it('onay kutusu salt okunur ve işaret durumunu taşır', () => {
    ciz('- [ ] ödev ver\n- [x] ölçek uygula')
    const kutular = screen.getAllByRole('checkbox')
    expect(kutular).toHaveLength(2)
    expect((kutular[0] as HTMLInputElement).checked).toBe(false)
    expect((kutular[1] as HTMLInputElement).checked).toBe(true)
    expect((kutular[0] as HTMLInputElement).disabled).toBe(true)
  })

  it('alıntı blockquote olur', () => {
    ciz('> Danışanın kendi cümlesi')
    expect(screen.getByText('Danışanın kendi cümlesi').closest('blockquote')).not.toBeNull()
  })

  it('HTML etiketi METİN olarak görünür, DOM elemanı olmaz', () => {
    const { getByTestId } = ciz('<script>alert(1)</script> <b>kalın değil</b>')
    const kok = getByTestId('kok')
    expect(kok.querySelector('script')).toBeNull()
    expect(kok.querySelector('b')).toBeNull()
    expect(kok.textContent).toContain('<script>alert(1)</script>')
  })

  it('kümede olmayan sözdizimi metin olarak kalır', () => {
    const { getByTestId } = ciz('[bağlantı](http://ornek) | tablo |')
    expect(getByTestId('kok').querySelector('a')).toBeNull()
    expect(getByTestId('kok').textContent).toContain('[bağlantı](http://ornek)')
  })

  it('kapanmamış işaret metin olarak kalır', () => {
    ciz('yarım **kalın')
    // `jest-dom` bu pakette kurulu değil (`test-kurulum.ts`'te yok,
    // `TakvimSekmesi.test.tsx`deki aynı gerekçe): `toBeInTheDocument`
    // burada TANIMSIZ olurdu. `getByText` zaten bulamazsa fırlatır; DOM'da
    // gerçekten bulunduğunu ayrıca doğrulamak için `.not.toBeNull()`.
    expect(screen.getByText(/yarım \*\*kalın/)).not.toBeNull()
  })

  it('eski biçimli (Veri:) not düz paragraf olarak okunur', () => {
    ciz('Veri:\nDanışan geldi.\n\nPlan:\nHaftaya.')
    expect(screen.getByText(/Danışan geldi/).tagName).toBe('P')
  })

  it('boş kaynak hiçbir şey çizmez', () => {
    const { getByTestId } = ciz('')
    expect(getByTestId('kok').childElementCount).toBe(0)
  })

  // =====================================================================
  // Tasarım notu: bitişik/iç içe `**`/`*` — bkz. `markdown.tsx` modül
  // başlığındaki kural. Kalın ÖNCE ve kendi çiftini TÜKETEREK eşleşir;
  // italik yalnızca kalından ARTA KALAN metinde aranır. Aşağıdaki iki test
  // bu davranışı SABİTLER (belirsiz bırakılmaz).
  // =====================================================================

  it('bitişik kalın ve italik ayrı elemanlar üretir (iç içe değil)', () => {
    ciz('**a** *b*')
    const kalin = screen.getByText('a')
    const italik = screen.getByText('b')
    expect(kalin.tagName).toBe('STRONG')
    expect(italik.tagName).toBe('EM')
    // Aynı öğe değiller ve kalının İÇİNDE italik yok — iç içe biçim
    // desteklenmiyor, bu iki BAĞIMSIZ satır içi eleman.
    expect(kalin.contains(italik)).toBe(false)
    expect(italik.contains(kalin)).toBe(false)
  })

  it('üç yıldız (***metin***) kalın önce eşleşir, artakalan yıldızlar metin kalır', () => {
    const { getByTestId } = ciz('***metin***')
    const kok = getByTestId('kok')
    // Kalın "*metin" içeriğiyle eşleşir (baştaki tek yıldız içeriğin bir
    // parçası olarak kalın etiketin İÇİNDE düz metindir), sondaki tek
    // yıldız kalın geçişinin dışında kalıp düz metin olarak görünür.
    const kalin = kok.querySelector('strong')
    expect(kalin).not.toBeNull()
    expect(kalin?.textContent).toBe('*metin')
    expect(kok.querySelector('em')).toBeNull()
    expect(kok.textContent).toBe('*metin*')
  })
})

// =========================================================================
// YAPISAL TEST — `dangerouslySetInnerHTML` / `innerHTML` web/src üretim
// kodunda YOK. Markdown çevirici bu görevin HTML-üretmeme kısıtını (bkz.
// görev brief'i, genel kısıtlar) yapısal olarak da zorlar; test dosyaları
// hariç tutulur çünkü meşru olarak bu dizgileri (ör. `DosyaBilgileri.test.tsx`
// içindeki `document.body.innerHTML` iddiaları) içerirler. Dosya kümesi
// `import.meta.glob` ile `web/src`'den özyinelemeli türetilir
// (`istemciRaporUretimi.test.ts` emsali); asgari dosya sayısı koruması
// `AyarlarSekmesi.test.tsx` emsalinin aynısı — glob boşa düşerse sıfır dosya
// taranıp yeşil kalmasın diye.
// =========================================================================

const tumKaynaklar = import.meta.glob(['../**/*.ts', '../**/*.tsx'], {
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
   * bugünkü üretim dosyası sayısının (45+) belirgin altında ama "boş
   * tarama" ile "gerçek tarama"yı kesin ayıracak kadar yüksek.
   */
  it('taranan dosya sayısı asgari korumayı karşılar', () => {
    expect(yollar.length).toBeGreaterThan(25)
  })

  it('taranan dosyalar arasında test dosyası yok ve bilinen bir üretim dosyası VAR', () => {
    // Okuma boş değil, hariç tutma da gerçekten çalışıyor: körlüğe karşı.
    expect(yollar.some((y) => /\.test\.[cm]?[jt]sx?$/.test(y))).toBe(false)
    expect(yollar).toContain(path.posix.join('..', 'seans', 'sablon.ts'))
  })

  for (const yol of yollar) {
    it(`${yol} dangerouslySetInnerHTML/innerHTML içermiyor`, () => {
      const kaynak = uretimKaynaklari[yol]
      expect(kaynak.includes('dangerouslySetInnerHTML')).toBe(false)
      expect(kaynak.includes('innerHTML')).toBe(false)
    })
  }
})
