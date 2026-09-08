import { expect, type Page } from '@playwright/test'

const PAROLA = 'gizliparola'

// Kurulum akışı hem kurulum.spec.ts hem de takvim.spec.ts tarafından
// kullanılıyor. Sunucu süreci (bkz. playwright.config.ts webServer) test
// dosyaları arasında paylaşılıyor ve kurulum en fazla bir kez yapılabilir —
// bu yüzden yardımcı, sayfanın hangi ekranda olduğunu (kurulum sihirbazı,
// kilit ekranı ya da zaten açık ana ekran) tanıyıp ona göre davranır.
// playwright.config.ts'teki workers: 1 ayarı, birden fazla test dosyasının
// aynı anda kurulum uç noktasına yarışarak gitmesini engeller.
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
