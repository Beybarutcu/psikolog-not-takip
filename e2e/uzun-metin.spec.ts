import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * Uzun metinler kutularını taşırmaz (kullanıcı isteği 2026-09-27, "uzun
 * metinleri de"): kullanıcının yazdığı her metin — danışan adı, Bilgiler
 * alanları, ek dosya adı, etiket, notun ilk satırı, arama parçası — ya
 * kutusunun içinde satır sonunda bölünür ya da tek satırlık tasarımda üç
 * noktayla kısalır ve tam metni `title`'da taşır. Hiçbiri kutusunu, sütununu
 * ya da belgeyi yatay taşırmaz.
 *
 * Senaryo uygulamanın en dar penceresinde (1024x680, `src-tauri`) koşar:
 * boşluksuz 120 karakterlik ad, boşluksuz uzun Bilgiler alanları ve ek
 * dosya adı, 40 karakterlik etiket, ilk satırı boşluksuz uzun bir dizgi olan
 * not. Her ekranda iki ölçüm: belge yatay taşmıyor (`scrollWidth <=
 * innerWidth`) ve her öğenin kutusu kabının içinde (sağ kenar ≤ kabın sağ
 * kenarı + 1). Öğenin METNİ de kendi kutusunu taşmıyor: `scrollWidth <=
 * clientWidth`; tek istisna bilinçli kısaltma (`text-overflow: ellipsis`) ve
 * o durumda tam metin `title`'da olmalı. Kendi içinde kayan sütunlar
 * (danışan listesi, seans listesi) yatay KAYDIRMA çubuğu da açmamalı: belge
 * taşmasa da metin orada gizlenirdi.
 *
 * Tarayıcı saati Perşembe 24 Eylül 2026 07:00'a sabit (`page.clock`):
 * randevular API'yle o güne kurulur, bugün satırının "sıradaki"si ve ay
 * özeti bu tarihe göre. Sunucunun saati değişmez.
 */
test.use({ reducedMotion: 'reduce' })

const SIMDI = new Date(2026, 8, 24, 7, 0)
const UZUN_AD = 'ŞebnemÜnalKaraosmanoğlu'.repeat(6).slice(0, 120)
const UZUN_ETIKET = 'kaygıuykusuzlukdikkat'.repeat(2).slice(0, 40)
const ILK_SATIR = 'Notbaşı' + 'ç'.repeat(220)
/** Sunucu seans listesi önizlemesini 120 karakterde kırpar (`AZAMI_ONIZLEME`). */
const ONIZLEME = ILK_SATIR.slice(0, 120)
const TELEFON = '+90-(555)-123-45-67/89.01,23-45'
const BASVURU = 'Başvuru' + 'ı'.repeat(300)
const RISK = 'Risk' + 'ö'.repeat(300)
const EK_ADI = 'onam-' + 'imzaliformtaramasi'.repeat(9) + '.txt'

async function danisanOlustur(request: APIRequestContext): Promise<number> {
  const yanit = await request.post('/api/danisanlar', { data: { ad_soyad: UZUN_AD } })
  expect(yanit.status()).toBe(201)
  const id = ((await yanit.json()) as { id: number }).id
  const guncelle = await request.patch(`/api/danisanlar/${id}`, {
    data: { telefon: TELEFON, basvuru_nedeni: BASVURU, risk_notu: RISK },
  })
  expect(guncelle.status()).toBe(200)
  return id
}

async function randevuOlustur(request: APIRequestContext, clientId: number, baslangic: string, bitis: string): Promise<number> {
  const yanit = await request.post('/api/randevular', { data: { client_id: clientId, baslangic, bitis, ucret: 90000 } })
  expect(yanit.status()).toBe(201)
  return ((await yanit.json()) as Array<{ id: number }>)[0].id
}

/**
 * `oge` kabının içinde (sağ ve sol kenar, 1 px pay) ve metni kendi kutusunu
 * taşmıyor; kısaltılmışsa (`ellipsis`) tam metin `title`'da.
 */
async function icinde(ad: string, oge: Locator, kap: Locator) {
  await expect(oge, `${ad}: görünmüyor`).toBeVisible()
  const o = (await oge.boundingBox())!
  const k = (await kap.boundingBox())!
  expect.soft(o.x + o.width, `${ad}: sağ kenarı kabını aşıyor`).toBeLessThanOrEqual(k.x + k.width + 1)
  expect.soft(o.x, `${ad}: sol kenarı kabının dışında`).toBeGreaterThanOrEqual(k.x - 1)
  const metin = await oge.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      satirIci: s.display === 'inline',
      kisaltma: s.textOverflow === 'ellipsis' && s.overflowX !== 'visible',
      tasma: el.scrollWidth - el.clientWidth,
      baslik: el.getAttribute('title'),
      tam: (el.textContent ?? '').trim(),
    }
  })
  if (metin.satirIci) return
  if (metin.kisaltma) {
    expect.soft(metin.baslik, `${ad}: kısaltılmış metnin tamamı title'da değil`).toBe(metin.tam)
  } else {
    expect.soft(metin.tasma, `${ad}: metin kendi kutusunu taşıyor`).toBeLessThanOrEqual(1)
  }
}

