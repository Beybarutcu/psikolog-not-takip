import { expect, test, type Locator, type Page } from '@playwright/test'
import { kurulumYap, sonaGit } from './yardimcilar'

// Tasarım A3 kabul ölçütü: 1200x760 ve 1280x800'de gün başlığı ile 20:00
// satırının alt kenarı SAYFA KAYDIRILMADAN görünür. jsdom yerleşimi
// ölçemediği için bu tek bekçi gerçek tarayıcıdır.
for (const boyut of [{ width: 1200, height: 760 }, { width: 1280, height: 800 }]) {
  test(`hafta ${boyut.width}x${boyut.height} penceresine kaydırmadan sığar`, async ({ page }) => {
    await page.setViewportSize(boyut)
    await kurulumYap(page)
    const sonSatir = page.locator('tbody tr').last()
    await expect(sonSatir).toBeVisible()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    const kutu = await sonSatir.boundingBox()
    expect(kutu).not.toBeNull()
    expect((kutu?.y ?? 0) + (kutu?.height ?? 0)).toBeLessThanOrEqual(boyut.height)
    const baslik = await page.locator('thead').boundingBox()
    expect(baslik?.y ?? -1).toBeGreaterThanOrEqual(0)
  })
}

test('1024x680de satirlar 36 pikselden kisa olmaz; sayfa kaymasi kabul', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 })
  await kurulumYap(page)
  const kutu = await page.locator('tbody tr').first().boundingBox()
  expect(kutu?.height ?? 0).toBeGreaterThanOrEqual(36)
})

test('1024 genisliginde yeni randevu formu izgaranin altina iner, sikismaz', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 })
  await kurulumYap(page)
  await page.locator('button[aria-label$="10:00 boş"]').first().click()
  const form = page.getByRole('heading', { name: 'Yeni randevu' }).locator('xpath=ancestor::aside')
  const izgara = page.getByTestId('takvim-izgara')
  const f = await form.boundingBox()
  const i = await izgara.boundingBox()
  expect(f?.width ?? 0).toBeGreaterThanOrEqual(300)
  expect(f?.y ?? 0).toBeGreaterThan((i?.y ?? 0) + (i?.height ?? 0) - 1)
})

// Görev 7 düzeltme turu 2 (R7) regresyon testi. Kök neden: satır yüksekliği
// ölçümü `getBoundingClientRect().top`'u (VIEWPORT'a göreli) SAYFA
// koordinatına çevirmeden önce, sayfa aşağı kaydırılmışken -- ör. "Geldi"ye
// basmak için Playwright'ın (ve Görev 10'da HER randevu tıklamasının)
// otomatik kaydırması -- `top` küçülüp satırlar büyüyor, sayfa uzuyor,
// tarayıcının "scroll anchoring"i tıklanan öğeyi ekranda tutmak için
// `scrollY`'yi kaydırıyor, bir SONRAKİ render'da `top` yine değişiyor: ölçüm
// ↔ scroll geri besleme döngüsü. Gerçek tarayıcıda bu React "Maximum update
// depth exceeded" (üretimde küçültülmüş hata #185) fırlatıp AĞACI
// SÖKÜYORDU -- `e2e/odeme.spec.ts`'teki dört testin dördü de PATCH başarıyla
// dönmesine rağmen "Seans durumu" grubunun DOM'dan KAYBOLMASIYLA
// kırılıyordu (kontrolör R7 kanıtı: `page.on('pageerror', ...)` ile
// yakalanan "Minified React error #185").
//
// Bu test tam o senaryoyu kurup (danışan + randevu oluştur, aç, SAYFANIN
// SONUNA kaydır, "Geldi"ye bas) hem düğmenin `aria-pressed="true"`
// olduğunu (ağaç sökülmediyse bu satır hiç çalışmaz) hem de ızgaranın ilk
// satır yüksekliğinin kaydırmadan ÖNCE ve SONRA AYNI kaldığını (sayfa
// ızgaranın yerinde açıldığı için ölçüm takvime dönüşte; ölçüm SAYFA
// konumuna göre, `scrollY`'den bağımsız) doğruluyor.
async function danisanEkle(page: Page, ad: string) {
  await page.getByRole('tab', { name: 'Danışanlar', exact: true }).click()
  await page.getByRole('button', { name: 'Danışan ekle', exact: true }).click()
  await page.getByLabel('Ad soyad', { exact: true }).fill(ad)
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText(ad, { exact: true }).first()).toBeVisible()
  await page.getByRole('tab', { name: 'Takvim', exact: true }).click()
}

async function randevuOlustur(page: Page, ad: string, saat: string, ucretTl: string) {
  await page.locator(`button[aria-label$="${saat} boş"]`).first().click()
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
  await page.getByLabel('Ücret (TL)', { exact: true }).fill(ucretTl)
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(page.locator('button[data-durum]', { hasText: ad })).toHaveCount(1)
}

test('1200x760: sayfa sonuna kaydirip Geldi isaretlenince ilk satir yuksekligi degismez (Gorev 7 R7 regresyonu)', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 })
  await kurulumYap(page)

  const ad = 'Yerlesim Kaydirma Testi'
  await danisanEkle(page, ad)
  await randevuOlustur(page, ad, '09:00', '400')

  // Not sayfası ızgaranın YERİNDE açılır (tasarım N1): ızgara ölçümü bloğa
  // tıklamadan ÖNCE.
  const oncesi = await page.locator('tbody tr').first().boundingBox()
  expect(oncesi).not.toBeNull()

  await page.locator('button[data-durum]', { hasText: ad }).click()
  const grup = page.getByRole('group', { name: 'Seans durumu', exact: true })
  await expect(grup).toBeVisible()

  // Sayfanın SONUNA kaydır: eski (viewport-göreli) ölçümle bu adım ölçüm ↔
  // scroll geri besleme döngüsünü BAŞLATIRDI.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

  const dugme = grup.getByRole('button', { name: 'Geldi', exact: true })
  await dugme.click()
  await expect(dugme).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Takvime dön', exact: true }).click()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  const sonrasi = await page.locator('tbody tr').first().boundingBox()
  expect(sonrasi).not.toBeNull()
  expect(sonrasi?.height).toBe(oncesi?.height)
})

