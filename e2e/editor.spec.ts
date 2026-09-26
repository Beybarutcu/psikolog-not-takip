import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * Seans notu sayfası ve biçimli editörün uçtan uca doğrulaması (tasarım
 * 2026-09-26 §11). Birim testler not yüzeyini jsdom'da bir `<textarea>`
 * test yüzeyiyle sürer (`test-kurulum.ts`); GERÇEK TipTap/ProseMirror'un
 * tarayıcıdaki davranışı — girdi kuralları, klavye eşlemesi, yapıştırma
 * ayrıştırması, bağlantı tıklaması, `window.open` — yalnızca burada ölçülür.
 *
 * # Paylaşılan sunucu durumu — saat seçimi
 *
 * Bu dosya kendi sunucusunda ve kendi veri dizininde koşar (port 7708).
 * Testler aynı sunucuyu paylaşır ve sırayla koşar; her test kendi danışanını
 * ve kendi saatlerini kullanır. "Önceki seans" gerektiren testlerde bütün
 * randevular haftanın İLK boş gününe düşer (`.first()`), yani aynı güne;
 * erken saat "önceki"dir. Kilitleyen test EN SONDA: sonraki bir testin
 * kilit açma maliyeti (Argon2id) olmasın.
 *
 * # Dış bağlantı ağa ÇIKMAZ
 *
 * `ornek.invalid` hiçbir zaman çözülmeyen ayrılmış bir alan adı ve her test
 * bağlamında `context.route` ile yerelde karşılanır: test bir yeni sekme
 * açıldığını ölçer, internete istek atmaz.
 *
 * # Senkronizasyon bariyeri: ProseMirror'un KENDİ seçimi
 *
 * Sözcük seçimi (Ctrl/Option+Shift+←) tarayıcının yerli davranışı;
 * ProseMirror yeni seçimi ancak `selectionchange` olayında okur ve o olay
 * bir sonraki tuştan SONRA işlenebilir. Yüklü makinede (tam e2e koşusu)
 * Ctrl+B bu yüzden ESKİ seçime uygulanabiliyor (Görev 5'te
 * `notlar-gelismis.spec.ts`'te yaşandı). Seçimden sonra biçim kısayolu
 * basan her test, editörün kendi durumundaki seçim beklenen sözcük olana
 * kadar bekler (`sonSozcuguSec`); sabit bekleme YOK. Yalnızca yazma ve
 * Enter kullanan adımlar bariyer gerektirmez: ProseMirror onları kendi
 * olay işleyicisinde (tuş haritası, `handleTextInput`) eşzamanlı işler.
 */

test.beforeEach(async ({ context }) => {
  await context.route('https://ornek.invalid/**', (istek) =>
    istek.fulfill({ status: 200, contentType: 'text/html', body: '<p>dis</p>' }),
  )
})

const MAC = process.platform === 'darwin'

/** TipTap editör örneğini ProseMirror kök öğesine `editor` olarak asar. */
type EditorluKok = HTMLElement & {
  editor?: {
    state: { doc: { textBetween(a: number, b: number): string }; selection: { from: number; to: number } }
    isActive(ad: string): boolean
  }
}

/** Otomatik kaydın "sunucuya yazıldı" göstergesi (bkz. `notlar.spec.ts`). */
async function kaydedildiBekle(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Kaydedildi \d{2}:\d{2}$/ })).toBeVisible()
}

