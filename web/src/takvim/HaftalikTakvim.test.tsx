import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HaftalikTakvim } from './HaftalikTakvim'
import { haftaninBasi } from './hafta'

const randevu = {
  id: 1, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T14:00', bitis: '2026-09-07T15:00',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}

function kur(ozel = {}) {
  const props = {
    randevular: [randevu],
    haftaBasi: haftaninBasi(new Date(2026, 8, 7)),
    // Görev 6'da kullanılacak (bugün vurgusu, şimdi çizgisi); bu görevde
    // yalnızca geçiriliyor. `simdi` zorunlu bir prop olduğu için `kur()`
    // burada sabit bir değer veriyor (Görev 6 AYNI değeri kullanacak).
    simdi: '2026-09-09T14:30',
    onRandevuSec: vi.fn(),
    onBosSaatSec: vi.fn(),
    ...ozel,
  }
  render(<HaftalikTakvim {...props} />)
  return props
}

describe('HaftalikTakvim', () => {
  // Hafta başlığı ve gezinme okları Görev 5'te `TakvimSekmesi`nin tek araç
  // çubuğuna taşındı (bkz. `TakvimSekmesi.test.tsx` — "araç çubuğu (Görev
  // 5)"); burada yalnızca ızgaranın kendi içeriği (gün adları, randevular)
  // ölçülüyor.
  it('yedi günü gösterir', () => {
    kur()
    for (const gun of ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']) {
      expect(screen.getByText(gun)).toBeDefined()
    }
  })

  it('randevuyu danışan adıyla gösterir', () => {
    kur()
    expect(screen.getByText('Ayşe Yılmaz')).toBeDefined()
  })

  it('randevuya tıklayınca seçimi bildirir', async () => {
    const props = kur()
    await userEvent.click(screen.getByText('Ayşe Yılmaz'))
    expect(props.onRandevuSec).toHaveBeenCalledWith(randevu)
  })

  it('boş saate tıklayınca o saati bildirir', async () => {
    const props = kur()
    await userEvent.click(screen.getByLabelText('8 Eylül 10:00 boş'))
    expect(props.onBosSaatSec).toHaveBeenCalledWith('2026-09-08T10:00')
  })

  it('iptal edilmiş randevuyu ayrı biçimde işaretler', () => {
    kur({ randevular: [{ ...randevu, durum: 'iptal' }] })
    expect(screen.getByText('Ayşe Yılmaz').closest('button')?.className).toContain('line-through')
  })

  // e2e/takvim.spec.ts'teki "kopya olusmaz" testinin senkronizasyon
  // bariyeri bu özniteliğe dayanıyor: güncelleme ızgarada başka hiçbir
  // gözlemlenebilir iz bırakmıyor (blok yalnızca adı gösteriyor, React aynı
  // key ile aynı DOM'u üretiyor). Öznitelik kaldırılırsa o e2e testi tekrar
  // körleşir — bu yüzden burada birim testiyle sabitleniyor.
  it('randevu bloğu ücreti data-ucret olarak (kuruş) yayar', () => {
    kur()
    expect(screen.getByText('Ayşe Yılmaz').closest('button')?.getAttribute('data-ucret'))
      .toBe('45000')
  })

  it('ücretsiz randevuda data-ucret özniteliği hiç basılmaz', () => {
    kur({ randevular: [{ ...randevu, ucret: null }] })
    expect(screen.getByText('Ayşe Yılmaz').closest('button')?.hasAttribute('data-ucret'))
      .toBe(false)
  })

  it('randevusuz hafta boş ızgara gösterir, hata vermez', () => {
    kur({ randevular: [] })
    expect(screen.getByRole('table')).toBeDefined()
    expect(screen.getByText('Pzt')).toBeDefined()
  })

  // Görev 8 (R2): saat yalnızca TAM olmayan (off-hour) randevularda görünür.
  // Erişilebilir ad saat ile isim arasında GERÇEK bir metin boşluğu taşımalı
  // ("10:50 Ayşe Yılmaz") — yalnızca CSS margin ("mr-1") kullanılsaydı
  // erişilebilir ad "10:50Ayşe Yılmaz" olur, ekran okuyucu iki kelimeyi
  // birleştirirdi. Var olan e2e seçicileri tam saat bloklarının erişilebilir
  // adının yalnızca isim olmasına dayanıyor; o davranış burada da sabitleniyor.
  it('8.12: off-hour randevu bloğunun erişilebilir adı "saat isim"; tam saat yalnızca isim', () => {
    kur({
      randevular: [
        randevu,
        {
          ...randevu, id: 10, client_id: 2, danisan_adi: 'Mehmet Demir',
          baslangic: '2026-09-07T10:50', bitis: '2026-09-07T11:20',
        },
      ],
    })
    expect(screen.getByRole('button', { name: '10:50 Mehmet Demir' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Ayşe Yılmaz' })).toBeDefined()
  })
})

// Izgara 08:00–21:00. Bu aralığın DIŞINDAKİ randevular sunucudan
// çekiliyordu ama hiçbir hücreye düşmüyor, dolayısıyla ekranda HİÇ
// görünmüyorlardı: takvimde olmayan bir randevu, olmayan bir randevudur.
describe('HaftalikTakvim — görünen aralık dışındaki randevular', () => {
  const erken = {
    ...randevu, id: 2, danisan_adi: 'Erken Danışan',
    baslangic: '2026-09-08T07:30', bitis: '2026-09-08T08:30',
  }
  const gec = {
    ...randevu, id: 3, danisan_adi: 'Geç Danışan',
    baslangic: '2026-09-09T21:30', bitis: '2026-09-09T22:30',
  }

  const bolum = () => screen.getByRole('region', { name: 'Görünen aralık dışındaki randevular' })

  it('aralik dışındaki randevu ızgarada GÖRÜNMÜYOR (bu bölümün varlık sebebi)', () => {
    // ÖN KOŞUL. Bu satır olmadan aşağıdaki testler, randevu ızgarada da
    // görünüyor olsa bile yeşil kalırdı ve bölüm gereksiz bir tekrar
    // olurdu.
    kur({ randevular: [erken] })
    const izgara = screen.getByRole('table')
    expect(izgara.textContent).not.toContain('Erken Danışan')
  })

  it('erken ve geç randevuları GERÇEK sayıyla bildirir', () => {
    // Sayı tahmin değil: ızgaranın kendi hücre kimliklerinden türüyor.
    // Aralık İÇİNDEKİ randevu (14:00) sayıya KARIŞMAMALI.
    kur({ randevular: [randevu, erken, gec] })
    const b = bolum()
    expect(b.textContent).toContain('2 randevu var')
    expect(b.textContent).toContain('08:00–21:00')
    expect(b.textContent).toContain('Erken Danışan')
    expect(b.textContent).toContain('Geç Danışan')
    expect(b.textContent).not.toContain('Ayşe Yılmaz')

    // Ve aralık içindeki randevu ızgarada DURUYOR (bölüm, çalışan bir
    // şeyi bozmadı).
    expect(screen.getByRole('table').textContent).toContain('Ayşe Yılmaz')
  })

  it('gizli randevuya tıklanınca seçim bildirilir (ULAŞILABİLİR)', () => {
    // Görünür kılmak yetmez: kullanıcı o randevuyu açıp saatini
    // düzeltebilmeli.
    const props = kur({ randevular: [erken] })
    screen
      .getByRole('button', { name: /Erken Danışan — 08\.09 07:30 \(aralık dışı\) randevusunu aç/ })
      .click()
    expect(props.onRandevuSec).toHaveBeenCalledWith(erken)
  })

  it('hepsi aralik ICINDEYSE bolum HIC gorunmez', () => {
    // Her zaman uyaran bir arayüz uyarıyı anlamsızlaştırır. Sınır
    // değerleri de aralığın İÇİNDE sayılmalı: 08:00 ilk hücre,
    // 20:00 son hücre (21:00 ızgaraya dahil DEĞİL).
    const sinirdakiler = [
      { ...randevu, id: 4, baslangic: '2026-09-07T08:00', bitis: '2026-09-07T09:00' },
      { ...randevu, id: 5, baslangic: '2026-09-07T20:00', bitis: '2026-09-07T21:00' },
    ]
    kur({ randevular: sinirdakiler })
    expect(
      screen.queryByRole('region', { name: 'Görünen aralık dışındaki randevular' }),
    ).toBeNull()
    // ÖN KOŞUL: sınırdakiler gerçekten ızgarada.
    expect(screen.getByRole('table').textContent).toContain('Ayşe Yılmaz')
  })

  it('tam 21:00 ızgaranın DIŞINDADIR ve bildirilir', () => {
    // Üst sınır HARİÇ (`CALISMA_BITIS` son satır değil). Bu kayma sessiz
    // olurdu: 21:00'deki randevu ne ızgarada ne uyarıda görünseydi
    // tamamen kaybolurdu.
    kur({
      randevular: [
        { ...randevu, id: 6, danisan_adi: 'Tam Yirmibir', baslangic: '2026-09-07T21:00', bitis: '2026-09-07T22:00' },
      ],
    })
    expect(bolum().textContent).toContain('1 randevu var')
    expect(bolum().textContent).toContain('Tam Yirmibir')
  })
})

// Görev 6 (tasarım A2): bugün vurgusu ve şimdi çizgisi. `kur()`'un varsayılan
// `simdi`'si '2026-09-09T14:30' (9 Eylül Çarşamba); görünen hafta hep
// haftaninBasi(new Date(2026, 8, 7)) yani 7–13 Eylül — 9 Eylül BU haftanın
// içinde, Çarşamba (gunler[2]).
describe('HaftalikTakvim — bugün ve şimdi (Görev 6)', () => {
  it('6.1 bugünün sütun başlığı aria-current="date" taşır; başka hiçbir başlık taşımaz', () => {
    kur()
    const basliklar = screen.getAllByRole('columnheader')
    const isaretliler = basliklar.filter((b) => b.getAttribute('aria-current') === 'date')
    expect(isaretliler.length).toBe(1)
    expect(isaretliler[0].textContent).toContain('9')
  })

  it('6.2 şimdi çizgisi tam bir tane, 9 Eylül 14:00 hücresinin içinde, style.top %50', () => {
    kur()
    const cizgiler = screen.getAllByTestId('simdi-cizgisi')
    expect(cizgiler.length).toBe(1)
    const cizgi = cizgiler[0]
    // Çizginin en yakın hücresi (td), o saatin satırındaki 9 Eylül sütunu
    // olmalı: satırın ilk hücresi (saat etiketi) "14:00" yazıyor ve çizgi o
    // satırın Çarşamba (4. td, indeks 3) hücresinde.
    const satir = cizgi.closest('tr')
    expect(satir?.querySelector('td')?.textContent).toBe('14:00')
    const hucreler = satir ? Array.from(satir.querySelectorAll('td')) : []
    // gunler[0]=Pzt(7) .. gunler[2]=Çar(9): saat hücresinden sonraki 3. td.
    expect(hucreler[3]?.contains(cizgi)).toBe(true)
    expect((cizgi as HTMLElement).style.top).toBe('50%')
  })

  it('6.3 simdi görünen haftanın dışındaysa çizgi ve aria-current yok', () => {
    kur({ simdi: '2026-09-20T10:00' })
    expect(screen.queryByTestId('simdi-cizgisi')).toBeNull()
    const basliklar = screen.getAllByRole('columnheader')
    expect(basliklar.some((b) => b.getAttribute('aria-current') === 'date')).toBe(false)
  })

  it('6.4 simdi 07:30 ise çizgi yok, aria-current var', () => {
    kur({ simdi: '2026-09-09T07:30' })
    expect(screen.queryByTestId('simdi-cizgisi')).toBeNull()
    const basliklar = screen.getAllByRole('columnheader')
    expect(basliklar.some((b) => b.getAttribute('aria-current') === 'date')).toBe(true)
  })

  it('6.4b simdi 21:10 ise çizgi yok, aria-current var', () => {
    kur({ simdi: '2026-09-09T21:10' })
    expect(screen.queryByTestId('simdi-cizgisi')).toBeNull()
    const basliklar = screen.getAllByRole('columnheader')
    expect(basliklar.some((b) => b.getAttribute('aria-current') === 'date')).toBe(true)
  })

  it('boş hücrede görünür ipucu "+ HH:00" var; erişilebilir ad DEĞİŞMEZ', () => {
    kur()
    const dugme = screen.getByLabelText('8 Eylül 10:00 boş')
    expect(dugme.textContent).toBe('+ 10:00')
    const ipucu = dugme.querySelector('span')
    expect(ipucu?.getAttribute('aria-hidden')).toBe('true')
    expect(ipucu?.className).toContain('opacity-0')
    expect(ipucu?.className).toContain('group-hover:opacity-100')
  })
})

// Görev 7 düzeltme (R6): satır yüksekliği eskiden yalnızca mount'ta ve
// pencere `resize`'ında ölçülüyordu (deps: [saatler.length,
// gizliRandevular.length > 0]). Bu, ızgaranın ÜSTÜNDEKİ içerik (hata
// banner'ı, "Bugün N seans" bilgi satırı, aralık dışı randevular kutusunun
// büyümesi) bir RESIZE OLMADAN yükseklik değiştirdiğinde ölçümü BAYATLATIYOR
// -- ne `saatler.length` (sabit 13) ne de "gizli randevu var mı" (boole)
// değişmediği için eski efekt yeniden ÇALIŞMIYORDU. Düzeltme: ölçüm artık
// deps dizisi OLMAYAN bir `useLayoutEffect` ile HER render'dan sonra
// yapılıyor; `resize` dinleyicisi ayrı, mount'ta kurulan bir efekt ve AYNI
// ölçüm fonksiyonunu tetikliyor.
//
// `window.innerHeight` ve `Element.prototype.getBoundingClientRect`
// sahteleniyor: jsdom hiçbir zaman gerçek bir yerleşim (layout) hesaplamıyor,
// yani gerçek pikselleri yalnızca e2e (bkz. `e2e/yerlesim.spec.ts`)
// ölçebilir. Bu testler jsdom'da SAHTE bir ölçümle formülü ve "her render'da
// yeniden hesapla" davranışını sabitliyor.
describe('HaftalikTakvim — satır yüksekliği HER render\'da yeniden ölçülür (Görev 7 düzeltme)', () => {
  const SAAT_SAYISI = 13 // CALISMA_BITIS (21) - CALISMA_BASLANGIC (8)
  const orijinalInnerHeight = window.innerHeight
  const orijinalGetBoundingClientRect = Element.prototype.getBoundingClientRect

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: orijinalInnerHeight,
    })
    Element.prototype.getBoundingClientRect = orijinalGetBoundingClientRect
  })

  function sahteDikdortgen(ust: number): DOMRect {
    return {
      x: 0, y: ust, width: 0, height: 0,
      top: ust, right: 0, bottom: ust, left: 0,
      toJSON() {
        return this
      },
    }
  }

  /** `tbody`nin `getBoundingClientRect().top`'unu sabitler; başka hiçbir
   * öğe bu formülde kullanılmadığı için diğerlerine 0 dönmesi yeterli. */
  function tbodyUstunuSabitle(ust: number) {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.tagName === 'TBODY' ? sahteDikdortgen(ust) : sahteDikdortgen(0)
    }
  }

  function beklenenYukseklik(ust: number, pencereYuksekligi: number): number {
    return Math.max(36, Math.floor((pencereYuksekligi - ust - 16) / SAAT_SAYISI))
  }

  /** İlk saat satırının ilk GÜN hücresi (0. td saat etiketi, style TAŞIMIYOR;
   * stil yalnızca gün hücrelerinde). */
  function ilkGunHucresi(): HTMLElement {
    const hucre = document.querySelector('tbody tr td:nth-child(2)')
    if (!hucre) throw new Error('gün hücresi bulunamadı')
    return hucre as HTMLElement
  }

  it('mount anında pencereden türetilen formüle göre ölçülür', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 })
    tbodyUstunuSabitle(100)
    kur()
    expect(ilkGunHucresi().style.height).toBe(`${beklenenYukseklik(100, 760)}px`)
  })

  it('RESIZE olmadan, RERENDER sonrası tbody kayarsa yeniden ölçülür (eski deps dizisi bunu kaçırırdı)', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 })
    tbodyUstunuSabitle(100)
    const ortakProps = {
      haftaBasi: haftaninBasi(new Date(2026, 8, 7)),
      simdi: '2026-09-09T14:30',
      onRandevuSec: vi.fn(),
      onBosSaatSec: vi.fn(),
    }
    const { rerender } = render(<HaftalikTakvim randevular={[randevu]} {...ortakProps} />)
    const ilkBeklenen = beklenenYukseklik(100, 760)
    expect(ilkGunHucresi().style.height).toBe(`${ilkBeklenen}px`)

    // tbody'nin ÜSTÜNDEKİ bir bileşen büyüyüp onu aşağı ittiğinde bu olur:
    // `randevular` YENİ bir dizi ama AYNI tek randevu -- `saatler.length`
    // (sabit) ve `gizliRandevular.length > 0` (ikisinde de false, 0 gizli
    // randevu) DEĞİŞMİYOR. Eski deps dizisiyle efekt bu render'da yeniden
    // ÇALIŞMAZ, ölçüm 100'deki `ilkBeklenen` değerinde BAYAT kalırdı.
    tbodyUstunuSabitle(204)
    rerender(<HaftalikTakvim randevular={[{ ...randevu }]} {...ortakProps} />)
    const yeniBeklenen = beklenenYukseklik(204, 760)
    expect(yeniBeklenen).not.toBe(ilkBeklenen) // ÖN KOŞUL: senaryo gerçekten farklı bir değer üretiyor
    expect(ilkGunHucresi().style.height).toBe(`${yeniBeklenen}px`)
  })

  it('hesaplanan değer 36 altına düşerse 36 pikselde sabitlenir (alt sınır)', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 })
    tbodyUstunuSabitle(600)
    expect(beklenenYukseklik(600, 760)).toBe(36) // ÖN KOŞUL: senaryo gerçekten alt sınıra çarpıyor
    kur()
    expect(ilkGunHucresi().style.height).toBe('36px')
  })
})