// Görev 5 incelemesinden taşınan madde: biçimli yüzey (`BicimliYuzey`)
// `NotEditoru`'nun esnek sütununda uzamıyordu (eski metin kutusu
// `min-h-64 flex-1` idi). Tasarım N4: not sayfasında editör "sayfanın büyük
// kısmı" — açılış kaydırmasından (A6) sonra ekranın kalanını doldurur.
// Danışan dosyasının editörü yazı alanının asgarisini (16rem) korur. jsdom
// yerleşim ölçmediği için tek bekçi gerçek tarayıcı.
//
// 2026-09-27 (araç çubuğu notu örtmez): ProseMirror artık yüzeyin kaydırma
// kabının (`not-yazi-alani`) içinde ve en az onun boyunda. Danışan
// dosyasındaki asgari ölçümü GÖRÜNEN yazı alanına taşındı: ProseMirror'un
// kendi boyu kabın içinde kayan notla büyür, görünen alanı ölçmez (daha
// sıkı ölçüm; not sayfasındaki ölçümler aynı kaldı, boş notta ikisi eşit).
// Danışan dosyasının not sütunu da artık yükseklik veriyor (`DanisanDosyasi`).
test('not sayfasinda editor ekranin kalanini doldurur; danisan dosyasinda asgari yukseklik korunur', async ({ page }) => {
  const boyut = { width: 1280, height: 800 }
  await page.setViewportSize(boyut)
  await kurulumYap(page)

  const ad = 'Yerlesim Editor Testi'
  await danisanEkle(page, ad)
  await randevuOlustur(page, ad, '11:00', '400')
  await page.locator('button[data-durum]', { hasText: ad }).click()

  const sayfa = page.getByTestId('seans-bolumu')
  const yuzey = page.getByLabel('Seans notu', { exact: true })
  await expect(yuzey).toBeVisible()
  // BARİYER: açılış kaydırması (yumuşak, index.css) bitti — sayfanın başı
  // ekranın üstünde (`scroll-mt-2` = 8 px).
  await expect.poll(async () => Math.round((await sayfa.boundingBox())?.y ?? -1)).toBe(8)

  const k = await yuzey.boundingBox()
  expect(k).not.toBeNull()
  // Ekranın kalanını dolduruyor: alt kenarı ekranın alt beşte birinde ve
  // ekranın İÇİNDE (altında yalnızca etiket satırı ve kenar boşlukları).
  expect(k!.y + k!.height).toBeGreaterThan(boyut.height * 0.8)
  expect(k!.y + k!.height).toBeLessThanOrEqual(boyut.height)
  // Asgari (16rem = 256 px) yükseklikte kalmış bir yüzey bu eşiği geçemez.
  expect(k!.height).toBeGreaterThan(boyut.height / 2)
  // Editör KALANI alır, sekme gövdesinin TAMAMINI değil: altındaki etiket
  // satırı editörün altında, sekme gövdesinin içinde ve ekranda kalır.
  // (Not: `NotEditoru` kökünde `flex-1` yerine `h-full` Chromium'da EŞDEĞER
  // çıktı — esnek küçülme etiket satırına yer açıyor; ölçüldü, bu satırlar o
  // mutasyonu yakalamıyor. Yakalanan: kökte hiç büyüme yok, kapta `flex-1`
  // yok, sayfada ekran boyu asgari yok.)
  const etiket = await sayfa.getByLabel('Etiket ekle', { exact: true }).boundingBox()
  const govde = await sayfa.getByRole('tabpanel').boundingBox()
  expect(etiket).not.toBeNull()
  expect(govde).not.toBeNull()
  expect(etiket!.y).toBeGreaterThanOrEqual(k!.y + k!.height)
  expect(etiket!.y + etiket!.height).toBeLessThanOrEqual(govde!.y + govde!.height)
  expect(govde!.y + govde!.height).toBeLessThanOrEqual(boyut.height)

  // Danışan dosyası: aynı editör — görünen yazı alanının asgarisi korunur.
  await page.getByRole('button', { name: `${ad} dosyasını aç`, exact: true }).click()
  const dosyaYuzeyi = page.getByLabel('Seans notu', { exact: true })
  await expect(dosyaYuzeyi).toBeVisible()
  const d = await page.getByTestId('not-yazi-alani').boundingBox()
  expect(d).not.toBeNull()
  expect(d!.height).toBeGreaterThanOrEqual(256)
})

