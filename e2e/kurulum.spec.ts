import { expect, test } from '@playwright/test'

test('kurulum, kilitleme ve tekrar acma', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Ana parola').fill('gizliparola')
  await page.getByLabel('Parola tekrar').fill('gizliparola')
  await page.getByRole('button', { name: 'Devam et' }).click()

  const kod = await page.locator('.font-mono').textContent()
  expect(kod).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/)

  await page.getByLabel(/kurtarma kodunu kaydettim/i).check()
  await page.getByRole('button', { name: 'Kurulumu bitir' }).click()

  await expect(page.getByRole('heading', { name: 'Terapi Notları' })).toBeVisible()

  await page.getByRole('button', { name: 'Kilitle' }).click()
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()

  await page.getByLabel('Ana parola').fill('yanlisparola')
  await page.getByRole('button', { name: 'Aç' }).click()
  await expect(page.getByText(/hatalı/i)).toBeVisible()

  await page.getByLabel('Ana parola').fill('gizliparola')
  await page.getByRole('button', { name: 'Aç' }).click()
  await expect(page.getByRole('heading', { name: 'Terapi Notları' })).toBeVisible()
})