// Görev 7 düzeltme turu 2 (R7): `getBoundingClientRect().top` PENCEREYE
// (viewport) görelidir, SAYFAYA değil. Sayfa aşağı kaydırılmışken (ör. bir
// randevuya tıklayıp "Seans durumu" grubuna erişmek için Playwright'ın
// otomatik kaydırması -- Görev 10'da HER randevu tıklamasında olacak) eski
// ölçüm bu viewport-göreli değeri doğrudan kullanıyordu: satırlar büyüyor,
// sayfa uzuyor, tarayıcının "scroll anchoring"i tıklanan öğeyi ekranda
// tutmak için `scrollY`'yi kaydırıyor, bir sonraki render'da `top` yine
// değişiyor -- ölçüm ↔ scroll DÖNGÜSÜ. Gerçek ortamda bu React "Maximum
// update depth exceeded" (üretimde küçültülmüş hata #185) fırlatıp AĞACI
// SÖKÜYORDU: `e2e/odeme.spec.ts`'teki dört testin dördü de "Geldi"ye
// basınca PATCH başarıyla dönmesine rağmen "Seans durumu" grubunun DOM'dan
// KAYBOLMASIYLA kırılıyordu (kontrolör R7, `page.on('pageerror', ...)` ile
// yakalanan kanıt: "Minified React error #185").
//
// Düzeltme: `top`'u SAYFA (döküman) koordinatına çevir (`+ window.scrollY`).
// A3 ölçütü zaten KAYDIRILMAMIŞ sayfa için tanımlı; tbody'nin sayfadaki
// mutlak konumu kaydırma sırasında SABİT kalır. Bu testler `window.scrollY`'yi
// de sahteleyip ölçümün SAYFA konumuna göre sabit kaldığını (viewport
// konumuna göre DEĞİL) doğruluyor.
describe('HaftalikTakvim — satır yüksekliği kaydırma (scrollY) konumundan BAĞIMSIZDIR (Görev 7 düzeltme turu 2)', () => {
  const SAAT_SAYISI = 13 // CALISMA_BITIS (21) - CALISMA_BASLANGIC (8)
  const orijinalInnerHeight = window.innerHeight
  const orijinalGetBoundingClientRect = Element.prototype.getBoundingClientRect
  const orijinalScrollY = window.scrollY

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: orijinalInnerHeight,
    })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: orijinalScrollY })
    Element.prototype.getBoundingClientRect = orijinalGetBoundingClientRect
  })

  function sahteDikdortgen(viewportUst: number): DOMRect {
    return {
      x: 0, y: viewportUst, width: 0, height: 0,
      top: viewportUst, right: 0, bottom: viewportUst, left: 0,
      toJSON() {
        return this
      },
    }
  }

  /** `tbody`nin `getBoundingClientRect().top`'unu (VIEWPORT'a göre, kaydırma
   * dâhil) sabitler. */
  function tbodyViewportUstunuSabitle(viewportUst: number) {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.tagName === 'TBODY' ? sahteDikdortgen(viewportUst) : sahteDikdortgen(0)
    }
  }

  function scrollYSabitle(deger: number) {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: deger })
  }

  /** Formül artık SAYFA (döküman) üst kenarını kullanıyor: viewport top +
   * scrollY. Testler bu SAYFA değerini sabit tutup viewport/scrollY'yi
   * değiştiriyor. */
  function beklenenYukseklikSayfaKoordinatiyla(sayfaUstu: number, pencereYuksekligi: number): number {
    return Math.max(36, Math.floor((pencereYuksekligi - sayfaUstu - 16) / SAAT_SAYISI))
  }

  function ilkGunHucresi(): HTMLElement {
    const hucre = document.querySelector('tbody tr td:nth-child(2)')
    if (!hucre) throw new Error('gün hücresi bulunamadı')
    return hucre as HTMLElement
  }

  it('sayfa AŞAĞI KAYDIRILMIŞKEN bile ölçüm SAYFA konumuna göre doğru hesaplanır', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 })
    const SAYFA_UST = 100 // tbody'nin sayfadaki (döküman) mutlak üst kenarı
    scrollYSabitle(400)
    // viewport top = sayfa top − scrollY = 100 − 400 = −300 (tbody viewport'un
    // ÜSTÜNE kaymış: sayfa aşağı kaydırılmış durumu simüle ediyor).
    tbodyViewportUstunuSabitle(SAYFA_UST - 400)
    kur()
    const beklenen = beklenenYukseklikSayfaKoordinatiyla(SAYFA_UST, 760)
    // ÖN KOŞUL: eski (viewport-göreli, `scrollY` eklemeyen) formül burada
    // FARKLI bir değer (80px) üretirdi -- senaryo gerçekten ayırt edici.
    expect(beklenen).not.toBe(Math.max(36, Math.floor((760 - (SAYFA_UST - 400) - 16) / SAAT_SAYISI)))
    expect(ilkGunHucresi().style.height).toBe(`${beklenen}px`)
  })

  it('AYNI sayfa konumunda FARKLI scrollY ile rerender edilince yükseklik DEĞİŞMEZ', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 })
    const SAYFA_UST = 100
    scrollYSabitle(400)
    tbodyViewportUstunuSabitle(SAYFA_UST - 400)
    const ortakProps = {
      haftaBasi: haftaninBasi(new Date(2026, 8, 7)),
      simdi: '2026-09-09T14:30',
      onRandevuSec: vi.fn(),
      onBosSaatSec: vi.fn(),
    }
    const { rerender } = render(<HaftalikTakvim randevular={[randevu]} {...ortakProps} />)
    const beklenen = beklenenYukseklikSayfaKoordinatiyla(SAYFA_UST, 760)
    expect(ilkGunHucresi().style.height).toBe(`${beklenen}px`)

    // `scrollY` DEĞİŞTİ (400 -> 0) ama tbody'nin SAYFA konumu (SAYFA_UST=100)
    // AYNI kaldı -- viewport top da buna göre değişti (100 − 0 = 100). Eski
    // (viewport-göreli) formül bunu FARKLI bir yükseklik olarak okurdu (ve
    // gerçek tarayıcıda tam olarak bu, scroll-anchoring geri beslemesini
    // başlatan adımdı); yeni formül SAYFA konumu değişmediği için AYNI
    // yüksekliği üretmeli.
    scrollYSabitle(0)
    tbodyViewportUstunuSabitle(SAYFA_UST - 0)
    rerender(<HaftalikTakvim randevular={[{ ...randevu }]} {...ortakProps} />)
    expect(ilkGunHucresi().style.height).toBe(`${beklenen}px`)
  })
})
