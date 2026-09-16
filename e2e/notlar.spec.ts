import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * Plan 3'ün uçtan uca doğrulaması: not yazma, özel notun ayrılığı, kilit ve
 * danışan dosyası — **gerçek sunucu + gerçek tarayıcı** ile.
 *
 * # Neden bu dosya var: birim testler aynı şeyi kanıtlıyor, ama ayrı ayrı
 *
 * `NotEditoru.test.tsx` otomatik kaydı sahte bir `onKaydet` ile ölçüyor,
 * `AnaEkran.test.tsx` raporu sahte bir `fetch` ile, sunucu testleri de
 * SQLCipher katmanını Rust'tan. Aradaki bağlantılar (arayüzün ürettiği
 * gövde, sunucunun beklediği gövde mi? kilitlenen sunucu not uçlarını da
 * kapatıyor mu? indirilen rapor dosyasının içinde ne var?) yalnızca burada
 * ölçülebilir.
 *
 * # Paylaşılan sunucu durumu — saat seçimi
 *
 * Bu dosya artık KENDİ sunucusunda ve kendi veri dizininde koşuyor (bkz.
 * `playwright.config.ts` SUNUCULAR), yani `takvim.spec.ts` ile hiçbir şey
 * paylaşmıyor. Ama dosya İÇİNDEKİ testler aynı sunucuyu paylaşmaya devam
 * ediyor: her test kendi saatini (13:00–20:00) kullanıyor ki bir testin
 * "ilk boş hücre" seçimi bir öncekinin randevusuna denk gelip çakışma
 * uyarısı doğurmasın.
 *
 * # `exact: true` ve sabit bekleme yok
 *
 * `getByRole`/`getByLabel` varsayılan olarak ALT DİZGİ eşleştirir; Plan
 * 3'te `aria-label` eklenince bu sekiz locator'ı belirsiz, dördünü de
 * yanlış öğeye bağlı hâle getirmişti. Yeni locator'lar tam eşleşme
 * kullanıyor. `waitForTimeout` bu dosyada YOK: her bekleme gözlemlenebilir
 * bir duruma bağlı.
 */

/** Otomatik kaydın "sunucuya yazıldı" göstergesi — `NotEditoru`'nun `role="status"` bölgesi. */
async function kaydedildiBekle(page: Page) {
  // SENKRONİZASYON BARİYERİ. Editörün kaydet düğmesi yok: metin yazma
  // durduktan `gecikmeMs` (2000 ms) sonra kendiliğinden gidiyor. Bu satır
  // olmadan bir sonraki adım (yenileme, kilitleme, arama, rapor) kayıt
  // sunucuya ULAŞMADAN çalışır ve testin ölçtüğü şey İŞLEM ÖNCESİ durum
  // olurdu — Plan 2'nin e2e'sinde bizzat yaşanan hata sınıfı.
  //
  // Durum metni `kaydetDene`'nin `await onKaydet(...)` çağrısı BAŞARIYLA
  // döndükten sonra basılıyor, yani "yazıldı" gerçekten sunucunun cevabıdır.
  await expect(
    page.getByRole('status').filter({ hasText: /^Kaydedildi \d{2}:\d{2}$/ }),
  ).toBeVisible()
}

/** Danışan ekler, verilen saate randevu kurar ve takvimdeki bloğunu döndürür. */
async function danisanVeRandevu(page: Page, ad: string, saat: string) {
  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill(ad)
  // `exact: true`: "Danışan ekle" düğmesi de "Ekle" alt dizgisini içeriyor.
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText(ad, { exact: true })).toBeVisible()

  await page.locator(`button[aria-label$="${saat} boş"]`).first().click()
  // `exact: true` şart: danışan listesindeki "… adlı danışanı arşivle"
  // düğmesi de "Danışan" alt dizgisiyle eşleşir.
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
  await page.getByRole('button', { name: 'Kaydet' }).click()

  // `exact: true`: rol adı eşleşmesi de varsayılan olarak alt dizgidir ve
  // onsuz bu locator danışan çipindeki arşivleme düğmesini bulurdu.
  const blok = page.getByRole('button', { name: ad, exact: true }).first()
  await expect(blok).toBeVisible()
  return blok
}

