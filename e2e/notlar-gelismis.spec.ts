import { expect, test, type Locator, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * Görev 8'in uçtan uca doğrulaması: Plan 6'nın yedi görevde yazdığı üç
 * parçanın (Markdown editörü + biçim çubuğu, etiketler, arama) GERÇEK bir
 * tarayıcıda, GERÇEK bir sunucuyla birbirine bağlı çalıştığı — birim
 * testler her parçayı kendi izolasyonunda (jsdom, sahte `fetch`) doğruluyor;
 * parçaların ZİNCİRİ (biçim çubuğu → textarea → otomatik kayıt → sunucu →
 * yeniden yükleme, etiket ekle → Ctrl+K → etiketli seanslar → danışan
 * dosyası, not içeriğinde ara → danışan dosyası) yalnızca burada ölçülebilir.
 *
 * # Ctrl+Z testi neden burada ve neden ÖZEL
 *
 * `NotEditoru::yerelDuzenlemeDene` biçimi `document.execCommand('insertText',
 * …)` ile uyguluyor — amaç tarayıcının YERLİ geri alma (Ctrl+Z) yığınını
 * `setIcerik` ile tüm metni programatik olarak değiştirerek BOZMAMAK (bkz. o
 * fonksiyonun kod başlığı). `document.execCommand` jsdom'da TANIMLI DEĞİL,
 * yani hiçbir birim testi bunu gerçekten ÖLÇEMEZ — testler yalnızca
 * fonksiyonun `execCommand`'i çağırdığını (ya da `false` dönünce düşüş
 * yoluna geçtiğini) doğrulayabilir, geri almanın FİİLEN çalıştığını değil.
 * Gerçek geri alma davranışı yalnızca gerçek bir tarayıcı motorunda ölçülür
 * — bu dosyadaki `test('Ctrl+Z ...')` bu boşluğu kapatıyor.
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
  await expect(page.getByText(ad, { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Takvim', exact: true }).click()
  await page.locator(`button[aria-label$="${saat} boş"]`).first().click()
  // `exact: true` şart: danışan listesindeki "… adlı danışanı arşivle"
  // düğmesi de "Danışan" alt dizgisiyle eşleşir.
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
  await page.getByRole('button', { name: 'Kaydet' }).click()

  const blok = page.getByRole('button', { name: ad, exact: true }).first()
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

/**
 * Bir textarea'da geçen bir sözcüğü GERÇEK tarayıcı seçimiyle işaretler.
 *
 * `setSelectionRange` DOM'un standart seçim API'sidir — çift tıklamayla aynı
 * temel mekanizmayı (tarayıcının kendi seçim durumunu) kullanır, yalnızca
 * piksel koordinatına bağımlı olmadığı için kararlıdır. Asıl ölçülen şey
 * (`document.execCommand('insertText', …)`'in tarayıcının YERLİ geri alma
 * yığınına tek adım olarak girmesi) seçimin NASIL kurulduğundan bağımsızdır:
 * `NotEditoru::bicimUygulaVeYaz` biçim düğmesine basıldığı ANDAKİ
 * `selectionStart`/`selectionEnd`'i okur ve `execCommand`'i KENDİ hesapladığı
 * (değişen aralık) sınırlarıyla çağırır (bkz. `degisenAralikHesapla`).
 */
async function kelimeSec(alan: Locator, kelime: string) {
  await alan.evaluate((el, kelime) => {
    const textarea = el as HTMLTextAreaElement
    const bas = textarea.value.indexOf(kelime)
    if (bas === -1) throw new Error(`kelime metinde bulunamadi: ${kelime}`)
    textarea.focus()
    textarea.setSelectionRange(bas, bas + kelime.length)
  }, kelime)
}

// ---------------------------------------------------------------------------

test('bicim cubugu: secili kelime kalinlasir, Onizle gosterir, sayfa yenilenince kalici', async ({
  page,
}) => {
  await kurulumYap(page)
  const ad = 'Gamze Aydemir'
  const kelime = 'KALINSOZ25'
  const cumle = `Danisan bu hafta ${kelime} konusunda ilerleme kaydetti.`

  const blok = await danisanVeRandevu(page, ad, '08:00')
  const alan = await seansiAc(page, blok)

  await alan.fill(cumle)
  await kelimeSec(alan, kelime)

  // Fare tıklamasında odağın textarea'dan düğmeye kaymaması BicimCubugu'nun
  // kendi `onMouseDown` engellemesiyle sağlanıyor (bkz. o dosyanın kod
  // başlığı); bu satır o davranışa güveniyor.
  await seansPaneli(page).getByRole('button', { name: 'Kalın (Ctrl+B)' }).click()

  // ARTI YÖN: metin `**KALINSOZ25**` içeriyor (saklanan biçim düz metin
  // Markdown işareti — `progress_notes.icerik` biçim DEĞİŞTİRMEZ) VE
  // cümlenin geri kalanı kayıp değil — `bicimUygula` yalnızca seçili
  // sözcüğü sarmalı, TAM EŞİTLİK bunu birlikte ölçüyor.
  await expect(alan).toHaveValue(cumle.replace(kelime, `**${kelime}**`))

  await seansPaneli(page).getByRole('button', { name: 'Önizle', exact: true }).click()
  // Önizlemede GERÇEK bir <strong> elemanı var (dangerouslySetInnerHTML
  // yasak — `markdownOgeleri` React elemanı üretir, HTML dizgisi değil).
  await expect(
    seansPaneli(page).locator('strong', { hasText: kelime }),
  ).toBeVisible()

  await seansPaneli(page).getByRole('button', { name: 'Yaz', exact: true }).click()
  await kaydedildiBekle(page)

  // Yenileme: metnin SUNUCUDA olduğunu kanıtlar (taslak deposu bellekte,
  // sayfa yenilenince sıfırlanır — bkz. `notlar.spec.ts` aynı gerekçe).
  await page.reload()
  await kurulumYap(page)

  const yenidenAlan = await seansiAc(page, blok)
  await expect(yenidenAlan).toHaveValue(cumle.replace(kelime, `**${kelime}**`))
})

test('etiket: seansa eklenir, Ctrl+K etiketi bulur, etiketli seanslardan danisan dosyasina gecilir', async ({
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

  await page.getByRole('button', { name: 'Hızlı arama (Ctrl+K)' }).click()
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
  await expect(page.getByLabel('Seans notu', { exact: true })).toHaveValue(
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

  await page.getByRole('button', { name: 'Hızlı arama (Ctrl+K)' }).click()
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
  await expect(page.getByLabel('Seans notu', { exact: true })).toHaveValue(new RegExp(notTerimi))
})

// ---------------------------------------------------------------------------
// EK TEST (kontrol tarafından zorunlu kılındı, brief'in DIŞINDA): Ctrl+Z
// gerçek tarayıcıda. Bkz. dosya başlığı "Ctrl+Z testi neden burada".
// ---------------------------------------------------------------------------

test('Ctrl+Z gercek tarayicida: yalnizca bicimi geri alir, cumlenin geri kalani kaybolmaz, geri alinan hal kaydedilir', async ({
  page,
}) => {
  await kurulumYap(page)
  const ad = 'Onur Aslan'
  const kelime = 'GERIALKANARYA28'
  const cumle = `Danisan ${kelime} ile ilgili konustu ve devam plani belirlendi.`

  const blok = await danisanVeRandevu(page, ad, '11:00')
  const alan = await seansiAc(page, blok)

  await alan.fill(cumle)
  await kelimeSec(alan, kelime)

  // Bu kez KISAYOLLA (Ctrl+B), araç çubuğu düğmesiyle DEĞİL — brief'in ek
  // testi ikisini de kabul ediyor ("Kalın'a bas ya da Ctrl+B"); kısayol yolu
  // burada tercih edildi çünkü `kisayolTusu` FİZİKSEL tuş koduyla
  // (`event.code`) eşleşiyor ve Playwright'ın `Control+b`'si doğru `code`'u
  // üretiyor (bkz. dosya başlığındaki bağlam notu) — bu da ayrı bir yol.
  await page.keyboard.press('Control+b')

  await expect(alan).toHaveValue(new RegExp(`\\*\\*${kelime}\\*\\*`))

  // ASIL İDDİA: TEK bir Ctrl+Z yalnızca biçimi geri alır. `execCommand`
  // yerli geri alma yığınına TEK adım olarak girdiyse (bkz.
  // `yerelDuzenlemeDene` kod başlığı), bir geri alma cümleyi BAŞLANGIÇ
  // hâline (biçimsiz) döndürmeli — ne bir kısmını, ne fazlasını.
  await page.keyboard.press('Control+z')
  await expect(alan).toHaveValue(cumle)

  // EKSİ YÖN + ARTI YÖN AYNI İDDİADA: yukarıdaki `toHaveValue(cumle)` zaten
  // hem "biçim gitti" hem "cümlenin geri kalanı kayıp değil"i birlikte
  // ölçüyor — TAM EŞİTLİK, yalnızca `**` işaretlerinin yokluğu değil.

  // Geri alınan (biçimsiz) hâlin OTOMATİK KAYITLA sunucuya gittiğini
  // doğrula: native undo bir `input` olayı üretiyor (`inputType:
  // 'historyUndo'`), React'in `onChange`'i bunu yakalıyor ve metin yine TEK
  // giriş noktasından (`icerikDegistir` → `setIcerik`) geçiyor — otomatik
  // kayıt bunun "kullanıcı yazdı" ile aynı olduğunu bilmeden çalışmaya
  // devam ediyor.
  await kaydedildiBekle(page)

  await page.reload()
  await kurulumYap(page)
  const yenidenAlan = await seansiAc(page, blok)
  await expect(yenidenAlan).toHaveValue(cumle)

  // Playwright tarayıcı önbelleğinde WebKit KURULU DEĞİLSE (görev kısıtı:
  // yeni bir tarayıcı motoru İNDİRİLMEZ) bu proje yalnızca Chromium'da
  // koşar; WebKit kuruluysa `--project` ile AYNI dosya orada da koşturulup
  // sonucu görev raporuna yazılır (bkz. görev raporu).
})
