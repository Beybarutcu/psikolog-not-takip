import { expect, test, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * Görev 8'in uçtan uca doğrulaması: sekme kabuğunun GERÇEKTEN kullanıcıya
 * bağlandığı — `Sekmeler`, `TakvimSekmesi`, `DanisanlarSekmesi`,
 * `AyarlarSekmesi`, `DanisanDosyasi` yedi görevdir yazılıydı ama `App.tsx`
 * hâlâ eski `AnaEkran`'ı tek dikey yığın olarak monte ediyordu — birim
 * testler her parçayı KENDİ İZOLASYONUNDA doğruluyor, ama parçaların
 * BİRBİRİNE bağlı olduğunu yalnızca gerçek tarayıcıda gerçek bir tıklama
 * zinciri kanıtlayabilir.
 *
 * # Neden `randevuVeNotOlustur` burada AYRI yazıldı, `notlar.spec.ts`'ten
 *   İTHAL EDİLMEDİ
 *
 * `notlar.spec.ts`teki `danisanVeRandevu`/`seansiAc` bir test dosyasının
 * İÇİNDE tanımlı yerel yardımcılar — kodtabanının bu dosyalardaki yerleşik
 * deseni (her spec kendi küçük adım yardımcılarını yazar) burada da
 * izleniyor. PAYLAŞILAN olan tek yardımcı kilit açma/kurulum
 * (`e2e/yardimcilar.ts::kurulumYap`) ve bu dosya onu KULLANIYOR, kopyalamadı.
 */

/**
 * Danışan ekler, verilen saate randevu kurar ve takvimdeki bloğunu döndürür.
 *
 * Görev 8: "Danışan ekle" formu artık Danışanlar sekmesinin İÇİNDE
 * (eskiden ana ekranda HER ZAMAN görünüyordu); boş saat düğmesi ise Takvim
 * sekmesinde. Bu yüzden yardımcı İKİ sekme arasında gidip geliyor — bu,
 * `danisanaGit`in AKSİNE, elle yapılan bir geçiş: danışan eklemek sekme
 * DEĞİŞTİRMEZ (bkz. `DanisanlarSekmesi.tsx`), randevu kurmak da Takvim
 * sekmesinde kalınmasını gerektirir.
 */
async function danisanVeRandevu(page: Page, ad: string, saat: string) {
  await page.getByRole('tab', { name: 'Danışanlar' }).click()
  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill(ad)
  // `exact: true`: "Danışan ekle" düğmesi de "Ekle" alt dizgisini içeriyor.
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText(ad, { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Takvim' }).click()
  await page.locator(`button[aria-label$="${saat} boş"]`).first().click()
  // `exact: true` şart: danışan listesindeki "… adlı danışanı arşivle"
  // düğmesi de "Danışan" alt dizgisiyle eşleşir.
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
  await page.getByRole('button', { name: 'Kaydet' }).click()

  const blok = page.getByRole('button', { name: ad, exact: true }).first()
  await expect(blok).toBeVisible()
  return blok
}

/** Otomatik kaydın "sunucuya yazıldı" göstergesi (bkz. `notlar.spec.ts`teki aynı yardımcı). */
async function kaydedildiBekle(page: Page) {
  await expect(
    page.getByRole('status').filter({ hasText: /^Kaydedildi \d{2}:\d{2}$/ }),
  ).toBeVisible()
}

/**
 * Takvim sekmesinde bir danışan ve randevu kurar, seans notunu yazar ve
 * sunucuya yazıldığını doğrular. Testin geri kalanı Danışanlar sekmesine
 * geçip AYNI notu orada bulmalı.
 */
async function randevuVeNotOlustur(page: Page, ad: string, icerik: string) {
  const blok = await danisanVeRandevu(page, ad, '15:00')
  await blok.click()
  const alan = page.getByLabel('Seans notu', { exact: true })
  await expect(alan).toBeVisible()
  await alan.fill(icerik)
  await kaydedildiBekle(page)
}

test('açılışta takvim görünür, yedekleme görünmez', async ({ page }) => {
  await kurulumYap(page)

  await expect(page.getByRole('tab', { name: 'Takvim' })).toHaveAttribute('aria-selected', 'true')
  // Yedekleme, parola gibi ayarlar bölümleri artık Ayarlar sekmesinin
  // İÇİNDE — açılışta (Takvim sekmesindeyken) hiçbiri DOM'da olmamalı.
  // Eskiden bu bölüm ana ekranı sarı bir kutu olarak işgal ediyordu (Görev 2
  // ürün kararı); Görev 8 bu görünürlüğü GERÇEKTEN sekmeye taşıdığını
  // kanıtlıyor.
  await expect(page.getByText('Şimdi yedek al')).toHaveCount(0)
  await expect(page.getByText('Parolayı değiştir')).toHaveCount(0)
})

test('takvim çipinden danışana gidince sekme değişir, geri dönünce takvim aynı kalır', async ({
  page,
}) => {
  await kurulumYap(page)

  const blok = await danisanVeRandevu(page, 'Fatma Çelik', '16:00')

  // Randevu panelini AÇMADAN, danışan listesindeki çipten dosyayı aç
  // (`danisanaGit` — tek giriş noktası, bkz. `AnaEkran.tsx` modül başlığı).
  // Çip Danışanlar sekmesinin İÇİNDE — `danisanVeRandevu` Takvim'de
  // bıraktığı için önce oraya geçiliyor (bu, `danisanaGit`in kendisi
  // DEĞİL: yalnızca çipi GÖREBİLMEK için gereken elle sekme değişimi).
  await page.getByRole('tab', { name: 'Danışanlar' }).click()
  await page
    .getByRole('button', { name: 'Fatma Çelik dosyasını aç', exact: true })
    .click()

  await expect(page.getByRole('tab', { name: 'Danışanlar' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // Danışan dosyası kendi küçük şeridiyle "Seanslar" alt sekmesinde açılır.
  await expect(page.getByRole('tab', { name: 'Seanslar', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // Takvim sekmesine dönünce randevu HÂLÂ orada — sekme değişimi takvimin
  // state'ini SIFIRLAMAMALI (`AnaEkran` yalnızca hangi panelin göründüğünü
  // değiştiriyor, `useTakvimAkisi`nin kendisini değil).
  await page.getByRole('tab', { name: 'Takvim' }).click()
  await expect(blok).toBeVisible()
})

test('danışana tıklayınca geçmiş seansları ve notu açılır', async ({ page }) => {
  await kurulumYap(page)
  await randevuVeNotOlustur(page, 'Ayşe', 'Geçen haftanın notu')

  await page.getByRole('tab', { name: 'Danışanlar' }).click()
  // Tam ad DEĞİL "dosyasını aç" ile eşleşen bir düzenli ifade: "Ayşe" alt
  // dizgisi aynı satırdaki "Ayşe adlı danışanı arşivle" düğmesiyle de
  // örtüşüyor (strict mode ihlali — iki eleman bulunur).
  await page.getByRole('button', { name: /Ayşe dosyasını aç/ }).click()

  // SENKRONİZASYON BARİYERİ: sayım/görünürlük iddiasından ÖNCE listenin
  // sunucudan GERÇEKTEN geldiğini bekle. `data-yuklendi` olmadan aşağıdaki
  // metin iddiası yalnızca Playwright'ın auto-retry'ına güvenirdi — bu
  // satır o güveni AÇIK bir koşula çeviriyor (bkz.
  // `docs/test-yesil-ama-korumuyor.md` 6. biçim: "işlem öncesi durumla
  // tatmin olan assertion").
  await expect(page.getByTestId('seans-listesi')).toHaveAttribute('data-yuklendi', 'evet')
  await expect(page.getByText('Geçen haftanın notu')).toBeVisible()
})
