import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * Danışan listesi ve dosyası (tasarım 2026-09-24 §6 B1–B3) uçtan uca.
 *
 * Birim testleri jsdom'da yerleşim ÖLÇEMEZ. Yapışkan ay başlığı, listenin
 * kendi içinde kayması, notun görünür kalması ve "satırı görünür alana
 * getirme" yalnızca burada, gerçek tarayıcıda ölçülür.
 *
 * # Saat
 *
 * B2/B3 senaryoları TARAYICININ saatini `page.clock.setFixedTime` ile
 * Perşembe 24 Eylül 2026 12:00'a (yerel) sabitler. Özet ("Son",
 * "Sıradaki") ve "Yaklaşan" gerçek saate bağlı kalsaydı test tarihe göre
 * değişirdi. Zamanlayıcılar işler, `Date` sabittir. Sunucunun saati
 * değişmez: randevular API'yle, açık tarihlerle kurulur ve bu senaryolarda
 * sunucu saate bakan bir karar vermez.
 *
 * # Paylaşılan sunucu
 *
 * Dosya kendi sunucusunda ve veri dizininde koşar (port 7709). Testler
 * sırayla koşar; her test kendi danışanını kurar. API'yle eklenen danışan
 * ekrandaki listeye ancak liste yeniden çekilince girer (açılışta çekilir):
 * `dosyayiAc` sayfayı yeniden açar.
 *
 * # Yerleşim (preflight D1/D3)
 *
 * Seans listesi sütunu `sticky top-0 max-h-[100dvh]` (tasarım B3'ün
 * sözü) ve 1280×720'de sayfanın 191 px aşağısında başlar (ölçüldü): açılışta
 * alt ucu pencerenin altında kalır, sayfa en çok 223 px kayar. Dipteki
 * satırı ölçen test önce sütunu pencerenin tepesine getirir (sayfayı
 * kaydırır), sonra iç kaydırmayı yapar. Dipteki satıra giden B2 bağlantısı
 * da (`nearest`) sayfayı bu yüzden kaydırır.
 */

// Yumuşak kaydırma (`index.css`, hareketi azaltma tercihi yoksa) konum
// ölçümlerini animasyon boyunca oynatırdı; ölçen testler anlık kaydırma ister.
test.use({ reducedMotion: 'reduce' })

/** B2/B3 senaryolarının "şimdi"si: Perşembe 24 Eylül 2026 12:00 (yerel). */
const SIMDI = new Date(2026, 8, 24, 12, 0)

const BILGI = 'Arşivlenmiş danışanlar bu listede aranmaz; ⌘K hızlı arama arşivi de tarar.'

async function danisanlaraGec(page: Page) {
  await page.getByRole('tab', { name: 'Danışanlar', exact: true }).click()
}

function aramaKutusu(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Danışan ara', exact: true })
}

function acmaDugmeleri(page: Page): Locator {
  return page.getByTestId('danisan-listesi-sutunu').getByRole('button', { name: /dosyasını aç$/ })
}

async function dosyaYuklendi(page: Page, ad: string) {
  await expect(page.getByRole('heading', { level: 2, name: ad, exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="seans-listesi"][data-yuklendi="evet"]')).toBeVisible()
}

/** Danışanı FORMLA ekler (B1: imleç ad alanında, Enter kaydeder, dosya açılır). */
async function formlaEkle(page: Page, ad: string) {
  await page.getByRole('button', { name: 'Danışan ekle', exact: true }).click()
  const adAlani = page.getByLabel('Ad soyad', { exact: true })
  await expect(adAlani).toBeFocused()
  await adAlani.fill(ad)
  await adAlani.press('Enter')
  await dosyaYuklendi(page, ad)
}

/** Listede tarih metni tam eşleşen satır düğmesi. */
function satir(liste: Locator, tarih: string): Locator {
  return liste.getByRole('button').filter({ has: liste.page().getByText(tarih, { exact: true }) })
}

/**
 * Satırın sol üst köşesinin hemen İÇİNDEKİ noktada (+4, +4) en üstte ne var?
 * `'satir'`: satırın kendisi ya da bir çocuğu. Aksi hâlde o noktayı örten
 * başlığın metni (ya da öğenin etiketi). Yapışkan başlıklar opak (`bg-white`)
 * ve `z-10`: satırın üstüne binen başlık bu noktayı alır. Satır görünür
 * alanın dışındaysa `elementFromPoint` satırı bulamaz, sonuç `'satir'`
 * OLMAZ (kaydırma bitmeden iddia tatmin olmaz).
 */
function ustKenarindaNeVar(satirDugmesi: Locator): Promise<string> {
  return satirDugmesi.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const isabet = document.elementFromPoint(r.left + 4, r.top + 4)
    if (isabet === null) return 'hiçbir şey'
    if (el.contains(isabet)) return 'satir'
    return isabet.closest('h3')?.textContent ?? isabet.tagName
  })
}

