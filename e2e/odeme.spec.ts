import { expect, test, type Locator, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * Ödeme işaretleme ve ay sonu özeti — uçtan uca (Plan 4 Görev 8).
 *
 * # Dosya içi paylaşılan durum
 *
 * Bu dosyanın testleri AYNI sunucuyu ve AYNI veritabanını paylaşır (bkz.
 * `playwright.config.ts`). Özet bir AY toplamı olduğu için bir testin
 * randevuları, aynı aya düşen başka bir testin sayılarını bozar. Bu yüzden:
 *
 * - Birinci test randevularını BU haftanın ilk gününe (Pazartesi) koyar.
 * - İkinci test randevusunu 5 hafta SONRAKİ Pazartesi'ye koyar. İki Pazartesi
 *   arası 35 gün; hiçbir ay 31 günden uzun olmadığından iki tarih ASLA aynı
 *   aya düşemez — testin koşulduğu gerçek tarihten bağımsız.
 * - Üçüncü test özeti ekranda okumaz, yalnızca uç noktayı yoklar ve dosyada
 *   son sırada koşar.
 *
 * # Ay sınırı
 *
 * Özet açılışta BUGÜNÜN ayını gösterir; bu haftanın Pazartesi'si ise önceki
 * aya düşebilir (ör. bugün 1 Ekim Çarşamba, Pazartesi 29 Eylül). Test hangi
 * ayı okuyacağını tahmin ETMEZ: randevuyu oluşturan `POST /api/randevular`
 * yanıtındaki `baslangic`tan ayı alır ve özet ekranında `Önceki ay` /
 * `Sonraki ay` ile o aya gider; başlığın o ayı gösterdiği doğrulanmadan
 * hiçbir sayı okunmaz.
 */

const AYLAR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

type Randevu = { id: number; baslangic: string; ucret: number | null }

function ayBasligi(ay: string): string {
  const [yil, a] = ay.split('-')
  return `${AYLAR[Number(a) - 1]} ${yil}`
}

async function danisanEkle(page: Page, ad: string) {
  await page.getByRole('button', { name: 'Danışan ekle', exact: true }).click()
  await page.getByLabel('Ad soyad', { exact: true }).fill(ad)
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText(ad, { exact: true }).first()).toBeVisible()
}

/** Takvimdeki randevu bloğu (yalnızca `data-durum` taşıyan ızgara blokları). */
function blok(page: Page, ad: string): Locator {
  return page.locator('button[data-durum]', { hasText: ad })
}

/**
 * Görünen haftanın ilk gününün `saat` hücresine randevu koyar ve sunucunun
 * döndürdüğü kaydı verir (ayı ve kimliği buradan okuyoruz, tahmin etmiyoruz).
 */
async function randevuOlustur(page: Page, ad: string, saat: string, ucretTl: string) {
  await page.locator(`button[aria-label$="${saat} boş"]`).first().click()
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
  await page.getByLabel('Ücret (TL)', { exact: true }).fill(ucretTl)
  const yanitSozu = page.waitForResponse(
    (y) => y.request().method() === 'POST' && new URL(y.url()).pathname === '/api/randevular',
  )
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  const yanit = await yanitSozu
  expect(yanit.ok()).toBe(true)
  const kayitlar = (await yanit.json()) as Randevu[]
  expect(kayitlar).toHaveLength(1)
  await expect(blok(page, ad)).toHaveCount(1)
  return kayitlar[0]
}

/**
 * Randevuyu açar ve alt satırı döndürür. Bariyer: satırın ücret metni BU
 * randevunun ücretini gösterir -- önceki seçili randevunun satırı hâlâ
 * ekrandayken onun düğmelerine basılmasın.
 */
async function seansAc(page: Page, ad: string, ucretMetni: string): Promise<Locator> {
  await blok(page, ad).click()
  const grup = page.getByRole('group', { name: 'Seans durumu', exact: true })
  const satir = grup.locator('xpath=..')
  await expect(satir).toContainText(ucretMetni)
  return satir
}

/**
 * Durum düğmesine basar. Bariyer: PATCH yanıtı başarılı döner VE düğme
 * `aria-pressed=true` olur (durum iyimser değil; yalnızca başarıda değişir)
 * VE takvim bloğu yeni durumu taşır.
 */
async function durumIsaretle(page: Page, satir: Locator, r: Randevu, ad: string, etiket: string, kod: string) {
  const dugme = satir.getByRole('button', { name: etiket, exact: true })
  const yanitSozu = page.waitForResponse(
    (y) => y.request().method() === 'PATCH' && new URL(y.url()).pathname === `/api/randevular/${r.id}`,
  )
  await dugme.click()
  expect((await yanitSozu).ok()).toBe(true)
  await expect(dugme).toHaveAttribute('aria-pressed', 'true')
  await expect(blok(page, ad)).toHaveAttribute('data-durum', kod)
}

