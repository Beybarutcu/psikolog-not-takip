import { expect, type Locator, type Page } from '@playwright/test'

const PAROLA = 'gizliparola'
const MAC = process.platform === 'darwin'

// Bu yardımcı hem notlar.spec.ts hem de takvim.spec.ts tarafından
// kullanılıyor. Her spec dosyası artık KENDİ sunucusunda ve kendi veri
// dizininde koşuyor (bkz. playwright.config.ts SUNUCULAR), yani dosyalar
// arası durum sızıntısı yok. Dosya İÇİNDE ise durum bilerek paylaşılıyor:
// ilk test kurulumu yapar, sonrakiler ya doğrudan ana ekranı bulur ya da
// (bir önceki test "Kilitle"ye bastıysa) kilit ekranını görüp parolayla
// açar. Üç ekranın da tanınması bu yüzden gerekli.
//
// ZAMANLAMA. Kilit açma ucuz DEĞİL ve öyle olması amaçlanıyor: Argon2id,
// 64 MiB / t=3 (`KdfParams::default`). e2e sunucusu debug profilinde
// derlendiği için ölçülen süre kilit açmada ~2,1 sn, kurulumda (iki
// sarmalama) ~4,3 sn. Playwright'ın varsayılan 5 sn'lik iddia bütçesi
// buna dar geliyordu; bütçe playwright.config.ts'te `expect.timeout` ile
// büyütüldü (gerekçesi orada).
export async function kurulumYap(page: Page) {
  await page.goto('/')

  const anaBaslik = page.getByRole('heading', { name: 'Terapi Notları' })
  const kilitliBaslik = page.getByRole('heading', { name: 'Kilitli' })
  const hosGeldinBasligi = page.getByRole('heading', { name: 'Hoş geldiniz' })

  await expect(anaBaslik.or(kilitliBaslik).or(hosGeldinBasligi)).toBeVisible()

  if (await anaBaslik.isVisible()) return

  if (await kilitliBaslik.isVisible()) {
    await page.getByLabel('Ana parola').fill(PAROLA)
    await page.getByRole('button', { name: 'Aç' }).click()
    await expect(anaBaslik).toBeVisible()
    return
  }

  await page.getByLabel('Ana parola').fill(PAROLA)
  await page.getByLabel('Parola tekrar').fill(PAROLA)
  await page.getByRole('button', { name: 'Devam et' }).click()

  await page.getByLabel(/kurtarma kodunu kaydettim/i).check()
  await page.getByRole('button', { name: 'Kurulumu bitir' }).click()

  await expect(anaBaslik).toBeVisible()
}

/** TipTap editör örneğini ProseMirror kök öğesine `editor` olarak asar. */
type EditorluKok = HTMLElement & {
  editor?: { state: { doc: { textBetween(a: number, b: number): string }; selection: { from: number; to: number } } }
}

/** Editörün KENDİ durumundaki seçili metin (DOM seçimi değil). */
function seciliMetin(alan: Locator): Promise<string | null> {
  return alan.evaluate((el) => {
    const durum = (el as EditorluKok).editor?.state
    return durum ? durum.doc.textBetween(durum.selection.from, durum.selection.to) : null
  })
}

/**
 * Satırın SON sözcüğünü klavyeyle seçer (satır sonu, sonra macOS'ta Option,
 * diğerlerinde Ctrl + Shift+←) ve ProseMirror'un kendi seçimi `beklenen`
 * olana kadar bekler. `editor.spec.ts` ve `notlar-gelismis.spec.ts` PAYLAŞIR
 * (Görev 10 bulgusu, Görev 11'de buraya taşındı): ikisi de aynı yarışa açıktı.
 *
 * # Neden yeniden deneniyor (sabit bekleme DEĞİL)
 *
 * ProseMirror'un `focus` işleyicisi 20 ms'lik bir zamanlayıcı kurar: o an DOM
 * seçimi kendi son kaydından farklıysa KENDİ seçimini DOM'a geri yazar.
 * Chromium, CDP'den art arda gelen girdi olaylarını zamanlayıcılardan önce
 * işler; tıklayıp hemen yazan bir testte zamanlayıcı bu yüzden yazma boyunca
 * açık kalır ve sözcük seçiminin HEMEN ARDINDAN çalışıp yeni seçimi siler
 * (ölçüldü: 28 denemede 15 kez; yığın `handlers.focus` → `selectionToDOM`).
 * İnsan hızında yazmada zamanlayıcı ilk tuştan çok önce çalışır; bu bir ürün
 * hatası değil, otomasyonun hızının ürettiği bir yarış. Seçim silinirse jest
 * (satır sonu + seçim) yeniden yapılır: satır sonu seçimi her denemede
 * sıfırlar, yani gecikmeyle işlenmiş bir önceki deneme seçimi büyütmez.
 * Zamanlayıcı odak başına bir kez kurulduğu için ikinci deneme bu yarışa
 * girmez. Kısayol yine ANCAK editörün kendi seçimi `beklenen` olduktan
 * sonra basılır (çağıranın sorumluluğu).
 */
export async function sonSozcuguSec(page: Page, alan: Locator, beklenen: string) {
  await expect(async () => {
    await page.keyboard.press(MAC ? 'Meta+ArrowRight' : 'End')
    await page.keyboard.press(MAC ? 'Alt+Shift+ArrowLeft' : 'Control+Shift+ArrowLeft')
    await expect.poll(() => seciliMetin(alan), { timeout: 1_000 }).toBe(beklenen)
  }).toPass({ timeout: 15_000 })
}
