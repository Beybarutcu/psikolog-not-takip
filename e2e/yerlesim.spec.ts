import { expect, test } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

// Tasarım A3 kabul ölçütü: 1200x760 ve 1280x800'de gün başlığı ile 20:00
// satırının alt kenarı SAYFA KAYDIRILMADAN görünür. jsdom yerleşimi
// ölçemediği için bu tek bekçi gerçek tarayıcıdır.
for (const boyut of [{ width: 1200, height: 760 }, { width: 1280, height: 800 }]) {
  test(`hafta ${boyut.width}x${boyut.height} penceresine kaydırmadan sığar`, async ({ page }) => {
    await page.setViewportSize(boyut)
    await kurulumYap(page)
    const sonSatir = page.locator('tbody tr').last()
    await expect(sonSatir).toBeVisible()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    const kutu = await sonSatir.boundingBox()
    expect(kutu).not.toBeNull()
    expect((kutu?.y ?? 0) + (kutu?.height ?? 0)).toBeLessThanOrEqual(boyut.height)
    const baslik = await page.locator('thead').boundingBox()
    expect(baslik?.y ?? -1).toBeGreaterThanOrEqual(0)
  })
}

test('1024x680de satirlar 36 pikselden kisa olmaz; sayfa kaymasi kabul', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 })
  await kurulumYap(page)
  const kutu = await page.locator('tbody tr').first().boundingBox()
  expect(kutu?.height ?? 0).toBeGreaterThanOrEqual(36)
})

test('1024 genisliginde yeni randevu formu izgaranin altina iner, sikismaz', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 })
  await kurulumYap(page)
  await page.locator('button[aria-label$="10:00 boş"]').first().click()
  const form = page.getByRole('heading', { name: 'Yeni randevu' }).locator('xpath=ancestor::aside')
  const izgara = page.getByTestId('takvim-izgara')
  const f = await form.boundingBox()
  const i = await izgara.boundingBox()
  expect(f?.width ?? 0).toBeGreaterThanOrEqual(300)
  expect(f?.y ?? 0).toBeGreaterThan((i?.y ?? 0) + (i?.height ?? 0) - 1)
})