/**
 * "Ödendi" kutusunu işaretler. Kutu İYİMSER: tıklanınca sunucu cevabından
 * önce işaretlenir, dolayısıyla `toBeChecked` tek başına bariyer değildir.
 * Asıl bariyer `PATCH .../odeme` yanıtının başarıyla gelmesi; ardından kutu
 * işaretli ve tekrar etkin (istek bitti, geri alınmadı).
 */
async function odemeIsaretle(page: Page, satir: Locator, r: Randevu) {
  const kutu = satir.getByRole('checkbox', { name: 'Ödendi', exact: true })
  await expect(kutu).not.toBeChecked()
  const yanitSozu = page.waitForResponse(
    (y) =>
      y.request().method() === 'PATCH' && new URL(y.url()).pathname === `/api/randevular/${r.id}/odeme`,
  )
  await kutu.check()
  expect((await yanitSozu).ok()).toBe(true)
  await expect(kutu).toBeEnabled()
  await expect(kutu).toBeChecked()
}

/**
 * Özeti AÇAR (her açılış yeni bir mount = taze bir istek) ve `ay`a gider.
 * Başlık hedef ayı göstermeden döner değil; `AyOzeti` yalnızca o aya ait
 * yanıtı çizdiği için bundan sonra okunan her sayı o ayındır.
 */
async function ozetAc(page: Page, ay: string): Promise<Locator> {
  const dugme = page.getByRole('button', { name: 'Ay sonu özeti', exact: true })
  await expect(dugme).toHaveAttribute('aria-expanded', 'false')
  await dugme.click()
  const bolum = page.getByRole('region', { name: 'Ay sonu özeti', exact: true })
  const baslik = bolum.getByRole('heading', { level: 2 })
  await expect(baslik).toHaveText(/^\S+ \d{4}$/)
  const [acilisAdi, acilisYili] = ((await baslik.textContent()) ?? '').split(' ')
  const acilisIndeksi = AYLAR.indexOf(acilisAdi)
  expect(acilisIndeksi).toBeGreaterThanOrEqual(0)

  const [hedefYil, hedefAy] = ay.split('-').map(Number)
  const fark = hedefYil * 12 + (hedefAy - 1) - (Number(acilisYili) * 12 + acilisIndeksi)
  const yon = fark < 0 ? 'Önceki ay' : 'Sonraki ay'
  for (let i = 0; i < Math.abs(fark); i++) {
    await bolum.getByRole('button', { name: yon, exact: true }).click()
  }
  await expect(baslik).toHaveText(ayBasligi(ay))
  return bolum
}

async function ozetKapat(page: Page) {
  const dugme = page.getByRole('button', { name: 'Ay sonu özeti', exact: true })
  await dugme.click()
  await expect(dugme).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: 'Ay sonu özeti', exact: true })).toHaveCount(0)
}

function deger(bolum: Locator, etiket: string): Locator {
  return bolum
    .locator('dl > div')
    .filter({ has: bolum.page().getByText(etiket, { exact: true }) })
    .locator('dd')
}

test('geldi + odendi isaretlenen seans ay sonu ozetinde tahsilata, odenmeyen borca girer', async ({ page }) => {
  await kurulumYap(page)

  await danisanEkle(page, 'Tahsil Aslı')
  await danisanEkle(page, 'Borçlu Burak')
  const r1 = await randevuOlustur(page, 'Tahsil Aslı', '10:00', '450')
  const r2 = await randevuOlustur(page, 'Borçlu Burak', '11:00', '300')
  // İkisi de görünen haftanın ilk gününde: aynı ay (aşağıdaki sayılar buna dayanıyor).
  const ay = r1.baslangic.slice(0, 7)
  expect(r2.baslangic.slice(0, 7)).toBe(ay)

  const s1 = await seansAc(page, 'Tahsil Aslı', '450,00 TL')
  await durumIsaretle(page, s1, r1, 'Tahsil Aslı', 'Geldi', 'geldi')
  await odemeIsaretle(page, s1, r1)

  const s2 = await seansAc(page, 'Borçlu Burak', '300,00 TL')
  await durumIsaretle(page, s2, r2, 'Borçlu Burak', 'Geldi', 'geldi')

  let ozet = await ozetAc(page, ay)
  await expect(deger(ozet, 'Gelinen seans')).toHaveText('2')
  await expect(deger(ozet, 'Tahsilat')).toHaveText('450,00 TL')
  await expect(deger(ozet, 'Bekleyen')).toHaveText('300,00 TL')
  await expect(
    ozet.getByRole('button', { name: 'Borçlu Burak — 300,00 TL (1 seans)', exact: true }),
  ).toBeVisible()
  // Sayılar yüklendikten SONRA (yukarıdaki bariyerler): ödeyen borçlu değil.
  await expect(ozet.getByRole('listitem')).toHaveCount(1)
  await expect(ozet.getByText('Bu ay bekleyen ödeme yok.', { exact: true })).toHaveCount(0)
  await ozetKapat(page)

  // İkinci danışan da öder -> özet YENİDEN açılır (taze istek) ve DEĞİŞİR.
  const s2b = await seansAc(page, 'Borçlu Burak', '300,00 TL')
  await odemeIsaretle(page, s2b, r2)

  ozet = await ozetAc(page, ay)
  await expect(deger(ozet, 'Tahsilat')).toHaveText('750,00 TL')
  await expect(deger(ozet, 'Bekleyen')).toHaveText('0,00 TL')
  await expect(deger(ozet, 'Gelinen seans')).toHaveText('2')
  await expect(ozet.getByText('Bu ay bekleyen ödeme yok.', { exact: true })).toBeVisible()
  await expect(ozet.getByRole('listitem')).toHaveCount(0)
})

