import { expect, test, type APIRequestContext, type Locator, type Page, type Response } from '@playwright/test'
import { kurulumYap, sonSozcuguSec } from './yardimcilar'

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

// `sonSozcuguSec` (satırın son sözcüğünü seçip ProseMirror'un kendi
// seçimini bekleyen, yarışta yeniden deneyen bariyer) `./yardimcilar`'da:
// `notlar-gelismis.spec.ts` ile PAYLAŞILIYOR (Görev 10 bulgusu, Görev 11).

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

type Bolge = { x: number; y: number; width: number; height: number }
type PikselKutusu = { x0: number; y0: number; x1: number; y1: number }

/**
 * Bir sayfa bölgesinin EKRANDA ne gösterdiğini piksellerle özetler.
 *
 * Neden hesaplanmış stil değil de piksel: onay kutusunun iki gerçek arızası
 * da stil okuyarak görünmüyordu. (1) TipTap 3.x'in görev öğesi düğüm
 * görünümü `label > span`'ı görünmez erişilebilir etikete çevirdi (satır
 * içi `clip: rect(0,0,0,0)`, 1×1 px); şablonun kutusu o `span`'da
 * çizildiği için ekranda HİÇ kutu yoktu, oysa `span::before`'un stili
 * (12 px, beyaz, opaklık 1) "tik var" diyordu. (2) Tik bir `data:` SVG
 * maskesiyle çiziliyordu ve CSP (`default-src 'self'`, `img-src` yok) o
 * görseli engelliyor; engellenen maske öğeyi tamamen gizler, stil yine aynı.
 * Bu ölçü uygulamaya bağlı değil: kutu ne ile çizilirse çizilsin, ekranda
 * görünmesi gereken şeyi arar.
 *
 * Görüntü tarayıcıda `createImageBitmap(Blob)` ile çözülür: URL
 * yüklenmediği için sayfanın CSP'sine takılmaz, yeni bağımlılık gerekmez.
 *
 * - `murekkep`: beyaz zeminden seçilir biçimde ayrılan piksellerin sınır
 *   kutusu (boş kutunun %10'luk çerçevesi dahil).
 * - `koyu`: koyu (dolu) piksellerin sınır kutusu — işaretli kutunun zemini.
 * - `koyuIcindeAcik`: `koyu` kutusunun İÇİNDE (kenardan 2 px içeride) açık
 *   piksel sayısı — dolu kutunun üstündeki tik.
 */
async function pikselOzeti(page: Page, bolge: Bolge) {
  const png = await page.screenshot({ clip: bolge, scale: 'css' })
  return page.evaluate(async (b64) => {
    const baytlar = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const resim = await createImageBitmap(new Blob([baytlar], { type: 'image/png' }))
    const tuval = new OffscreenCanvas(resim.width, resim.height)
    const baglam = tuval.getContext('2d')!
    baglam.drawImage(resim, 0, 0)
    const { data, width, height } = baglam.getImageData(0, 0, resim.width, resim.height)
    const parlaklik = (x: number, y: number) => {
      const i = (y * width + x) * 4
      return { enKoyu: Math.min(data[i], data[i + 1], data[i + 2]), ort: (data[i] + data[i + 1] + data[i + 2]) / 3 }
    }
    const sinirKutusu = (kosul: (x: number, y: number) => boolean) => {
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!kosul(x, y)) continue
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
        }
      }
      return x1 < 0 ? null : { x0, y0, x1, y1 }
    }
    const murekkep = sinirKutusu((x, y) => 255 - parlaklik(x, y).enKoyu >= 15)
    const koyu = sinirKutusu((x, y) => parlaklik(x, y).ort < 100)
    let koyuIcindeAcik = 0
    if (koyu !== null) {
      for (let y = koyu.y0 + 2; y <= koyu.y1 - 2; y++) {
        for (let x = koyu.x0 + 2; x <= koyu.x1 - 2; x++) if (parlaklik(x, y).ort > 200) koyuIcindeAcik++
      }
    }
    return { murekkep, koyu, koyuIcindeAcik }
  }, png.toString('base64'))
}

/** Sınır kutusunun KISA kenarı (piksel); kutu yoksa 0. */
const kisaKenar = (k: PikselKutusu | null) => (k === null ? 0 : Math.min(k.x1 - k.x0, k.y1 - k.y0) + 1)

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

