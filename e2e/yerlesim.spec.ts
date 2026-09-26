import { expect, test, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

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
// Danışan dosyasının editörü (`DanisanDosyasi`, yükseklik vermeyen bir
// kapta) yüzeyin kendi asgarisini (16rem) korur. jsdom yerleşim ölçmediği
// için tek bekçi gerçek tarayıcı.
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

  // Danışan dosyası: aynı editör, yükseklik vermeyen bir kapta — asgari korunur.
  await page.getByRole('button', { name: `${ad} dosyasını aç`, exact: true }).click()
  const dosyaYuzeyi = page.getByLabel('Seans notu', { exact: true })
  await expect(dosyaYuzeyi).toBeVisible()
  const d = await dosyaYuzeyi.boundingBox()
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

      // Takvimdeki not sayfası, dar önceki notlar sütunuyla.
      await izgara.getByRole('button', { name: `13:00 ${ad}`, exact: true }).click()
      await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
      const bolge = page.getByRole('region', { name: 'Önceki seans notları' })
      await expect(bolge.getByRole('listitem')).toHaveCount(1)
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