/** Danışan ekler ve Takvim sekmesine döner. */
async function danisanEkle(page: Page, ad: string) {
  await page.getByRole('tab', { name: 'Danışanlar', exact: true }).click()
  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill(ad)
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText(ad, { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Takvim', exact: true }).click()
}

/** Izgaradaki blok (blok adı `SS:DD Ad`; durumsuz randevuda ek yok). */
function blokBul(page: Page, ad: string, saat: string): Locator {
  return page.getByTestId('takvim-izgara').getByRole('button', { name: `${saat} ${ad}`, exact: true })
}

/** Haftanın ilk boş gününde verilen saate randevu kurar, bloğu döndürür. */
async function randevuKur(page: Page, ad: string, saat: string): Promise<Locator> {
  await page.locator(`button[aria-label$="${saat} boş"]`).first().click()
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
  await page.getByRole('button', { name: 'Kaydet' }).click()
  const blok = blokBul(page, ad, saat)
  await expect(blok).toBeVisible()
  return blok
}

/** Bloğa tıklar; not sayfası ızgaranın yerine açılır. Editörü döndürür. */
async function seansiAc(page: Page, blok: Locator): Promise<Locator> {
  await blok.click()
  const alan = page.getByLabel('Seans notu', { exact: true })
  await expect(alan).toBeVisible()
  return alan
}

async function takvimeDon(page: Page) {
  await page.getByRole('button', { name: 'Takvime dön', exact: true }).click()
  await expect(page.getByTestId('takvim-izgara')).toBeVisible()
}

/** Editörün KENDİ durumundaki seçili metin (DOM seçimi değil). */
function seciliMetin(alan: Locator): Promise<string | null> {
  return alan.evaluate((el) => {
    const durum = (el as EditorluKok).editor?.state
    return durum ? durum.doc.textBetween(durum.selection.from, durum.selection.to) : null
  })
}

/**
 * Satırın SON sözcüğünü klavyeyle seçer (satır sonu, sonra macOS'ta
 * Option, diğerlerinde Ctrl + Shift+←) ve ProseMirror'un kendi seçimi
 * `beklenen` olana kadar bekler (bkz. modül başlığı "Senkronizasyon
 * bariyeri"). Bu makinede yalnızca Windows dalı koşar.
 *
 * # Neden jest bir kez daha yapılabiliyor
 *
 * ProseMirror'un `focus` işleyicisi 20 ms'lik bir zamanlayıcı kurar: o an
 * DOM seçimi kendi son kaydından farklıysa KENDİ seçimini DOM'a geri yazar.
 * Chromium, CDP'den art arda gelen girdi olaylarını zamanlayıcılardan önce
 * işler; tıklayıp hemen yazan bir testte zamanlayıcı bu yüzden yazma boyunca
 * aç kalır ve sözcük seçiminin HEMEN ARDINDAN çalışıp yeni seçimi siler
 * (ölçüldü: 28 denemede 15 kez; yığın `handlers.focus` → `selectionToDOM`).
 * İnsan hızında yazmada zamanlayıcı ilk tuştan çok önce çalışır; bu bir
 * ürün hatası değil, otomasyonun hızının ürettiği bir yarış. Seçim
 * silinirse jest (satır sonu + seçim) yeniden yapılır: satır sonu seçimi
 * her denemede sıfırlar, yani gecikmeyle işlenmiş bir önceki deneme seçimi
 * büyütmez. Zamanlayıcı odak başına bir kez kurulduğu için ikinci deneme
 * bu yarışa girmez. Kısayol yine ANCAK editörün kendi seçimi `beklenen`
 * olduktan sonra basılır.
 */
async function sonSozcuguSec(page: Page, alan: Locator, beklenen: string) {
  await expect(async () => {
    await page.keyboard.press(MAC ? 'Meta+ArrowRight' : 'End')
    await page.keyboard.press(MAC ? 'Alt+Shift+ArrowLeft' : 'Control+Shift+ArrowLeft')
    await expect.poll(() => seciliMetin(alan), { timeout: 1_000 }).toBe(beklenen)
  }).toPass({ timeout: 15_000 })
}

/**
 * Türkçe Q düzeninde basılmış bir Ctrl/Cmd kısayolunu editöre gönderir.
 *
 * Playwright'ın klavyesi düzen seçemez (hep ABD): Türkçe Q'da I tuşu
 * `key: 'ı'`, Shift+8 `key: '('` üretir; `Mod-i` / `Mod-Shift-8` eşlemesi
 * `key`le bulunamaz. ProseMirror'un tuş haritası (`prosemirror-keymap`)
 * değiştirici basılıyken `keyCode`'a (fiziksel tuş: 73 = I, 56 = 8) düşer.
 * Olay bu yüzden elle kurulur; `KeyboardEvent` kurucusu `keyCode`'u 0
 * bıraktığı için o da elle tanımlanır.
 */
async function turkceQKisayolu(alan: Locator, tus: { key: string; code: string; keyCode: number; shift?: boolean }) {
  await alan.evaluate(
    (el, { tus, mac }) => {
      const olay = new KeyboardEvent('keydown', {
        key: tus.key,
        code: tus.code,
        ctrlKey: !mac,
        metaKey: mac,
        shiftKey: tus.shift ?? false,
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperty(olay, 'keyCode', { get: () => tus.keyCode })
      el.dispatchEvent(olay)
    },
    { tus, mac: MAC },
  )
}

/**
 * Editöre HTML yapıştırır: gerçek bir `paste` olayı, `text/html` taşıyan
 * `DataTransfer` ile. ProseMirror yapıştırmayı `clipboardData`'dan okur;
 * sistem panosuna dokunulmaz.
 */
async function htmlYapistir(alan: Locator, html: string) {
  await alan.click()
  await alan.evaluate((el, html) => {
    const veri = new DataTransfer()
    veri.setData('text/html', html)
    veri.setData('text/plain', html.replace(/<[^>]*>/g, ''))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: veri, bubbles: true, cancelable: true }))
  }, html)
}

async function randevuKimligi(request: APIRequestContext, ad: string, saat: string): Promise<number> {
  const yanit = await request.get('/api/randevular?baslangic=2000-01-01T00:00&bitis=2100-01-01T00:00')
  expect(yanit.status()).toBe(200)
  const liste: Array<{ id: number; danisan_adi: string; baslangic: string }> = await yanit.json()
  const bulunan = liste.find((r) => r.danisan_adi === ad && r.baslangic.slice(11, 16) === saat)
  expect(bulunan, `${ad} ${saat}`).toBeDefined()
  return bulunan!.id
}

async function sunucuNotu(request: APIRequestContext, id: number): Promise<string> {
  const yanit = await request.get(`/api/randevular/${id}/not`)
  expect(yanit.status()).toBe(200)
  return ((await yanit.json()) as { icerik: string }).icerik
}

// ---------------------------------------------------------------------------

test('bicim kalici: "## " basliga, Ctrl/Cmd+B kalina doner; isaret ne ekranda ne sunucuda', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Aylin Korkmaz'
  await danisanEkle(page, ad)
  const alan = await seansiAc(page, await randevuKur(page, ad, '09:00'))

  await alan.click()
  await page.keyboard.type('## Gözlem')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Danışan bugün KALIN30')
  await sonSozcuguSec(page, alan, 'KALIN30')
  await page.keyboard.press('ControlOrMeta+b')

  await expect(alan.locator('h2')).toHaveText('Gözlem')
  await expect(alan.locator('strong')).toHaveText('KALIN30')
  await expect(alan).not.toContainText('##')
  await expect(alan).not.toContainText('**')
  await kaydedildiBekle(page)

  const icerik = await sunucuNotu(request, await randevuKimligi(request, ad, '09:00'))
  expect(icerik).toContain('<h2>Gözlem</h2>')
  expect(icerik).toContain('<strong>KALIN30</strong>')
  expect(icerik).not.toContain('##')
  expect(icerik).not.toContain('**')

  await page.reload()
  await kurulumYap(page)
  const yeniden = await seansiAc(page, blokBul(page, ad, '09:00'))
  await expect(yeniden.locator('h2')).toHaveText('Gözlem')
  await expect(yeniden.locator('strong')).toHaveText('KALIN30')
})