async function danisanOlustur(request: APIRequestContext, ad: string): Promise<number> {
  const yanit = await request.post('/api/danisanlar', { data: { ad_soyad: ad } })
  expect(yanit.status()).toBe(201)
  return ((await yanit.json()) as { id: number }).id
}

type Kayit = { id: number; baslangic: string }

async function randevuOlustur(
  request: APIRequestContext,
  govde: { client_id: number; baslangic: string; bitis: string; ucret: number | null; tekrar_sayisi?: number },
): Promise<Kayit[]> {
  const yanit = await request.post('/api/randevular', { data: govde })
  expect(yanit.status()).toBe(201)
  return (await yanit.json()) as Kayit[]
}

async function durumYaz(request: APIRequestContext, id: number, durum: string) {
  const yanit = await request.patch(`/api/randevular/${id}`, { data: { durum } })
  expect(yanit.status()).toBe(200)
}

async function odendiYaz(request: APIRequestContext, id: number) {
  const yanit = await request.patch(`/api/randevular/${id}/odeme`, { data: { odendi: true } })
  expect(yanit.status()).toBe(204)
}

/**
 * Uzun geçmiş (SIMDI = 24 Eylül 2026 12:00'a göre):
 *  - 3 Mart – 8 Eylül her salı 10:00, 28 seans (tek seri), hepsi "geldi";
 *    8 Eylül HARİÇ hepsi ödendi.
 *  - 15 Eylül "gelmedi", ücretli, ödenmemiş (borca girer, §5.1).
 *  - 22 Eylül planlı: bitmiş, işaretlenmemiş.
 *  - 1 ve 8 Ekim 14:00 planlı (Yaklaşan).
 * Beklenen özet: "28. seans · Mart 2026'dan beri · Son: 8 Eylül · Sıradaki:
 * Perşembe 1 Ekim 14:00 · Ödenmemiş: 1.800,00 TL (+1 işaretlenmemiş)".
 * Ay grupları: Eylül 2 · Ağustos 4 · Temmuz 4 · Haziran 5 · Mayıs 4 ·
 * Nisan 4 · Mart 5 seans.
 */
async function uzunGecmisKur(request: APIRequestContext, ad: string) {
  const id = await danisanOlustur(request, ad)
  const seri = await randevuOlustur(request, {
    client_id: id, baslangic: '2026-03-03T10:00', bitis: '2026-03-03T10:50', ucret: 90000, tekrar_sayisi: 28,
  })
  expect(seri).toHaveLength(28)
  for (const r of seri) {
    await durumYaz(request, r.id, 'geldi')
    if (r.baslangic !== '2026-09-08T10:00') await odendiYaz(request, r.id)
  }
  const [gelmedi] = await randevuOlustur(request, {
    client_id: id, baslangic: '2026-09-15T10:00', bitis: '2026-09-15T10:50', ucret: 90000,
  })
  await durumYaz(request, gelmedi.id, 'gelmedi')
  for (const [baslangic, bitis] of [
    ['2026-09-22T10:00', '2026-09-22T10:50'],
    ['2026-10-01T14:00', '2026-10-01T14:50'],
    ['2026-10-08T14:00', '2026-10-08T14:50'],
  ]) {
    await randevuOlustur(request, { client_id: id, baslangic, bitis, ucret: 90000 })
  }
}

/** Sayfayı yeniden açar (liste yeniden çekilir) ve danışanın dosyasını açar. */
async function dosyayiAc(page: Page, ad: string) {
  await kurulumYap(page)
  await danisanlaraGec(page)
  await page.getByRole('button', { name: `${ad} dosyasını aç`, exact: true }).click()
  await dosyaYuklendi(page, ad)
}

