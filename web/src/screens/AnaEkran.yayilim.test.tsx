import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notOnizlemesi } from '../seans/onizleme'
import { taslaklariUnut } from '../seans/taslak'
import { AnaEkran } from './AnaEkran'

/**
 * Son inceleme — takvim ile danışan dosyasının AYNI seansa bakması.
 *
 * Bu dosya `AnaEkran.test.tsx`'ten AYRI: o dosya 3600+ satır (bölünmesi ayrı
 * bir görev, defterde ertelenmiş) ve buradaki bütün testler tek bir sınıfı
 * ölçüyor — bir ekranda yapılan yazmanın DİĞER ekranın önbelleğine
 * yayılması (C1/C2), ve o yayılımın dayandığı kabuk kararları (I1-I3, M1).
 *
 * Sunucu taklidi YAZMALARI GERÇEKTEN uygular (not, ödeme, durum) ve her
 * okuma o anki değeri döndürür: "ekran bayat mı" sorusu ancak böyle
 * ölçülebilir — sabit yanıt dönen bir taklit, yeniden çekmeyen ama
 * yamalamayan bir istemciyi de yeşil geçirirdi.
 *
 * İki ayrı bekletme var, ikisi de "METHOD yol" anahtarlı:
 *   - `onceBekle`: istek İŞLENMEDEN bekler (sunucu yazmayı henüz yapmadı).
 *   - `sonraBekle`: yanıt ANLIK GÖRÜNTÜSÜ alındıktan SONRA bekler (sunucu
 *     okumayı eski değerle yaptı, yanıt geç geliyor) — `yazmaSaati`nin
 *     kapattığı yarışın tam kurulumu.
 */

const BUGUN_SAATI = new Date(2026, 8, 9, 12, 0) // Çarşamba; hafta başı 2026-09-07

