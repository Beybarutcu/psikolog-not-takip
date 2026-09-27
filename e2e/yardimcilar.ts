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

/** Editörün KENDİ seçimi daraltılmış ve imleçten sonra metin yok (belgenin sonu). */
function imlecSondaMi(alan: Locator): Promise<boolean | null> {
  return alan.evaluate((el) => {
    const durum = (el as EditorluKok).editor?.state
    if (!durum) return null
    const { from, to } = durum.selection
    return from === to && durum.doc.textBetween(to, durum.doc.content.size) === ''
  })
}

/**
 * İmleci notun SONUNA götürür (macOS'ta Cmd+↓, diğerlerinde Ctrl+End) ve
 * ProseMirror'un KENDİ seçimi belgenin sonuna gelene kadar bekler; gelmezse
 * jesti yineler.
 *
 * `sonSozcuguSec` ile AYNI yarış: editör tıklamayla YENİ odak aldıysa
 * ProseMirror'un 20 ms'lik odak zamanlayıcısı hâlâ açıktır. Tuşun seçim
 * değişikliği ProseMirror'a ulaşmadan (`selectionchange`) zamanlayıcı
 * çalışırsa DOM seçimini kendi kaydıyla, yani TIKLAMA konumuyla karşılaştırır,
 * farkı görür ve tıklama konumunu DOM'a geri yazar: Ctrl+End silinir, ardından
 * yazılan metin notun sonuna değil tıklanan paragrafa girer. `e2e/yerlesim.
 * spec.ts` > "arac cubugu notu ortmez" danışan dosyası adımında (editör orada
 * ilk kez tıklamayla odak alıyor) bir kez böyle kırıldı; zamanlayıcıyı tuşun
 * seçim değişikliğiyle ProseMirror'un okuması ARASINA koyan bir enjeksiyonla
 * her seferinde yeniden üretildi. Zamanlayıcı odak başına bir kez kurulur:
 * yinelenen jest yarışa girmez. Ctrl+End her denemede aynı yere gider.
 */
export async function sonaGit(page: Page, alan: Locator) {
  await expect(async () => {
    await page.keyboard.press(MAC ? 'Meta+ArrowDown' : 'Control+End')
    await expect.poll(() => imlecSondaMi(alan), { timeout: 1_000 }).toBe(true)
  }).toPass({ timeout: 15_000 })
}