test('onay kutusu: kutu ekranda gorunur, tiklayinca dolu kutunun icinde tik cizilir; CSP ihlali yok (tasarim E6)', async ({ page }) => {
  // Tik eskiden `data:` SVG maskesiydi: CSP görseli engelliyor ve Chromium
  // bunu konsola yazıyor ("… violates the following Content Security Policy
  // directive …"). CSP gevşetilmez; tik saf CSS ile çizilir.
  const cspIhlalleri: string[] = []
  page.on('console', (mesaj) => {
    if (/Content Security Policy|violates/i.test(mesaj.text())) cspIhlalleri.push(mesaj.text())
  })
  await kurulumYap(page)
  const ad = 'Jale Tikli'
  await danisanEkle(page, ad)
  const alan = await seansiAc(page, await randevuKur(page, ad, '20:00'))
  await alan.click()
  await page.keyboard.type('[ ] TIK38')
  const liste = alan.locator('ul[data-type="taskList"]')
  const oge = liste.locator(':scope > li')
  await expect(oge.locator('p')).toHaveText('TIK38')
  const kutu = oge.getByRole('checkbox', { name: 'Görev onay kutusu: TIK38' })
  await expect(kutu).not.toBeChecked()

  // Kutunun sütunu: listenin sol kenarından öğe metninin başladığı yere.
  // Metin, imleç ve üstü çizgi bu bölgenin DIŞINDA.
  const bolge = async (): Promise<Bolge> => {
    const l = (await liste.boundingBox())!
    const o = (await oge.boundingBox())!
    const metin = (await oge.locator(':scope > div').boundingBox())!
    return { x: l.x, y: o.y, width: Math.max(1, metin.x - l.x), height: o.height }
  }
  // Görev öğesi çizildi ve bir kare boyandı: maske (varsa) bu noktada
  // istenmiş ve CSP'ye takılmıştır.
  let bos = await pikselOzeti(page, await bolge())
  expect(cspIhlalleri).toEqual([])

  // İşaretsiz: bir kutu GÖRÜNÜR (kullanıcı nereye tıklayacağını görür), dolu değil.
  await expect
    .poll(async () => {
      bos = await pikselOzeti(page, await bolge())
      return { kutuGorunur: kisaKenar(bos.murekkep) >= 10, dolu: bos.koyu !== null }
    })
    .toEqual({ kutuGorunur: true, dolu: false })

  // Kullanıcının GÖRDÜĞÜ kutunun ortasına tıklanır (gizli `input`'a değil).
  const b = await bolge()
  const k = bos.murekkep!
  await page.mouse.click(b.x + (k.x0 + k.x1 + 1) / 2, b.y + (k.y0 + k.y1 + 1) / 2)
  await expect(kutu).toBeChecked()

  // İşaretli: kutu koyu dolu ve İÇİNDE açık renkli bir tik var (dolu ama
  // tiksiz kare — engellenen maske — burada kırılır).
  await expect
    .poll(async () => {
      const dolu = await pikselOzeti(page, await bolge())
      return { doluKutu: kisaKenar(dolu.koyu) >= 10, tik: dolu.koyuIcindeAcik >= 8 }
    })
    .toEqual({ doluKutu: true, tik: true })
  expect(cspIhlalleri).toEqual([])
})