const danisanlar = [
  { id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' },
  { id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif' },
]

// Ayşe'nin iki seansı: 201 GEÇMİŞTE (bu hafta Pazartesi), 202 GELECEKTE
// (sonraki hafta). 202 "geldi", 450 TL, ödenmemiş: kartın bakiyesi ve ay
// özetinin borcu bu seanstan.
const R201 = {
  id: 201, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
  durum: 'planlandi', ucret: null as number | null, odendi: false, seri_id: null,
}
const R202 = {
  id: 202, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-14T10:00', bitis: '2026-09-14T11:00',
  durum: 'geldi', ucret: 45000 as number | null, odendi: false, seri_id: null,
}
const R203 = {
  id: 203, client_id: 2, danisan_adi: 'Mehmet Demir',
  baslangic: '2026-09-08T13:00', bitis: '2026-09-08T14:00',
  durum: 'planlandi', ucret: null as number | null, odendi: false, seri_id: null,
}
const TUMU = [R201, R202, R203]

const dosyalar: Record<number, unknown> = {
  1: {
    id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: '0555 111 22 33', durum: 'aktif',
    dogum_tarihi: null, basvuru_nedeni: null, risk_notu: null,
    riza_tarihi: '2026-03-01', riza_dosya_id: null, son_temas: null, saklama_bitis: null,
  },
  2: {
    id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif',
    dogum_tarihi: null, basvuru_nedeni: null, risk_notu: null,
    riza_tarihi: null, riza_dosya_id: null, son_temas: null, saklama_bitis: null,
  },
}

type NotKaydi = { sablon: string; icerik: string }
type Istek = { method: string; yol: string; govde: unknown }

let notlar: Record<number, NotKaydi>
let odemeler: Record<number, boolean>
let durumlar: Record<number, string>
let istekler: Istek[]
let onceBekle: Record<string, Promise<void> | undefined>
let sonraBekle: Record<string, Promise<void> | undefined>
let seanslarHatasi: boolean

function kapi() {
  let ac!: () => void
  const bekle = new Promise<void>((c) => {
    ac = c
  })
  return { bekle, ac }
}

function json(govde: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => govde } as unknown as Response
}

function randevuAnlik(r: (typeof TUMU)[number]) {
  return { ...r, odendi: odemeler[r.id] ?? r.odendi, durum: durumlar[r.id] ?? r.durum }
}

function notYaniti(id: number) {
  const r = TUMU.find((x) => x.id === id)!
  const k = notlar[id] ?? { sablon: 'serbest', icerik: '' }
  return {
    appointment_id: id, client_id: r.client_id, seans_zamani: r.baslangic,
    ...k, guncelleme_zamani: '2026-09-09T09:00:00Z',
  }
}

/** Sunucunun o anki hâline göre bir yanıt üretir (ANLIK GÖRÜNTÜ). */
function yanitUret(method: string, yol: string, govde: unknown): Response {
  if (yol.startsWith('/api/saklama-suresi-dolanlar')) return json([])
  if (yol.startsWith('/api/depolama-durumu')) {
    return json({ toplam_boyut: 0, esik: 500 * 1024 * 1024, uyari: false })
  }
  if (yol.startsWith('/api/yedekler')) {
    return json({ hedef_dizin: '/Volumes/YEDEK', yedekler: [{ dosya_adi: 'y.db', tarih: '2026-09-09', boyut: 1 }] })
  }
  if (yol.startsWith('/api/cakisma')) {
    return json({ cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1 })
  }
  if (yol.startsWith('/api/ay-ozeti')) {
    const borclu = (durumlar[202] ?? R202.durum) === 'geldi' && !(odemeler[202] ?? R202.odendi)
    return json({
      ay: '2026-09', seans_sayisi: 3, tahsilat_kurus: 0,
      bekleyen_kurus: borclu ? 45000 : 0,
      borclular: borclu
        ? [{ client_id: 1, ad_soyad: 'Ayşe Yılmaz', borc_kurus: 45000, seans_sayisi: 1 }]
        : [],
    })
  }
  const not = /^\/api\/randevular\/(\d+)\/not$/.exec(yol)
  if (not) {
    const id = Number(not[1])
    if (method === 'PUT') notlar[id] = govde as NotKaydi
    return json(notYaniti(id))
  }
  const odeme = /^\/api\/randevular\/(\d+)\/odeme$/.exec(yol)
  if (odeme && method === 'PATCH') {
    odemeler[Number(odeme[1])] = (govde as { odendi: boolean }).odendi
    return json({}, 204)
  }
  const durum = /^\/api\/randevular\/(\d+)$/.exec(yol)
  if (durum && method === 'PATCH') {
    durumlar[Number(durum[1])] = (govde as { durum: string }).durum
    return json({})
  }
  const aralik = /^\/api\/randevular\?baslangic=([^&]+)&bitis=([^&]+)/.exec(yol)
  if (aralik) {
    const bas = decodeURIComponent(aralik[1])
    const bit = decodeURIComponent(aralik[2])
    return json(TUMU.filter((r) => r.baslangic >= bas && r.baslangic < bit).map(randevuAnlik))
  }
  const gecmis = /^\/api\/danisanlar\/(\d+)\/notlar/.exec(yol)
  if (gecmis) {
    const once = new URL(yol, 'http://x').searchParams.get('once') ?? '9999'
    return json(
      TUMU.filter((r) => r.client_id === Number(gecmis[1]) && notlar[r.id] && r.baslangic < once)
        .sort((a, b) => (a.baslangic < b.baslangic ? 1 : -1))
        .map((r) => notYaniti(r.id)),
    )
  }
  const seanslar = /^\/api\/danisanlar\/(\d+)\/seanslar$/.exec(yol)
  if (seanslar) {
    if (seanslarHatasi) return json({ hata: 'Veritabanı okunamadı.' }, 500)
    return json(
      TUMU.filter((r) => r.client_id === Number(seanslar[1]))
        .sort((a, b) => (a.baslangic < b.baslangic ? 1 : -1))
        .map((r) => {
          const a = randevuAnlik(r)
          return {
            appointment_id: a.id, baslangic: a.baslangic, durum: a.durum,
            ucret_kurus: a.ucret, odendi: a.odendi,
            not_ilk_satiri: notlar[a.id] ? notOnizlemesi(notlar[a.id].icerik) : null,
          }
        }),
    )
  }
  if (/^\/api\/danisanlar\/\d+\/ekler$/.test(yol)) return json([])
  const dosya = /^\/api\/danisanlar\/(\d+)$/.exec(yol)
  if (dosya) return json(dosyalar[Number(dosya[1])])
  if (yol.startsWith('/api/danisanlar')) return json(danisanlar)
  throw new Error(`beklenmeyen istek: ${method} ${yol}`)
}

const gercekFetch = globalThis.fetch
let kilitle: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(BUGUN_SAATI)
  notlar = {}
  odemeler = {}
  durumlar = {}
  istekler = []
  onceBekle = {}
  sonraBekle = {}
  seanslarHatasi = false
  kilitle = vi.fn<() => void>()
  taslaklariUnut()
  globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
    const yol = typeof girdi === 'string' ? girdi : girdi.toString()
    const method = secenekler?.method ?? 'GET'
    const govde = secenekler?.body ? JSON.parse(String(secenekler.body)) : null
    istekler.push({ method, yol, govde })
    const anahtar = `${method} ${yol}`
    if (onceBekle[anahtar]) await onceBekle[anahtar]
    const yanit = yanitUret(method, yol, govde)
    if (sonraBekle[anahtar]) await sonraBekle[anahtar]
    return yanit
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = gercekFetch
  vi.restoreAllMocks()
  taslaklariUnut()
})