test('Turkce Q: I tusu "ı", Shift+8 "(" uretse de Ctrl/Cmd+I italik, Ctrl/Cmd+Shift+8 madde listesi yapar (keyCode dusumu, tasarim E5)', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Burcu Işık'
  await danisanEkle(page, ad)
  const alan = await seansiAc(page, await randevuKur(page, ad, '10:00'))
  await alan.click()
  await page.keyboard.type('Danışan anlattı EGIK31')
  await sonSozcuguSec(page, alan, 'EGIK31')

  await turkceQKisayolu(alan, { key: 'ı', code: 'KeyI', keyCode: 73 })
  await expect(alan.locator('em')).toHaveText('EGIK31')
  await expect(alan).toHaveText('Danışan anlattı EGIK31')

  // Seçim hâlâ paragrafın içinde: madde listesi paragrafı sarar. İmleç
  // taşınmıyor, yani bariyer gerekmiyor.
  await turkceQKisayolu(alan, { key: '(', code: 'Digit8', keyCode: 56, shift: true })
  await expect(alan.locator('ul > li')).toHaveText('Danışan anlattı EGIK31')
  await expect(alan.locator('ul em')).toHaveText('EGIK31')
  // Kısayol metin üretmedi: `(` da `ı` da eklenmedi.
  await expect(alan).toHaveText('Danışan anlattı EGIK31')
})

