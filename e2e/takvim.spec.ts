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
  // `exact: true` sart: `getByLabel` varsayilan olarak ALT DIZGI arar ve
  // danisan listesindeki "... adli danisani arsivle" dugmesi de eslesir.
  // Aranan sey randevu panelindeki `<select id="danisan">` alani.
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: 'Ayşe Yılmaz' })
  await page.getByLabel('Ücret (TL)').fill('450')
  await page.getByRole('button', { name: 'Kaydet' }).click()

  // `exact: true`: rol adi eslesmesi de varsayilan olarak ALT DIZGIDIR.
  // Onsuz bu locator takvimdeki randevu blogunu degil, danisan listesindeki
  // "Ayşe Yılmaz adlı danışanı arşivle" dugmesini bulur ve tiklama arsivleme
  // onayini acar.
  const blok = page.getByRole('button', { name: 'Ayşe Yılmaz', exact: true }).first()
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
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: 'Zeynep Kaya' })
  await page.getByLabel('Ücret (TL)').fill('300')
  await page.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByRole('button', { name: 'Zeynep Kaya', exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Kilitle' }).click()
  // BARIYER -- yoksa test bir YARIS olcerdi. `click()` yalnizca tiklamanin
  // gonderildigi anda coozulur; `POST /api/kilitle` hala ucusta olabilir ve
  // asagidaki istek acik oturuma denk gelip `200` alir. Bu kirilganlik
  // bastan beri vardi ama tetiklenmiyordu; yedekleme bolumunun mount'ta
  // attigi ek istek ve dorduncu e2e sunucusunun getirdigi yuk onu gorunur
  // yapti (olculdu: dort kosudan ikisinde `200` geldi, ekran ise "Kilitli"
  // gosteriyordu). Kardes testlerin hepsi (`notlar.spec.ts:234`, `:271`,
  // `kurulum.spec.ts:19`) zaten bu bariyeri kullaniyor.
  //
  // Iddia ZAYIFLAMIYOR: test "kilitliyken 401 doner" diyor ve bu satir tam
  // olarak "kilitliyken" on kosulunu kuruyor.
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()

  const yanit = await request.get(
    '/api/randevular?baslangic=2026-01-01T00:00&bitis=2030-01-01T00:00',
  )
  expect(yanit.status()).toBe(401)

  const govde = await yanit.json()
  expect(Array.isArray(govde)).toBe(false)
  expect(JSON.stringify(govde)).not.toContain('Zeynep Kaya')
})

// Dal incelemesi C1'in birebir kaniti: mevcut bir randevunun ucreti
// degistirilince TEK randevu kalmali (kopya uretilmemeli) ve ucret gercekten
// degismis olmali. Bu senaryo daha once ikinci bir randevu yaratiyordu.
test('mevcut randevunun ucreti guncellenir, kopya olusmaz', async ({ page }) => {
  await kurulumYap(page)

  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill('Elif Şahin')
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText('Elif Şahin')).toBeVisible()

  // Bu dosyadaki diger testlerin kullandigi 10:00 satirindan farkli bir saat
  // secilir: dosyalar arasi yalitim var (her spec kendi sunucusunda), ama
  // dosya ICINDEKI testler ayni sunucuyu paylasiyor.
  await page.locator('button[aria-label$="11:00 boş"]').first().click()
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: 'Elif Şahin' })
  await page.getByLabel('Ücret (TL)').fill('450')
  await page.getByRole('button', { name: 'Kaydet' }).click()

  const bloklar = page.getByRole('button', { name: 'Elif Şahin', exact: true })
  await expect(bloklar).toHaveCount(1)

  // Randevuyu ac, ucreti degistir, Guncelle'ye bas.
  await bloklar.first().click()
  await expect(page.getByLabel('Ücret (TL)')).toHaveValue('450')
  await page.getByLabel('Ücret (TL)').fill('500')
  await page.getByRole('button', { name: 'Güncelle' }).click()

  // SENKRONIZASYON BARIYERI. `toHaveCount` kosul saglanana kadar BEKLER;
  // tiklama aninda sayi zaten 1 oldugu icin, dogrudan yazilan bir
  // `toHaveCount(1)` islem daha bitmeden -- yani ONCEKI durumu olcerek --
  // aninda tatmin oluyordu. Boyle bir satir hicbir seyi korumaz: mutasyonla
  // dogrulandi, `AnaEkran.kaydet()` POST'a dondurulunce bile geciyordu.
  //
  // Bu yuzden once "guncelleme EKRANA YANSIDI" olayini bekliyoruz: yeni
  // ucreti (500 TL = 50000 kurus) tasiyan bir blok belirene kadar. Bu kosul
  // hem dogru (PUT) hem hatali (POST) dunyada saglanir -- yani bariyer
  // kendisi ayrim yapmaz, yalnizca izgaranin yeniden yuklenmis veriyle
  // cizildigini garantiler. Ayrimi bir ALTTAKI sayim yapar.
  await expect(
    page.locator('button[data-ucret="50000"]', { hasText: 'Elif Şahin' }),
  ).toHaveCount(1)

  // (a) KOPYA OLUSMADI: izgara yeniden yuklendikten SONRA hala tek blok.
  // POST regresyonunda burada 2 gorunur ve test kirilir.
  await expect(bloklar).toHaveCount(1)

  // (b) UCRET GERCEKTEN DEGISTI: paneli yeniden ac ve alani oku.
  await bloklar.first().click()
  await expect(page.getByLabel('Ücret (TL)')).toHaveValue('500')
})

// Dal incelemesi I4a: seri kurulabiliyor ama iptal edilemiyordu
// (`seriyi_sil`in cagri yeri yoktu). Seri kur, sonra "bu ve sonraki tum
// tekrarlar" ile iptal et.
test('seri kurulur ve tek adimda iptal edilir', async ({ page }) => {
  await kurulumYap(page)

  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill('Deniz Arslan')
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText('Deniz Arslan')).toBeVisible()

  await page.locator('button[aria-label$="12:00 boş"]').first().click()
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: 'Deniz Arslan' })
  await page.getByLabel('Her hafta tekrarla').check()
  await page.getByLabel('Kaç hafta').fill('3')
  await page.getByRole('button', { name: 'Kaydet' }).click()

  const bloklar = page.getByRole('button', { name: 'Deniz Arslan', exact: true })
  await expect(bloklar).toHaveCount(1) // bu haftada serinin ilk uyesi

  await bloklar.first().click()
  await page.getByRole('button', { name: 'Bu ve sonraki tüm tekrarları sil' }).click()
  // Onay metni kac randevunun silinecegini ve gecmisin korundugunu soyler.
  await expect(page.getByText(/3 randevu/)).toBeVisible()
  await expect(page.getByText(/Geçmiş randevular silinmez/)).toBeVisible()
  await page.getByRole('button', { name: 'Evet, tekrarları sil' }).click()

  await expect(bloklar).toHaveCount(0)
  // Sonraki haftalardaki uyeler de gitmis olmali.
  await page.getByRole('button', { name: 'Sonraki hafta' }).click()
  await expect(bloklar).toHaveCount(0)
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