// --- yardımcılar -------------------------------------------------------------

const editor = () => screen.getByLabelText('Seans notu') as HTMLTextAreaElement
const odendiKutusu = () => screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement
const putlar = (id: number) =>
  istekler.filter((i) => i.method === 'PUT' && i.yol === `/api/randevular/${id}/not`)
const notGetleri = (id: number) =>
  istekler.filter((i) => i.method === 'GET' && i.yol === `/api/randevular/${id}/not`)

function ciz() {
  render(<AnaEkran kilitle={kilitle} onGeriYukle={vi.fn()} />)
}

/** Takvimde sonraki haftaya gider ve 202'nin seans panelini açar. */
async function takvimde202Ac() {
  await userEvent.click(await screen.findByRole('button', { name: 'Sonraki hafta' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
  await screen.findByLabelText('Seans notu')
}

/** Seans panelinin başlığındaki "… dosyasını aç" (takvimden dosyaya giden yol). */
async function paneldenDosyayaGit() {
  await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Danışanlar' }).getAttribute('aria-selected')).toBe('true'),
  )
}

/** Danışanlar sekmesinde Ayşe'nin çipine tıklar; liste gelene kadar bekler. */
async function danisanlarda(ad = 'Ayşe Yılmaz') {
  await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
  await userEvent.click(await screen.findByRole('button', { name: `${ad} dosyasını aç` }))
  await waitFor(() =>
    expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
  )
}

async function takvimeDon() {
  await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
}

/** Otomatik kaydın "sunucuya yazıldı" göstergesi (2 sn gecikme, gerçek saat). */
async function kaydedildiBekle() {
  await waitFor(() =>
    expect(
      screen.getAllByRole('status').some((e) => /^Kaydedildi \d{2}:\d{2}$/.test(e.textContent ?? '')),
    ).toBe(true),
  )
}

/** Dosya listesindeki seans satırı (erişilebilir ad tarih metnini içerir). */
function listeSatiri(tarihMetni: string) {
  return within(screen.getByTestId('seans-listesi')).getByText(tarihMetni).closest('button') as HTMLElement
}

function bakiye() {
  return screen.getAllByRole('term').find((e) => e.textContent === 'Bakiye')?.nextElementSibling
    ?.textContent
}

// =============================================================================

describe('C1 — resmî not iki ekranda TEK yazma yolundan', () => {
  // İncelemecinin testle ÜRETTİĞİ senaryo, birebir.
  it('takvimde yükle -> dosyaya git -> yaz -> kaydet -> takvime dön: editör YENİ metni gösterir, ESKİ metin hiç PUT edilmez', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await takvimde202Ac()
    expect(editor().value).toBe('ESKI')

    await paneldenDosyayaGit()
    // Takvimden gelindi: dosya O seansla açılır (I3).
    await waitFor(() => expect(editor().value).toBe('ESKI'))
    await userEvent.type(editor(), ' YENI')
    await kaydedildiBekle()
    expect(notlar[202].icerik).toBe('ESKI YENI')
    const oncekiPutSayisi = putlar(202).length

    await takvimeDon()
    // Seans paneli hâlâ 202'de; editör sunucudaki (dosyada yazılan) metni
    // gösteriyor — eskiden "ESKI" gösteriyordu.
    await waitFor(() => expect(editor().value).toBe('ESKI YENI'))

    // Terapist takvimde bir karakter yazar: otomatik kayıt YENİ metnin
    // üstüne gider, dosyada yazılanı SİLMEZ.
    await userEvent.type(editor(), '!')
    await waitFor(() => expect(putlar(202).length).toBe(oncekiPutSayisi + 1))
    const donustenSonra = putlar(202).slice(oncekiPutSayisi)
    for (const p of donustenSonra) {
      expect((p.govde as NotKaydi).icerik).toContain('ESKI YENI')
    }
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI YENI!'))
  })

  it('takvimde not yazılınca dosya listesindeki önizleme YENİ metni gösterir, dosya editörü de (yeniden çekmeden)', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    // Dosya önce açılır, 202 seçilir (önbelleğe ESKİ girer), sonra takvime
    // gidilip yazılır.
    await danisanlarda()
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await waitFor(() => expect(editor().value).toBe('ESKI'))

    await takvimeDon()
    await takvimde202Ac()
    // Sayım takvim panelinin KENDİ not GET'inden SONRA alınıyor: ölçülen,
    // dosyanın dönüşte yeniden çekip çekmediği.
    const getSayisi = notGetleri(202).length
    await userEvent.type(editor(), ' TAKVIMDEN')
    await kaydedildiBekle()

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await waitFor(() => expect(editor().value).toBe('ESKI TAKVIMDEN'))
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('ESKI TAKVIMDEN')
    // Dosyanın not önbelleği YAYILIMLA tazelendi, yeniden ÇEKİLMEDİ (M1).
    expect(notGetleri(202).length).toBe(getSayisi)
  })

  // Ters yarış (inceleme yalnızca kod okumasıyla çıkarmıştı; burada ÜRETİLİYOR):
  // takvim editörü bekleyen metni unmount'ta PUT eder, dosya aynı nota AYNI
  // ANDA GET atar. PUT sunucuda GECİKİRSE GET eski metni okur. Üç savunma:
  //   - iki editör AYNI taslak anahtarını (`not-<id>`) kullanıyor: gelen
  //     editör uçuştaki metni taslaktan alır (eski metni DEĞİL);
  //   - taslak "uçuşta" işaretli: bu bir kilit kurtarması değil, "oturum
  //     kilitlendi" şeridi GÖSTERİLMEZ;
  //   - PUT bitince yayılım `sunucuHali`yi günceller, editör metni zaten
  //     gösterdiği için yalnızca "kaydedildi" sayar — aynı metin İKİNCİ kez
  //     PUT edilmez (silinemez denetim satırı).
  const KILIT_SERIDI = /Kaydedilmemiş not içeriğiniz geri yüklendi/

  it('ters yarış A: takvim tahliyesi GECİKİRKEN açılan dosya editörü ESKİ metni DEĞİL, yoldaki metni gösterir; şerit yok, çift PUT yok', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await takvimde202Ac()
    const k = kapi()
    onceBekle['PUT /api/randevular/202/not'] = k.bekle
    await userEvent.type(editor(), ' T') // 2 sn dolmadan
    await paneldenDosyayaGit()
    // BARİYER: dosyanın GET'i sunucuya ulaştı ve PUT'tan ÖNCE işlendi
    // (sunucu hâlâ ESKİ).
    await waitFor(() => expect(notGetleri(202).length).toBeGreaterThan(0))
    expect(notlar[202].icerik).toBe('ESKI')
    await waitFor(() => expect(editor().value).toBe('ESKI T'))
    expect(document.body.textContent).not.toMatch(KILIT_SERIDI)

    k.ac()
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI T'))
    // Dosya editörünün 2 sn'lik zamanlayıcısı dolsun: aynı metin ikinci kez
    // YAZILMAMALI.
    await new Promise((r) => setTimeout(r, 2300))
    expect(putlar(202)).toHaveLength(1)
    expect(editor().value).toBe('ESKI T')
  }, 15_000)

  it('ters yarış B: GET eski metni OKUYUP geç dönerse (PUT ondan önce biter) dosya editörü YİNE yeni metni gösterir', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await takvimde202Ac()
    const kPut = kapi()
    const kGet = kapi()
    onceBekle['PUT /api/randevular/202/not'] = kPut.bekle
    sonraBekle['GET /api/randevular/202/not'] = kGet.bekle
    await userEvent.type(editor(), ' T')
    await paneldenDosyayaGit()
    // BARİYER: GET sunucuda ESKİ metni okudu (anlık görüntü alındı), yanıt yolda.
    await waitFor(() => expect(notGetleri(202).length).toBeGreaterThan(0))
    expect(notlar[202].icerik).toBe('ESKI')

    // PUT şimdi işlenir ve GET'ten ÖNCE yanıtlanır.
    kPut.ac()
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI T'))
    await new Promise((r) => setTimeout(r, 30))
    kGet.ac()
    await waitFor(() => expect(editor().value).toBe('ESKI T'))
  })

  it('ters yarış C: dosya editörünün tahliyesi GECİKİRKEN takvime dönülürse takvim editörü yoldaki metni gösterir; sonraki tuş onun üstüne yazar', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await takvimde202Ac()
    await paneldenDosyayaGit()
    await waitFor(() => expect(editor().value).toBe('ESKI'))
    const k = kapi()
    onceBekle['PUT /api/randevular/202/not'] = k.bekle
    await userEvent.type(editor(), ' D') // 2 sn dolmadan
    await takvimeDon()
    // Takvim paneli önbellekte ESKİ notu tutuyor; editör yoldaki metinle açılır.
    await waitFor(() => expect(editor().value).toBe('ESKI D'))
    expect(document.body.textContent).not.toMatch(KILIT_SERIDI)

    k.ac()
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI D'))
    const once = putlar(202).length
    await userEvent.type(editor(), '!')
    await waitFor(() => expect(putlar(202).length).toBe(once + 1))
    expect((putlar(202)[once].govde as NotKaydi).icerik).toBe('ESKI D!')
  })
  // `useSeansNotlari` `yazmaSaati`nin dördüncü kullanıcısı: takvim panelinin not
  // okuması ESKİ metni okuyup geç dönerken dosyanın tahliyesi biterse takvim
  // editörü eski metinle açılmamalı (taslak o sırada temizlenmiş olur —
  // tek savunma saat).
  it('ters yarış D: takvim panelinin not GET\'i eski metni okuyup geç dönerken dosya tahliyesi biterse takvim YENİ metni gösterir', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await danisanlarda()
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await waitFor(() => expect(editor().value).toBe('ESKI'))
    const kPut = kapi()
    const kGet = kapi()
    onceBekle['PUT /api/randevular/202/not'] = kPut.bekle
    sonraBekle['GET /api/randevular/202/not'] = kGet.bekle
    await userEvent.type(editor(), ' D')
    await takvimeDon()
    await userEvent.click(await screen.findByRole('button', { name: 'Sonraki hafta' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    // BARİYER: takvimin GET'i sunucuda ESKİ metni okudu, yanıt yolda.
    await waitFor(() => expect(notGetleri(202).length).toBe(2))
    expect(notlar[202].icerik).toBe('ESKI')

    kPut.ac()
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI D'))
    await new Promise((r) => setTimeout(r, 30))
    kGet.ac()
    await waitFor(() => expect(editor().value).toBe('ESKI D'))
  })

  it('dosyada ESKİ bir seansın notu düzeltilince takvim panelinin "Önceki seans notları" kopyası da tazelenir', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'ilk hali' }
    ciz()
    await takvimde202Ac()
    await paneldenDosyayaGit()
    await userEvent.click(listeSatiri('7 Eylül 2026, 10:00'))
    await waitFor(() => expect(editor().value).toBe('ilk hali'))
    await userEvent.type(editor(), ' duzeltildi')
    await kaydedildiBekle()

    await takvimeDon()
    const gecmis = await screen.findByRole('region', { name: 'Önceki seans notları' })
    await userEvent.click(within(gecmis).getByRole('button', { name: /7 Eylül 2026, 10:00/ }))
    expect(gecmis.textContent).toContain('ilk hali duzeltildi')
  })
})