/** Seans panelini açar ve resmî not editörünün geldiğini doğrular. */
async function seansiAc(page: Page, blok: ReturnType<Page['getByRole']>) {
  await blok.click()
  const alan = page.getByLabel('Seans notu', { exact: true })
  await expect(alan).toBeVisible()
  return alan
}

/** "Özel Notlarım" sekmesine geçer ve editörün yüklendiğini doğrular. */
async function ozelSekmeyeGec(page: Page) {
  await page.getByRole('tab', { name: 'Özel Notlarım' }).click()
  // Uyarı şeridi sekme açık olduğu sürece duruyor; editör ise özel not
  // sunucudan GELDİKTEN sonra basılıyor ("Özel not yükleniyor…" yerine).
  await expect(
    page.getByText('Bu notlar dışa aktarımlara ve danışan raporuna dahil edilmez.'),
  ).toBeVisible()
  const alan = page.getByLabel('Özel notum', { exact: true })
  await expect(alan).toBeVisible()
  return alan
}

/** Danışan kartını danışan çipinden açar. */
async function danisanKartiAc(page: Page, ad: string) {
  await page.getByRole('button', { name: `${ad} dosyasını aç`, exact: true }).click()
  await expect(page.getByRole('heading', { name: ad, exact: true })).toBeVisible()
}

// ---------------------------------------------------------------------------

test('seans notu otomatik kaydedilir, sayfa yenilenince yerinde durur', async ({ page }) => {
  await kurulumYap(page)
  const icerik = 'OTOKAYIT13 — danisan kaygi uzerine calisti.'

  const blok = await danisanVeRandevu(page, 'Merve Doğan', '13:00')
  const alan = await seansiAc(page, blok)

  // KAYDET DÜĞMESİ YOK. Panelin içine kapsanmış bir sayım: sayfanın geri
  // kalanında "Rızayı kaydet" gibi başka düğmeler var ve kapsamsız bir
  // iddia onları da görürdü. Asıl kanıt aşağıdaki yenileme; bu satır
  // yalnızca "kullanıcı kaydetmeye basmadı" önkoşulunu ekranda sabitler.
  const seansPaneli = page.getByRole('region', { name: 'Seans', exact: true })
  await expect(seansPaneli.getByRole('button', { name: 'Kaydet', exact: true })).toHaveCount(0)

  await alan.fill(icerik)
  await kaydedildiBekle(page)

  // Yenileme, metnin SUNUCUDA olduğunu kanıtlayan adım: taslak deposu
  // (`seans/taslak.ts`) bilerek BELLEKTE tutuluyor ve sayfa yenilenince
  // sıfırlanıyor. Yani aşağıda ekranda görünen metnin tek olası kaynağı
  // `GET /api/randevular/{id}/not` yanıtıdır.
  await page.reload()
  await kurulumYap(page)

  const yenidenAlan = await seansiAc(page, blok)
  await expect(yenidenAlan).toHaveValue(icerik)
})