/** Kendi içinde kayan kap yatay kaydırma çubuğu açmıyor. */
async function yatayKaymaz(ad: string, kap: Locator) {
  const { genislik, gorunen } = await kap.evaluate((el) => ({ genislik: el.scrollWidth, gorunen: el.clientWidth }))
  expect.soft(genislik, `${ad}: kabın içinde yatay taşma`).toBeLessThanOrEqual(gorunen)
}

async function belgeTasmaz(page: Page, ad: string) {
  const { genislik, pencere } = await page.evaluate(() => ({
    genislik: document.documentElement.scrollWidth,
    pencere: window.innerWidth,
  }))
  expect.soft(genislik, `${ad}: belge yatay taşıyor`).toBeLessThanOrEqual(pencere)
}

test('uzun metinler kutularini tasirmaz: liste, dosya (Seanslar + Bilgiler), takvim, not sayfasi, onceki notlar, okuma penceresi, etiketli seanslar, ay sonu ozeti, hizli arama', async ({ page, request, context }) => {
  // Tek senaryo, on ekran ve iki kilit açma (kurulum + yeniden açma): 90 sn dar.
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1024, height: 680 })
  await page.clock.setFixedTime(SIMDI)
  await kurulumYap(page)

  const id = await danisanOlustur(request)
  const onceki = await randevuOlustur(request, id, '2026-09-24T08:00', '2026-09-24T08:50')
  const bugunku = await randevuOlustur(request, id, '2026-09-24T13:00', '2026-09-24T13:50')
  // Görünen aralığın (08:00–21:00) dışında: ızgaranın üstündeki uyarı listesi.
  await randevuOlustur(request, id, '2026-09-24T21:30', '2026-09-24T22:20')
  expect((await request.patch(`/api/randevular/${onceki}`, { data: { durum: 'geldi' } })).status()).toBe(200)
  const not = await request.put(`/api/randevular/${onceki}/not`, {
    data: { sablon: 'serbest', icerik: `<p>${ILK_SATIR}</p><p>ikinci satır</p>` },
  })
  expect(not.status()).toBe(200)
  expect((await request.post(`/api/randevular/${bugunku}/etiketler`, { data: { ad: UZUN_ETIKET } })).status()).toBeLessThan(300)

  // Liste açılışta çekilir: API'yle eklenen danışan için sayfa yeniden açılır.
  await kurulumYap(page)

  // --- Danışanlar listesi ---
  await page.getByRole('tab', { name: 'Danışanlar', exact: true }).click()
  const solSutun = page.getByTestId('danisan-listesi-sutunu')
  const adDugmesi = solSutun.getByRole('button', { name: `${UZUN_AD} dosyasını aç`, exact: true })
  const satir = solSutun.getByRole('listitem').filter({ has: page.getByRole('button', { name: `${UZUN_AD} dosyasını aç`, exact: true }) })
  await icinde('liste: ad', adDugmesi, satir)
  await icinde('liste: Arşivle', satir.getByRole('button', { name: `${UZUN_AD} adlı danışanı arşivle`, exact: true }), satir)
  await icinde('liste: satır', satir, solSutun)
  await yatayKaymaz('liste sütunu', solSutun)
  await belgeTasmaz(page, 'danışanlar')

  // --- Dosya: başlık ve Seanslar ---
  await adDugmesi.click()
  const sagKolon = page.getByTestId('danisan-dosyasi-sag-kolon')
  const baslik = page.getByRole('heading', { level: 2, name: UZUN_AD, exact: true })
  await icinde('dosya: başlık', baslik, sagKolon)
  await expect(page.locator('[data-testid="seans-listesi"][data-yuklendi="evet"]')).toBeVisible()
  const seansSutunu = page.getByTestId('seans-listesi-sutunu')
  const seansListesi = page.getByTestId('seans-listesi')
  const oncekiSatir = seansListesi.getByRole('button').filter({ hasText: '24 Eylül 2026, 08:00' })
  const bugunkuSatir = seansListesi.getByRole('button').filter({ hasText: '24 Eylül 2026, 13:00' })
  await icinde('seans listesi: satır', oncekiSatir, seansSutunu)
  await icinde('seans listesi: not önizlemesi', oncekiSatir.getByText(ONIZLEME, { exact: true }), oncekiSatir)
  await icinde('seans listesi: etiket', bugunkuSatir.getByText(UZUN_ETIKET, { exact: true }), bugunkuSatir)
  await yatayKaymaz('seans listesi sütunu', seansSutunu)
  await bugunkuSatir.click()
  await expect(bugunkuSatir).toHaveAttribute('aria-current', 'true')
  const etiketSatiri = page.getByTestId('etiket-satiri')
  const cip = etiketSatiri.getByRole('listitem')
  await icinde('dosya: etiket çipi', cip, etiketSatiri)
  await icinde('dosya: etiket adı', cip.getByRole('button', { name: `${UZUN_ETIKET} etiketli seansları göster`, exact: true }), cip)
  await belgeTasmaz(page, 'dosya, Seanslar')

  // --- Dosya: Bilgiler ---
  await page.getByRole('tab', { name: 'Bilgiler', exact: true }).click()
  const bilgiler = page.getByRole('region', { name: 'Danışan bilgileri' })
  await icinde('Bilgiler: telefon', bilgiler.getByText(TELEFON, { exact: true }), bilgiler)
  await icinde('Bilgiler: başvuru nedeni', bilgiler.getByText(BASVURU, { exact: true }), bilgiler)
  await bilgiler.getByRole('button', { name: 'Risk notunu göster', exact: true }).click()
  await icinde('Bilgiler: risk notu', bilgiler.getByText(RISK, { exact: true }), bilgiler)
  await page.getByLabel('Yüklenecek dosya').setInputFiles({
    name: EK_ADI,
    mimeType: 'text/plain',
    buffer: Buffer.from('uzun adlı onam formu', 'utf-8'),
  })
  await page.getByLabel('Dosya türü').selectOption('onam')
  await page.getByRole('button', { name: 'Dosyayı yükle' }).click()
  const ekler = page.getByRole('region', { name: 'Ekli dosyalar' })
  const ekBaglantisi = ekler.getByRole('link', { name: EK_ADI, exact: true })
  await expect(ekBaglantisi).toBeVisible()
  await icinde('Bilgiler: ek dosya adı', ekBaglantisi, ekler)
  await icinde('Bilgiler: ek satırı', ekler.getByRole('listitem').filter({ has: page.getByRole('link', { name: EK_ADI, exact: true }) }), ekler)
  const onam = page.getByRole('region', { name: 'Onam' })
  const onamSecimi = page.getByLabel('İmzalı onam dosyası')
  await onamSecimi.selectOption({ label: EK_ADI })
  await icinde('Bilgiler: onam dosyası seçimi', onamSecimi, onam)
  await page.getByLabel('Açık rıza tarihi').fill('2026-09-01')
  await page.getByRole('button', { name: 'Rızayı kaydet' }).click()
  const onamBaglantisi = onam.getByRole('link', { name: `İmzalı onam belgesi: ${EK_ADI}`, exact: true })
  await expect(onamBaglantisi).toBeVisible()
  await icinde('Bilgiler: onam belgesi', onamBaglantisi, onam)
  await belgeTasmaz(page, 'dosya, Bilgiler')

  // --- Takvim: blok, bugün satırı, aralık dışı listesi ---
  await page.getByRole('tab', { name: 'Takvim', exact: true }).click()
  const izgara = page.getByTestId('takvim-izgara')
  const blok = izgara.getByRole('button', { name: `13:00 ${UZUN_AD}`, exact: true })
  await expect(blok).toBeVisible()
  await icinde('takvim: blok adı', blok.getByTestId('blok-adi'), blok)
  await icinde('takvim: blok', blok, blok.locator('xpath=ancestor::td[1]'))
  // Blok boyu süreyle sınırlı, taşan satırlar kırpılır: tam ad fareyle görünür.
  await expect.soft(blok.getByTestId('blok-adi')).toHaveAttribute('title', `13:00 ${UZUN_AD}`)
  const bugunBilgisi = page.getByTestId('bugun-bilgisi')
  await icinde('takvim: sıradaki', bugunBilgisi.getByRole('button'), bugunBilgisi)
  const disarida = page.getByRole('region', { name: 'Görünen aralık dışındaki randevular' })
  await icinde('takvim: aralık dışı', disarida.getByRole('button', { name: new RegExp(`^${UZUN_AD} — `) }), disarida)
  await belgeTasmaz(page, 'takvim')

  // --- Ay sonu özeti ---
  await page.getByRole('button', { name: 'Ay sonu özeti', exact: true }).click()
  const ozet = page.getByRole('region', { name: 'Ay sonu özeti', exact: true })
  const borclu = ozet.getByRole('button', { name: new RegExp(`^${UZUN_AD} — `) })
  await icinde('ay sonu özeti: borçlu', borclu, ozet)
  await belgeTasmaz(page, 'ay sonu özeti')
  await page.getByRole('button', { name: 'Ay sonu özeti', exact: true }).click()

  // --- Not sayfası: üst satır, önceki notlar, geniş okuma ---
  await blok.click()
  const bolum = page.getByTestId('seans-bolumu')
  await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
  const sayfaAdi = bolum.getByRole('button', { name: `${UZUN_AD} dosyasını aç`, exact: true })
  await icinde('not sayfası: danışan adı', sayfaAdi, bolum)
  await icinde('not sayfası: durum satırı', bolum.getByRole('group', { name: 'Seans durumu', exact: true }), bolum)
  // Randevu formu: danışan seçimi en uzun seçenekle genişlemez.
  await bolum.getByRole('button', { name: 'Randevuyu düzenle', exact: true }).click()
  const form = page.locator('#seans-randevu-formu')
  await icinde('randevu formu: danışan seçimi', form.getByLabel('Danışan', { exact: true }), form)
  await belgeTasmaz(page, 'randevu formu')
  await bolum.getByRole('button', { name: 'Kapat', exact: true }).click()
  await expect(form).toHaveCount(0)
  const notEtiketi = bolum.getByTestId('etiket-satiri').getByRole('listitem')
  await icinde('not sayfası: etiket çipi', notEtiketi, bolum.getByTestId('etiket-satiri'))
  const oncekiNotlar = page.getByRole('region', { name: 'Önceki seans notları' })
  const oncekiDugme = oncekiNotlar.getByRole('button', { name: /24 Eylül 2026, 08:00/ })
  await icinde('önceki notlar: satır', oncekiDugme, oncekiNotlar)
  await icinde('önceki notlar: önizleme', oncekiDugme.getByText(ONIZLEME, { exact: true }), oncekiDugme)
  await belgeTasmaz(page, 'not sayfası')

  await oncekiDugme.click()
  const okunan = oncekiNotlar.getByRole('document').getByText(ILK_SATIR, { exact: true })
  await icinde('geniş okuma: notun ilk satırı', okunan, oncekiNotlar)
  await belgeTasmaz(page, 'geniş okuma')
  await oncekiNotlar.getByRole('button', { name: 'Listeye dön' }).click()

  // --- Okuma penceresi ---
  const [pencere] = await Promise.all([
    context.waitForEvent('page'),
    oncekiNotlar.getByRole('button', { name: /24 Eylül 2026, 08:00/ }).click({ modifiers: ['ControlOrMeta'] }),
  ])
  await pencere.setViewportSize({ width: 1024, height: 680 })
  const pencereBasligi = pencere.getByRole('heading', { level: 1 })
  await expect(pencereBasligi).toContainText(UZUN_AD)
  await icinde('okuma penceresi: başlık', pencereBasligi, pencere.getByRole('main'))
  await icinde('okuma penceresi: not', pencere.getByText(ILK_SATIR, { exact: true }), pencere.getByRole('main'))
  await belgeTasmaz(pencere, 'okuma penceresi')
  await pencere.close()

  // --- Etiketli seanslar ---
  await bolum.getByRole('button', { name: `${UZUN_ETIKET} etiketli seansları göster`, exact: true }).click()
  const etiketli = page.getByRole('region', { name: `${UZUN_ETIKET} etiketli seanslar` })
  await icinde('etiketli seanslar: başlık', etiketli.getByRole('heading', { level: 2 }), etiketli)
  await icinde('etiketli seanslar: satır', etiketli.getByRole('button', { name: new RegExp(UZUN_AD) }), etiketli)
  await belgeTasmaz(page, 'etiketli seanslar')
  await etiketli.getByRole('button', { name: 'Kapat', exact: true }).click()

  // --- Hızlı arama (⌘K): danışan, not parçası, etiket ---
  await page.getByRole('button', { name: 'Hızlı arama (⌘K)' }).click()
  const arama = page.getByRole('dialog', { name: 'Hızlı arama' })
  const kutu = arama.getByLabel('Danışan adı veya not içeriği')
  await kutu.fill('Şebnem')
  const danisanSonucu = arama.getByRole('button', { name: `${UZUN_AD} — danışan dosyasını aç`, exact: true })
  await icinde('hızlı arama: danışan', danisanSonucu, arama)
  await kutu.fill('Notbaşı')
  const notSonucu = arama.getByRole('button', { name: new RegExp(`^${UZUN_AD} — .* seansına git$`) })
  await icinde('hızlı arama: not', notSonucu, arama)
  await icinde('hızlı arama: not parçası', notSonucu.locator('span.block'), notSonucu)
  await kutu.fill(UZUN_ETIKET.slice(0, 12))
  await icinde('hızlı arama: etiket', arama.getByRole('button', { name: `${UZUN_ETIKET} etiketli seansları göster`, exact: true }), arama)
  await belgeTasmaz(page, 'hızlı arama')
})