describe('C2 — durum/ödeme yazmaları iki ekranda TEK yoldan', () => {
  async function dosyada202Sec() {
    await danisanlarda()
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await screen.findByLabelText('Seans notu')
  }

  it('dosyada "Ödendi" işaretlenince AYNI dosyanın Bilgiler bakiyesi 0,00 TL olur', async () => {
    ciz()
    await danisanlarda()
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    await waitFor(() => expect(bakiye()).toBe('450,00 TL'))
    await userEvent.click(screen.getByRole('tab', { name: 'Seanslar' }))
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))

    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    expect(bakiye()).toBe('0,00 TL')
  })

  it('dosyada "Ödendi" işaretlenip Takvim -> Danışanlar gidip gelince kutu İŞARETLİ, listede "· Ödendi" VAR', async () => {
    ciz()
    await dosyada202Sec()
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))

    await takvimeDon()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await screen.findByLabelText('Seans notu')
    expect(odendiKutusu().checked).toBe(true)
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('· Ödendi')
  })

  it('dosyada "Ödendi" işaretlenince takvimde AYNI seans açılınca kutu İŞARETLİ', async () => {
    ciz()
    // Takvim önce 202'nin haftasını yükler (liste önbelleğe ÖDENMEMİŞ girer).
    await takvimde202Ac()
    expect(odendiKutusu().checked).toBe(false)
    await paneldenDosyayaGit()
    await screen.findByLabelText('Seans notu')
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
    const takvimGetleri = istekler.filter((i) => i.yol.startsWith('/api/randevular?')).length

    await takvimeDon()
    await screen.findByLabelText('Seans notu')
    expect(odendiKutusu().checked).toBe(true)
    // Takvim YENİDEN ÇEKİLMEDİ: değer yayılımdan geliyor.
    expect(istekler.filter((i) => i.yol.startsWith('/api/randevular?')).length).toBe(takvimGetleri)
  })

  it('ters yön: takvimde not yazılınca dosya listesinde "Not yazılmamış" DEĞİL, notun ilk satırı görünür', async () => {
    ciz()
    // Dosya listesi ÖNCE yüklenir (202'nin notu yok).
    await danisanlarda()
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('Not yazılmamış')

    await takvimeDon()
    await takvimde202Ac()
    await userEvent.type(editor(), 'Uyku düzeni iyileşmiş')
    await kaydedildiBekle()

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    const satir = listeSatiri('14 Eylül 2026, 10:00')
    expect(satir.textContent).not.toContain('Not yazılmamış')
    expect(satir.textContent).toContain('Uyku düzeni iyileşmiş')
  })

  it('ters yön: takvimde "Gelmedi" işaretlenince dosya listesindeki durum da "Gelmedi"', async () => {
    ciz()
    await danisanlarda()
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('Geldi')
    await takvimeDon()
    await takvimde202Ac()
    await userEvent.click(screen.getByRole('button', { name: 'Gelmedi' }))
    await waitFor(() => expect(durumlar[202]).toBe('gelmedi'))
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('Gelmedi')
  })

  // Bu projede ay özeti ile kartın farklı borç göstermesi daha önce gerçek
  // bir hataydı (dal incelemesi I1). Dosyadan yapılan ödeme de `AnaEkran.
  // odemeDegis`ten geçtiği için özetin tazeleme sayacını artırır — ama özet
  // `TakvimSekmesi`nin içinde ve dosya görünürken monte DEĞİL, dolayısıyla
  // sayacın kendisi bu an gözlemlenemez: özet açıldığında zaten TEK taze
  // istek atar. Ölçülen, kullanıcının gördüğü: dosyadan ödeme → kart bakiyesi
  // 0 → takvimde açılan özet de Ayşe'yi borçlu GÖSTERMEZ; iki ekran AYNI
  // borcu söylüyor.
  it('dosyadan ödeme: kart bakiyesi ve sonra açılan ay özeti AYNI borcu gösterir', async () => {
    ciz()
    await dosyada202Sec()
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    expect(bakiye()).toBe('0,00 TL')

    await takvimeDon()
    await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))
    const bolge = await screen.findByRole('region', { name: 'Ay sonu özeti' })
    await waitFor(() =>
      expect(
        within(bolge).getAllByRole('term').find((e) => e.textContent === 'Bekleyen')
          ?.nextElementSibling?.textContent,
      ).toBe('0,00 TL'),
    )
    expect(within(bolge).queryByRole('button', { name: /Ayşe Yılmaz/ })).toBeNull()
  })

  // `useDanisanSeanslari` `yazmaSaati`nin üçüncü kullanıcısı: liste okuması
  // yazmadan ÖNCE başlayıp SONRA dönerse (sunucu okumayı eski değerle yaptı)
  // yama kaybolmamalı.
  it('liste okuması uçuştayken takvimde ödenen seans, geç dönen listede ESKİ değere dönmez', async () => {
    ciz()
    await takvimde202Ac()
    const k = kapi()
    sonraBekle['GET /api/danisanlar/1/seanslar'] = k.bekle
    await paneldenDosyayaGit()
    // BARİYER: listenin okuması yola çıktı (anlık görüntü: ödenmemiş).
    await waitFor(() =>
      expect(istekler.some((i) => i.yol === '/api/danisanlar/1/seanslar')).toBe(true),
    )
    await takvimeDon()
    await screen.findByLabelText('Seans notu')
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))

    k.ac()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('· Ödendi')
  })
})