test('yazarken donusum: "- ", "1. ", "> ", "[ ] " ve **x** isaretsiz dugume doner (tasarim E6)', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Hale Demir'
  await danisanEkle(page, ad)
  const alan = await seansiAc(page, await randevuKur(page, ad, '18:00'))

  await alan.click()
  // Her blokta ikinci Enter boş öğeden/paragraftan çıkar (liste ve alıntı).
  for (const satir of ['- MADDE36', '1. SIRA36', '> ALINTI36', '[ ] GOREV36']) {
    await page.keyboard.type(satir)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
  }
  await page.keyboard.type('Bu **KALIN36** oldu')

  await expect(alan.locator('ul:not([data-type="taskList"]) > li')).toHaveText('MADDE36')
  await expect(alan.locator('ol > li')).toHaveText('SIRA36')
  await expect(alan.locator('blockquote')).toHaveText('ALINTI36')
  await expect(alan.locator('ul[data-type="taskList"] > li p')).toHaveText('GOREV36')
  await expect(alan.locator('ul[data-type="taskList"] input[type="checkbox"]')).not.toBeChecked()
  await expect(alan.locator('strong')).toHaveText('KALIN36')
  // İşaretlerin HİÇBİRİ metinde kalmadı ve başıboş paragraf yok: bütün
  // metin blokları sırasıyla yalnızca sözcükler. (Onay kutusu öğesinin
  // görünmez erişilebilir etiketi — TaskItem düğüm görünümünün `<span>`'ı —
  // paragraf olmadığı için sayılmaz.)
  await expect(alan.locator('p')).toHaveText(['MADDE36', 'SIRA36', 'ALINTI36', 'GOREV36', 'Bu KALIN36 oldu'])
  await kaydedildiBekle(page)

  const icerik = await sunucuNotu(request, await randevuKimligi(request, ad, '18:00'))
  expect(icerik).toContain('<ul><li><p>MADDE36</p></li></ul>')
  expect(icerik).toMatch(/<ol[^>]*><li><p>SIRA36<\/p><\/li><\/ol>/)
  expect(icerik).toContain('<blockquote><p>ALINTI36</p></blockquote>')
  expect(icerik).toMatch(/<ul data-type="taskList"><li[^>]*data-checked="false"[^>]*>.*GOREV36/)
  expect(icerik).toContain('Bu <strong>KALIN36</strong> oldu')
  for (const isaret of ['- MADDE36', '1. SIRA36', '&gt; ALINTI36', '[ ]', '**']) {
    expect(icerik, isaret).not.toContain(isaret)
  }
})

