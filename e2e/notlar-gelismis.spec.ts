import { expect, test, type Locator, type Page } from '@playwright/test'
import { kurulumYap, sonSozcuguSec } from './yardimcilar'

/**
 * Görev 8'in uçtan uca doğrulaması: Plan 6'nın yedi görevde yazdığı üç
 * parçanın (biçimli editör + araç çubuğu, etiketler, arama) GERÇEK bir
 * tarayıcıda, GERÇEK bir sunucuyla birbirine bağlı çalıştığı — birim
 * testler her parçayı kendi izolasyonunda (jsdom, sahte `fetch`) doğruluyor;
 * parçaların ZİNCİRİ (araç çubuğu → editör → otomatik kayıt → sunucu →
 * yeniden yükleme, etiket ekle → Cmd+K → etiketli seanslar → danışan
 * dosyası, not içeriğinde ara → danışan dosyası) yalnızca burada ölçülebilir.
 *
 * # Ctrl+Z testi neden burada ve neden ÖZEL
 *
 * TipTap'ın geri alma yığını (prosemirror-history) gerçek tarayıcıda: tek
 * Ctrl+Z yalnızca son biçimi geri alır. jsdom'da seçim ve tuş haritası
 * gerçek tarayıcıdaki gibi davranmıyor; birim testleri (`BicimliYuzey.test`,
 * `NotEditoru.gercekYuzey.test`) komutları doğrudan çağırıyor. Klavyeyle
 * seçip Ctrl+B / Ctrl+Z'ye basmanın zinciri yalnızca burada ölçülür — bu
 * dosyadaki `test('Ctrl+Z ...')` bu boşluğu kapatıyor.
 *
 * # Paylaşılan sunucu durumu — saat seçimi
 *
 * Bu dosya kendi sunucusunda ve kendi veri dizininde koşuyor (bkz.
 * `playwright.config.ts` SUNUCULAR, port 7706). Dosya İÇİNDEKİ testler aynı
 * sunucuyu paylaşır ve sırayla koşar; her test kendi saatini kullanıyor ki
 * bir testin "ilk boş hücre" seçimi bir öncekinin randevusuyla çakışmasın.
 *
 * # Neden yardımcılar burada AYRI yazıldı, `notlar.spec.ts`'ten İTHAL EDİLMEDİ
 *
 * Kod tabanının yerleşik deseni (bkz. `kabuk.spec.ts` modül başlığı): her
 * spec dosyası kendi küçük adım yardımcılarını yazar. PAYLAŞILAN olan tek
 * yardımcı kilit açma/kurulum (`e2e/yardimcilar.ts::kurulumYap`).
 *
 * # Danışan dosyasındaki seçimi ZAMAN BİÇİMİYLE DEĞİL, NOT İÇERİĞİYLE doğrula
 *
 * "Arama sonucundan doğru seans seçili açıldı" iddiası `zamanMetni`'nin
 * ürettiği metni bilmeyi gerektirmiyor: her testte o seansa önce ayırt
 * edici bir not (kanarya) yazılıyor, sonra arama sonucuna tıklandıktan
 * SONRA açılan not editörünün o kanaryayı taşıdığı doğrulanıyor. Bu hem
 * daha az kırılgan hem de asıl iddiayı (doğru seans) daha doğrudan ölçüyor.
 */

/** Otomatik kaydın "sunucuya yazıldı" göstergesi (bkz. `notlar.spec.ts`teki aynı yardımcı). */
async function kaydedildiBekle(page: Page) {
  await expect(
    page.getByRole('status').filter({ hasText: /^Kaydedildi \d{2}:\d{2}$/ }),
  ).toBeVisible()
}