// SINIR — bu test rapor İÇERİĞİNİ DOĞRULAMAZ. Rapor sunucuda AES-256 ile
// şifrelenmiş PDF olarak iniyor ve e2e sürecinde onu çözecek bir PDF
// kütüphanesi (Rust tarafındaki `lopdf`) yok. "Özel not rapora girmez, resmî
// not girer" iddiasının davranışsal kanıtı sunucunun HTTP testidir:
// `server/tests/notlar_api.rs::veri_raporu_sifreli_pdf_doner_ve_disa_aktarma_loglanir`
// (PDF parolayla çözülür, metinde resmî kanarya VAR, özel kanarya YOK).
//
// Bu test yalnızca uçtan uca zinciri ölçer: arayüzdeki parola formu doğru
// uca gider, ana parola reddi ekrana gelir, ŞİFRELİ bir PDF iner (ham
// baytlarda resmî kanarya bile düz metin olarak yok) ve parola hiçbir
// isteğin URL'sine girmez.
test('veri raporu SIFRELI PDF olarak iner, parola URLye girmez (icerik dogrulamasi HTTP testinde)', async ({
  page,
}) => {
  await kurulumYap(page)
  const ad = 'Selin Aydın'
  const resmi = 'RESMIKANARYA14 — seans ozetinin resmi metni.'
  const gizli = 'GIZLIKANARYA14 — terapistin kendi degerlendirmesi.'
  const raporParolasi = 'danisan-rapor-parolasi-14'

  const blok = await danisanVeRandevu(page, ad, '14:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(resmi)
  await kaydedildiBekle(page)

  const ozelAlan = await ozelSekmeyeGec(page)
  await ozelAlan.fill(gizli)
  // BARİYER: özel not GERÇEKTEN sunucuda; seans paneli açık bırakılıyor.
  await kaydedildiBekle(page)

  await danisanKartiAc(page, ad)

  const istekler: { url: string; govde: string | null }[] = []
  page.on('request', (r) => istekler.push({ url: r.url(), govde: r.postData() }))

  const formuDoldur = async (parola: string) => {
    await page.getByLabel('Rapor parolası', { exact: true }).fill(parola)
    await page.getByLabel('Parolayı tekrar girin', { exact: true }).fill(parola)
  }

  // 1) ANA PAROLA reddedilir; mesaj arayüze olduğu gibi gelir, dosya inmez.
  await page.getByRole('button', { name: 'Danışan veri raporu dışa aktar' }).click()
  const form = page.getByRole('dialog', { name: 'Rapor parolası belirleyin' })
  await formuDoldur('gizliparola')
  const redYaniti = page.waitForResponse((y) => /\/veri-raporu$/.test(y.url()))
  await form.getByRole('button', { name: 'Raporu oluştur' }).click()
  expect((await redYaniti).status()).toBe(400)
  await expect(form.getByRole('alert')).toHaveText(/ana parolanızı kullanmayın/)
  // Reddedilen ana parola alanlarda kalmadı.
  await expect(page.getByLabel('Rapor parolası', { exact: true })).toHaveValue('')

  // 2) Ayrı parolayla şifreli PDF iner.
  await formuDoldur(raporParolasi)
  const [indirme] = await Promise.all([
    page.waitForEvent('download'),
    form.getByRole('button', { name: 'Raporu oluştur' }).click(),
  ])
  expect(indirme.suggestedFilename()).toMatch(/^danisan-veri-raporu-\d{4}-\d{2}-\d{2}\.pdf$/)
  await expect(page.getByText(/şifreli PDF olarak indirildi/)).toBeVisible()

  const bayt = readFileSync(await indirme.path())
  const ham = bayt.toString('latin1')
  // ARTI YÖN: gerçekten bir PDF ve gerçekten ŞİFRELİ (şifreleme sözlüğü var).
  // Boş ya da bozuk bir dosya aşağıdaki "düz metin yok" iddialarını da
  // geçerdi.
  expect(ham.startsWith('%PDF-')).toBe(true)
  expect(ham).toContain('/Encrypt')
  // Ham baytlarda DÜZ METİN yok — resmî not dahil (şifreli olduğu için).
  expect(ham).not.toContain('RESMIKANARYA14')
  expect(ham).not.toContain('GIZLIKANARYA14')
  expect(ham).not.toContain('Selin')

  // Parola hiçbir isteğin URL'sinde yok; rapor isteğinin GÖVDESİNDE var
  // (artı yön: izleyici istekleri gerçekten gördü).
  const raporIstekleri = istekler.filter((i) => /\/api\/danisanlar\/\d+\/veri-raporu$/.test(i.url))
  expect(raporIstekleri).toHaveLength(2)
  expect(raporIstekleri[1].govde).toContain(raporParolasi)
  expect(JSON.parse(raporIstekleri[1].govde ?? '{}').bugun).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  for (const i of istekler) {
    expect(i.url).not.toContain(raporParolasi)
    expect(i.url).not.toContain('gizliparola')
  }
  // Rapor için istemci not çekmedi (üretim sunucuda).
  expect(istekler.some((i) => /\/notlar(\?|$)/.test(i.url))).toBe(false)
})

test('kilitliyken not uclari veri sizdirmaz', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Burak Yıldız'
  const resmi = 'RESMIKANARYA15 — kilit oncesi yazilan resmi not.'
  const gizli = 'GIZLIKANARYA15 — kilit oncesi yazilan ozel not.'

  const blok = await danisanVeRandevu(page, ad, '15:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(resmi)
  await kaydedildiBekle(page)

  const ozelAlan = await ozelSekmeyeGec(page)
  await ozelAlan.fill(gizli)
  await kaydedildiBekle(page)

  const liste = await request.get(
    '/api/randevular?baslangic=2000-01-01T00:00&bitis=2100-01-01T00:00',
  )
  expect(liste.status()).toBe(200)
  const randevular: Array<{ id: number; client_id: number; danisan_adi: string }> =
    await liste.json()
  const randevu = randevular.find((r) => r.danisan_adi === ad)
  expect(randevu).toBeDefined()
  const randevuId = randevu?.id as number
  const danisanId = randevu?.client_id as number

  // ARTI YÖN: kilit AÇIKKEN bu istek bağlamı veriye gerçekten ulaşıyor.
  // Onsuz aşağıdaki 401'ler tautolojik olurdu — istek bağlamı hiçbir zaman
  // yetkili olmasaydı da aynı sonuç çıkardı ve test "kilit çalışıyor"
  // yerine "bu istemci hiç yetkili değil" derdi.
  const acikNot = await request.get(`/api/randevular/${randevuId}/not`)
  expect(acikNot.status()).toBe(200)
  expect(JSON.stringify(await acikNot.json())).toContain(resmi)

  const acikOzel = await request.get(`/api/randevular/${randevuId}/ozel-not`)
  expect(acikOzel.status()).toBe(200)
  expect(JSON.stringify(await acikOzel.json())).toContain(gizli)

  // BARİYER: "Kilitli" başlığı, `POST /api/kilitle`'nin dönüp durumun
  // yeniden çekildiğini gösterir. Düğmeye basıp hemen istek atmak, sunucu
  // henüz kilitlenmemişken 200 alıp testi yanlış sebeple kırardı (ya da
  // ters durumda yanlış sebeple geçirirdi).
  await page.getByRole('button', { name: 'Kilitle' }).click()
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()

  // EKSİ YÖN: yalnızca durum koduna bakmak yetmez — `guard::acik_baglanti`
  // "401 döner, GÖVDEDE hiçbir veri taşımaz" diyor ve testin ölçmesi
  // gereken ikinci yarısı bu (Plan 2'nin randevu ucu testinin deseni).
  const kapaliYollar = [
    `/api/randevular/${randevuId}/not`,
    `/api/randevular/${randevuId}/ozel-not`,
    `/api/danisanlar/${danisanId}/notlar?limit=200`,
    `/api/danisanlar/${danisanId}`,
    `/api/ara?q=${encodeURIComponent('KANARYA15')}&limit=50`,
  ]
  for (const yol of kapaliYollar) {
    const yanit = await request.get(yol)
    expect(yanit.status(), yol).toBe(401)
    const govde = JSON.stringify(await yanit.json())
    expect(govde, yol).not.toContain('RESMIKANARYA15')
    expect(govde, yol).not.toContain('GIZLIKANARYA15')
    expect(govde, yol).not.toContain(ad)
  }
})

test('kilitle ve tekrar ac, not korunur', async ({ page }) => {
  await kurulumYap(page)
  const resmi = 'KILITNOTU16 — kilitten once yazilan resmi not.'
  const gizli = 'KILITOZEL16 — kilitten once yazilan ozel not.'

  const blok = await danisanVeRandevu(page, 'Emre Çetin', '16:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(resmi)
  await kaydedildiBekle(page)

  const ozelAlan = await ozelSekmeyeGec(page)
  await ozelAlan.fill(gizli)
  await kaydedildiBekle(page)

  await page.getByRole('button', { name: 'Kilitle' }).click()
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()
  // Kilit görsel bir perde değil: `App` `AnaEkran`'ı gerçekten unmount
  // ediyor, yani ekranda danışan adı da kalmıyor.
  await expect(page.getByText('Emre Çetin')).toHaveCount(0)

  await page.getByLabel('Ana parola').fill('gizliparola')
  await page.getByRole('button', { name: 'Aç' }).click()
  await expect(page.getByRole('heading', { name: 'Terapi Notları' })).toBeVisible()

  const yenidenAlan = await seansiAc(page, blok)
  await expect(yenidenAlan).toHaveValue(resmi)

  const yenidenOzel = await ozelSekmeyeGec(page)
  await expect(yenidenOzel).toHaveValue(gizli)
})

test('arama resmi notu bulur, ozel notu bulmaz', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Kaan Öztürk'
  const resmiTerim = 'ARANANKANARYA17'
  const gizliTerim = 'GIZLIKANARYA17'

  const blok = await danisanVeRandevu(page, ad, '17:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(`Seans notu: ${resmiTerim} uzerine calisildi.`)
  await kaydedildiBekle(page)

  const ozelAlan = await ozelSekmeyeGec(page)
  await ozelAlan.fill(`Ozel not: ${gizliTerim} hakkinda kendi degerlendirmem.`)
  await kaydedildiBekle(page)

  // Özel notun sunucuda GERÇEKTEN durduğunu bağımsız olarak doğrula.
  // Aşağıdaki "arama bulmuyor" iddiası, aranan metin hiç kaydedilmemişse
  // hiçbir şey kanıtlamaz — bu istek o boşluğu kapatıyor.
  const liste = await request.get(
    '/api/randevular?baslangic=2000-01-01T00:00&bitis=2100-01-01T00:00',
  )
  const randevular: Array<{ id: number; danisan_adi: string }> = await liste.json()
  const randevuId = randevular.find((r) => r.danisan_adi === ad)?.id as number
  const ozelYanit = await request.get(`/api/randevular/${randevuId}/ozel-not`)
  expect(ozelYanit.status()).toBe(200)
  expect(JSON.stringify(await ozelYanit.json())).toContain(gizliTerim)

  await page.getByRole('button', { name: 'Hızlı arama (Ctrl+K)' }).click()
  const kutu = page.getByLabel('Danışan adı veya not içeriği')

  // ARTI YÖN: arama resmî notu buluyor ve sonuç, notun içinden bir parça
  // taşıyor.
  await kutu.fill(resmiTerim)
  const sonuc = page.getByRole('button', { name: /seansına git$/ })
  await expect(sonuc).toHaveCount(1)
  await expect(sonuc).toContainText(ad)
  await expect(sonuc).toContainText(resmiTerim)

  // EKSİ YÖN: özel notun terimi hiçbir sonuç üretmiyor.
  //
  // "Sonuç bulunamadı." bir SENKRONİZASYON BARİYERİDİR, işlem öncesi durum
  // değil: `HizliArama` bu metni yalnızca `bekleniyor === false` iken
  // basıyor ve `bekleniyor`, TAM OLARAK bu sorgu için sunucudan bir yanıt
  // (ya da hata) gelene kadar `true` kalıyor. Yani bu satır "sunucu bu
  // sorguyu yanıtladı ve sonuç boştu" demektir; henüz istek atılmamış olma
  // hâlinde ekranda "Aranıyor…" durur ve iddia beklemeye devam eder.
  await kutu.fill(gizliTerim)
  await expect(page.getByText('Sonuç bulunamadı.')).toBeVisible()
  await expect(page.getByRole('button', { name: /seansına git$/ })).toHaveCount(0)
})

test('danisan dosyasi: ek dosya, riza ve saklama suresi', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Pınar Kılıç'
  const ekAdi = 'onam-formu.txt'
  const ekIcerigi = 'Imzali onam formunun taranmis metni — EKKANARYA18.'

  const blok = await danisanVeRandevu(page, ad, '18:00')
  await danisanKartiAc(page, ad)

  // İŞLEM ÖNCESİ DURUM açıkça sabitleniyor: aşağıdaki her iddia bu üç
  // satırdan farklı bir ekran gerektiriyor, yani hiçbiri "zaten öyleydi"
  // ile tatmin olamaz.
  await expect(page.getByText(/açık rıza kaydı yok/)).toBeVisible()
  await expect(page.getByText(/Saklama süresi henüz hesaplanmadı/)).toBeVisible()
  await expect(page.getByText('Bu danışana henüz dosya eklenmemiş.')).toBeVisible()

  // Ek dosya sözleşmesi standart DEĞİL: ham gövde + `x-dosya-adi` /
  // `x-ek-turu` başlıkları (bkz. `danisanApi.ekYukle`). Bir
  // `<form enctype="multipart/form-data">` bu uçta çalışmaz; burada
  // ölçülen şey tam olarak arayüzün kurduğu isteğin sunucuda kabul
  // edilmesi.
  await page.getByLabel('Yüklenecek dosya').setInputFiles({
    name: ekAdi,
    mimeType: 'text/plain',
    buffer: Buffer.from(ekIcerigi, 'utf-8'),
  })
  await page.getByLabel('Dosya türü').selectOption('onam')
  await page.getByRole('button', { name: 'Dosyayı yükle' }).click()

  // BARİYER: bağlantı ancak yükleme başarılı olup kart yeniden çekildikten
  // sonra listede beliriyor.
  const ekBaglantisi = page.getByRole('link', { name: ekAdi, exact: true })
  await expect(ekBaglantisi).toBeVisible()

  // İçerik GÖMÜLÜ AÇILMIYOR, indiriliyor. Tıklama `api.ekIndir`'den
  // geçiyor (dal incelemesi I3): `fetch` + geçici `blob:` URL + `download`
  // özniteliği. Ölçülen şey değişmedi — indirme gerçekleşiyor, dosya adı ve
  // içeriği doğru, SAYFA GEZİNMİYOR. Sunucunun
  // `Content-Disposition: attachment` + `nosniff` başlıkları kaldırılmadı;
  // onlar `server/tests/notlar_api.rs`'te ayrıca sabitleniyor.
  const [ekIndirme] = await Promise.all([
    page.waitForEvent('download'),
    ekBaglantisi.click(),
  ])
  expect(ekIndirme.suggestedFilename()).toBe(ekAdi)
  expect(readFileSync(await ekIndirme.path(), 'utf-8')).toBe(ekIcerigi)
  // Sayfa gezinmedi: kart hâlâ ekranda.
  await expect(page.getByRole('heading', { name: ad, exact: true })).toBeVisible()

  await page.getByLabel('Açık rıza tarihi').fill('2026-09-01')
  await page.getByLabel('İmzalı onam dosyası').selectOption({ label: ekAdi })
  await page.getByRole('button', { name: 'Rızayı kaydet' }).click()

  // ARTI YÖN: rıza kaydedildi ve imzalı belge bağlandı.
  await expect(page.getByText('Açık rıza alındı: 01.09.2026')).toBeVisible()
  await expect(page.getByRole('link', { name: `İmzalı onam belgesi: ${ekAdi}` })).toBeVisible()
  // EKSİ YÖN: uyarı şeridi gitti. Kaydetmeden ÖNCE görünür olduğu yukarıda
  // ölçüldüğü için bu sayım işlem öncesi durumla tatmin olamaz.
  await expect(page.getByText(/açık rıza kaydı yok/)).toHaveCount(0)

  // Saklama süresi, danışanın SON TEMASINDAN hesaplanıyor ve son temas
  // yalnızca "geldi" işaretlenince ileri taşınıyor (`son_temasi_isaretle`).
  await page.getByRole('button', { name: 'Danışan kartını kapat' }).click()
  await blok.click()
  await page.getByRole('button', { name: 'Geldi' }).click()
  // BARİYER: durum değişikliği ekrana yansıyana kadar bekle. Kart bundan
  // önce açılırsa sunucu henüz `son_temas`ı yazmamış olabilir ve test
  // "hesaplanmadı" görüp yanlış sebeple kırılırdı.
  await expect(blok).toHaveAttribute('data-durum', 'geldi')

  await danisanKartiAc(page, ad)
  await expect(page.getByText(/tarihinde doluyor \(\d+ gün kaldı\)/)).toBeVisible()
  await expect(page.getByText(/Saklama süresi henüz hesaplanmadı/)).toHaveCount(0)
  // Süre dolunca dosyanın kendiliğinden silinmeyeceği her durumda yazılı.
  await expect(page.getByText(/imha kararı her zaman sizindir/)).toBeVisible()
})

test('randevu silme onayi, gidecek NOTLARI da soyler (dal incelemesi I2)', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Deniz Arslan'
  const resmi = 'CASCADEKANARYA19 — silinecek randevunun resmi notu.'
  const gizli = 'CASCADEOZEL19 — silinecek randevunun ozel notu.'

  const blok = await danisanVeRandevu(page, ad, '19:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(resmi)
  await kaydedildiBekle(page)

  const ozelAlan = await ozelSekmeyeGec(page)
  await ozelAlan.fill(gizli)
  // BARİYER: iki not da SUNUCUDA. Aşağıdaki "2 not silinecek" iddiası,
  // notlar hiç yazılmamışsa yanlış sebeple kırılırdı.
  await kaydedildiBekle(page)

  // İŞLEM ÖNCESİ DURUM: onay kutusu henüz yok.
  await expect(page.getByRole('button', { name: 'Evet, sil', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Sil', exact: true }).click()

  // Sayı SUNUCUDAN geliyor: arayüz notların varlığını başka hiçbir yerden
  // bilmiyor (özel not yalnızca sekmeye geçilince yükleniyor ve panel
  // kapanınca gidiyor).
  const uyari = page.getByText(/2 not .*da kalıcı olarak silinecek/)
  await expect(uyari).toBeVisible()
  await expect(uyari).toContainText(/geri getirilemez/)
  // Uyarı NOT İÇERİĞİNİ taşımıyor: onay kutusu bir SAYI gösterir, metin
  // değil. İddia uyarı paragrafına KAPSANMIŞ: seans paneli hâlâ açık ve
  // notların metni editör alanlarında meşru olarak duruyor; sayfa geneli
  // bir sayım yanlış şeyi ölçerdi.
  await expect(uyari).not.toContainText('CASCADEKANARYA19')
  await expect(uyari).not.toContainText('CASCADEOZEL19')

  // Vazgeçmek gerçekten vazgeçiyor: randevu ve notu yerinde.
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Evet, sil', exact: true })).toHaveCount(0)
  await expect(blok).toBeVisible()

  // Silme uygulanınca randevu da notu da gider (cascade).
  await page.getByRole('button', { name: 'Sil', exact: true }).click()
  await page.getByRole('button', { name: 'Evet, sil', exact: true }).click()
  await expect(page.getByRole('button', { name: ad, exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Hızlı arama (Ctrl+K)' }).click()
  await page.getByLabel('Danışan adı veya not içeriği').fill('CASCADEKANARYA19')
  // "Sonuç bulunamadı." bir SENKRONİZASYON BARİYERİ (bkz. arama testi):
  // sunucu bu sorguyu yanıtladı ve sonuç boştu.
  await expect(page.getByText('Sonuç bulunamadı.')).toBeVisible()
})

test('KILITLI oturumda ek baglantisi SPA yi yikmaz (dal incelemesi I3)', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Ceren Yalçın'
  const ekAdi = 'kilit-onami.txt'

  await danisanVeRandevu(page, ad, '20:00')
  await danisanKartiAc(page, ad)
  await page.getByLabel('Yüklenecek dosya').setInputFiles({
    name: ekAdi,
    mimeType: 'text/plain',
    buffer: Buffer.from('Onam belgesinin taranmis metni.', 'utf-8'),
  })
  await page.getByLabel('Dosya türü').selectOption('onam')
  await page.getByRole('button', { name: 'Dosyayı yükle' }).click()
  const ekBaglantisi = page.getByRole('link', { name: ekAdi, exact: true })
  await expect(ekBaglantisi).toBeVisible()

  // İŞLEM ÖNCESİ DURUM: kart açık ve URL uygulamanın kökü. Aşağıdaki
  // "gezinmedi" iddiası ancak bu satırla anlamlı.
  const kokAdres = page.url()
  expect(kokAdres).not.toContain('/api/')

  // Sunucuyu kilitle ama SPA'yı kilit ekranına DÜŞÜRME: `POST /api/kilitle`
  // doğrudan çağrılıyor, arayüzdeki "Kilitle" düğmesine basılmıyor. Boşta
  // kalma kilidinin gerçek hâli tam olarak budur — sunucu kilitli, ekranda
  // hâlâ kart duruyor, kullanıcı bağlantıya tıklıyor. (Oturum sunucuda
  // süreç-genelinde tutuluyor; `page.request` ile atılan kilit, sayfanın
  // isteklerini de kilitler.)
  const kilit = await page.request.post('/api/kilitle')
  expect(kilit.status()).toBe(200)
  // ÖN KOŞUL: ekranda hâlâ kart var (kilit ekranı henüz gelmedi), yani
  // tıklama gerçekten "kilitli sunucu + açık ekran" durumunda oluyor.
  await expect(page.getByRole('heading', { name: ad, exact: true })).toBeVisible()

  await ekBaglantisi.click()

  // ASIL İDDİA — SAYFA GEZİNMEDİ. Düz `<a href>` iken 401 yanıtında
  // `Content-Disposition` olmadığı için tarayıcı ham JSON'a gidiyor, SPA
  // belgesi değişiyor, React ağacı ve (aynı JS bağlamındaki) not taslağı
  // deposu yok oluyordu. Adres çubuğu bunu tek başına ölçer.
  await expect(page).toHaveURL(kokAdres)

  // ...ve 401 merkezi dinleyiciye ulaştığı için uygulama kilit ekranına
  // DÖNÜYOR. Bu React'in çizdiği bir ekran: gezinme olsaydı belge ham JSON
  // olurdu ve bu öğelerin hiçbiri bulunamazdı. ("Kilitle" düğmesine hiç
  // basılmadı — kilit ekranını getiren tek şey bağlantının 401'i.)
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()
  await expect(page.getByLabel('Ana parola')).toBeVisible()

  // ARTI YÖN: kilit açılınca uygulama normale dönüyor — yani yukarıdaki
  // kilit ekranı bir çökme değil, tasarlanmış 401 davranışı.
  await page.getByLabel('Ana parola').fill('gizliparola')
  await page.getByRole('button', { name: 'Aç' }).click()
  await expect(page.getByRole('heading', { name: 'Terapi Notları' })).toBeVisible()
})