test('kisayollar: Ctrl/Cmd+U alti cizili, Ctrl/Cmd+Alt+1/2/3 baslik, Ctrl/Cmd+Shift+7/9 liste (tasarim E5)', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'İlker Su'
  await danisanEkle(page, ad)
  const alan = await seansiAc(page, await randevuKur(page, ad, '19:00'))

  await alan.click()
  // Seçimsiz Ctrl+U saklı işareti açar/kapatır: aradaki yazı altı çizili.
  await page.keyboard.press('ControlOrMeta+u')
  await page.keyboard.type('ALTI37')
  await page.keyboard.press('ControlOrMeta+u')
  await page.keyboard.type(' duz')
  await page.keyboard.press('Enter')
  for (const [metin, duzey] of [['BIR37', 1], ['IKI37', 2], ['UC37', 3]] as const) {
    await page.keyboard.type(metin)
    await page.keyboard.press(`ControlOrMeta+Alt+${duzey}`)
    await page.keyboard.press('Enter')
  }
  await page.keyboard.type('NUMARA37')
  await page.keyboard.press('ControlOrMeta+Shift+7')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('ONAY37')
  await page.keyboard.press('ControlOrMeta+Shift+9')

  await expect(alan.locator('u')).toHaveText('ALTI37')
  await expect(alan.locator('h1')).toHaveText('BIR37')
  await expect(alan.locator('h2')).toHaveText('IKI37')
  await expect(alan.locator('h3')).toHaveText('UC37')
  await expect(alan.locator('ol > li')).toHaveText('NUMARA37')
  await expect(alan.locator('ul[data-type="taskList"] > li p')).toHaveText('ONAY37')
  await expect(alan.locator('p, h1, h2, h3')).toHaveText(['ALTI37 duz', 'BIR37', 'IKI37', 'UC37', 'NUMARA37', 'ONAY37'])
  await kaydedildiBekle(page)

  const icerik = await sunucuNotu(request, await randevuKimligi(request, ad, '19:00'))
  expect(icerik).toContain('<p><u>ALTI37</u> duz</p>')
  expect(icerik).toContain('<h1>BIR37</h1><h2>IKI37</h2><h3>UC37</h3>')
  expect(icerik).toMatch(/<ol[^>]*><li><p>NUMARA37<\/p><\/li><\/ol>/)
  expect(icerik).toMatch(/<ul data-type="taskList"><li[^>]*>.*ONAY37/)
})

test('yapistirma: gorsel, betik, cerceve ve olay ozniteligi duser; sunucudaki HTML temiz (tasarim E11)', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Cem Kaya'
  await danisanEkle(page, ad)
  const alan = await seansiAc(page, await randevuKur(page, ad, '11:00'))

  await htmlYapistir(
    alan,
    '<p>YAPISTIR32 <b>kalin</b></p><img src="/yok.png" onerror="window.__xss = 1">' +
      '<script>window.__xss = 2</script><p onclick="window.__xss = 3">tikla</p>' +
      '<iframe src="https://ornek.invalid/cerceve"></iframe>',
  )
  await expect(alan.locator('strong')).toHaveText('kalin')
  await expect(alan).toContainText('tikla')
  await expect(alan.locator('img, script, iframe, [onclick], [onerror]')).toHaveCount(0)
  await alan.getByText('tikla').click()
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  await kaydedildiBekle(page)

  const icerik = await sunucuNotu(request, await randevuKimligi(request, ad, '11:00'))
  expect(icerik).toContain('YAPISTIR32')
  expect(icerik).toContain('<strong>kalin</strong>')
  for (const yasak of ['<img', '<script', '<iframe', 'onclick', 'onerror', '__xss', 'ornek.invalid']) {
    expect(icerik, yasak).not.toContain(yasak)
  }
})