// ---------------------------------------------------------------------------

test('B1: arama Turkce harf duyarsiz suzer ve istek atmaz; oklar ve Enter dosyayi acar; Esc temizler; imlec kendiliginden gelmez', async ({ page }) => {
  await kurulumYap(page)
  await danisanlaraGec(page)
  const kutu = aramaKutusu(page)
  await expect(kutu).toBeVisible()
  await expect(kutu).not.toBeFocused()
  for (const ad of ['İpek Işık', 'Ipek Sahin', 'Ayşe Kaya']) await formlaEkle(page, ad)

  // Süzme sunucuya GİTMEZ (tasarım B1, §8). Ana pencere yoklama yapmaz;
  // bariyer (`dosyaYuklendi`) son dosyanın isteklerinin bittiğini gösterir.
  const apiIstekleri: string[] = []
  page.on('request', (istek) => {
    if (new URL(istek.url()).pathname.startsWith('/api/')) apiIstekleri.push(istek.url())
  })

  await kutu.fill('IŞIK')
  await expect(acmaDugmeleri(page)).toHaveText(['İpek Işık'])
  await kutu.fill('ipek')
  await expect(acmaDugmeleri(page)).toHaveCount(2)
  expect((await acmaDugmeleri(page).allTextContents()).sort()).toEqual(['Ipek Sahin', 'İpek Işık'])
  expect(apiIstekleri).toEqual([])

  // Yazınca ilk eşleşme vurgulu; ↓ ikinciye geçer; Enter onu açar.
  const sira = await acmaDugmeleri(page).allTextContents()
  await kutu.press('ArrowDown')
  const vurgulu = page.locator('li[data-vurgulu="evet"]').getByRole('button', { name: /dosyasını aç$/ })
  await expect(vurgulu).toHaveText(sira[1])
  await kutu.press('Enter')
  await dosyaYuklendi(page, sira[1])
  await expect(kutu).toBeFocused()

  await kutu.press('Escape')
  await expect(kutu).toHaveValue('')
  expect(await acmaDugmeleri(page).count()).toBeGreaterThanOrEqual(3)
  await expect(page.locator('li[data-vurgulu="evet"]')).toHaveCount(0)
})

test('B1: eslesme yoksa kisayol formu o adla acar, imlec ad alaninda; Esc kapatir; Enter kaydeder ve dosya acilir', async ({ page }) => {
  await kurulumYap(page)
  await danisanlaraGec(page)
  const kutu = aramaKutusu(page)
  await kutu.fill('Işıl Çağrı')
  await expect(page.getByText(BILGI, { exact: true })).toBeVisible()
  const kisayol = page.getByRole('button', { name: "'Işıl Çağrı' adıyla yeni danışan ekle", exact: true })

  await kisayol.click()
  const adAlani = page.getByLabel('Ad soyad', { exact: true })
  await expect(adAlani).toHaveValue('Işıl Çağrı')
  await expect(adAlani).toBeFocused()
  await adAlani.press('Escape')
  await expect(adAlani).toHaveCount(0)

  await kisayol.click()
  await expect(adAlani).toBeFocused()
  await adAlani.press('Enter')
  await dosyaYuklendi(page, 'Işıl Çağrı')
  await expect(kutu).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Işıl Çağrı dosyasını aç', exact: true })).toHaveAttribute('aria-current', 'true')
})

