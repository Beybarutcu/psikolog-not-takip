import { expect, type Page } from '@playwright/test'

const PAROLA = 'gizliparola'

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