test('onceki notlarda arama Turkce harf duyarsiz; genis okumada vurgulu; "Bu seansa git" o seansi acar (N6-N8)', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Deniz Şahin'
  const eskiNot = 'Danışan KAYGI anlattı; kaygı azaldı. ARAMA33'
  await danisanEkle(page, ad)
  const onceki = await seansiAc(page, await randevuKur(page, ad, '12:00'))
  await onceki.fill(eskiNot)
  await kaydedildiBekle(page)
  await takvimeDon(page)
  // Terimi TAŞIMAYAN ikinci önceki seans: arama listeyi gerçekten daraltmalı
  // (2 → 1); tek önceki seansla "1 satır" iddiası aramadan önce de doğruydu.
  const baska = await seansiAc(page, await randevuKur(page, ad, '08:00'))
  await baska.fill('Uyku duzeni konusuldu. DIGER33')
  await kaydedildiBekle(page)
  await takvimeDon(page)

  const alan = await seansiAc(page, await randevuKur(page, ad, '15:00'))
  await alan.fill('Bu seansin YARIM33 metni')
  const bolge = page.getByRole('region', { name: 'Önceki seans notları' })
  const satirlar = bolge.getByRole('listitem')
  await expect(satirlar).toHaveCount(2)
  const darGenislik = (await bolge.boundingBox())!.width

  await bolge.getByRole('searchbox', { name: 'Önceki notlarda ara' }).fill('kaygi')
  await expect(satirlar).toHaveCount(1)
  await expect(satirlar).toContainText(', 12:00')
  await expect(satirlar.locator('mark').first()).toHaveText('KAYGI')

  await satirlar.getByRole('button').click()
  await expect(bolge.locator('.not-vurgu')).toHaveText(['KAYGI', 'kaygı'])
  // Geniş okuma salt okunur bir belge, yazılabilir alan değil (F2).
  await expect(bolge.getByRole('document')).toContainText('ARAMA33')
  await expect(bolge.getByRole('textbox')).toHaveCount(0)
  // N7: sütun sayfanın yarısına büyür; bu seansın editörü ve yazılanı yerinde.
  await expect.poll(async () => (await bolge.boundingBox())!.width).toBeGreaterThan(darGenislik * 1.5)
  await expect(alan).toHaveText('Bu seansin YARIM33 metni')

  await bolge.getByRole('button', { name: 'Bu seansa git' }).click()
  await expect(page.getByRole('region', { name: 'Seans', exact: true })).toContainText(', 12:00')
  await expect(page.getByLabel('Seans notu', { exact: true })).toHaveText(eskiNot)
  // Giden seansın yazılanı kaybolmadı (tahliye ya da otomatik kayıt).
  const id15 = await randevuKimligi(request, ad, '15:00')
  await expect.poll(() => sunucuNotu(request, id15)).toContain('YARIM33')
})

test('dis baglanti: editorde tiklamak gezinmez; okuma gorunumunde yeni sekmede acilir, uygulama yerinde kalir', async ({ page, context, request }) => {
  await kurulumYap(page)
  const ad = 'Fikret Oral'
  await danisanEkle(page, ad)
  const onceki = await seansiAc(page, await randevuKur(page, ad, '14:00'))
  // Web sayfasından kopyalanan bağlantı kendi `target`/`rel`'ini taşıyabilir;
  // `_self` uygulama penceresini bağlantıya götürürdü. Şema ikisini de
  // ayrıştırmada ZORLAR (`uzantilar.ts`, preflight F13).
  await htmlYapistir(
    onceki,
    '<p>Kaynak BAGLANTI34: <a href="https://ornek.invalid/makale" target="_self" rel="opener">makale</a></p>',
  )
  const editordeki = onceki.getByRole('link', { name: 'makale' })
  await expect(editordeki).toHaveAttribute('href', 'https://ornek.invalid/makale')
  await expect(editordeki).toHaveAttribute('target', '_blank')
  await expect(editordeki).toHaveAttribute('rel', 'noopener noreferrer')
  await kaydedildiBekle(page)
  const icerik = await sunucuNotu(request, await randevuKimligi(request, ad, '14:00'))
  expect(icerik).toContain('href="https://ornek.invalid/makale"')
  expect(icerik).toContain('noopener')
  expect(icerik).not.toContain('_self')
  expect(icerik).not.toContain('"opener"')

  const adres = page.url()
  // EKSİ YÖN için SINIRLI pencere: tıkta açılan bir sekme (`window.open` ya da
  // yerli `target=_blank`) aynı tıkın içinde doğar ve 2 sn içinde `page`
  // olayı üretir. Sabit bekleme değil: olay gelirse hemen kırılır.
  const acilanSekme = context.waitForEvent('page', { timeout: 2_000 }).then(() => true, () => false)
  await editordeki.click()
  expect(await acilanSekme).toBe(false)
  expect(page.url()).toBe(adres)
  // Tık bağlantıyı AÇMADI ama işlendi: seçim bağlantıda (E10: editörde bağlantı düzenlenir).
  const baglantidaMi = () => onceki.evaluate((el) => (el as EditorluKok).editor?.isActive('link') ?? null)
  await expect.poll(baglantidaMi).toBe(true)

  await takvimeDon(page)
  await seansiAc(page, await randevuKur(page, ad, '17:00'))
  const bolge = page.getByRole('region', { name: 'Önceki seans notları' })
  await bolge.getByRole('button', { name: /, 14:00/ }).click()
  const [dis] = await Promise.all([
    context.waitForEvent('page'),
    bolge.getByRole('link', { name: 'makale' }).click(),
  ])
  await dis.waitForURL('https://ornek.invalid/makale')
  expect(page.url()).toBe(adres)
  await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
  await dis.close()
})