test('B2+B3: ozet satiri, katli Yaklasan, ay basliklari ve #numara; baglantilar secer, grubu acar, gorunur alana getirir', async ({ page, request }) => {
  await page.clock.setFixedTime(SIMDI)
  await kurulumYap(page)
  const ad = 'Kübra Öztürk'
  await uzunGecmisKur(request, ad)
  await dosyayiAc(page, ad)

  const ozet = page.getByTestId('dosya-ozeti')
  await expect(ozet).toHaveText(
    "28. seans · Mart 2026'dan beri · Son: 8 Eylül · Sıradaki: Perşembe 1 Ekim 14:00 · Ödenmemiş: 1.800,00 TL (+1 işaretlenmemiş)",
  )

  const liste = page.getByTestId('seans-listesi')
  const yaklasan = liste.getByRole('button', { name: 'Yaklaşan (2)', exact: true })
  await expect(yaklasan).toHaveAttribute('aria-expanded', 'false')
  await expect(liste.getByText('1 Ekim 2026, 14:00', { exact: true })).toHaveCount(0)
  // Varsayılan seçim: geçmişteki en yeni (22 Eylül, bitmiş, işaretlenmemiş).
  // (Playwright `getByRole`'da `current` seçeneği yok; öznitelikle aranır.)
  await expect(liste.locator('button[aria-current="true"]')).toContainText('22 Eylül 2026, 10:00')
  await expect(liste.getByRole('heading', { name: 'Eylül 2026 · 2 seans', exact: true })).toBeVisible()
  await expect(liste.getByRole('heading', { name: 'Ağustos 2026 · 4 seans', exact: true })).toHaveCount(1)
  await expect(liste.getByRole('heading', { name: 'Mart 2026 · 5 seans', exact: true })).toHaveCount(1)
  await expect(satir(liste, '8 Eylül 2026, 10:00').getByTestId('seans-numarasi')).toHaveText('#28')
  await expect(satir(liste, '3 Mart 2026, 10:00').getByTestId('seans-numarasi')).toHaveText('#1')
  await expect(satir(liste, '15 Eylül 2026, 10:00').getByTestId('seans-numarasi')).toHaveCount(0)

  // "…'dan beri" → listenin DİBİNDEKİ ilk seans seçilir ve görünür alana gelir.
  await ozet.getByRole('button', { name: "Mart 2026'dan beri", exact: true }).click()
  const mart = satir(liste, '3 Mart 2026, 10:00')
  await expect(mart).toHaveAttribute('aria-current', 'true')
  await expect(mart).toBeInViewport()
  await expect(yaklasan).toHaveAttribute('aria-expanded', 'false')

  // "Sıradaki" → liste dipteyken EN ÜSTTEKİ katlı grup açılır, satır görünür.
  await ozet.getByRole('button', { name: 'Sıradaki: Perşembe 1 Ekim 14:00', exact: true }).click()
  await expect(yaklasan).toHaveAttribute('aria-expanded', 'true')
  const ekim = satir(liste, '1 Ekim 2026, 14:00')
  await expect(ekim).toHaveAttribute('aria-current', 'true')
  await expect(ekim).toBeInViewport()
  await expect(ekim).not.toContainText('Not yazılmamış')
  // Yukarı kaydırmada satırın üstü "Yaklaşan" başlığının ALTINDA kalmaz
  // (`scroll-mt-7`; Görev 4 düzeltmesi). Pay 28 px, bu başlık ≈24 px: en dar yer.
  await expect.poll(() => ustKenarindaNeVar(ekim)).toBe('satir')

  // Bilgiler: özet orada da; "Ödenmemiş" bakiyeyle aynı; "Son" Seanslar'a döner.
  await page.getByRole('tab', { name: 'Bilgiler', exact: true }).click()
  await expect(ozet).toContainText('Ödenmemiş: 1.800,00 TL')
  await expect(page.locator('dt', { hasText: /^Bakiye$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('1.800,00 TL')
  await ozet.getByRole('button', { name: 'Son: 8 Eylül', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Seanslar', exact: true })).toHaveAttribute('aria-selected', 'true')
  const son = satir(page.getByTestId('seans-listesi'), '8 Eylül 2026, 10:00')
  await expect(son).toHaveAttribute('aria-current', 'true')
  await expect(son).toBeInViewport()
})

test('B3: seans listesi kendi icinde kayar, ay basligi yapiskan, not gorunur kalir; B1 sol kolon da kendi icinde kayar', async ({ page, request }) => {
  await page.clock.setFixedTime(SIMDI)
  await kurulumYap(page)
  const ad = 'Selin Ünal'
  await uzunGecmisKur(request, ad)
  await dosyayiAc(page, ad)

  const solSutun = page.getByTestId('danisan-listesi-sutunu')
  expect(
    await solSutun.evaluate((el) => {
      const s = getComputedStyle(el)
      return [s.position, s.overflowY, s.maxHeight !== 'none']
    }),
  ).toEqual(['sticky', 'auto', true])

  const sutun = page.getByTestId('seans-listesi-sutunu')
  const liste = page.getByTestId('seans-listesi')
  const editor = page.getByLabel('Seans notu', { exact: true })
  await expect(editor).toBeVisible()

  // Açılışta seçili satır (22 Eylül) zaten görünür: `block: 'nearest'`
  // sayfayı KIPIRDATMAZ (preflight D4: efekt her monte oluşta çalışır;
  // görünen satır için hiçbir şeyi oynatmamalı). Bariyer: not editörü
  // seçimden SONRA gelen yanıtla çizilir ve yukarıda görünür; kaydırma
  // efekti o çizimden önce koşmuştur.
  const secili = liste.locator('button[aria-current="true"]')
  await expect(secili).toContainText('22 Eylül 2026, 10:00')
  await expect(secili).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  // ÖN KOŞUL: liste gerçekten taşıyor (kısa listede iç kaydırma hiçbir şey ölçmezdi).
  expect(await sutun.evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true)

  // Sütun önce pencerenin tepesine getirilir (preflight D1; bkz. dosya
  // başlığı "Yerleşim"): sayfa sütunun üst kenarına kadar kayar. ÖN KOŞUL:
  // sütunun üst kenarı pencerenin tepesinde, alt ucu pencerenin içinde.
  await sutun.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await expect.poll(async () => Math.round((await sutun.boundingBox())?.y ?? 999)).toBe(0)
  const sayfaKaydirmasi = await page.evaluate(() => window.scrollY)

  // Liste dibe kayar: en eski satır görünür, sayfa KAYMAZ, not yerinde.
  await sutun.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(satir(liste, '3 Mart 2026, 10:00')).toBeInViewport()
  await expect(editor).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(sayfaKaydirmasi)

  // Yapışkan ay başlığı: Haziran'ın İKİNCİ satırı (23 Haziran; ay içinde
  // en yeni üstte) kabın tepesine gelince "Haziran" başlığı kabın tepesinde
  // durur; ilk satır (30 Haziran) kabın üstünde kalmıştır (ön koşul:
  // yapışkan olmasaydı başlık da onunla gizlenirdi). Nisan DEĞİL: Nisan ve
  // Mart listenin son 720 px'inde (bir kap boyu); dipteki kap daha aşağı
  // kayamaz, Nisan'ın satırı tepeye hiç gelemez (ölçüldü: `scrollTop` en
  // büyük değerinde, 1088, kalıyordu).
  await satir(liste, '23 Haziran 2026, 10:00').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  const haziran = liste.getByRole('heading', { name: 'Haziran 2026 · 5 seans', exact: true })
  await expect
    .poll(async () => {
      const [b, s] = [await haziran.boundingBox(), await sutun.boundingBox()]
      return b !== null && s !== null ? Math.round(Math.abs(b.y - s.y)) : 999
    })
    .toBeLessThanOrEqual(1)
  const ilkHaziran = await satir(liste, '30 Haziran 2026, 10:00').boundingBox()
  const kap = await sutun.boundingBox()
  expect(ilkHaziran!.y).toBeLessThan(kap!.y)

  // B2 bağlantısı listeyi YUKARI kaydırır ("Son: 8 Eylül", Eylül'ün üçüncü
  // satırı): `nearest` satırın üstünü (payıyla) kabın tepesine koyar; ayın
  // yapışkan başlığı oraya yapışıktır. Satırın `scroll-mt-7` payı olmasa
  // başlık tarih, #n ve durumun üstüne binerdi (Görev 4 düzeltmesi).
  await page.getByTestId('dosya-ozeti').getByRole('button', { name: 'Son: 8 Eylül', exact: true }).click()
  const son = satir(liste, '8 Eylül 2026, 10:00')
  await expect(son).toHaveAttribute('aria-current', 'true')
  await expect(son).toBeInViewport()
  await expect.poll(() => ustKenarindaNeVar(son)).toBe('satir')
  // ÖN KOŞUL: Eylül başlığı o anda kabın tepesine yapışık (yoksa örtme
  // hiç sınanmamış olurdu).
  const eylul = await liste.getByRole('heading', { name: 'Eylül 2026 · 2 seans', exact: true }).boundingBox()
  const kapSimdi = await sutun.boundingBox()
  expect(Math.round(Math.abs(eylul!.y - kapSimdi!.y))).toBeLessThanOrEqual(1)
})