/** Danışan ekler, verilen saate randevu kurar ve takvimdeki bloğunu döndürür. */
async function danisanVeRandevu(page: Page, ad: string, saat: string): Promise<Locator> {
  await page.getByRole('tab', { name: 'Danışanlar', exact: true }).click()
  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill(ad)
  // `exact: true`: "Danışan ekle" düğmesi de "Ekle" alt dizgisini içeriyor.
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  // Tasarım B1: ekleme dosyayı açar; ad hem listede hem başlıkta durur.
  await expect(page.getByRole('heading', { level: 2, name: ad, exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Takvim', exact: true }).click()
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

/** Takvimdeki seans panelini açar ve resmî not editörünün geldiğini doğrular. */
async function seansiAc(page: Page, blok: Locator): Promise<Locator> {
  await blok.click()
  const alan = page.getByLabel('Seans notu', { exact: true })
  await expect(alan).toBeVisible()
  return alan
}

/** Takvimdeki seans panelinin `region`u — etiket kutusunu tekil biçimde bulmak için. */
function seansPaneli(page: Page): Locator {
  return page.getByRole('region', { name: 'Seans', exact: true })
}

// `sonSozcuguSec` (satırın son sözcüğünü seçip ProseMirror'un kendi
// seçimini bekleyen, yarışta yeniden deneyen bariyer) `./yardimcilar`'da:
// `editor.spec.ts` ile PAYLAŞILIYOR (Görev 10 bulgusu — bu dosyanın önceki
// tek denemelik hâli aynı 20 ms odak-zamanlayıcı yarışına açıktı; Görev 11
// paylaşılan yeniden deneyen sürüme geçirdi).

/** Araç çubuğundaki bir düğme (Türkçe ad). */
function aracDugmesi(page: Page, ad: string): Locator {
  return seansPaneli(page).getByRole('toolbar', { name: 'Biçim araçları' }).getByRole('button', { name: ad, exact: true })
}

// ---------------------------------------------------------------------------

test('bicim cubugu: secili kelime kalinlasir, isaret gorunmez, sayfa yenilenince kalici', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Gamze Aydemir'
  const kelime = 'KALINSOZ25'
  const cumle = `Danisan bu hafta ilerleme kaydetti ${kelime}`

  const blok = await danisanVeRandevu(page, ad, '08:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(cumle)
  await alan.click()
  await sonSozcuguSec(page, alan, kelime)
  await aracDugmesi(page, 'Kalın').click()

  // ARTI YÖN: gerçek <strong> — ve EKSİ YÖN: metinde işaret yok (eski biçim
  // işareti kalmadı; ekranda `**` görünmez, tasarım §1).
  await expect(alan.locator('strong')).toHaveText(kelime)
  await expect(alan).toHaveText(cumle)
  await kaydedildiBekle(page)

  await page.reload()
  await kurulumYap(page)
  const yenidenAlan = await seansiAc(page, blok)
  await expect(yenidenAlan.locator('strong')).toHaveText(kelime)
  await expect(yenidenAlan).toHaveText(cumle)
})

test('etiket: seansa eklenir, Cmd+K etiketi bulur, etiketli seanslardan danisan dosyasina gecilir', async ({
  page,
}) => {
  await kurulumYap(page)
  const ad = 'Serkan Bulut'
  const notKanaryasi = 'SECIMKANARYA26'
  const etiketAdi = 'kaygı'

  const blok = await danisanVeRandevu(page, ad, '09:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(`${notKanaryasi} - bu seansta kaygi ile calisildi.`)
  // BARİYER: not gerçekten sunucuda; arama etiketi bu seansla eşleştirdiğinde
  // açılacak dosyada bu kanaryayı arayacağız.
  await kaydedildiBekle(page)

  const panel = seansPaneli(page)
  await panel.getByLabel('Etiket ekle').fill(etiketAdi)
  await panel.getByLabel('Etiket ekle').press('Enter')
  // BARİYER: çip sunucu yanıtından SONRA render ediliyor (`EtiketSatiri`nin
  // `onEkle` çağrısı `AnaEkran.etiketEkle`nin `await`ini geçtikten sonra).
  const cip = panel.getByRole('button', { name: `${etiketAdi} etiketli seansları göster` })
  await expect(cip).toBeVisible()

  await page.getByRole('button', { name: 'Hızlı arama (⌘K)' }).click()
  const dialog = page.getByRole('dialog', { name: 'Hızlı arama' })
  // ASKANSIZ BÜYÜK HARF: `katla` Türkçe harf katlamasını ASCII'ye indirger,
  // yani "KAYGI" da "kaygı" etiketini bulmalı (bkz. `search.rs` modül
  // başlığı "Türkçe katlama").
  await dialog.getByLabel('Danışan adı veya not içeriği').fill('KAYGI')

  const etiketSonucu = dialog.getByRole('button', { name: `${etiketAdi} etiketli seansları göster` })
  await expect(etiketSonucu).toBeVisible()
  await etiketSonucu.click()

  // Arama katmanı kapandı, "etiketli seanslar" paneli açıldı — sekme
  // panellerinin DIŞINDA, hâlâ Takvim sekmesindeyken bile görünür olmalı.
  const etiketliPanel = page.getByRole('region', { name: `${etiketAdi} etiketli seanslar`, exact: true })
  await expect(etiketliPanel).toBeVisible()

  await etiketliPanel.getByRole('button', { name: new RegExp(ad) }).click()

  // Danışanlar sekmesine geçildi ve dosya o seans seçili açıldı.
  await expect(page.getByRole('tab', { name: 'Danışanlar', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('heading', { name: ad, exact: true })).toBeVisible()
  // SENKRONİZASYON BARİYERİ: seans listesi sunucu yanıtını aldı.
  await expect(page.locator('[data-testid="seans-listesi"][data-yuklendi="evet"]')).toBeVisible()
  // ASIL İDDİA: açılan not editörü DOĞRU seansın (kanaryalı) notunu taşıyor.
  await expect(page.getByLabel('Seans notu', { exact: true })).toHaveText(
    new RegExp(notKanaryasi),
  )
})

test('arama: not iceriginden danisan dosyasina gecilir', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Ece Korkmaz'
  const notTerimi = 'NOTARAMA27'

  const blok = await danisanVeRandevu(page, ad, '10:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(`Seans notu: ${notTerimi} uzerine calisildi.`)
  await kaydedildiBekle(page)

  await page.getByRole('button', { name: 'Hızlı arama (⌘K)' }).click()
  const dialog = page.getByRole('dialog', { name: 'Hızlı arama' })
  await dialog.getByLabel('Danışan adı veya not içeriği').fill(notTerimi)

  const notSonucu = dialog.getByRole('button', { name: /seansına git$/ })
  await expect(notSonucu).toHaveCount(1)
  await expect(notSonucu).toContainText(ad)
  await expect(notSonucu).toContainText(notTerimi)
  await notSonucu.click()

  await expect(page.getByRole('tab', { name: 'Danışanlar', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('heading', { name: ad, exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="seans-listesi"][data-yuklendi="evet"]')).toBeVisible()
  await expect(page.getByLabel('Seans notu', { exact: true })).toHaveText(new RegExp(notTerimi))
})

// ---------------------------------------------------------------------------
// EK TEST (kontrol tarafından zorunlu kılındı, brief'in DIŞINDA): Ctrl+Z
// gerçek tarayıcıda. Bkz. dosya başlığı "Ctrl+Z testi neden burada".
// ---------------------------------------------------------------------------

test('Ctrl+Z gercek tarayicida: yalnizca bicimi geri alir, cumle kaybolmaz, sunucudaki hal bicimsiz', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Onur Aslan'
  const kelime = 'GERIALKANARYA28'
  const cumle = `Danisan devam plani ile ilgili konustu ${kelime}`

  const blok = await danisanVeRandevu(page, ad, '11:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(cumle)
  // BARİYER + geri alma grubu ayrımı: kayıt ~2 sn sürer, ProseMirror'un
  // 500 ms'lik birleştirme penceresi kapanır; Ctrl+B ayrı bir adım olur.
  await kaydedildiBekle(page)

  await alan.click()
  await sonSozcuguSec(page, alan, kelime)
  await page.keyboard.press('Control+b')
  await expect(alan.locator('strong')).toHaveText(kelime)

  // ASIL İDDİA: TEK Ctrl+Z yalnızca biçimi geri alır; cümle TAM kalır.
  await page.keyboard.press('Control+z')
  await expect(alan.locator('strong')).toHaveCount(0)
  await expect(alan).toHaveText(cumle)
  // Bekleyen kayıt yok: ya hiç yazılmadı (sunucudaki hâle dönüldü) ya da
  // biçimsiz hâl yazıldı. İkisinde de sunucudaki metin biçimsiz.
  await expect(page.getByRole('status').filter({ hasText: /Kaydedilmemiş|Yazılıyor/ })).toHaveCount(0)

  await page.reload()
  await kurulumYap(page)
  const yenidenAlan = await seansiAc(page, blok)
  await expect(yenidenAlan).toHaveText(cumle)
  await expect(yenidenAlan.locator('strong')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Görev 4 incelemesinin bıraktığı denetim (d): `not/not-yuzeyi.scss`'in
// `:root` teması şablonun `styles/_variables.scss` varsayılanlarını (mor
// "brand" tonları) YALNIZCA paket CSS'inde ondan SONRA gelirse ezer — ikisi
// de katmansız ve aynı seçicide. Sıra `main.tsx`'in `index.css`'i
// `App`'ten ÖNCE içe aktarmasına bağlı; bu test o sırayı derlenmiş
// uygulamada ölçer.
// ---------------------------------------------------------------------------

test('editor uygulamanin acik slate paletini kullanir, sablonun mor varsayilanini degil', async ({ page }) => {
  await kurulumYap(page)
  const blok = await danisanVeRandevu(page, 'Deniz Kaya', '12:00')
  const alan = await seansiAc(page, blok)

  const renkler = await alan.evaluate((el) => {
    const kok = getComputedStyle(document.documentElement)
    return {
      marka500: kok.getPropertyValue('--tt-brand-color-500').trim(),
      imlec: getComputedStyle(el).caretColor,
    }
  })
  // ARTI YÖN: uygulamanın slate tonları (`not-yuzeyi.scss`).
  expect(renkler.marka500).toBe('#475569')
  // Değişkenin KULLANILDIĞI yer: şablonun `paragraph-node.scss`'i
  // `caret-color: var(--tt-cursor-color)` yazar; tema `#0f172a` verir.
  // Şablon varsayılanı kazansaydı `rgb(98, 41, 255)` (mor) olurdu.
  expect(renkler.imlec).toBe('rgb(15, 23, 42)')
})