test('okuma penceresi kilitte icerigi kaldirir: sag tik "Yeni pencerede ac", salt okunur, ayni seans ayni pencere (P2-P4)', async ({ page, context }) => {
  await kurulumYap(page)
  const ad = 'Ece Yurt'
  const kanarya = 'PENCERE35 eski seansin notu'
  await danisanEkle(page, ad)
  const onceki = await seansiAc(page, await randevuKur(page, ad, '13:00'))
  await onceki.fill(kanarya)
  await kaydedildiBekle(page)
  await takvimeDon(page)
  await seansiAc(page, await randevuKur(page, ad, '16:00'))

  const bolge = page.getByRole('region', { name: 'Önceki seans notları' })
  const satir = bolge.getByRole('button', { name: /, 13:00/ })
  await satir.click({ button: 'right' })
  const [pencere] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('menuitem', { name: 'Yeni pencerede aç' }).click(),
  ])
  await expect(pencere).toHaveURL(/\/\?okuma=\d+$/)
  await expect(pencere.getByRole('heading', { level: 1 })).toContainText(ad)
  await expect(pencere.getByText(kanarya)).toBeVisible()
  // Salt okunur: not bir belge, yazılabilir alan değil (F2); düğme yok.
  // (`main` içinde: `<html>` öğesinin örtük rolü de `document`.)
  await expect(pencere.getByRole('main').getByRole('document')).toContainText(kanarya)
  await expect(pencere.getByRole('textbox')).toHaveCount(0)
  await expect(pencere.getByRole('button')).toHaveCount(0)
  // Danışan adı yalnızca sayfanın İÇİNDE; pencere başlığında değil.
  expect(await pencere.title()).not.toContain(ad)
  // Ana pencere yerinde: aynı seans sayfası açık, geniş okumaya geçilmedi.
  await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
  await expect(bolge.getByRole('button', { name: 'Listeye dön' })).toHaveCount(0)

  // P3: aynı seans ikinci kez (Cmd/Ctrl+tık) istenince AYNI pencere kullanılır.
  const sayfaSayisi = context.pages().length
  await Promise.all([pencere.waitForEvent('framenavigated'), satir.click({ modifiers: ['ControlOrMeta'] })])
  await expect(pencere.getByText(kanarya)).toBeVisible()
  expect(context.pages()).toHaveLength(sayfaSayisi)

  // P4: ana pencerede Kilitle -> okuma penceresi 5 sn'lik yoklamayla kilit ekranına.
  await page.getByRole('button', { name: 'Kilitle' }).click()
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()
  // 5 sn yoklama + istek ve çizim payı; genel 15 sn bütçesinden BİLEREK dar.
  await expect(pencere.getByRole('heading', { name: 'Kilitli' })).toBeVisible({ timeout: 7_000 })
  await expect(pencere.getByText(kanarya)).toHaveCount(0)
  await expect(pencere.getByText(ad)).toHaveCount(0)
  await pencere.close()
})