test('gelmedi isaretlenen seans ne tahsilata ne borca girer', async ({ page }) => {
  await kurulumYap(page)

  await danisanEkle(page, 'Devamsız Cem')

  // 5 hafta ileri: birinci testin ayından kesinlikle farklı bir ay (başlık yorumu).
  const haftaBasligi = page
    .getByRole('button', { name: 'Önceki hafta', exact: true })
    .locator('xpath=following-sibling::h2')
  for (let i = 0; i < 5; i++) {
    const once = (await haftaBasligi.textContent()) ?? ''
    await page.getByRole('button', { name: 'Sonraki hafta', exact: true }).click()
    await expect(haftaBasligi).not.toHaveText(once)
  }

  const r = await randevuOlustur(page, 'Devamsız Cem', '10:00', '450')
  const ay = r.baslangic.slice(0, 7)

  const satir = await seansAc(page, 'Devamsız Cem', '450,00 TL')
  await durumIsaretle(page, satir, r, 'Devamsız Cem', 'Gelmedi', 'gelmedi')

  // Özet, Gelmedi yazması sunucuda TAMAMLANDIKTAN sonra açılıyor (bariyer
  // yukarıda); sıfırlar işlem öncesi bir yanıttan gelemez.
  let ozet = await ozetAc(page, ay)
  await expect(deger(ozet, 'Gelinen seans')).toHaveText('0')
  await expect(deger(ozet, 'Tahsilat')).toHaveText('0,00 TL')
  await expect(deger(ozet, 'Bekleyen')).toHaveText('0,00 TL')
  await expect(ozet.getByText('Bu ay bekleyen ödeme yok.', { exact: true })).toBeVisible()
  await ozetKapat(page)

  // ARTI YÖN: aynı randevu Geldi olunca sayılır. Hiçbir şey saymayan bir özet
  // yukarıdaki sıfırları da verirdi.
  await durumIsaretle(page, satir, r, 'Devamsız Cem', 'Geldi', 'geldi')
  ozet = await ozetAc(page, ay)
  await expect(deger(ozet, 'Gelinen seans')).toHaveText('1')
  await expect(deger(ozet, 'Bekleyen')).toHaveText('450,00 TL')
  await expect(deger(ozet, 'Tahsilat')).toHaveText('0,00 TL')
  await expect(
    ozet.getByRole('button', { name: 'Devamsız Cem — 450,00 TL (1 seans)', exact: true }),
  ).toBeVisible()
})

test('kilitliyken ay ozeti ucu veri sizdirmaz', async ({ page, request }) => {
  await kurulumYap(page)

  await danisanEkle(page, 'OZET-KANARYA')
  const r = await randevuOlustur(page, 'OZET-KANARYA', '12:00', '200')
  const ay = r.baslangic.slice(0, 7)
  const satir = await seansAc(page, 'OZET-KANARYA', '200,00 TL')
  await durumIsaretle(page, satir, r, 'OZET-KANARYA', 'Geldi', 'geldi')

  const url = `/api/ay-ozeti?ay=${ay}`

  // ARTI YÖN: kilit AÇIKKEN aynı istek kanaryayı GERÇEKTEN döndürüyor.
  // Olmasaydı aşağıdaki "gövdede yok" iddiası, zaten hiç içermeyen bir
  // yanıtla (yanlış ay, boş özet) totolojik olarak geçerdi.
  const acikYanit = await request.get(url)
  expect(acikYanit.status()).toBe(200)
  expect(await acikYanit.text()).toContain('OZET-KANARYA')

  await page.getByRole('button', { name: 'Kilitle', exact: true }).click()
  // BARİYER: kilitleme isteği bitmeden sorulursa açık oturuma denk gelir.
  await expect(page.getByRole('heading', { name: 'Kilitli', exact: true })).toBeVisible()

  const yanit = await request.get(url)
  expect(yanit.status()).toBe(401)
  expect(await yanit.text()).not.toContain('OZET-KANARYA')
})