// Son inceleme A: uygulamanın KENDİ pencere boylarında (Tauri ana pencere
// 1200x760, en az 1024x680; bkz. `src-tauri/src/main.rs`) ve 1280x720'de
// belge yatay taşmaz ve not editörünün araç çubuğu kesilmez. Eskiden
// danışan dosyasının iki `1fr` izi TipTap araç çubuğunun tek satırlık
// asgari genişliğinin (~740 px) altına inemiyordu: belge 1280'de ~1358 px
// oluyor, "Bul ve değiştir" dahil editörün sağı ekranın dışında kalıyordu.
// Takvimdeki not sayfasında sütun daralabiliyor (`min-w-0`) ama araç çubuğu
// kendi içinde (gizli kaydırma çubuğuyla) kesiliyordu. İki sayfada da:
// belge pencereden geniş değil, düğme tamamen ekranda ve araç çubuğunun
// sağ kenarını aşmıyor (kendi içinde kaydırılarak gizlenmemiş). Danışan
// dosyasında nota uzun bir bağlantı yazılınca da belge taşmaz.
test.describe('editor arac cubugu pencereye sigar', () => {
  // Açılış kaydırması (yumuşak, index.css) ölçümleri oynatmasın.
  test.use({ reducedMotion: 'reduce' })

  async function tasmaYok(page: Page, yer: string) {
    const belge = await page.evaluate(() => ({
      genislik: document.documentElement.scrollWidth,
      pencere: window.innerWidth,
    }))
    expect.soft(belge.genislik, `${yer}: belge yatay taşıyor`).toBeLessThanOrEqual(belge.pencere)
    const cubuk = page.getByRole('toolbar', { name: 'Biçim araçları', exact: true })
    const dugme = cubuk.getByRole('button', { name: 'Bul ve değiştir', exact: true })
    await expect.soft(dugme, `${yer}: "Bul ve değiştir" tamamen ekranda değil`).toBeInViewport({ ratio: 1 })
    const c = await cubuk.boundingBox()
    const d = await dugme.boundingBox()
    expect(c).not.toBeNull()
    expect(d).not.toBeNull()
    expect.soft(d!.x + d!.width, `${yer}: düğme araç çubuğunun sağ kenarını aşıyor`).toBeLessThanOrEqual(c!.x + c!.width)
  }

  // Dar sütunda çubuk birkaç satıra kırılır; bul paneli çubuğun ALTINDAN
  // açılır, alt satırları ve açan düğmeyi örtmez (eskiden çubuğun tek
  // satırlık yüksekliğinden açılıyordu).
  async function bulPaneliCubugunAltinda(page: Page, yer: string) {
    const cubuk = page.getByRole('toolbar', { name: 'Biçim araçları', exact: true })
    await cubuk.getByRole('button', { name: 'Bul ve değiştir', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Bul ve değiştir', exact: true })
    await expect(panel).toBeVisible()
    const c = await cubuk.boundingBox()
    const p = await panel.boundingBox()
    expect(c).not.toBeNull()
    expect(p).not.toBeNull()
    expect(p!.y, `${yer}: bul paneli araç çubuğunu örtüyor`).toBeGreaterThanOrEqual(c!.y + c!.height)
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  }

  for (const [sira, boyut] of [
    { width: 1024, height: 680 },
    { width: 1200, height: 760 },
    { width: 1280, height: 720 },
  ].entries()) {
    test(`${boyut.width}x${boyut.height}: danisan dosyasi ve not sayfasi yatay tasmaz, "Bul ve degistir" gorunur`, async ({ page }) => {
      await page.setViewportSize(boyut)
      // 08:00'deki önceki seansın notu YOK ve "Diğer seanslar" notsuz GELECEK
      // seansı listelemez (2026-09-27). Randevular görünen haftanın ilk boş
      // günlerine düşer (Pzt-Çar); tarayıcı saati haftanın SONUNA sabit
      // (Pazar 20:30), yani o seans hangi gün koşulursa koşulsun geçmişte.
      await page.clock.setFixedTime(new Date(2026, 8, 27, 20, 30))
      await kurulumYap(page)
      const ad = `Yerlesim Tasma ${sira + 1}`
      await danisanEkle(page, ad)
      // Önceki seans (geniş okuma için) ve bu seans, aynı gün.
      const izgara = page.getByTestId('takvim-izgara')
      for (const saat of ['08:00', '13:00']) {
        await page.locator(`button[aria-label$="${saat} boş"]`).first().click()
        await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
        await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
        await expect(izgara.getByRole('button', { name: `${saat} ${ad}`, exact: true })).toBeVisible()
      }

      // Takvimdeki not sayfası, dar "Diğer seanslar" sütunuyla: önceki seans
      // ve altında değil ÜSTÜNDE "Bu seans" işareti (açık seans en yenisi).
      await izgara.getByRole('button', { name: `13:00 ${ad}`, exact: true }).click()
      await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
      const bolge = page.getByRole('region', { name: 'Diğer seanslar' })
      await expect(bolge.getByRole('listitem')).toHaveCount(2)
      await expect(bolge.getByRole('listitem').first()).toHaveAttribute('aria-current', 'true')
      await tasmaYok(page, `${boyut.width}x${boyut.height} not sayfası`)

      // Geniş okuma (N7): sütun sayfanın yarısına büyür, editör daralır.
      const darGenislik = (await bolge.boundingBox())!.width
      await bolge.getByRole('listitem').getByRole('button').first().click()
      await expect.poll(async () => (await bolge.boundingBox())!.width).toBeGreaterThan(darGenislik * 1.3)
      await tasmaYok(page, `${boyut.width}x${boyut.height} not sayfası geniş okuma`)
      await bulPaneliCubugunAltinda(page, `${boyut.width}x${boyut.height} not sayfası geniş okuma`)

      // Danışan dosyası, Seanslar alt sekmesi, seans notu açık.
      await page.getByTestId('seans-bolumu').getByRole('button', { name: `${ad} dosyasını aç`, exact: true }).click()
      await expect(page.getByRole('heading', { level: 2, name: ad, exact: true })).toBeVisible()
      await expect(page.getByRole('tab', { name: 'Seanslar', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
      await tasmaYok(page, `${boyut.width}x${boyut.height} danışan dosyası`)
      await bulPaneliCubugunAltinda(page, `${boyut.width}x${boyut.height} danışan dosyası`)

      // Nota yapıştırılmış boşluksuz uzun bir bağlantı: yüzey onu satır
      // sonunda böler (`overflow-wrap: break-word`), ama bu kural içeriğin
      // ASGARİ genişliğini küçültmez. Düz `1fr` izi (iki ızgaranın ikisi de)
      // o asgariye kadar büyüyüp belgeyi taşırırdı; `minmax(0,1fr)` izi
      // pencerede tutar. (Kırılan araç çubuğu artık izi genişletmiyor; bu
      // adım olmadan `1fr`e dönüş ölçülemezdi.)
      const alan = page.getByLabel('Seans notu', { exact: true })
      const uzunBaglanti = `https://ornek.invalid/${'a'.repeat(300)}`
      await alan.fill(uzunBaglanti)
      await expect(alan).toHaveText(uzunBaglanti)
      await tasmaYok(page, `${boyut.width}x${boyut.height} danışan dosyası, uzun bağlantı`)
    })
  }
})

/**
 * Nota HTML yapıştırır: gerçek bir `paste` olayı (bkz.
 * `editor.spec.ts::htmlYapistir`). `son`: yapıştırılanın son metni (bariyer).
 */
async function notaYapistir(alan: Locator, html: string, son: string) {
  await alan.click()
  await alan.evaluate((el, html) => {
    const veri = new DataTransfer()
    veri.setData('text/html', html)
    veri.setData('text/plain', html.replace(/<[^>]*>/g, '\n'))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: veri, bubbles: true, cancelable: true }))
  }, html)
  await expect(alan).toContainText(son)
}

// Kullanıcı isteği (2026-09-27, "araç çubuğu örtmesin notu"): yüzey
// içeriğiyle uzuyor ve SAYFA kayıyordu; şablonun yapışkan (`position:
// sticky; top: 0; z-index: 50`), opak araç çubuğu dar sütunda iki-üç satıra
// kırılıp (69–105 px) kayan notun üst satırlarını örtüyor, ProseMirror'un
// imleci gösteren kaydırması imleci çubuğun altında bırakabiliyordu. Artık
// çubuk akışta, yazı alanının ÜSTÜNDE; uzun not yüzeyin KENDİ kaydırma
// kabında kayar, sayfa kaymaz (bkz. `BicimliYuzey`). Ölçümler:
//  (a) çubuğun alt kenarı yazı alanının üst kenarında ya da üstünde; ortaya
//      kaydırılmış notta çubuğun hemen altındaki nokta NOT İÇERİĞİ;
//  (b) not kayarken ve sonuna yazılırken sayfa kaymaz, belge yatay taşmaz;
//  (c) Ctrl+End ve yazma: son paragraf yazı alanının kutusunun içinde;
//  (d) not sayfasında durum satırı, etiket satırı ve bul paneli sayfa
//      kaydırılmadan görünür.
test.describe('arac cubugu notu ortmez; uzun not editorun icinde kayar', () => {
  test.use({ reducedMotion: 'reduce' })

  /** (c)'de yazılan işaretin sırası (her adımın işareti ayrı). */
  let sonaYazma = 0

  /** 60 paragraflık not (bkz. `notaYapistir`). */
  async function uzunNotYapistir(alan: Locator) {
    const html = Array.from({ length: 60 }, (_, i) => `<p>Paragraf ${i + 1}: seans notunun uzun bir satırı.</p>`).join('')
    await notaYapistir(alan, html, 'Paragraf 60:')
  }

  /**
   * Notu kaydırır: ProseMirror'un en yakın KAYAN atası (kaydırma kabı), yoksa
   * belge. `oran` 0 = baş, 0.5 = orta, 1 = son. Kimin kaydırdığını döndürür.
   */
  function notuKaydir(alan: Locator, oran: number): Promise<'yuzey' | 'belge'> {
    return alan.evaluate((el, oran) => {
      let kap: HTMLElement | null = el.parentElement
      while (kap !== null && !(/(auto|scroll)/.test(getComputedStyle(kap).overflowY) && kap.scrollHeight > kap.clientHeight)) {
        kap = kap.parentElement
      }
      const kaydirici = kap ?? (document.scrollingElement as HTMLElement)
      kaydirici.scrollTop = (kaydirici.scrollHeight - kaydirici.clientHeight) * oran
      return kap === null ? 'belge' : 'yuzey'
    }, oran)
  }

  const sayfaKaymasi = (page: Page) => page.evaluate(() => window.scrollY)

  /**
   * (a)-(c). Yazı alanı = ProseMirror'un ebeveyni (yüzeyin kaydırma kabı).
   * `kaydirma`: sayfanın bu ölçümler boyunca kalması gereken konumu.
   */
  async function cubukNotuOrtmez(page: Page, alan: Locator, yer: string, kaydirma: number) {
    const cubuk = page.getByRole('toolbar', { name: 'Biçim araçları', exact: true })
    const icerik = alan.locator('xpath=..')
    // ÖN KOŞUL: not pencereden uzun (kısa notta kaydırma hiçbir şey ölçmezdi).
    const pencere = page.viewportSize()!
    expect((await alan.boundingBox())!.height, `${yer}: not yeterince uzun değil`).toBeGreaterThan(pencere.height)

    // (b) Not ortaya kayar: kaydıran yüzeyin kendi kabı, sayfa yerinde.
    expect.soft(await notuKaydir(alan, 0.5), `${yer}: notu sayfa kaydırıyor`).toBe('yuzey')
    expect(await sayfaKaymasi(page), `${yer}: not kayarken sayfa kaydı`).toBe(kaydirma)
    const belge = await page.evaluate(() => ({ genislik: document.documentElement.scrollWidth, pencere: window.innerWidth }))
    expect(belge.genislik, `${yer}: belge yatay taşıyor`).toBeLessThanOrEqual(belge.pencere)

    // (a) Çubuk ekranda, alt kenarı yazı alanının üstünde; hemen altındaki
    // nokta not içeriği (çubuk değil). Ön koşul: ilk paragraf yukarıda
    // kaldı, yani not gerçekten kaydı ve çubuğun "altında" metin var.
    await expect(cubuk).toBeInViewport({ ratio: 1 })
    const c = (await cubuk.boundingBox())!
    const k = (await icerik.boundingBox())!
    expect(c.y + c.height, `${yer}: araç çubuğu yazı alanına biniyor`).toBeLessThanOrEqual(k.y + 0.5)
    expect((await alan.locator('p').first().boundingBox())!.y).toBeLessThan(c.y + c.height)
    const altindaki = await page.evaluate(
      ([x, y]) => {
        const e = document.elementFromPoint(x, y)
        if (e === null) return 'hiçbir şey'
        if (e.closest('[role="toolbar"]') !== null) return 'araç çubuğu'
        return e.closest('.ProseMirror') !== null ? 'not' : e.tagName
      },
      [k.x + 24, c.y + c.height + 2],
    )
    expect(altindaki, `${yer}: çubuğun hemen altında not içeriği yok`).toBe('not')

    // (c) Baştan Ctrl+End ve yazma: son paragraf yazı alanının içinde, sayfa
    // yerinde. `sonaGit` editörün kendi seçimi sona gelene kadar bekler
    // (danışan dosyasında editör tıklamayla ilk kez odak alıyor; ProseMirror'un
    // odak zamanlayıcısı Ctrl+End'i silebiliyordu, bkz. yardımcı). İşaret her
    // adımda AYRI: danışan dosyası aynı notu açar ve not sayfasında yazılan
    // işaret son paragrafta zaten durur (tek işaretle, metin tıklanan
    // paragrafa gitse de iddia geçiyordu).
    await notuKaydir(alan, 0)
    await alan.locator('p').first().click()
    await sonaGit(page, alan)
    const isaret = `sonuna eklendi #${++sonaYazma}`
    await page.keyboard.type(` ${isaret}`)
    const son = alan.locator('p').last()
    await expect(son).toContainText(isaret)
    await expect(alan.locator('p').first()).not.toContainText(isaret)
    const kk = (await icerik.boundingBox())!
    // İmleç (daraltılmış seçimin dikdörtgeni) yazı alanının içinde.
    const imlec = await page.evaluate(() => {
      const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      return { ust: r.top, alt: r.bottom }
    })
    expect(imlec.alt - imlec.ust, `${yer}: imleç dikdörtgeni boş`).toBeGreaterThan(0)
    expect(imlec.ust, `${yer}: imleç yazı alanının üstünde`).toBeGreaterThanOrEqual(kk.y - 0.5)
    expect(imlec.alt, `${yer}: imleç yazı alanının altında`).toBeLessThanOrEqual(kk.y + kk.height + 0.5)
    const s = (await son.boundingBox())!
    expect(s.y, `${yer}: son paragraf yazı alanının üstünde`).toBeGreaterThanOrEqual(kk.y - 0.5)
    expect(s.y + s.height, `${yer}: son paragraf yazı alanının altında (imleç görünmüyor)`).toBeLessThanOrEqual(kk.y + kk.height + 0.5)
    await expect(son).toBeInViewport({ ratio: 1 })
    expect(await sayfaKaymasi(page), `${yer}: sona yazınca sayfa kaydı`).toBe(kaydirma)
  }

  /**
   * Yazı alanı etiket satırının üstüne TAŞMAZ. Esnek zincirde `min-h-0` ile
   * yapılan ilk deneme danışan dosyasında (1024x680) tam bunu üretti: sütun
   * asgarinin altına inince 16rem'lik yazı alanı etiket satırının üstüne
   * biniyordu (ölçüldü: alan 349–605, etiket satırı 558–604).
   */
  async function etiketSatiriYaziAlanininAltinda(page: Page, alan: Locator, yer: string) {
    const k = (await alan.locator('xpath=..').boundingBox())!
    const e = (await page.getByTestId('etiket-satiri').boundingBox())!
    expect(e.y, `${yer}: yazı alanı etiket satırının üstüne biniyor`).toBeGreaterThanOrEqual(k.y + k.height - 0.5)
  }

  for (const [sira, boyut] of [
    { width: 1024, height: 680 },
    { width: 1200, height: 760 },
  ].entries()) {
    test(`${boyut.width}x${boyut.height}: not sayfasi ve danisan dosyasinda cubuk notu ortmez, sayfa kaymaz`, async ({ page }, testBilgisi) => {
      await page.setViewportSize(boyut)
      await kurulumYap(page)
      // `--repeat-each` ile (aynı sunucu, aynı hafta) tekrar koşulabilir: ad
      // ve saat her tekrarda ayrı (yoksa `randevuOlustur`un "tek blok"
      // iddiası önceki tekrarın bloğunu da sayar, 15:00 satırı dolar).
      const tekrar = testBilgisi.repeatEachIndex
      const ad = `Yerlesim Uzun Not ${sira + 1}.${tekrar}`
      await danisanEkle(page, ad)
      await randevuOlustur(page, ad, `${15 + (tekrar % 5)}:00`, '400')

      // --- Takvimdeki not sayfası ---
      await page.locator('button[data-durum]', { hasText: ad }).click()
      const bolum = page.getByTestId('seans-bolumu')
      const alan = page.getByLabel('Seans notu', { exact: true })
      await expect(alan).toBeVisible()
      // BARİYER: açılış kaydırması (A6) bitti.
      await expect.poll(async () => Math.round((await bolum.boundingBox())?.y ?? -1)).toBe(8)
      const kaydirma = await sayfaKaymasi(page)
      await uzunNotYapistir(alan)
      expect(await sayfaKaymasi(page), 'yapıştırınca sayfa kaydı').toBe(kaydirma)
      await cubukNotuOrtmez(page, alan, `${boyut.width}x${boyut.height} not sayfası`, kaydirma)
      await etiketSatiriYaziAlanininAltinda(page, alan, `${boyut.width}x${boyut.height} not sayfası`)

      // (d) Durum satırı, etiket satırı ve bul paneli sayfa kaymadan görünür.
      await expect(bolum.getByRole('group', { name: 'Seans durumu', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(bolum.getByLabel('Etiket ekle', { exact: true })).toBeInViewport({ ratio: 1 })
      const cubuk = page.getByRole('toolbar', { name: 'Biçim araçları', exact: true })
      await cubuk.getByRole('button', { name: 'Bul ve değiştir', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Bul ve değiştir', exact: true })
      await expect(panel).toBeInViewport({ ratio: 1 })
      const cb = (await cubuk.boundingBox())!
      const pk = (await panel.boundingBox())!
      expect(pk.y, 'bul paneli araç çubuğunu örtüyor').toBeGreaterThanOrEqual(cb.y + cb.height)
      // Bul paneli kayan yazı alanında çalışır: not sonundayken yukarıdaki
      // (ortadaki) eşleşmeye gidilir; eşleşme yazı alanının içinde ve panelin ALTINDA
      // görünür (panel yazı alanının sağ üstünü örter), sayfa kaymaz.
      await notuKaydir(alan, 1)
      const bul = panel.getByLabel('Bul', { exact: true })
      await bul.fill('Paragraf 30:')
      const guncel = alan.locator('.find-and-replace-result-current')
      await expect(guncel).toHaveCount(1)
      await bul.press('Enter')
      await expect(guncel).toBeInViewport({ ratio: 1 })
      const g = (await guncel.boundingBox())!
      const ka = (await alan.locator('xpath=..').boundingBox())!
      expect(g.y + g.height, 'eşleşme yazı alanının dışında').toBeLessThanOrEqual(ka.y + ka.height)
      expect(g.y, 'eşleşme bul panelinin altında kaldı').toBeGreaterThanOrEqual(pk.y + pk.height)
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
      expect(await sayfaKaymasi(page), 'bul panelinde gezinince sayfa kaydı').toBe(kaydirma)

      // (e) İnceleme M5: notun BAŞINDA yukarı tekerlek sayfayı kaydırmaz
      // (yazı alanı `overscroll-contain`). Eskiden kaydırma zinciri notun
      // başından sonra sayfaya geçiyor, sayfa açılış konumundan (A6) yukarı
      // kayıyordu. Bariyer: tekerlek olayı sayfaya ulaştı ve ardından iki
      // kare çizildi (kaydırma o karelerde başlar). Dinleyici pencerede:
      // olay kaydırmadan SONRA hedeflenir; sayfa kayarsa imlecin altındaki
      // öğe artık yazı alanı olmayabilir (ölçüldü, 1024x680).
      await notuKaydir(alan, 0)
      const ya = (await alan.locator('xpath=..').boundingBox())!
      await page.evaluate(() => {
        ;(window as unknown as { tekerlekIslendi: Promise<void> }).tekerlekIslendi = new Promise<void>((coz) => {
          window.addEventListener('wheel', () => requestAnimationFrame(() => requestAnimationFrame(() => coz())), {
            once: true,
            passive: true,
            capture: true,
          })
        })
      })
      await page.mouse.move(ya.x + ya.width / 3, ya.y + ya.height / 2)
      await page.mouse.wheel(0, -400)
      await page.evaluate(() => (window as unknown as { tekerlekIslendi: Promise<void> }).tekerlekIslendi)
      expect(await sayfaKaymasi(page), 'notun başında yukarı tekerlek sayfayı kaydırdı').toBe(kaydirma)

      // (f) İnceleme M2: kısa pencerede, randevu formu açıkken sayfa
      // editörün ÜSTÜNÜ geçecek kadar kayabilir (yazı alanının asgarisi +
      // çubuk pencereden uzun). Yapışkan bir çubuk (şablonun kuralı) orada
      // pencerenin tepesine yapışıp yazının üst satırlarını örterdi; akıştaki
      // çubuk sayfayla yukarı çıkar. 1024x680 / 1200x760'ta form açıkken
      // sayfanın en altında bile çubuk ekranda kalıyor (ölçüldü: 251 px):
      // yapışkanlık orada görünmez, bu yüzden pencere 360 px'e kısaltılır.
      await page.setViewportSize({ width: boyut.width, height: 360 })
      await bolum.getByRole('button', { name: 'Randevuyu düzenle', exact: true }).click()
      await expect(page.locator('#seans-randevu-formu')).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight - window.scrollY))
        .toBeLessThan(1)
      const editorKoku = (await alan.locator('xpath=ancestor::div[contains(@class, "not-editoru")][1]').boundingBox())!
      const yk = (await alan.locator('xpath=..').boundingBox())!
      expect(editorKoku.y, 'ön koşul: sayfa editörün üstünü geçmedi').toBeLessThan(0)
      expect(yk.y + yk.height, 'ön koşul: yazı alanı ekranda değil').toBeGreaterThan(80)
      const kc = (await cubuk.boundingBox())!
      expect(kc.y + kc.height, 'kaydırılmış sayfada araç çubuğu yazı alanına biniyor').toBeLessThanOrEqual(yk.y + 0.5)
      const tepedeki = await page.evaluate(
        ([x, y]) => {
          const e = document.elementFromPoint(x, y)
          if (e === null) return 'hiçbir şey'
          if (e.closest('[role="toolbar"]') !== null) return 'araç çubuğu'
          return e.closest('.ProseMirror') !== null ? 'not' : e.tagName
        },
        [yk.x + 24, Math.max(yk.y, 0) + 4],
      )
      expect(tepedeki, 'kaydırılmış sayfada yazı alanının tepesinde not içeriği yok').toBe('not')
      await bolum.getByRole('button', { name: 'Kapat', exact: true }).click()
      await expect(page.locator('#seans-randevu-formu')).toHaveCount(0)
      await page.setViewportSize(boyut)
      await page.evaluate((y) => window.scrollTo(0, y), kaydirma)
      await expect.poll(() => sayfaKaymasi(page)).toBe(kaydirma)
      const kaydedildi = page.getByRole('status').filter({ hasText: /^Kaydedildi \d{2}:\d{2}$/ })
      await expect(kaydedildi).toBeVisible()

      // Özel Notlarım: aynı editör, aynı davranış.
      await bolum.getByRole('tab', { name: 'Özel Notlarım', exact: true }).click()
      const ozel = page.getByLabel('Özel notum', { exact: true })
      await expect(ozel).toBeVisible()
      await uzunNotYapistir(ozel)
      expect(await sayfaKaymasi(page), 'özel nota yapıştırınca sayfa kaydı').toBe(kaydirma)
      await cubukNotuOrtmez(page, ozel, `${boyut.width}x${boyut.height} özel not`, kaydirma)
      await expect(bolum.getByRole('group', { name: 'Seans durumu', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(kaydedildi).toBeVisible()

      // --- Danışan dosyası: aynı editör, sütununun içinde ---
      await bolum.getByRole('button', { name: `${ad} dosyasını aç`, exact: true }).click()
      await expect(page.getByRole('heading', { level: 2, name: ad, exact: true })).toBeVisible()
      const dosyaAlani = page.getByLabel('Seans notu', { exact: true })
      await expect(dosyaAlani).toContainText('Paragraf 60:')
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect.poll(() => sayfaKaymasi(page)).toBe(0)
      await cubukNotuOrtmez(page, dosyaAlani, `${boyut.width}x${boyut.height} danışan dosyası`, 0)
      await etiketSatiriYaziAlanininAltinda(page, dosyaAlani, `${boyut.width}x${boyut.height} danışan dosyası`)
      // Not sütunu ekranın kalanını doldurur (yalnızca 16rem'lik asgarisinde
      // durmaz): alt kenarı pencerenin alt kenarına 40 px'ten yakın.
      const sutun = (await page.getByTestId('seans-notu-sutunu').boundingBox())!
      expect(sutun.y + sutun.height, 'not sütunu ekranın kalanını doldurmuyor').toBeGreaterThan(boyut.height - 40)
      // 1200x760'da sütunun tamamı (etiket ve durum satırı dahil) sayfa
      // kaymadan ekranda. 1024x680'de üç satırlık araç çubuğu + 16rem
      // asgari yazı alanı sığmaz: sayfa ~50 px kayar (bkz. `DanisanDosyasi`).
      if (boyut.width >= 1200) {
        await expect(page.getByRole('group', { name: 'Seans durumu', exact: true })).toBeInViewport({ ratio: 1 })
        await expect(page.getByLabel('Etiket ekle', { exact: true })).toBeInViewport({ ratio: 1 })
      }
    })
  }
})

// İnceleme I1 (2026-09-27): bul panelinde bulunan eşleşme GÖRÜNÜR. Eskiden
// eşleşmenin PARAGRAFI `block: 'nearest'` ile kaydırılıyordu ve panel
// açıkken yazı alanının üst 15rem'i (`scroll-pt-60`, panelden büyük) kaydırma
// hedefi sayılmadığından görünen şerit dardı (not sayfasında 1024x680'de
// 80 px, danışan dosyasında ~16 px). Görünen şeritten uzun bir paragrafta
// `nearest` paragrafın YAKIN kenarını hizalar: aşağıdaki eşleşme paragrafın
// sonundaysa şeridin altında, yukarıdaki eşleşme paragrafın başındaysa
// şeridin üstünde (panelin altında) kalıyordu. İki yön, iki sayfa, iki boy:
// güncel eşleşmenin kutusu görünen yazı alanının (yazı alanı ∩ pencere)
// içinde ve bul panelinin alt kenarının altında; sayfa kaymaz.
test.describe('bul paneli: bulunan eslesme yazi alaninda gorunur, panelin altinda kalmaz', () => {
  test.use({ reducedMotion: 'reduce' })

  const CUMLE = 'Danışan bu hafta uyku düzeninin bozulduğunu ve işte dikkatini toplamakta zorlandığını anlattı.'
  const kisalar = (bas: number) => Array.from({ length: 20 }, (_, i) => `<p>Kısa paragraf ${bas + i}.</p>`).join('')
  /**
   * Kısa paragraflar arasında iki uzun (en az altı satırlık) paragraf.
   * ASAGIHEDEF birincinin SONUNDA (not baştayken aşağıda), YUKARIHEDEF
   * ikincinin BAŞINDA (not sondayken yukarıda): eski kodun en kötü durumu.
   */
  const BELGE =
    kisalar(1) +
    `<p>${Array(12).fill(CUMLE).join(' ')} ASAGIHEDEF</p>` +
    kisalar(21) +
    `<p>YUKARIHEDEF ${Array(12).fill(CUMLE).join(' ')}</p>` +
    kisalar(41)

  /** Güncel eşleşmenin görünürlük sorunları (boş liste = görünür). */
  function sorunlar(alan: Locator): Promise<string[]> {
    return alan.evaluate((el) => {
      const g = el.querySelector('.find-and-replace-result-current')
      if (g === null) return ['güncel eşleşme yok']
      const e = g.getBoundingClientRect()
      const k = el.parentElement!.getBoundingClientRect()
      const p = document.querySelector('[role="dialog"][aria-label="Bul ve değiştir"]')!.getBoundingClientRect()
      const ust = Math.max(k.top, 0)
      const alt = Math.min(k.bottom, window.innerHeight)
      const liste: string[] = []
      if (e.top < ust - 0.5) liste.push(`eşleşme görünen yazı alanının üstünde (${e.top} < ${ust})`)
      if (e.bottom > alt + 0.5) liste.push(`eşleşme görünen yazı alanının altında (${e.bottom} > ${alt})`)
      if (e.top < p.bottom - 0.5) liste.push(`eşleşme bul panelinin altında kaldı (${e.top} < ${p.bottom})`)
      return liste
    })
  }

  /**
   * Bul panelini açar; not BAŞTAYKEN aşağıdaki, not SONDAYKEN yukarıdaki
   * eşleşmeyi arar. Eşleşmeye gitme bir kare sonra kaydırır: koşul
   * sağlanana kadar beklenir (eski davranışta hiç sağlanmaz).
   */
  async function asagiVeYukariBul(page: Page, alan: Locator, yer: string, kaydirma: number) {
    const icerik = alan.locator('xpath=..')
    const cubuk = page.getByRole('toolbar', { name: 'Biçim araçları', exact: true })
    await cubuk.getByRole('button', { name: 'Bul ve değiştir', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Bul ve değiştir', exact: true })
    await expect(panel).toBeInViewport({ ratio: 1 })
    const bul = panel.getByLabel('Bul', { exact: true })
    const guncel = alan.locator('.find-and-replace-result-current')

    for (const { terim, yon, oran } of [
      { terim: 'ASAGIHEDEF', yon: 'aşağı', oran: 0 },
      { terim: 'YUKARIHEDEF', yon: 'yukarı', oran: 1 },
    ]) {
      const paragraf = alan.locator('p', { hasText: terim })
      await icerik.evaluate((el, oran) => {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * oran
      }, oran)
      // ÖN KOŞUL: paragraf en az altı satır ve arama başlarken görünen
      // alanın tamamen dışında (aşağıda / yukarıda).
      const pk = (await paragraf.boundingBox())!
      const kk = (await icerik.boundingBox())!
      expect(pk.height, `${yer}: paragraf altı satırdan kısa`).toBeGreaterThanOrEqual(6 * 25.6)
      if (yon === 'aşağı') expect(pk.y, `${yer}: ön koşul, paragraf aşağıda değil`).toBeGreaterThan(kk.y + kk.height)
      else expect(pk.y + pk.height, `${yer}: ön koşul, paragraf yukarıda değil`).toBeLessThan(kk.y)

      await bul.fill(terim)
      await expect(guncel).toHaveText(terim)
      await expect.poll(() => sorunlar(alan), { message: `${yer}: ${yon} aranan eşleşme görünmüyor` }).toEqual([])
      expect(await page.evaluate(() => window.scrollY), `${yer}: ${yon} ararken sayfa kaydı`).toBe(kaydirma)
    }
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  }

  for (const [sira, boyut] of [
    { width: 1024, height: 680 },
    { width: 1200, height: 760 },
  ].entries()) {
    test(`${boyut.width}x${boyut.height}: not sayfasi ve danisan dosyasinda asagi ve yukari aranan eslesme gorunur`, async ({ page }, testBilgisi) => {
      await page.setViewportSize(boyut)
      await kurulumYap(page)
      // Tekrar koşulabilir (`--repeat-each`): ad ve saat tekrar başına ayrı.
      const tekrar = testBilgisi.repeatEachIndex
      const ad = `Yerlesim Bul ${sira + 1}.${tekrar}`
      await danisanEkle(page, ad)
      await randevuOlustur(page, ad, ['10:00', '12:00', '14:00', '16:00', '18:00'][tekrar % 5], '400')

      // --- Takvimdeki not sayfası ---
      await page.locator('button[data-durum]', { hasText: ad }).click()
      const bolum = page.getByTestId('seans-bolumu')
      const alan = page.getByLabel('Seans notu', { exact: true })
      await expect(alan).toBeVisible()
      // BARİYER: açılış kaydırması (A6) bitti.
      await expect.poll(async () => Math.round((await bolum.boundingBox())?.y ?? -1)).toBe(8)
      const kaydirma = await page.evaluate(() => window.scrollY)
      await notaYapistir(alan, BELGE, 'Kısa paragraf 60.')
      await asagiVeYukariBul(page, alan, `${boyut.width}x${boyut.height} not sayfası`, kaydirma)
      await expect(page.getByRole('status').filter({ hasText: /^Kaydedildi \d{2}:\d{2}$/ })).toBeVisible()

      // --- Danışan dosyası: aynı not, sütununun içinde ---
      await bolum.getByRole('button', { name: `${ad} dosyasını aç`, exact: true }).click()
      await expect(page.getByRole('heading', { level: 2, name: ad, exact: true })).toBeVisible()
      const dosyaAlani = page.getByLabel('Seans notu', { exact: true })
      await expect(dosyaAlani).toContainText('Kısa paragraf 60.')
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      await asagiVeYukariBul(page, dosyaAlani, `${boyut.width}x${boyut.height} danışan dosyası`, 0)
    })
  }
})

// İnceleme M1 (2026-09-27): danışan dosyasının not sütunu ekranın kalanını
// sütunun ÖLÇÜLEN üst kenarından doldurur (`DanisanDosyasi`). Eski sabit
// (`13rem` = kısa adla ölçülen 191 px + 16 px) başlığın yüksekliğini sabit
// sayıyordu; iki satıra kırılan uzun ad ve borç özetiyle sütun pencerenin
// altına taşıyor, durum satırı için sayfa kaydırmak gerekiyordu (ölçüldü:
// 1200x760'ta sütun 219–771).
test('1200x760: uzun kirilan ad ve borc ozetiyle danisan dosyasinda durum satiri sayfa kaymadan gorunur', async ({ page }, testBilgisi) => {
  await page.setViewportSize({ width: 1200, height: 760 })
  await kurulumYap(page)
  // En çok 120 karakter (`AZAMI_AD_UZUNLUGU`); geniş büyük harfler 1200
  // px'te iki satıra kırılır. Tekrar koşulabilir: ad ve saat tekrar başına.
  const tekrar = testBilgisi.repeatEachIndex
  const ad = `${'MEHMET ŞÜKRÜ WAGNER KARAMUSTAFAOĞLU '.repeat(3)}${tekrar}`
  await danisanEkle(page, ad)
  await randevuOlustur(page, ad, ['17:00', '19:00', '20:00'][tekrar % 3], '400')

  // Seans "Geldi", ödenmedi: dosya özetinde borç.
  await page.locator('button[data-durum]', { hasText: ad }).click()
  const bolum = page.getByTestId('seans-bolumu')
  const geldi = bolum.getByRole('group', { name: 'Seans durumu', exact: true }).getByRole('button', { name: 'Geldi', exact: true })
  await geldi.click()
  await expect(geldi).toHaveAttribute('aria-pressed', 'true')

  await bolum.getByRole('button', { name: `${ad} dosyasını aç`, exact: true }).click()
  const baslik = page.getByRole('heading', { level: 2, name: ad, exact: true })
  await expect(baslik).toBeVisible()
  await expect(page.getByTestId('dosya-ozeti')).toContainText('Ödenmemiş')
  await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
  // ÖN KOŞUL: ad gerçekten kırıldı (tek satır ~28 px).
  expect((await baslik.boundingBox())!.height, 'ön koşul: ad iki satıra kırılmadı').toBeGreaterThan(40)

  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  const sutun = page.getByTestId('seans-notu-sutunu')
  await expect(sutun.getByRole('group', { name: 'Seans durumu', exact: true })).toBeInViewport({ ratio: 1 })
  await expect(sutun.getByLabel('Etiket ekle', { exact: true })).toBeInViewport({ ratio: 1 })
  // Sütun yine ekranın kalanını doldurur (asgarisinde durmaz) ve ekranın içinde.
  const s = (await sutun.boundingBox())!
  expect(s.y + s.height, 'not sütunu ekranın kalanını doldurmuyor').toBeGreaterThan(760 - 40)
  expect(s.y + s.height, 'not sütunu pencerenin altına taşıyor').toBeLessThanOrEqual(760)
})