describe('I1 — Kilitle kabuğun üst satırında, her sekmede', () => {
  it.each([['Takvim'], ['Danışanlar'], ['Ayarlar']])(
    '%s sekmesindeyken Kilitle görünür ve kilitler',
    async (sekme) => {
      ciz()
      await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${sekme}`) }))
      expect(
        screen.getByRole('tab', { name: new RegExp(`^${sekme}`) }).getAttribute('aria-selected'),
      ).toBe('true')
      await userEvent.click(screen.getByRole('button', { name: 'Kilitle' }))
      expect(kilitle).toHaveBeenCalledTimes(1)
    },
  )

  it('Kilitle, danışan dosyası (risk notu dahil) açıkken de erişilebilir', async () => {
    ciz()
    await danisanlarda()
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    await userEvent.click(screen.getByRole('button', { name: 'Kilitle' }))
    expect(kilitle).toHaveBeenCalledTimes(1)
  })
})

describe('I2 — açık dosyanın kime ait olduğu Seanslar alt sekmesinde de görünür', () => {
  it('Seanslar alt sekmesinde danışanın adı başlıkta', async () => {
    ciz()
    await danisanlarda()
    expect(screen.getByRole('tab', { name: 'Seanslar' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Ayşe Yılmaz' })).toBeDefined()
    // Başka danışana geçince başlık da değişir.
    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir dosyasını aç' }))
    expect(await screen.findByRole('heading', { name: 'Mehmet Demir' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Ayşe Yılmaz' })).toBeNull()
  })
})

describe('I3 — dosya açılınca varsayılan seçim', () => {
  it('listeden açılınca bugünden önceki en yeni seans (201) seçili, gelecekteki 202 DEĞİL', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'GECMIS SEANS NOTU' }
    notlar[202] = { sablon: 'serbest', icerik: 'GELECEK SEANS NOTU' }
    ciz()
    await danisanlarda()
    await waitFor(() => expect(editor().value).toBe('GECMIS SEANS NOTU'))
    const aktif = within(screen.getByTestId('seans-listesi')).getByRole('button', { current: true })
    expect(aktif.textContent).toContain('7 Eylül 2026, 10:00')
    expect(notGetleri(202)).toHaveLength(0)
  })

  it('takvimden "dosyasını aç" ile gelinince O seans (202) seçili', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'GECMIS SEANS NOTU' }
    notlar[202] = { sablon: 'serbest', icerik: 'GELECEK SEANS NOTU' }
    ciz()
    await takvimde202Ac()
    await paneldenDosyayaGit()
    await waitFor(() => expect(editor().value).toBe('GELECEK SEANS NOTU'))
    const aktif = within(screen.getByTestId('seans-listesi')).getByRole('button', { current: true })
    expect(aktif.textContent).toContain('14 Eylül 2026, 10:00')
  })
})

describe('M1 — sekme gidip gelince dosyanın durumu korunur, not yeniden istenmez', () => {
  it('elle seçilen seans ve alt sekme korunur; seçili notun GET\'i tekrarlanmaz', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'SECILEN' }
    ciz()
    await danisanlarda()
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await waitFor(() => expect(editor().value).toBe('SECILEN'))
    expect(notGetleri(202)).toHaveLength(1)

    // Alt sekme: Bilgiler -> Takvim -> Danışanlar => hâlâ Bilgiler.
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    await takvimeDon()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    expect(screen.getByRole('tab', { name: 'Bilgiler' }).getAttribute('aria-selected')).toBe('true')

    // Seçim: Seanslar'a dönünce hâlâ 202, not önbellekten (yeni GET YOK).
    await userEvent.click(screen.getByRole('tab', { name: 'Seanslar' }))
    await waitFor(() => expect(editor().value).toBe('SECILEN'))
    const aktif = within(screen.getByTestId('seans-listesi')).getByRole('button', { current: true })
    expect(aktif.textContent).toContain('14 Eylül 2026, 10:00')
    await takvimeDon()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await screen.findByLabelText('Seans notu')
    expect(notGetleri(202)).toHaveLength(1)
  })

  // Değişmez: görünmeyen sekmeden (silinemez görüntüleme kaydı yazan) istek
  // atılmaz. Liste yanıtı kullanıcı Takvim'e geçtikten SONRA gelir ve
  // varsayılan seçimi kurar; dosyanın not isteği Danışanlar görünene kadar
  // BEKLER.
  it('liste yanıtı Takvim sekmesindeyken gelirse dosyanın not isteği Danışanlar görünene kadar ATILMAZ', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'GECMIS' }
    ciz()
    const k = kapi()
    onceBekle['GET /api/danisanlar/1/seanslar'] = k.bekle
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await takvimeDon()
    k.ac()
    // BARİYER: liste yanıtı geldi ve işlendi (takvimdeyken).
    await waitFor(() =>
      expect(istekler.some((i) => i.yol === '/api/danisanlar/1/seanslar')).toBe(true),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(notGetleri(201)).toHaveLength(0)

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await waitFor(() => expect(editor().value).toBe('GECMIS'))
    expect(notGetleri(201)).toHaveLength(1)
  })

  it('Bilgiler alt sekmesindeyken seçili seansın notu İSTENMEZ', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'GECMIS' }
    ciz()
    const k = kapi()
    onceBekle['GET /api/danisanlar/1/seanslar'] = k.bekle
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await userEvent.click(await screen.findByRole('tab', { name: 'Bilgiler' }))
    k.ac()
    await waitFor(() => expect(bakiye()).toBe('450,00 TL'))
    await new Promise((r) => setTimeout(r, 50))
    expect(notGetleri(201)).toHaveLength(0)
  })
})

describe('I4 — seans listesi hatası "seans yok" DEĞİLDİR (AnaEkran üzerinden)', () => {
  it('500 -> "Seanslar yüklenemedi" + Yeniden dene; "seansı yok" YOK; yeniden deneme listeyi getirir', async () => {
    seanslarHatasi = true
    ciz()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    const alarm = await screen.findByRole('alert')
    expect(alarm.textContent).toContain('Seanslar yüklenemedi')
    expect(screen.queryByText('Bu danışanın kayıtlı bir seansı yok.')).toBeNull()

    seanslarHatasi = false
    await userEvent.click(within(alarm).getByRole('button', { name: 'Yeniden dene' }))
    await waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )
    expect(screen.getByTestId('seans-listesi').querySelectorAll('li')).toHaveLength(2)
  })
})

describe('M4 — seans zamanı iki ekranda TEK biçim', () => {
  it('takvim panelinin "Önceki seans notları" ve dosya listesi aynı seansı AYNI metinle gösterir', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'onceki not' }
    ciz()
    await takvimde202Ac()
    const gecmis = screen.getByRole('region', { name: 'Önceki seans notları' })
    await waitFor(() => expect(gecmis.textContent).toContain('Seans: 7 Eylül 2026, 10:00'))

    await paneldenDosyayaGit()
    await waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )
    expect(listeSatiri('7 Eylül 2026, 10:00')).toBeDefined()
  })
})
