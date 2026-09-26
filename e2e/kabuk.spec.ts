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

  // Blok adı "SS:DD Ad Soyad" (başlangıç saati her blokta). Izgarayla
  // sınırlı: bugünün sıradaki seansıysa bilgi satırındaki bağlantı da aynı
  // adı taşır.
  const blok = page
    .getByTestId('takvim-izgara')
    .getByRole('button', { name: `${saat} ${ad}`, exact: true })
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
  // SENKRONİZASYON BARİYERİ (MINOR-2 düzeltmesi): aşağıdaki "yok" iddiaları
  // Takvim panelinin KENDİ içeriği gerçekten render olduktan SONRA
  // ölçülüyor — yalnızca `kurulumYap`'ın beklediği üst başlık değil.
  // `kurulumYap` yalnızca AnaEkran'ın (kabuğun) monte olduğunu kanıtlıyordu;
  // bu satır Takvim panelinin de kendi verisiyle (hafta başlığı) çizildiğini
  // kanıtlıyor, ki "yok" iddiası işlem ÖNCESİ bir kareyi ölçmesin (biçim 6).
  await expect(page.getByRole('button', { name: 'Sonraki hafta' })).toBeVisible()
  // Yedekleme, parola gibi ayarlar bölümleri artık Ayarlar sekmesinin
  // İÇİNDE — açılışta (Takvim sekmesindeyken) hiçbiri DOM'da olmamalı.
  // Eskiden bu bölüm ana ekranı sarı bir kutu olarak işgal ediyordu (Görev 2
  // ürün kararı); Görev 8 bu görünürlüğü GERÇEKTEN sekmeye taşıdığını
  // kanıtlıyor.
  await expect(page.getByText('Şimdi yedek al')).toHaveCount(0)
  await expect(page.getByText('Parolayı değiştir')).toHaveCount(0)
})

test('takvimdeki randevudan danisan adina tiklayinca Danisanlar sekmesi o danisanin dosyasiyla acilir', async ({
  page,
}) => {
  // İnceleme CRITICAL-1: bu testin ESKİ hâli (adı "takvim çipinden
  // danışana gidince...") aslında takvim ÇİPİNE hiç dokunmuyordu — önce
  // elle Danışanlar sekmesine geçip LİSTE çipine tıklıyordu. Randevu
  // çipinin kendisi yalnızca seansı SEÇER (`onSec`); Görev 8'in brief'i
  // Adım 1'de istediği "takvimdeki randevudan danışana git" yolu o zaman
  // GERÇEKTEN yoktu (`SeansPaneli`nin danışan açan bir düğmesi yoktu).
  // Bu test artık o gerçek yolu kullanıyor: randevuya tıkla (seans paneli
  // AÇILIR, davranış DEĞİŞMEDİ) → panelin BAŞLIĞINDAKİ danışan adına
  // tıkla (`SeansPaneli.tsx`'e eklenen düğme, `danisanaGit`i çağırıyor).
  await kurulumYap(page)

  const blok = await danisanVeRandevu(page, 'Fatma Çelik', '16:00')

  // Randevu ÇİPİNE tıklamak yalnızca seansı seçer — davranış DEĞİŞMEDİ,
  // sekme hâlâ Takvim.
  await blok.click()
  await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Takvim' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // Panelin başlığındaki danışan adına tıklamak `danisanaGit`i tetikler —
  // danışan listesindeki çiple AYNI erişilebilir ad kalıbı.
  await page
    .getByRole('button', { name: 'Fatma Çelik dosyasını aç', exact: true })
    .click()

  await expect(page.getByRole('tab', { name: 'Danışanlar' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // SENKRONİZASYON BARİYERİ: aşağıdaki iddialardan ÖNCE dosyanın GERÇEKTEN
  // sunucudan geldiğini bekle (biçim 6) — `aria-selected` tek başına
  // sekmenin DEĞİŞTİĞİNİ kanıtlar ama dosyanın AÇILDIĞINI kanıtlamaz.
  await expect(page.getByTestId('seans-listesi')).toHaveAttribute('data-yuklendi', 'evet')
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
  // Not metni İKİ YERDE birden görünüyor: seans listesindeki önizleme
  // satırında ("geçmiş seansları" — bkz. test adı) VE seçili seansın not
  // editöründe ("notu açılır"). `getByText` tek başına artık BELİRSİZ
  // (strict mode ihlali, iki eşleşme) — bu da ürünün çalıştığının bir
  // kanıtı; ikisi ayrı ayrı, kendi rolleriyle doğrulanıyor.
  await expect(page.getByTestId('seans-listesi')).toContainText('Geçen haftanın notu')
  await expect(page.getByRole('textbox', { name: 'Seans notu' })).toHaveText(
    'Geçen haftanın notu',
  )
})