test('E8: kayitli zengin notu acmak, tiklamak ve imleci gezdirmek YAZMAZ; tek harf tek PUT (tasarim E8)', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Kerem Acar'
  await danisanEkle(page, ad)
  const blok = await randevuKur(page, ad, '20:00')
  const id = await randevuKimligi(request, ad, '20:00')
  const notYolu = `/api/randevular/${id}/not`

  // Sunucudaki not TipTap'ın KENDİ çıktısı DEĞİL: `<b>`, `<p>`'siz liste ve
  // görev öğesi, `target`/`rel`'siz bağlantı. Editör açılışta bunu kendi
  // biçimine normalleştirir; bu bir değişiklik SAYILMAMALI (E8). Not başka
  // bir sürümün (TipTap yükseltmesi çıktıyı değiştirir) ya da şablonun
  // yazdığı hâli temsil eder. Editörün kendi yazdığı bir not burada az şey
  // ölçerdi: yeniden normalleştirme onu değiştirmez. Belge bir LİSTEYLE
  // biter (`TrailingNode` ilk işlemde sona `<p>` eklerdi, preflight F12).
  const ham =
    '<h2>Gözlem</h2><p>Danışan <b>kaygı</b> anlattı; kaynak: <a href="https://ornek.invalid/makale">makale</a></p>' +
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">ödev verildi</li>' +
    '<li data-type="taskItem" data-checked="false">ölçek doldurulacak</li></ul>' +
    '<ul><li>madde bir</li><li>madde SON39</li></ul>'
  const kayit = await request.put(notYolu, { data: { sablon: 'serbest', icerik: ham } })
  expect(kayit.status()).toBe(200)

  // Sayım İLK açılıştan önce başlar: açılış, ayrılış (tahliye) ve yeniden
  // açılışın HİÇBİRİ yazmamalı.
  const notPutlari: string[] = []
  page.on('request', (istek) => {
    if (istek.method() === 'PUT' && new URL(istek.url()).pathname === notYolu) notPutlari.push(istek.postData() ?? '')
  })

  const ilk = await seansiAc(page, blok)
  await expect(ilk.locator('h2')).toHaveText('Gözlem')
  await takvimeDon(page)

  const alan = await seansiAc(page, blok)
  await expect(alan.locator('strong')).toHaveText('kaygı')
  await expect(alan.locator('ul[data-type="taskList"] input[type="checkbox"]').first()).toBeChecked()
  // Tıklamalar: paragraf, bağlantı (editörde bağlantıyı seçer, açmaz),
  // görev metni, son liste öğesi. Onay kutusuna tıklanmaz (o bir değişiklik).
  await alan.locator('strong', { hasText: 'kaygı' }).click()
  await alan.getByRole('link', { name: 'makale' }).click()
  // (`getByText` DEĞİL: görev öğesinin görünmez erişilebilir etiketi de bu
  // metni taşır.)
  await alan.locator('ul[data-type="taskList"] p', { hasText: 'ölçek doldurulacak' }).click()
  await alan.locator('ul:not([data-type="taskList"]) p', { hasText: 'madde SON39' }).click()
  // İmleç gezintisi: yukarı-aşağı bütün bloklardan geçer, belge sonuna iner.
  for (const tus of ['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'Home', 'End']) {
    await page.keyboard.press(tus)
  }
  await page.keyboard.press(MAC ? 'Meta+ArrowDown' : 'Control+End')

  // "Hiçbir şey olmaz" iddiası: beklenecek bir durum yok, bu yüzden SINIRLI
  // bekleme — otomatik kayıt gecikmesinin (2 sn, `NotEditoru`) üstünde.
  await page.waitForTimeout(3_000)
  expect(notPutlari).toEqual([])

  // ARTI YÖN (sayaç kör değil): tek harf, AYNI yola tam bir PUT üretir.
  // İmleç belge sonunda: harf son liste öğesine eklenir.
  await page.keyboard.type('x')
  await expect.poll(() => notPutlari.length).toBe(1)
  await kaydedildiBekle(page)
  expect(JSON.parse(notPutlari[0]).icerik).toContain('madde SON39x')
  await page.waitForTimeout(3_000)
  expect(notPutlari).toHaveLength(1)
  await expect.poll(() => sunucuNotu(request, id)).toContain('madde SON39x')
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
  //
  // # Süre neden duvar saatiyle değil, tarayıcının ağ zamanlarıyla ölçülüyor
  //
  // P4'ün ürün tarafı yoklamadır: pencere `/api/durum`'u 5 sn'de bir sorar
  // ve "kilitli" yanıtında içeriği kaldırır. İlk sürüm bunu tek bir duvar
  // saati bütçesiyle ölçüyordu (ana pencerede "Kilitli" + 7 sn) ve tam e2e
  // koşusunda ara sıra kırıldı. Ölçüldü (tarayıcının kaynak zamanları):
  // yoklama ZAMANINDA gitti (kilitten ~4,85 sn sonra) ama e2e sunucusu o
  // `/api/durum`'u 2,6 sn'de yanıtladı. Bu sunucu dokuz spec dosyasına tek
  // süreçten, hata ayıklama derlemesiyle hizmet veriyor; başka dosyaların
  // kilit açma/kurulum Argon2id türetmeleri (hata ayıklamada 2-4 sn) o anda
  // koşuyor. Gecikme ortamın, ürünün değil; yerel sunucu üretimde tek
  // kullanıcıya milisaniyede yanıt verir.
  //
  // Bu yüzden iddia ikiye bölündü ve ürünün payı DAHA SIKI ölçülüyor:
  // (1) kilitten sonraki ilk yoklama, kilit yanıtından en geç 5 sn (+0,5 sn
  //     zamanlayıcı payı) sonra GÖNDERİLDİ — iki zaman da tarayıcının ağ
  //     yığınından (`timing().startTime`, aynı duvar saati), yani test
  //     sürecinin ve sunucunun gecikmesinden bağımsız; 6 sn'lik bir aralık
  //     da, hiç yoklamamak da burada kırılır;
  // (2) o yoklamanın yanıtı "kilitli" dedi ve kilit ekranı yanıttan en geç
  //     3 sn sonra ekranda (çizim payı; yeni bir yoklamanın, 5 sn, altında).
  const YOKLAMA_MS = 5_000
  const ZAMANLAYICI_PAYI_MS = 500
  const yoklamaYanitlari: Response[] = []
  pencere.on('response', (yanit) => {
    if (new URL(yanit.url()).pathname === '/api/durum') yoklamaYanitlari.push(yanit)
  })
  const [kilitYaniti] = await Promise.all([
    page.waitForResponse((yanit) => new URL(yanit.url()).pathname === '/api/kilitle'),
    page.getByRole('button', { name: 'Kilitle' }).click(),
  ])
  await kilitYaniti.finished()
  const kilitZamani = kilitYaniti.request().timing().startTime + kilitYaniti.request().timing().responseEnd
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()

  const kilittenSonraki = () => yoklamaYanitlari.find((y) => y.request().timing().startTime >= kilitZamani)
  await expect.poll(() => kilittenSonraki() !== undefined).toBe(true)
  const yoklama = kilittenSonraki()!
  expect(yoklama.request().timing().startTime - kilitZamani).toBeLessThanOrEqual(YOKLAMA_MS + ZAMANLAYICI_PAYI_MS)
  expect(((await yoklama.json()) as { kilitli: boolean }).kilitli).toBe(true)
  await expect(pencere.getByRole('heading', { name: 'Kilitli' })).toBeVisible({ timeout: 3_000 })
  await expect(pencere.getByText(kanarya)).toHaveCount(0)
  await expect(pencere.getByText(ad)).toHaveCount(0)
  await pencere.close()
})
