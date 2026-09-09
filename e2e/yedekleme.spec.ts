import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * # Bu dosyanın ölçtüğü şey
 *
 * `core::backup` baştan beri test edilmişti ve hepsi yeşildi; eksik olan
 * **çağrı yeriydi**. Birim ve HTTP testleri o boşluğu kapattı; burada
 * ölçülen şey, terapistin **tarayıcıda gerçekten yapabildiği**: klasörü
 * seçmek, yedeğin alındığını görmek, bir kaydı yanlışlıkla eklemek/silmek
 * ve yedekten geri dönebilmek.
 *
 * Testler bu dosyada **sırayla** koşar ve durumu bilerek paylaşır (dosya
 * içi paylaşım `notlar`/`takvim` spec'lerindeki desenin aynısı; dosyalar
 * arası yalıtım `playwright.config.ts`'te port başına veri diziniyle
 * sağlanıyor).
 *
 * # Yedek klasörü nereden geliyor
 *
 * Tarayıcıdan dizin seçilemediği için klasör yolu **yazılıyor** (gerekçe:
 * `server/src/routes/backup.rs` modül başlığı). Testte yol, işletim
 * sisteminin geçici dizininde açılan gerçek bir klasördür — sunucu
 * yazılabilirliği fiilen deniyor, sahte bir yol kabul edilmezdi.
 */
const YEDEK_KLASORU = mkdtempSync(join(tmpdir(), 'psikolog-e2e-yedek-'))

test('yedek klasoru secilir ve yedek gercekten alinir', async ({ page }) => {
  await kurulumYap(page)

  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill('Ayşe Yılmaz')
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText('Ayşe Yılmaz')).toBeVisible()

  const bolum = page.getByRole('region', { name: 'Yedekleme' })
  // ON KOSUL: klasor secilmeden yedek ALINAMAZ ve bu SESSIZ gecilmez
  // (tasarim §7: "ana ekranda kalici uyari").
  await expect(bolum.getByRole('alert')).toContainText(/klasör/i)

  await bolum.getByRole('button', { name: 'Yedek klasörünü değiştir' }).click()
  await page.getByLabel(/yedeklerin yazılacağı klasörün yolu/i).fill(YEDEK_KLASORU)
  await page.getByRole('button', { name: 'Kaydet ve yedek al' }).click()

  // Uyari kalkti ve son yedek ekranda.
  await expect(bolum.getByRole('alert')).toHaveCount(0)
  await expect(bolum).toContainText('Son yedek:')

  // KANIT: yedek DISKTE ve CIFT halinde. Ekrandaki metin tek basina
  // dosyanin yazildigini kanitlamazdi.
  const dosyalar = readdirSync(YEDEK_KLASORU)
  const db = dosyalar.filter((d) => d.startsWith('yedek-') && d.endsWith('.db'))
  expect(db).toHaveLength(1)
  expect(dosyalar).toContain(db[0].replace(/\.db$/, '.keystore.json'))
})

test('yedekten geri yukleme, yedekten SONRAKI kaydi geri alir', async ({ page }) => {
  // BU TESTIN VARLIK SEBEBI: dosyanin kopyalanmis olmasi degil, geri
  // yuklemenin gercekten CALISMASI. Onceki test yedegi aldi; simdi yeni bir
  // danisan ekliyoruz, geri yukluyoruz ve o danisanin GITTIGINI, eskisinin
  // ise DURDUGUNU goruyoruz.
  await kurulumYap(page)

  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill('Yedekten Sonra Eklenen')
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText('Yedekten Sonra Eklenen')).toBeVisible()

  const bolum = page.getByRole('region', { name: 'Yedekleme' })
  await bolum.getByRole('button', { name: 'Yedekten geri yükle' }).click()
  await expect(page.getByRole('heading', { name: 'Yedekten geri yükleme' })).toBeVisible()

  // Panikteki kullanicinin gormesi gereken iki sey ekranda:
  await expect(page.getByRole('heading', { name: /kopyasını alın/i })).toBeVisible()
  // Uyari iki yerde birden geciyor (ust bant + "yedeginiz yoksa" bolumu);
  // burada olculen sey, panikteki kullanicinin FORMDAN ONCE gordugu bant.
  await expect(page.getByText('Yeniden kurulum yapmayın.', { exact: true })).toBeVisible()

  // Kayitli klasordeki yedek LISTELENIYOR (ikisi de yerinde oldugu icin).
  const secim = page.getByRole('radio').first()
  await expect(secim).toBeVisible()
  await secim.check()

  await page.getByLabel(/parolanız/i).fill('gizliparola')
  await page.getByRole('button', { name: 'Bu yedeği geri yükle' }).click()

  await expect(page.getByRole('heading', { name: /geri yükleme tamamlandı/i })).toBeVisible()
  await page.getByRole('button', { name: 'Devam et' }).click()

  // Oturum kilitlendi: elde tutulan anahtar artik BASKA bir veritabanina
  // aitti (bkz. `routes::restore::uygula`).
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()
  await page.getByLabel('Ana parola').fill('gizliparola')
  await page.getByRole('button', { name: 'Aç' }).click()
  await expect(page.getByRole('heading', { name: 'Terapi Notları' })).toBeVisible()

  // KANIT: yedekteki danisan YERINDE, yedekten sonra eklenen GITTI.
  await expect(page.getByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })).toBeVisible()
  await expect(page.getByText('Yedekten Sonra Eklenen')).toHaveCount(0)
})

test('yanlis parolayla geri yukleme reddedilir ve veri DEGISMEZ', async ({ page }) => {
  // "Her hata parola hatasidir"in tersi: dogru parolayla gelen kullanici
  // reddedilmemeli, YANLIS parolayla gelen de veriyi kaybetmemeli.
  await kurulumYap(page)

  const bolum = page.getByRole('region', { name: 'Yedekleme' })
  await bolum.getByRole('button', { name: 'Yedekten geri yükle' }).click()
  await page.getByRole('radio').first().check()
  await page.getByLabel(/parolanız/i).fill('bu-parola-yanlis')
  await page.getByRole('button', { name: 'Bu yedeği geri yükle' }).click()

  // Mesaj ne olmadigini da soyluyor.
  await expect(page.getByRole('alert')).toContainText(/hiçbir şey değiştirilmedi/i)
  await expect(page.getByRole('heading', { name: /geri yükleme tamamlandı/i })).toHaveCount(0)

  // Ve oturum HALA acik, veri yerinde: reddedilen bir geri yukleme mevcut
  // veritabanina dokunmadi.
  await page.getByRole('button', { name: 'Geri dön' }).click()
  await expect(page.getByRole('heading', { name: 'Terapi Notları' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })).toBeVisible()
})
