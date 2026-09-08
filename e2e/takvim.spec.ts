import { expect, test } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

test('danisan ekle, randevu olustur, geldi isaretle', async ({ page }) => {
  await kurulumYap(page)

  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill('Ayşe Yılmaz')
  // "Danışan ekle" düğmesi "Ekle" alt dizesini içerdiği için isim eşleşmesi
  // (Playwright varsayılan olarak alt dize eşleştirir) iki düğmeyi de
  // bulur; gönder düğmesi tam eşleşmeyle hedefleniyor.
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText('Ayşe Yılmaz')).toBeVisible()

  // Izgarada bos bir saate tikla; hangi hafta olursa olsun ilk bos hucre yeterli.
  await page.locator('button[aria-label$="10:00 boş"]').first().click()
  await page.getByLabel('Danışan').selectOption({ label: 'Ayşe Yılmaz' })
  await page.getByLabel('Ücret (TL)').fill('450')
  await page.getByRole('button', { name: 'Kaydet' }).click()

  const blok = page.getByRole('button', { name: 'Ayşe Yılmaz' }).first()
  await expect(blok).toBeVisible()

  await blok.click()
  await page.getByRole('button', { name: 'Geldi' }).click()
  // Gorsel sinif adina/renge degil, RandevuBloku'nun yaydigi semantik
  // data-durum onitelegine bakiyoruz: renk ya da sinif degisirse bu test
  // "durum degismedi" gibi yanlis bir sebeple kirilmaz.
  await expect(blok).toHaveAttribute('data-durum', 'geldi')
})

test('kilitliyken randevu ucu veri sizdirmaz', async ({ page, request }) => {
  await kurulumYap(page)

  // Kilitlemeden once taninabilir bir danisan ve randevu olustur; asagida
  // yanit govdesinin bu adi GERCEKTEN icermedigini dogrulayabilmek icin.
  // Yalnizca durum kodunu kontrol etmek testin adinin ("veri sizdirmaz")
  // iddia ettigini kanitlamiyordu.
  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill('Zeynep Kaya')
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText('Zeynep Kaya')).toBeVisible()

  await page.locator('button[aria-label$="10:00 boş"]').first().click()
  await page.getByLabel('Danışan').selectOption({ label: 'Zeynep Kaya' })
  await page.getByLabel('Ücret (TL)').fill('300')
  await page.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByRole('button', { name: 'Zeynep Kaya' }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Kilitle' }).click()

  const yanit = await request.get(
    '/api/randevular?baslangic=2026-01-01T00:00&bitis=2030-01-01T00:00',
  )
  expect(yanit.status()).toBe(401)

  const govde = await yanit.json()
  expect(Array.isArray(govde)).toBe(false)
  expect(JSON.stringify(govde)).not.toContain('Zeynep Kaya')
})

test('haftalar arasi gezinme calisir', async ({ page }) => {
  await kurulumYap(page)
  const baslik = page.locator('h2').first()
  const ilk = await baslik.textContent()

  await page.getByRole('button', { name: 'Sonraki hafta' }).click()
  await expect(baslik).not.toHaveText(ilk ?? '')

  await page.getByRole('button', { name: 'Önceki hafta' }).click()
  await expect(baslik).toHaveText(ilk ?? '')
})
