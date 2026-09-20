import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { taslakOku, taslaklariUnut } from '../seans/taslak'
import { AnaEkran } from './AnaEkran'

// Görev 10 inceleme Bulgu 1: RandevuPaneli, seçili randevu/boş saat değişince
// yeniden mount edilecek bir `key` almadan önce, panel içindeki state
// (silme onayı, doldurulmuş form alanları) bir seçimden diğerine sızıyordu.
// Bu testler AnaEkran seviyesinde çalışır çünkü asıl düzeltme (key) çağrı
// noktasında (AnaEkran.tsx) — RandevuPaneli.test.tsx'teki testler her
// zaman temiz bir mount yaptığından bu regresyonu yakalayamaz.

const danisanlar = [
  { id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' },
  { id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif' },
]

const randevuA = {
  id: 101, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
  durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
}
const randevuB = {
  id: 102, client_id: 2, danisan_adi: 'Mehmet Demir',
  baslangic: '2026-09-07T13:00', bitis: '2026-09-07T14:00',
  durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
}

// --- Görev 9: seans paneli sunucu taklidi ---------------------------------
//
// Randevu seçilince panel üç istek daha atıyor: `.../not`, `.../ozel-not` ve
// `/api/danisanlar/{id}/notlar`. Aşağıdaki yardımcı bunları karşılıyor ve
// PUT'ları hatırlıyor (sekme değişimi/seans geçişi testleri yazılanın
// gerçekten sunucuya gittiğini ölçebilsin diye).
type NotKaydi = { sablon: string; icerik: string }
let sunucuNotlari: Record<number, NotKaydi>
let sunucuOzelNotlari: Record<number, string>
let sunucuGecmisi: {
  appointment_id: number
  client_id: number
  seans_zamani: string
  sablon: string
  icerik: string
  guncelleme_zamani: string
}[]

const ZAMAN = '2026-09-07T06:00:00Z'

// Veri raporu testinin iki kanaryası. Plan 4 Görev 7'den beri rapor
// SUNUCUDA üretiliyor; istemci tarafında ölçülebilen şey, rapor isteğinin
// not içeriği (özel ya da resmî) TAŞIMAMASI ve not çekmemesidir. Rapor
// İÇERİĞİ sunucunun HTTP testinde (`veri_raporu_sifreli_pdf_...`) ölçülür.
const OZEL_NOT_KANARYASI = 'OZEL-NOT-KANARYASI-XYZ'
const RESMI_NOT_KANARYASI = 'RESMI-NOT-KANARYASI-ABC'

function jsonYanit(govde: unknown): Response {
  return { ok: true, json: async () => govde } as unknown as Response
}

// --- Dal incelemesi: ana ekranin iki YENI mount istegi -------------------
//
// `AnaEkran` artik mount'ta `GET /api/saklama-suresi-dolanlar` ve
// `GET /api/depolama-durumu` de cagiriyor (HTTP -> arayuz taramasinin
// bagladigi uclar). Bu dosyadaki ON taklidin hepsi bilinmeyen yolda
// FIRLATIYOR; ortak yardimci her taklide ayri dal eklemek yerine tek
// yerde cevap veriyor.
//
// VARSAYILAN NOTR: hicbir dosyanin suresi dolmamis, esik asilmamis --
// yani iki yeni bolum de gorunmez ve mevcut testlerin ekran iddialari
// degismez. Onlari goren testler degerleri kendileri kuruyor.
let sunucuSaklamaDolanlar: typeof danisanlar = []
let sunucuDepolama = { toplam_boyut: 0, esik: 500 * 1024 * 1024, uyari: false }

// --- Yedekleme: mount'ta `POST /api/yedekler`, gerekirse `POST /api/yedek`
//
// VARSAYILAN NOTR: bugunun yedegi ZATEN ALINMIS. Boylece varsayilan halde
// otomatik yedek TETIKLENMEZ ve mevcut testlerin istek sayilari/ekran
// iddialari degismez. Otomatik yedegi olcen testler listeyi kendileri
// bosaltir.
type TestYedek = { dosya_adi: string; tarih: string; boyut: number }
let sunucuYedekDizini: string
let sunucuYedekleri: TestYedek[]
let yedekIstekleri: { damga: string; hedef_dizin?: string }[]
/** Kurulursa `POST /api/yedek` bu mesajla `500` doner (disk dolu vb.). */
let yedekAlmaHatasi: string | null
/** Kurulursa `POST /api/yedekler` bu mesajla `400` doner (klasor secilmemis). */
let yedekListeHatasi: string | null

/** Testlerin varsaydigi "bugun" — `AnaEkran::yerelGun` ile ayni bicimde. */
const BUGUN = '2026-09-09'

/**
 * Sunucudaki gecerli parola. `POST /api/parola` taklidi bunu GERCEKTEN
 * degistirir: "parola degisti mi" iddiasi ancak boyle olculebilir --
 * her istegi `200` donen bir taklit, mevcut parola dogrulamasini hic
 * yapmayan bir istemciyi de yesil gecerdi.
 */
let sunucuParolasi: string

function hataYaniti(kod: number, mesaj: string): Response {
  return {
    ok: false,
    status: kod,
    json: async () => ({ hata: mesaj }),
  } as unknown as Response
}

function ekUcYaniti(yol: string, secenekler?: RequestInit): Response | null {
  // `POST /api/parola` taklidi -- sunucunun `core::parola` sozlesmesini
  // izler: mevcut parola YANLISSA 401, yeni parola KISAYSA 400, ikisi de
  // farkli metinler ("her hata parola hatasidir" tuzagi).
  if (yol === '/api/parola') {
    const g = JSON.parse((secenekler?.body as string) ?? '{}') as {
      mevcut_parola: string
      yeni_parola: string
    }
    if (g.mevcut_parola !== sunucuParolasi) {
      return hataYaniti(401, 'Mevcut parolanız hatalı. Parolanız değişmedi.')
    }
    if (g.yeni_parola.length < 8) {
      return hataYaniti(400, 'Yeni parola en az 8 karakter olmalı. Parolanız değişmedi.')
    }
    sunucuParolasi = g.yeni_parola
    return jsonYanit({})
  }
  if (yol.startsWith('/api/saklama-suresi-dolanlar')) return jsonYanit(sunucuSaklamaDolanlar)
  if (yol.startsWith('/api/depolama-durumu')) return jsonYanit(sunucuDepolama)
  // `/api/yedekler` ONCE: `/api/yedek` onun oneki.
  if (yol.startsWith('/api/yedekler')) {
    if (yedekListeHatasi) return hataYaniti(400, yedekListeHatasi)
    return jsonYanit({ hedef_dizin: sunucuYedekDizini, yedekler: sunucuYedekleri })
  }
  if (yol.startsWith('/api/yedek')) {
    const govde = JSON.parse((secenekler?.body as string) ?? '{}') as {
      damga: string
      hedef_dizin?: string
    }
    yedekIstekleri.push(govde)
    if (yedekAlmaHatasi) return hataYaniti(500, yedekAlmaHatasi)
    if (govde.hedef_dizin) {
      sunucuYedekDizini = govde.hedef_dizin
      yedekListeHatasi = null
    }
    sunucuYedekleri = [
      { dosya_adi: `yedek-${govde.damga}.db`, tarih: govde.damga, boyut: 4096 },
      ...sunucuYedekleri.filter((y) => y.tarih !== govde.damga),
    ]
    return jsonYanit({ tarih: govde.damga, boyut: 4096 })
  }
  return null
}

function notYaniti(yol: string, method: string, govde: unknown): Response | null {
  const ozel = /^\/api\/randevular\/(\d+)\/ozel-not$/.exec(yol)
  if (ozel) {
    const id = Number(ozel[1])
    if (method === 'PUT') sunucuOzelNotlari[id] = (govde as { icerik: string }).icerik
    return jsonYanit({
      appointment_id: id,
      icerik: sunucuOzelNotlari[id] ?? '',
      guncelleme_zamani: ZAMAN,
    })
  }
  const resmi = /^\/api\/randevular\/(\d+)\/not$/.exec(yol)
  if (resmi) {
    const id = Number(resmi[1])
    if (method === 'PUT') sunucuNotlari[id] = govde as NotKaydi
    const kayit = sunucuNotlari[id] ?? { sablon: 'dap', icerik: '' }
    const randevu = id === randevuB.id ? randevuB : randevuA
    return jsonYanit({
      appointment_id: id,
      client_id: randevu.client_id,
      seans_zamani: randevu.baslangic,
      ...kayit,
      guncelleme_zamani: ZAMAN,
    })
  }
  if (/^\/api\/danisanlar\/\d+\/notlar/.test(yol)) {
    // Sunucudaki `?once=` kesmesi taklit ediliyor: kesme UYGULANMAZSA
    // "Önceki seans notları" başlığı altında SONRAKİ seansların notları
    // gösterilir (inceleme I2). Taklit bunu uygulamasaydı, çağıran tarafın
    // `once` geçmemesi testlerde hiçbir fark yaratmazdı.
    const sorgu = new URL(yol, 'http://x').searchParams
    const once = sorgu.get('once')
    const kesilmis =
      once === null ? sunucuGecmisi : sunucuGecmisi.filter((n) => n.seans_zamani < once)
    // `?limit=` de TAKLIT EDILIYOR: sunucu onu `LIMIT`e geciriyor. Taklit
    // uygulamasaydi "en fazla ucu gosterir" iddiasi cagiranin GONDERDIGI
    // limiti degil, taklidin veri kumesinin boyutunu olcerdi -- ve istemci
    // tarafinda kalmis olu bir `slice` de gorunmez olurdu (dal incelemesi
    // M1 tam olarak bu sinifta bir olu savunmaydi).
    const limit = Number(sorgu.get('limit'))
    return jsonYanit(Number.isFinite(limit) && limit > 0 ? kesilmis.slice(0, limit) : kesilmis)
  }
  return null
}

beforeEach(() => {
  sunucuNotlari = {}
  sunucuOzelNotlari = {}
  sunucuGecmisi = []
  sunucuSaklamaDolanlar = []
  sunucuDepolama = { toplam_boyut: 0, esik: 500 * 1024 * 1024, uyari: false }
  sunucuYedekDizini = '/Volumes/YEDEK/terapi'
  sunucuYedekleri = [{ dosya_adi: `yedek-${BUGUN}.db`, tarih: BUGUN, boyut: 4096 }]
  yedekIstekleri = []
  yedekAlmaHatasi = null
  yedekListeHatasi = null
  sunucuParolasi = 'gizli-parola-123'
  // Taslak deposu MODÜL DÜZEYİNDE (bileşen ağacının dışında) yaşıyor ve
  // kendi belgesi "testler arası sızar" diyor. `SeansPaneli.test.tsx` ile
  // `NotEditoru.test.tsx` temizliyordu, bu dosya temizlemiyordu: bugün
  // yeşil ama SIRA BAĞIMLI — bir testin bıraktığı bekleyen metin, sonraki
  // testte "geri yüklendi" olarak editöre dolar.
  taslaklariUnut()
})

// --- Görev 8: sekme kabuğu yardımcıları -----------------------------------
//
// `AnaEkran` artık üç sekmeli bir kabuk (Takvim/Danışanlar/Ayarlar) ve
// YALNIZCA seçili sekmenin paneli monte ediliyor (bkz. `AnaEkran.tsx` modül
// başlığı "Yalnızca SEÇİLİ sekmenin paneli monte edilir"). Bu dosyadaki
// testlerin çoğu Görev 8'den ÖNCE yazıldı: danışan listesi/çipleri/
// arşivleme (eskiden ekranda HER ZAMAN görünüyordu) ve yedekleme/parola/
// depolama/saklama hatırlatması (eskiden ekranın ALT kısmında HER ZAMAN
// görünüyordu) artık kendi sekmelerinde, İSTEĞE BAĞLI monte ediliyor.
// Aşağıdaki yardımcılar bu geçişi testlerde açıkça yapıyor.

/** Danışanlar sekmesine geçer (danışan listesi, çipler, arşivleme, dosya). */
async function danisanlarSekmesineGec() {
  await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
}

/**
 * Ayarlar sekmesine geçer (yedekleme, parola, depolama, saklama hatırlatması).
 * Ad `/^Ayarlar/` ile aranıyor, TAM eşleşme DEĞİL: hiç yedek alınmamışsa
 * `Sekmeler` erişilebilir adı "Ayarlar — ilgilenilmesi gereken bir şey var"
 * yapar (bkz. `kabuk/Sekmeler.tsx` `uyaran` prop'u) — bu, testler için bir
 * hata değil, tasarımın kendisi.
 */
async function ayarlarSekmesineGec() {
  await userEvent.click(screen.getByRole('tab', { name: /^Ayarlar/ }))
}

/**
 * Açık danışan dosyasının "Bilgiler" alt sekmesine geçer (telefon, risk
 * notu, rıza, ekler, Bakiye — `DosyaBilgileri`, bkz. `DanisanDosyasi.tsx`
 * modül başlığı "Kendi küçük sekme şeridi"). Bu şerit `kabuk/Sekmeler`den
 * AYRI — üst kabuğun Takvim/Danışanlar/Ayarlar şeridiyle karıştırılmamalı.
 * Varsayılan alt sekme "Seanslar"dır; BAŞKA bir danışanın dosyası açılınca
 * (ya da takvimden bir seansla gelinince) "Seanslar"a döner. Danışanlar
 * sekmesinden çıkıp geri girmek alt sekmeyi artık SIFIRLAMAZ (son inceleme
 * M1: alt sekme `AnaEkran`'da yaşıyor) — zaten Bilgiler'deyken tıklamak
 * zararsız bir tekrardır.
 */
async function dosyaBilgileriSekmesineGec() {
  // `findByRole` (senkron `getByRole` DEĞİL): bazı çağrı yerlerinde dosya
  // henüz YÜKLENİYOR olabilir (ör. gecikmeli bir `GET` çözüldükten hemen
  // sonra) — şerit DOM'a geç düşerse `getByRole` erken patlardı.
  await userEvent.click(await screen.findByRole('tab', { name: 'Bilgiler' }))
}

/**
 * ESKİ mount-barrier'ın YERİNE. Görev 8'den ÖNCE "Ayşe Yılmaz dosyasını aç"
 * çipi HER ZAMAN ekrandaydı ve pek çok test onu "mount'un diğer istekleri
 * (takvim, liste, saklama, yedek) bitti" sinyali olarak kullanıyordu — çipin
 * kendisiyle hiçbir işi yoktu. Çip artık yalnızca Danışanlar sekmesinde; bu
 * yardımcı ORAYA GEÇİP çipi bekliyor (liste isteğinin GERÇEKTEN bittiğinin
 * kanıtı, eski barrier'la AYNI anlam), sonra Takvim sekmesine GERİ dönüyor —
 * testin geri kalanı hâlâ Takvim sekmesinde, eski konumunda çalışmaya devam
 * eder.
 */
async function listeYuklenmesiniBekleVeTakvimeDon() {
  await danisanlarSekmesineGec()
  await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })
  await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
}

describe('AnaEkran — panel kimliği (Görev 10 inceleme Bulgu 1)', () => {
  const gercekFetch = globalThis.fetch

  beforeEach(() => {
    // haftaninBasi(new Date()) mount sırasında gerçek saate bağlı olmasın diye
    // yalnızca Date sabitleniyor (App.test.tsx'teki desenle aynı).
    vi.useFakeTimers({ toFake: ['Date'] })
    // 2026-09-09 Çarşamba → hafta başı 2026-09-07 Pazartesi.
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const notlar = notYaniti(yol, secenekler?.method ?? 'GET', null)
      if (notlar) return notlar
      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => danisanlar } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        return { ok: true, json: async () => [randevuA, randevuB] } as unknown as Response
      }
      if (yol.startsWith('/api/cakisma')) {
        return {
          ok: true,
          json: async () => ({
            cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1,
          }),
        } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  it('A için silme onayı açıkken B seçilince onay B üzerinde sızmaz', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)

    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })

    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    expect(screen.getByText(/kalıcı olarak silinsin mi/i)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))

    // Panel B'yi göstermeli; A'da açılmış silme onayı B'ye sızmamalı,
    // aksi hâlde kullanıcı sadece gezinirken "Evet, sil"e basıp B'yi silebilir.
    expect(screen.queryByText(/kalıcı olarak silinsin mi/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Evet, sil' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sil' })).toBeDefined()
  })

  it('A\'da form alanları doldurulup boş bir saate geçilince alanlar temiz gelir', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)

    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })

    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.clear(screen.getByLabelText('Süre (dakika)'))
    await userEvent.type(screen.getByLabelText('Süre (dakika)'), '45')
    expect((screen.getByLabelText('Süre (dakika)') as HTMLInputElement).value).toBe('45')

    // Boş bir saate tıkla (09:00, 08 satırından farklı bir aria-label).
    const bosSaat = screen.getAllByLabelText(/boş$/).find((el) =>
      el.getAttribute('aria-label')?.includes('09:00'),
    )
    expect(bosSaat).toBeDefined()
    await userEvent.click(bosSaat!)

    // Yeni panel varsayılan süreyle (60) açılmalı, 45 değeri sızmamalı.
    expect((screen.getByLabelText('Süre (dakika)') as HTMLInputElement).value).toBe('60')
    expect((screen.getByLabelText('Danışan') as HTMLSelectElement).value).toBe('')
  })
})

// Dal incelemesi C1: mevcut bir randevuda "Güncelle"ye basmak POST (yeni
// kayıt) DEĞİL, PUT (güncelleme) üretmeli. RandevuPaneli.test.tsx bunu
// yakalayamaz — POST/PUT ayrımı çağrı noktasında (AnaEkran.kaydet).
describe('AnaEkran — düzenleme kipi POST değil PUT üretir (C1)', () => {
  const gercekFetch = globalThis.fetch
  let istekler: { yol: string; method: string; govde: unknown }[] = []

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    istekler = []

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const method = secenekler?.method ?? 'GET'
      const govde = secenekler?.body ? JSON.parse(String(secenekler.body)) : null
      istekler.push({ yol, method, govde })
      const notlar = notYaniti(yol, method, govde)
      if (notlar) return notlar
      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => danisanlar } as unknown as Response
      }
      if (yol.startsWith('/api/cakisma')) {
        return {
          ok: true,
          json: async () => ({
            cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1,
          }),
        } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        if (method === 'GET') {
          return { ok: true, json: async () => [randevuA] } as unknown as Response
        }
        return { ok: true, json: async () => ({}) } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  it('mevcut randevuda Güncelle PUT gönderir, POST göndermez', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })

    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '500')
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))

    const yazmalar = istekler.filter(
      (i) => i.yol.startsWith('/api/randevular') && i.method !== 'GET',
    )
    expect(yazmalar).toHaveLength(1)
    expect(yazmalar[0].method).toBe('PUT')
    expect(yazmalar[0].yol).toBe(`/api/randevular/${randevuA.id}`)
    expect(yazmalar[0].govde).toMatchObject({
      client_id: 1,
      baslangic: '2026-09-07T10:00',
      bitis: '2026-09-07T11:00',
      ucret: 50000,
    })
    // C1'in ta kendisi: hiçbir POST /api/randevular gitmemeli.
    expect(istekler.some((i) => i.yol === '/api/randevular' && i.method === 'POST')).toBe(false)
  })

  it('boş saatte Kaydet hâlâ POST gönderir (yeni kayıt kipi bozulmadı)', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })

    const bosSaat = screen.getAllByLabelText(/boş$/).find((el) =>
      el.getAttribute('aria-label')?.includes('09:00'),
    )
    await userEvent.click(bosSaat!)
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    const yazmalar = istekler.filter(
      (i) => i.yol.startsWith('/api/randevular') && i.method !== 'GET',
    )
    expect(yazmalar).toHaveLength(1)
    expect(yazmalar[0].method).toBe('POST')
    expect(yazmalar[0].yol).toBe('/api/randevular')
  })
})

// Plan 3 Görev 2: denetim kaydı hacmi. `audit_log` satırları SİLİNEMEZ, bu
// yüzden gereksiz her GET kalıcı bir `goruntuleme` satırı bırakır. Bu
// testler SAYAR ve TAM EŞİTLİK iddia eder ("en fazla" değil): bir kullanıcı
// eyleminden sonra takvimin kaç kez yeniden çekildiği tam olarak bilinmeli.
describe('AnaEkran — gereksiz yeniden yükleme yapmaz (Plan 3 Görev 2)', () => {
  const gercekFetch = globalThis.fetch
  let istekler: { yol: string; method: string }[] = []
  let randevuDurumu: Record<number, string>

  const takvimGetSayisi = () =>
    istekler.filter((i) => i.yol.startsWith('/api/randevular?') && i.method === 'GET').length

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    istekler = []
    randevuDurumu = { [randevuA.id]: 'planlandi', [randevuB.id]: 'planlandi' }

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const method = secenekler?.method ?? 'GET'
      istekler.push({ yol, method })
      const notlar = notYaniti(
        yol,
        method,
        secenekler?.body ? JSON.parse(String(secenekler.body)) : null,
      )
      if (notlar) return notlar
      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => danisanlar } as unknown as Response
      }
      if (yol.startsWith('/api/cakisma')) {
        return {
          ok: true,
          json: async () => ({
            cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1,
          }),
        } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        if (method === 'GET') {
          return {
            ok: true,
            json: async () => [
              { ...randevuA, durum: randevuDurumu[randevuA.id] },
              { ...randevuB, durum: randevuDurumu[randevuB.id] },
            ],
          } as unknown as Response
        }
        return { ok: true, json: async () => ({}) } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  it('"Geldi" işaretlemek takvimi yeniden çekmez, ekranı yine de günceller', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    expect(takvimGetSayisi()).toBe(1) // mount'taki tek yükleme

    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Geldi' }))

    const yazmalar = istekler.filter(
      (i) => i.yol.startsWith('/api/randevular') && i.method === 'PATCH',
    )
    expect(yazmalar).toHaveLength(1)
    expect(takvimGetSayisi()).toBe(1)

    // Sunucu isteği atlanmadı, yalnızca YENİDEN YÜKLEME atlandı: yeni durum
    // ekranda görünmeli. (Bu assertion olmasaydı "hiçbir şey yapmayan"
    // bir kod da testi geçerdi.) `data-durum` görsel sınıfa değil semantik
    // duruma bağlıdır (bkz. RandevuBloku).
    expect(
      screen.getByRole('button', { name: 'Ayşe Yılmaz' }).getAttribute('data-durum'),
    ).toBe('geldi')
    expect(
      screen.getByRole('button', { name: 'Mehmet Demir' }).getAttribute('data-durum'),
    ).toBe('planlandi')
  })

  it('silme takvimi yeniden çekmez, randevu ekrandan kalkar', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    expect(takvimGetSayisi()).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(screen.getByRole('button', { name: 'Evet, sil' }))

    expect(
      istekler.filter((i) => i.yol.startsWith('/api/randevular/') && i.method === 'DELETE'),
    ).toHaveLength(1)
    expect(takvimGetSayisi()).toBe(1)
    // TAM ad ile sorgulanıyor, regex ile değil: aranan şey takvimdeki randevu
    // bloğu ("Ayşe Yılmaz"), danışan listesindeki "Ayşe Yılmaz adlı danışanı
    // arşivle" düğmesi değil. Gevşek regex ikisini birbirine karıştırır ve
    // test "randevu ekrandan kalktı mı" sorusunu ölçmeyi bırakırdı.
    expect(screen.queryByRole('button', { name: 'Ayşe Yılmaz' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mehmet Demir' })).toBeDefined()
  })

  it('mount tek bir takvim isteği atar, hafta değişimi tam olarak bir tane daha', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    expect(takvimGetSayisi()).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    expect(takvimGetSayisi()).toBe(2)
  })
})

// Plan 2'den devredilen madde: `clients::arsivle` yazılmış ve test edilmişti
// ama HİÇBİR ÇAĞRI YERİ YOKTU. Bir danışan eklenebiliyor, arşivlenemiyordu;
// danışan listesi ve randevu açılır menüsü sınırsız büyüyordu.
describe('AnaEkran — danışan arşivleme (Plan 2 devri)', () => {
  const gercekFetch = globalThis.fetch
  let istekler: { yol: string; method: string }[] = []
  let listedekiler: typeof danisanlar

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    istekler = []
    listedekiler = [...danisanlar]

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const method = secenekler?.method ?? 'GET'
      istekler.push({ yol, method })
      const notYaniti_ = notYaniti(yol, method, null)
      if (notYaniti_) return notYaniti_
      if (yol.startsWith('/api/danisanlar')) {
        if (method === 'POST' && yol.endsWith('/arsivle')) {
          const id = Number(yol.split('/')[3])
          listedekiler = listedekiler.filter((d) => d.id !== id)
          return { ok: true, json: async () => ({}) } as unknown as Response
        }
        return { ok: true, json: async () => listedekiler } as unknown as Response
      }
      if (yol.startsWith('/api/cakisma')) {
        return {
          ok: true,
          json: async () => ({
            cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1,
          }),
        } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        return { ok: true, json: async () => [] } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  const danisanListesi = () => screen.getByRole('list')

  // Her satırın arşivleme düğmesi KENDİ danışanının adıyla anılır. Eskiden
  // hepsinin erişilebilir adı düz "Arşivle" idi ve testler sıraya (`[0]`,
  // `[1]`) güveniyordu; sıra değişse test yanlış düğmeye basar, ekran
  // okuyucu kullanıcısı da hangi düğmenin kime ait olduğunu duyamazdı.
  const arsivDugmesi = (ad: string) =>
    screen.getByRole('button', { name: `${ad} adlı danışanı arşivle` })

  it('her arşivle düğmesi hangi danışana ait olduğunu erişilebilir adında söyler', async () => {
    // Yıkıcı bir işlemde "hangi satırdaydım" bilgisi yalnızca GÖRSEL
    // bağlamda kalamaz: ekran okuyucu kullanıcısı listede N tane özdeş
    // "Arşivle" duyuyordu.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')

    expect(arsivDugmesi('Ayşe Yılmaz')).toBeDefined()
    expect(arsivDugmesi('Mehmet Demir')).toBeDefined()
    // Ad tek başına ARŞİVLEME düğmesini seçmemeli: takvimdeki randevu bloğu
    // da düz danışan adıyla anılıyor; iki düğmenin adı çakışmamalı.
    expect(screen.queryByRole('button', { name: 'Arşivle' })).toBeNull()
    expect(arsivDugmesi('Ayşe Yılmaz')).not.toBe(
      screen.queryByRole('button', { name: 'Ayşe Yılmaz' }),
    )
  })

  it('arşivleme sonucu ekran okuyucuya duyurulur', async () => {
    // `role="status"` olmadan işlem sessizdi: düğmeye basılıyor, danışan
    // listeden düşüyor ama kullanıcı hiçbir şey duymuyordu.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')

    // Önce YOK: her `<p>`'ye status vermeyen, gerçekten sonuca bağlı olduğu.
    expect(screen.queryByRole('status')).toBeNull()

    await userEvent.click(arsivDugmesi('Ayşe Yılmaz'))
    await userEvent.click(screen.getByRole('button', { name: 'Evet, arşivle' }))

    expect(screen.getByRole('status').textContent ?? '').toMatch(/Ayşe Yılmaz arşivlendi/)
  })

  it('arşivleme iki adımlıdır: tek tıkla istek gitmez', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')

    await userEvent.click(arsivDugmesi('Ayşe Yılmaz'))

    // Onay ekranda, ama HENÜZ hiçbir yazma isteği gitmedi.
    expect(screen.getByText(/Ayşe Yılmaz arşivlensin mi\?/)).toBeDefined()
    expect(istekler.filter((i) => i.method === 'POST')).toHaveLength(0)
    // Ön koşul olarak danışan hâlâ listede — "işlem öncesi durumla tatmin
    // olan assertion" tuzağına düşmemek için aşağıdaki testte listeden
    // GERÇEKTEN düştüğü ayrıca doğrulanıyor.
    expect(within(danisanListesi()).getByText('Ayşe Yılmaz')).toBeDefined()
  })

  it('onay metni arşivlemenin silme OLMADIĞINI söyler', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')
    await userEvent.click(arsivDugmesi('Ayşe Yılmaz'))

    const metin = screen.getByText(/arşivlensin mi\?/).textContent ?? ''
    // Kullanıcı "sildim, gitti" sanmamalı: metin kayıtların DURDUĞUNU
    // açıkça söylemeli...
    expect(metin).toMatch(/silinmez/)
    expect(metin).toMatch(/notları/)
    // ...ve "hiçbir şey olmadı" da sanmamalı: ne değişiyor, o da yazıyor.
    expect(metin).toMatch(/listeden ve randevu seçiminden kaldırılır/)
  })

  it('onaylanınca arşivlenir, listeden düşer ve ne olduğu yazılır', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')

    await userEvent.click(arsivDugmesi('Ayşe Yılmaz'))
    await userEvent.click(screen.getByRole('button', { name: 'Evet, arşivle' }))

    const yazmalar = istekler.filter((i) => i.method === 'POST')
    expect(yazmalar).toHaveLength(1)
    expect(yazmalar[0].yol).toBe('/api/danisanlar/1/arsivle')

    // Listeden düştü (randevu açılır menüsü de bu listeyle besleniyor)...
    expect(within(danisanListesi()).queryByText('Ayşe Yılmaz')).toBeNull()
    expect(within(danisanListesi()).getByText('Mehmet Demir')).toBeDefined()
    // ...ve kullanıcı ne olduğunu okuyor: silme değil.
    expect(screen.getByText(/Ayşe Yılmaz arşivlendi/)).toBeDefined()
    expect(screen.getByText(/Kayıtları silinmedi/)).toBeDefined()
  })

  it('arşivleme danışan listesini sunucudan yeniden çekmez', async () => {
    // Denetim kaydı hacmi (Plan 3 Görev 2): her GET kalıcı bir
    // `goruntuleme` satırı bırakabilir. Sonuç yerel olarak kesin bilinebilir.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')
    const oncekiGet = istekler.filter(
      (i) => i.yol === '/api/danisanlar' && i.method === 'GET',
    ).length
    expect(oncekiGet).toBe(1)

    await userEvent.click(arsivDugmesi('Ayşe Yılmaz'))
    await userEvent.click(screen.getByRole('button', { name: 'Evet, arşivle' }))

    expect(
      istekler.filter((i) => i.yol === '/api/danisanlar' && i.method === 'GET'),
    ).toHaveLength(1)
  })

  it('Vazgeç hiçbir istek atmaz ve danışanı listede bırakır', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')

    await userEvent.click(arsivDugmesi('Ayşe Yılmaz'))
    await userEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))

    expect(screen.queryByText(/arşivlensin mi\?/)).toBeNull()
    expect(istekler.filter((i) => i.method === 'POST')).toHaveLength(0)
    expect(within(danisanListesi()).getByText('Ayşe Yılmaz')).toBeDefined()
  })

  it('bir danışan için açılan onay başka danışana sızmaz', async () => {
    // Görev 10 inceleme Bulgu 1 ile aynı sınıf: onay state\'i seçime bağlı
    // olmazsa kullanıcı A için onay açıp B\'yi arşivleyebilir.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')

    await userEvent.click(arsivDugmesi('Ayşe Yılmaz'))
    expect(screen.getByText(/Ayşe Yılmaz arşivlensin mi\?/)).toBeDefined()

    await userEvent.click(arsivDugmesi('Mehmet Demir'))
    expect(screen.queryByText(/Ayşe Yılmaz arşivlensin mi\?/)).toBeNull()
    expect(screen.getByText(/Mehmet Demir arşivlensin mi\?/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Evet, arşivle' }))
    expect(
      istekler.filter((i) => i.method === 'POST').map((i) => i.yol),
    ).toEqual(['/api/danisanlar/2/arsivle'])
  })

  it('sunucu hatası gösterilir ve danışan listede kalır', async () => {
    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const method = secenekler?.method ?? 'GET'
      if (method === 'POST' && yol.endsWith('/arsivle')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ hata: 'Veritabanı hatası.' }),
        } as unknown as Response
      }
      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => danisanlar } as unknown as Response
      }
      return { ok: true, json: async () => [] } as unknown as Response
    }) as unknown as typeof fetch

    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')
    await userEvent.click(arsivDugmesi('Ayşe Yılmaz'))
    await userEvent.click(screen.getByRole('button', { name: 'Evet, arşivle' }))

    expect(screen.getByText('Veritabanı hatası.')).toBeDefined()
    expect(within(danisanListesi()).getByText('Ayşe Yılmaz')).toBeDefined()
    expect(screen.queryByText(/arşivlendi/)).toBeNull()
  })
})

// Plan 2'den devredilen madde: ad/telefon doğrulaması. Sunucunun ürettiği
// hata mesajı OLDUĞU GİBİ gösterilmeli — "Danışan eklenemedi." gibi tek bir
// genel mesaj kullanıcıya hangi alanı düzelteceğini söylemez.
describe('AnaEkran — danışan ekleme doğrulama hatası (Plan 2 devri)', () => {
  const gercekFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const method = secenekler?.method ?? 'GET'
      if (yol === '/api/danisanlar' && method === 'POST') {
        return {
          ok: false,
          status: 400,
          json: async () => ({ hata: 'Telefon en az 7 rakam içermeli. Numara yoksa alanı boş bırakın.' }),
        } as unknown as Response
      }
      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => danisanlar } as unknown as Response
      }
      return { ok: true, json: async () => [] } as unknown as Response
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  it('sunucunun alan adını içeren mesajını gösterir, genelleştirmez', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: danışan listesi/çipler artık Danışanlar sekmesinin İÇİNDE.
    await danisanlarSekmesineGec()
    await screen.findByText('Ayşe Yılmaz')

    await userEvent.click(screen.getByRole('button', { name: 'Danışan ekle' }))
    await userEvent.type(screen.getByLabelText('Ad soyad'), 'Zeynep Kaya')
    await userEvent.type(screen.getByLabelText('Telefon'), 'asdfgh')
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }))

    expect(await screen.findByText(/Telefon en az 7 rakam içermeli/)).toBeDefined()
    expect(screen.queryByText('Danışan eklenemedi.')).toBeNull()
  })
})

// Plan 2'den devredilen madde: `seciliRandevu`, `yukle()` sonrası bayatlıyor.
// Panelin `key`'i `randevu-${id}` olduğu için kimlik değişmediğinde bileşen
// yeniden mount EDİLMEZ ve panel, yeniden yüklemeden önceki nesneyi tutmaya
// devam eder. Plan 2'de görünmezdi (panel `durum` basmıyordu); Plan 3'te
// seans notu editörü bu nesneye bağlanacak — yazdığı `appointment_id` ve
// `client_id` buradan gelecek. Bayat nesne, notun yanlış (ya da artık var
// olmayan) bir randevuya yazılması demektir.
//
// Testler AnaEkran seviyesinde: RandevuPaneli.test.tsx'teki testler her
// zaman temiz bir mount yapar ve bu regresyonu göremez.
describe('AnaEkran — seçili randevu yeniden yüklemede bayatlamaz (Plan 2 devri)', () => {
  const gercekFetch = globalThis.fetch
  // Sunucudaki kayıt. Testler bunu değiştirip yeniden yükleme tetikliyor.
  let sunucudakiler: typeof randevuA[] = []
  let randevuIstegi = 0
  let randevularYetkisiz = false
  // Not uç noktalarının 401'i ayrı: kilit takvim isteği sırasında değil, not
  // yüklenirken de gelebilir ve panel o durumda da kapanmalı.
  let notYetkisiz = false

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    sunucudakiler = [randevuA]
    randevuIstegi = 0
    randevularYetkisiz = false
    notYetkisiz = false

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const method = secenekler?.method ?? 'GET'
      if (notYetkisiz && /\/(ozel-)?not$|\/notlar/.test(yol)) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ hata: 'Oturum zaman aşımına uğradı.' }),
        } as unknown as Response
      }
      const notlar = notYaniti(yol, method, null)
      if (notlar) return notlar
      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => danisanlar } as unknown as Response
      }
      if (yol.startsWith('/api/cakisma')) {
        return {
          ok: true,
          json: async () => ({
            cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1,
          }),
        } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        randevuIstegi += 1
        // Tarih aralığı bilerek yok sayılıyor: ölçülen şey haftanın hangi
        // randevuları içerdiği değil, yeniden yüklemenin seçili nesneye ne
        // yaptığı.
        if (randevularYetkisiz && randevuIstegi > 1) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ hata: 'Oturum zaman aşımına uğradı.' }),
          } as unknown as Response
        }
        return { ok: true, json: async () => sunucudakiler } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  async function randevuSec() {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    expect(screen.getByRole('heading', { name: 'Randevu' })).toBeDefined()
  }

  it('yeniden yükleme, panelin elindeki randevuyu TAZELER', async () => {
    await randevuSec()
    expect(screen.getByText(/2026-09-07 10:00/)).toBeDefined()

    // Kayıt sunucuda değişti (ör. başka bir uygulama örneği güncelledi).
    sunucudakiler = [{
      ...randevuA,
      baslangic: '2026-09-07T11:00',
      bitis: '2026-09-07T12:00',
      client_id: 2,
      danisan_adi: 'Mehmet Demir',
    }]

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))

    // Panel yeniden mount edilmedi (`key` aynı id) ama elindeki nesne taze.
    // Bayat kalsaydı burada hâlâ 10:00 yazardı — ve editör notu, kaydı
    // değişmiş bir randevunun eski kopyasına dayanarak yazardı.
    await waitFor(() => expect(screen.getByText(/2026-09-07 11:00/)).toBeDefined())
    expect(screen.queryByText(/2026-09-07 10:00/)).toBeNull()
  })

  it('yeniden yüklemede randevu artık gelmiyorsa panel kapanır', async () => {
    await randevuSec()

    // Randevu sunucuda yok (ör. seri iptali bu randevuyu da kapsadı).
    sunucudakiler = []
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))

    // Var olmayan bir randevuya bağlı panel (ve ileride not editörü) açık
    // kalırsa, otomatik kayıt silinmiş bir `appointment_id`'ye yazmaya
    // çalışır.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Randevu' })).toBeNull())
  })

  it('401 sonrası panel kapanır', async () => {
    randevularYetkisiz = true
    await randevuSec()

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))

    // Oturum kilitlendi: takvim listesi zaten temizleniyordu ama panel
    // seçili danışanı ve saatini göstermeye devam ediyordu.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Randevu' })).toBeNull())
  })
})

// ---------------------------------------------------------------------------
// Görev 9: seans paneli — bağlam ve iki sekmeli not
//
// Testler AnaEkran seviyesinde çünkü ölçülen şeylerin çoğu ÇAĞRI NOKTASINDA:
// hangi uç noktaya gidildiği, kaç istek atıldığı, seans geçişinde bekleyen
// metnin HANGİ randevunun notuna yazıldığı. SeansPaneli.test.tsx her zaman
// temiz bir mount yapar ve bunları göremez.
// ---------------------------------------------------------------------------

// Özel notun kanaryası: bu dizge resmî sekmede, geçmiş listesinde ve resmî
// nota giden hiçbir istekte GÖRÜNMEMELİ.
const GIZLI = 'GIZLI-OZEL-XYZ'

describe('AnaEkran — seans paneli (Görev 9)', () => {
  const gercekFetch = globalThis.fetch
  let istekler: { yol: string; method: string; govde: unknown }[] = []
  let notSunucuHatasi = false
  let notYetkisiz = false
  // Yalnızca geçmiş notlar uç noktasını düşüren ayrı bayrak: "geçmiş
  // isteğinin başarısızlığı yutulmuyor" iddiası ancak diğer iki istek
  // BAŞARILIYKEN ölçülebilir.
  let gecmisSunucuHatasi = false
  // Yalnızca seansın KENDİ resmî notunun okunmasını (`GET .../not`) 500'e
  // düşüren bayrak: `notSunucuHatasi` iki isteği birden düşürüyor ve "hangisi
  // düşerse düşsün" iddiası ancak ikisi AYRI ayrı kurulursa ölçülür.
  let resmiNotSunucuHatasi = false
  // Yalnızca ÖZEL NOTUN YAZMA isteğini 401'e düşüren bayrak. Planın en
  // sert kısıtı ("otomatik kayıt sırasında 401 gelirse yazılmamış içerik
  // düşürülemez") özel not için hiç koşulmamıştı.
  let ozelYazmaYetkisiz = false
  // Ödeme işareti (Plan 4 Görev 2). Taklit `PATCH .../odeme`'yi GERÇEKTEN
  // uygular: sonraki bir takvim yüklemesi sunucudaki değeri görür. Böylece
  // "yerel kopya tazelendi" iddiası, taklidin her zaman `false` dönmesine
  // yaslanmaz.
  let sunucuOdendi: Record<number, boolean> = {}
  // Kurulursa ödeme PATCH'i bu söz çözülene kadar yanıt vermez — "işlem
  // BİTTİ" bariyeri kurabilmek için (altıncı biçim).
  let odemeBekletici: Promise<void> | null = null
  // Kurulursa durum ve ödeme PATCH'leri bu mesajla 500 döner (Görev 2
  // inceleme M4/M6: hatanın NEREDE ve KAÇ KEZ gösterildiği).
  let durumHatasi: string | null = null
  let odemeHatasi: string | null = null
  // Uçuştaki yazma × hafta yüklemesi (Görev 2 inceleme M7). `durumBekletici`
  // durum PATCH'ini, `haftaBekletici` takvim GET'ini kapıda tutar. Takvim
  // yanıtı İSTEK ANINDA anlık görüntüyle kuruluyor (sunucu okumayı o an
  // yaptı) ve `haftaSuzgeci` açıkken görünen aralığa göre süzülüyor —
  // sonraki haftada A yok, panel gerçekten kapanıyor (üretimdeki akış).
  let durumBekletici: Promise<void> | null = null
  let haftaBekletici: Promise<void> | null = null
  let haftaSuzgeci = false
  let sunucuDurumu: Record<number, string> = {}

  const notGetSayisi = (id: number) =>
    istekler.filter((i) => i.yol === `/api/randevular/${id}/not` && i.method === 'GET').length
  const yazmalar = (yol: string) => istekler.filter((i) => i.yol === yol && i.method === 'PUT')
  const ozelGetleri = () =>
    istekler.filter((i) => /\/ozel-not$/.test(i.yol) && i.method === 'GET')

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    istekler = []
    notSunucuHatasi = false
    notYetkisiz = false
    gecmisSunucuHatasi = false
    resmiNotSunucuHatasi = false
    ozelYazmaYetkisiz = false
    sunucuOdendi = {}
    odemeBekletici = null
    durumHatasi = null
    odemeHatasi = null
    durumBekletici = null
    haftaBekletici = null
    haftaSuzgeci = false
    sunucuDurumu = {}
    sunucuOzelNotlari = { [randevuA.id]: GIZLI }

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const method = secenekler?.method ?? 'GET'
      const govde = secenekler?.body ? JSON.parse(String(secenekler.body)) : null
      istekler.push({ yol, method, govde })

      if (ozelYazmaYetkisiz && method === 'PUT' && /\/ozel-not$/.test(yol)) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ hata: 'Oturum zaman aşımına uğradı.' }),
        } as unknown as Response
      }
      const notYolu = /\/(ozel-)?not$/.test(yol) || /\/notlar/.test(yol)
      if (notYolu && notYetkisiz) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ hata: 'Oturum zaman aşımına uğradı.' }),
        } as unknown as Response
      }
      if (resmiNotSunucuHatasi && method === 'GET' && /^\/api\/randevular\/\d+\/not$/.test(yol)) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ hata: 'Seans notu okunamadi.' }),
        } as unknown as Response
      }
      if (/\/notlar/.test(yol) && gecmisSunucuHatasi) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ hata: 'Gecmis notlar okunamadi.' }),
        } as unknown as Response
      }
      if (notYolu && notSunucuHatasi) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ hata: 'Veritabanı okunamadı.' }),
        } as unknown as Response
      }
      const notlar = notYaniti(yol, method, govde)
      if (notlar) return notlar

      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => danisanlar } as unknown as Response
      }
      if (yol.startsWith('/api/cakisma')) {
        return {
          ok: true,
          json: async () => ({
            cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1,
          }),
        } as unknown as Response
      }
      if (durumHatasi && method === 'PATCH' && /^\/api\/randevular\/\d+$/.test(yol)) {
        return { ok: false, status: 500, json: async () => ({ hata: durumHatasi }) } as unknown as Response
      }
      const durumYolu = /^\/api\/randevular\/(\d+)$/.exec(yol)
      if (durumYolu && method === 'PATCH') {
        if (durumBekletici) await durumBekletici
        sunucuDurumu[Number(durumYolu[1])] = (govde as { durum: string }).durum
        return { ok: true, json: async () => ({}) } as unknown as Response
      }
      const odeme = /^\/api\/randevular\/(\d+)\/odeme$/.exec(yol)
      if (odeme && method === 'PATCH' && odemeHatasi) {
        return { ok: false, status: 500, json: async () => ({ hata: odemeHatasi }) } as unknown as Response
      }
      if (odeme && method === 'PATCH') {
        if (odemeBekletici) await odemeBekletici
        sunucuOdendi[Number(odeme[1])] = (govde as { odendi: boolean }).odendi
        return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        if (method === 'GET') {
          const aralik = /^\/api\/randevular\?baslangic=([^&]+)&bitis=([^&]+)/.exec(yol)
          const anlik = [randevuA, randevuB]
            .filter(
              (r) =>
                !haftaSuzgeci ||
                (aralik !== null &&
                  r.baslangic >= decodeURIComponent(aralik[1]) &&
                  r.baslangic < decodeURIComponent(aralik[2])),
            )
            .map((r) => ({
              ...r,
              odendi: sunucuOdendi[r.id] ?? r.odendi,
              durum: sunucuDurumu[r.id] ?? r.durum,
            }))
          if (haftaBekletici) await haftaBekletici
          return { ok: true, json: async () => anlik } as unknown as Response
        }
        return { ok: true, json: async () => ({}) } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  const odendiKutusu = () => screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement

  async function seansAc(ad = 'Ayşe Yılmaz') {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: ad })
    await userEvent.click(screen.getByRole('button', { name: ad }))
    await screen.findByLabelText('Seans notu')
  }

  /**
   * GÖZLEMLENEBİLİR BARİYER: randevu seçilince `RandevuPaneli`
   * `CAKISMA_GECIKME_MS` (300 ms) sonra `GET /api/cakisma?...&haric_id=<id>`
   * atıyor. "Bu işlemden sonra başka istek yok" diyen bir test anlık
   * görüntüsünü bu istek gelmeden alırsa, sorgu ölçüm penceresine düşer ve
   * test yük altında kırılır (Görev 2 I2 / Görev 4 I1: tek-PATCH testi 5
   * koşunun 4'ünde kırmızı; ölçüm penceresine sabit 400 ms eklenince HER
   * SEFERİNDE kırılıyordu).
   *
   * Süzgeçle ayıklamak yerine BEKLENİYOR: süzgeç, işlemin ürettiği gerçek bir
   * fazla `cakisma` isteğini de gizlerdi. Bekleme sayıya değil VARLIĞA
   * bakıyor ve tam olarak BİR sorgu olduğunu da iddia ediyor — debounce
   * bozulup iki sorgu atılsa burada görünür.
   */
  async function cakismaSorgusunuBekle(randevuId: number) {
    const sorgular = () =>
      istekler.filter(
        (i) => i.yol.startsWith('/api/cakisma?') && i.yol.endsWith(`&haric_id=${randevuId}`),
      )
    await waitFor(() => expect(sorgular()).toHaveLength(1))
  }

  it('randevu secilince seans paneli acilir', async () => {
    await seansAc()
    expect(screen.getByRole('region', { name: 'Seans' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Seans Notu' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Özel Notlarım' })).toBeDefined()
  })

  it('bos saat secilince seans paneli ACILMAZ', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    const bosSaat = screen.getAllByLabelText(/boş$/).find((el) =>
      el.getAttribute('aria-label')?.includes('09:00'),
    )
    await userEvent.click(bosSaat!)

    // Henüz bir `appointment_id` yok; not ona bağlanır.
    expect(screen.queryByRole('region', { name: 'Seans' })).toBeNull()
    expect(istekler.some((i) => /\/not$/.test(i.yol))).toBe(false)
  })

  it('ozel not resmi sekmede EKRANIN HICBIR YERINDE yoktur', async () => {
    await seansAc()
    expect(document.body.textContent).not.toContain(GIZLI)
  })

  it('ARTI YON: ozel sekmede ozel not GORUNUR ve ayri uc noktadan gelir', async () => {
    // Bu yarı olmadan "özel notu hiç göstermeyen" bir panel de üstteki testi
    // geçerdi.
    await seansAc()
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    expect((screen.getByLabelText('Özel notum') as HTMLTextAreaElement).value).toBe(GIZLI)

    // İçerik AYRI bir uç noktadan geldi; resmî not isteği bir filtre değil.
    expect(istekler.some((i) => i.yol === `/api/randevular/${randevuA.id}/ozel-not`)).toBe(true)
  })

  // İnceleme I1: `AnaEkran.tsx`'teki `key={seans-${id}}` SİLİNDİĞİNDE 313
  // testin hiçbiri kırılmıyordu — çağrı noktasındaki YÜK TAŞIYAN TEK `key`
  // ölçülmemişti. Somut zarar: A'nın seansında "Özel Notlarım"a geçen
  // terapist takvimden B'ye tıkladığında panel doğrudan ÖZEL sekmede açılır;
  // kullanıcı varsayılanın resmî sekme olduğunu bildiği için seans notunu
  // özel nota yazar ve o metin dışa aktarımlara, danışan raporuna HİÇ
  // girmez — resmî not sessizce boş kalır.
  //
  // `SeansPaneli.test.tsx`'teki `key` testleri bu hattı ölçemez: onlar aynı
  // örneği farklı `randevu.id` ile `rerender` ediyor, yani üretimde var
  // olmayan bir durumu (on birinci biçim). O testler meşru bir İKİNCİ
  // savunma hattını ölçüyor; birincil hat burada ölçülüyor.
  it('A ozel sekmedeyken B secilince panel RESMI sekmede acilir', async () => {
    await seansAc()
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    expect(await screen.findByLabelText('Özel notum')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))
    await screen.findByLabelText('Seans notu')

    expect(screen.getByRole('tab', { name: 'Seans Notu' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Özel Notlarım' }).getAttribute('aria-selected')).toBe(
      'false',
    )
    expect(screen.queryByLabelText('Özel notum')).toBeNull()
  })

  // Birincil hattın ikinci yarısı: `key` yalnızca sekme seçimini değil,
  // GİDEN seansın bekleyen ÖZEL metnini de taşır. Resmî not için aynı iddia
  // zaten var ("baska seansa gecince bekleyen metin GIDEN seansin notuna
  // yazilir"); özel yolun karşılığı yoktu.
  it('ozel sekmede bekleyen metin, B secilince A NIN ozel notuna yazilir', async () => {
    await seansAc()
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await userEvent.type(await screen.findByLabelText('Özel notum'), '-A HIPOTEZI')

    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))

    await waitFor(() =>
      expect(yazmalar(`/api/randevular/${randevuA.id}/ozel-not`)).toHaveLength(1),
    )
    expect(
      (yazmalar(`/api/randevular/${randevuA.id}/ozel-not`)[0].govde as { icerik: string }).icerik,
    ).toContain('-A HIPOTEZI')
    // Yanlış danışanın özel notuna yazma yok.
    expect(yazmalar(`/api/randevular/${randevuB.id}/ozel-not`)).toHaveLength(0)
    // Ve özel metin resmî uca HİÇ gitmedi.
    expect(JSON.stringify(yazmalar(`/api/randevular/${randevuA.id}/not`))).not.toContain(
      'A HIPOTEZI',
    )
  })

  // ESKİ HÂLİ TOTOLOJİKTİ (birinci biçim): "resmî istek"i
  // `/\/not$/ || /\/notlar/` ile TANIMLIYORDU ve `/ozel-not` o filtreye
  // zaten takılmadığı için döngü boş, iddia boş doğruydu — `notApi.notGetir`
  // yolunu `/ozel-not`'a çeviren mutasyon 8 test kırdı ama o testi
  // kırmadı. Yerine geçen iddia filtresiz: panel açılıp resmî sekmede
  // KALINDIĞINDA atılan İSTEKLERİN HİÇBİRİ özel yola gitmez.
  it('resmi sekmede kalinirken atilan HICBIR istek ozel yola gitmez', async () => {
    await seansAc()
    // Ön koşul: gerçekten istek atıldı (boş liste tatmin etmesin).
    expect(istekler.filter((i) => /\/(not|notlar)/.test(i.yol)).length).toBeGreaterThan(0)
    for (const i of istekler) expect(i.yol).not.toContain('ozel')

    // ARTI YÖN: özel sekmeye geçilince gerçekten özel yola gidiliyor —
    // "hiçbir yere gitmeyen" bir uygulama üsttekini de geçerdi.
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await screen.findByLabelText('Özel notum')
    expect(istekler.some((i) => i.yol.includes('ozel-not'))).toBe(true)
  })

  // Denetim kaydı: `ozel_not_getir` her çağrıda SİLİNEMEZ bir
  // `goruntuleme | private_note | <id>` satırı yazıyor. Panel her
  // açıldığında bu satırı bastırmak, kullanıcının hiç yapmadığı bir
  // eylemi kalıcı olarak bildirmek olurdu.
  it('ozel sekmeye GIRILMEDEN ozel not istegi HIC atilmaz', async () => {
    await seansAc()
    expect(ozelGetleri()).toHaveLength(0)

    // Sekmeler arasında gidip gelmek de yeni satır üretmemeli: giriş
    // BİR kez yükler.
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await screen.findByLabelText('Özel notum')
    expect(ozelGetleri()).toHaveLength(1)

    await userEvent.click(screen.getByRole('tab', { name: 'Seans Notu' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await screen.findByLabelText('Özel notum')
    expect(ozelGetleri()).toHaveLength(1)
  })

  it('ozel sekme istegi SEANSA bagli: onceki seansta girilmis olmasi yenisini yuklemez', async () => {
    await seansAc()
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await screen.findByLabelText('Özel notum')
    expect(ozelGetleri()).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))
    await screen.findByLabelText('Seans notu')

    // B'nin özel notu İSTENMEDİ: "istendi" bayrağı seans kimliği taşıyor.
    expect(ozelGetleri().filter((i) => i.yol.includes(String(randevuB.id)))).toHaveLength(0)
    expect(ozelGetleri()).toHaveLength(1)
  })

  it('resmi sekmede yazilan metin YALNIZCA /not adresine PUT edilir', async () => {
    await seansAc()
    await userEvent.type(screen.getByLabelText('Seans notu'), 'resmi ek')
    await userEvent.click(screen.getByRole('button', { name: 'Seansı kapat' }))

    await waitFor(() => expect(yazmalar(`/api/randevular/${randevuA.id}/not`)).toHaveLength(1))
    expect(yazmalar(`/api/randevular/${randevuA.id}/ozel-not`)).toHaveLength(0)
    // Resmî uç noktaya giden gövdede özel notun içeriği YOK.
    expect(JSON.stringify(yazmalar(`/api/randevular/${randevuA.id}/not`))).not.toContain(GIZLI)
  })

  it('ozel sekmede yazilan metin YALNIZCA /ozel-not adresine PUT edilir', async () => {
    await seansAc()
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await userEvent.type(screen.getByLabelText('Özel notum'), '-EK')
    await userEvent.click(screen.getByRole('button', { name: 'Seansı kapat' }))

    await waitFor(() =>
      expect(yazmalar(`/api/randevular/${randevuA.id}/ozel-not`)).toHaveLength(1),
    )
    expect(yazmalar(`/api/randevular/${randevuA.id}/ozel-not`)[0].govde).toEqual({
      icerik: `${GIZLI}-EK`,
    })
    // En kritik iddia: özel metin resmî uç noktaya HİÇ gitmedi.
    expect(yazmalar(`/api/randevular/${randevuA.id}/not`)).toHaveLength(0)
  })

  it('sekme degisince yazilan icerik kaybolmaz (sunucudan tazelenir)', async () => {
    await seansAc()
    await userEvent.type(screen.getByLabelText('Seans notu'), 'yazilan metin')
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await screen.findByLabelText('Özel notum')
    await userEvent.click(screen.getByRole('tab', { name: 'Seans Notu' }))

    await waitFor(() =>
      expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toContain(
        'yazilan metin',
      ),
    )
  })

  it('baska seansa gecince bekleyen metin GIDEN seansin notuna yazilir', async () => {
    await seansAc()
    await userEvent.type(screen.getByLabelText('Seans notu'), 'A seansinin metni')

    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))

    await waitFor(() => expect(yazmalar(`/api/randevular/${randevuA.id}/not`)).toHaveLength(1))
    // İçerik şablon başlıklarıyla birlikte gidiyor (yeni not); ölçülen şey
    // yazılan metnin A'nın kaydında olması.
    expect(
      (yazmalar(`/api/randevular/${randevuA.id}/not`)[0].govde as { icerik: string }).icerik,
    ).toContain('A seansinin metni')
    // Yanlış danışanın dosyasına not: B'nin notuna hiçbir şey yazılmadı.
    expect(yazmalar(`/api/randevular/${randevuB.id}/not`)).toHaveLength(0)
  })

  it('gecmis liste bu seansin KENDI notunu icermez ve en fazla ucu gosterir', async () => {
    sunucuGecmisi = [
      {
        appointment_id: randevuA.id, client_id: 1, seans_zamani: randevuA.baslangic,
        sablon: 'dap', icerik: 'BU SEANSIN NOTU', guncelleme_zamani: ZAMAN,
      },
      {
        appointment_id: 90, client_id: 1, seans_zamani: '2026-08-31T10:00',
        sablon: 'dap', icerik: 'birinci gecmis', guncelleme_zamani: ZAMAN,
      },
      {
        appointment_id: 89, client_id: 1, seans_zamani: '2026-08-24T10:00',
        sablon: 'soap', icerik: 'ikinci gecmis', guncelleme_zamani: ZAMAN,
      },
      {
        appointment_id: 88, client_id: 1, seans_zamani: '2026-08-17T10:00',
        sablon: 'serbest', icerik: 'ucuncu gecmis', guncelleme_zamani: ZAMAN,
      },
    ]
    await seansAc()

    // Sunucudan TAM OLARAK gösterilecek kadar isteniyor. Eskiden bir
    // fazlası isteniyordu ve gerekçesi "aynı dakikaya denk gelen ikinci
    // randevuyu telafi et"ti; o telafi çalışmıyordu (kesme SQL'de, düşen
    // not geri gelmiyor) ve yanındaki `appointment_id` süzgeci de hiçbir
    // zaman bir şey elemiyordu — ikisi de kaldırıldı (dal incelemesi M1).
    expect(
      istekler.some((i) =>
        i.yol.startsWith('/api/danisanlar/1/notlar?limit=3'),
      ),
    ).toBe(true)

    const gecmis = screen.getByRole('region', { name: 'Önceki seans notları' })
    expect(within(gecmis).getAllByRole('button')).toHaveLength(3)
    expect(gecmis.textContent).not.toContain('BU SEANSIN NOTU')

    await userEvent.click(within(gecmis).getAllByRole('button')[0])
    expect(within(gecmis).getByText('birinci gecmis')).toBeDefined()
  })

  // İnceleme I2: "Önceki seans notları" SONRAKİ seansları listeliyordu.
  // Hiçbir test EN YENİ OLMAYAN bir randevuyu açmadığı için yakalanmamıştı;
  // bu test tam olarak onu yapıyor (takvimde geriye gitmek olağan bir iş).
  it('gecmiste bir seans acilinca SONRAKI seanslarin notlari listelenmez', async () => {
    sunucuGecmisi = [
      {
        appointment_id: 88, client_id: 1, seans_zamani: '2026-08-17T10:00',
        sablon: 'dap', icerik: 'GERCEKTEN ONCEKI', guncelleme_zamani: ZAMAN,
      },
      {
        appointment_id: 300, client_id: 1, seans_zamani: '2026-11-02T10:00',
        sablon: 'dap', icerik: 'HENUZ YASANMAMIS', guncelleme_zamani: ZAMAN,
      },
    ]
    await seansAc()

    // İstek kesmeyi TAŞIMALI; kesme sunucunun işi, ama geçmek çağıranın.
    const gecmisIstegi = istekler.find((i) => i.yol.includes('/notlar'))
    expect(gecmisIstegi).toBeDefined()
    expect(gecmisIstegi!.yol).toContain(`once=${encodeURIComponent(randevuA.baslangic)}`)

    const gecmis = screen.getByRole('region', { name: 'Önceki seans notları' })
    // Başlık "Önceki seans notları" ve gösterilen tek not gerçekten önceki.
    expect(within(gecmis).getAllByRole('button')).toHaveLength(1)
    expect(gecmis.textContent).toContain('17.08.2026')
    // Bu seanstan SONRAKİ seansın notu ekranın hiçbir yerinde yok — açılınca
    // içeriği de görünmemeli.
    await userEvent.click(within(gecmis).getAllByRole('button')[0])
    expect(within(gecmis).getByText('GERCEKTEN ONCEKI')).toBeDefined()
    expect(document.body.textContent).not.toContain('HENUZ YASANMAMIS')
  })

  it('"Geldi" isaretlemek not isteklerini YENIDEN ATMAZ', async () => {
    // Denetim kaydı hacmi: her GET sunucuda SİLİNEMEZ bir `goruntuleme`
    // satırı bırakır. `durumDegis` seçili randevuyu TAZE bir nesneyle
    // değiştiriyor; yükleme efekti nesneye bağlansaydı üç istek daha giderdi.
    await seansAc()
    expect(notGetSayisi(randevuA.id)).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Geldi' }))

    expect(notGetSayisi(randevuA.id)).toBe(1)
    expect(istekler.filter((i) => /\/notlar/.test(i.yol))).toHaveLength(1)
    // Özel sekmeye girilmediği için özel not isteği HİÇ atılmadı (aşağıdaki
    // denetim kaydı testlerine bakın); "Geldi" de bunu değiştirmemeli.
    expect(ozelGetleri()).toHaveLength(0)
    // İşlem gerçekten yapıldı: "hiçbir şey yapmayan" kod da üsttekileri geçerdi.
    expect(screen.getByRole('button', { name: 'Ayşe Yılmaz' }).getAttribute('data-durum')).toBe(
      'geldi',
    )
  })

  // Kardeş test (Plan 4 Görev 2). Denetim hacmi: bir ödeme işaretleme TEK
  // `PATCH` üretir. `odemeDegis` seçili randevuyu TAZE bir nesneyle
  // değiştiriyor; not efektleri nesneye bağlansaydı üç GET daha, tazeleme
  // yerine `yukle()` çağrılsaydı bir takvim GET'i daha giderdi.
  it('"Ödendi" isaretlemek YALNIZCA tek PATCH /odeme uretir; not, gecmis ve takvim istekleri YENIDEN ATILMAZ', async () => {
    await seansAc()
    const kutu = odendiKutusu()
    expect(kutu.checked).toBe(false)
    // ÖN BARİYER: panelin gecikmeli çakışma sorgusu ölçüm penceresinden
    // ÖNCE gelmiş olmalı (bkz. `cakismaSorgusunuBekle`).
    await cakismaSorgusunuBekle(randevuA.id)

    let coz: () => void = () => {}
    odemeBekletici = new Promise<void>((r) => { coz = r })
    const oncekiSayi = istekler.length

    await userEvent.click(kutu)
    // İstek uçuşta: kutu kilitli (ikinci bir tıklama ikinci PATCH üretemez).
    expect(kutu.disabled).toBe(true)
    coz()
    // SON BARİYER: işlem BİTTİ (kilit kalktı). Kilit `altIslem`in `finally`
    // bloğunda, yani `onOdemeDegis`in döndürdüğü söz — içinde bir `yukle()`
    // beklenseydi o da — çözüldükten SONRA kalkıyor; o zincirin atacağı her
    // istek bu noktada `istekler`e düşmüş olur. Eskiden burada sabit 30 ms
    // vardı: ölçülebilir bir şey beklemiyordu, yalnızca gecikmeli çakışma
    // sorgusunun henüz gelmemiş olmasına yaslanıyordu.
    await waitFor(() => expect(kutu.disabled).toBe(false))

    // YOL + YÖNTEM + GÖVDE ile, tam eşitlik: "bir PATCH gitti" tek başına
    // `{durum}` PATCH'ine giden bir çağrıyı da geçirirdi.
    expect(istekler.slice(oncekiSayi)).toEqual([
      { yol: `/api/randevular/${randevuA.id}/odeme`, method: 'PATCH', govde: { odendi: true } },
    ])
    expect(notGetSayisi(randevuA.id)).toBe(1)
    expect(ozelGetleri()).toHaveLength(0)
    // İşlem gerçekten yapıldı ve ekran onu söylüyor.
    expect(sunucuOdendi[randevuA.id]).toBe(true)
    expect(odendiKutusu().checked).toBe(true)
  })

  // Yük taşıyan `key={seans-${id}}`: kutunun iyimser yerel durumu seans
  // değişince SIFIRLANMALI. Temiz mount değil, GERÇEK gezinme (A → B → A).
  it('seans degisince Odendi kutusu YENI randevunun degerini gosterir; geri donunce A nin isareti korunur', async () => {
    await seansAc()
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(sunucuOdendi[randevuA.id]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
    expect(odendiKutusu().checked).toBe(true)

    // B'ye geç: B ödenmemiş. `key` olmasaydı panel yeniden mount edilmez ve
    // A'nın iyimser `true`'su B'nin kutusunda kalırdı — yanlış danışana
    // "ödendi" görünür.
    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))
    // İnceleme CRITICAL-1: danışan adı artık bir DÜĞME (bkz. `SeansPaneli`
    // "başlıktaki danışan adı"); `findByText` bir düzenli ifadeyi TEK bir
    // metin düğümünde arıyor ve ad ayrı bir öğede olduğu için "metin birden
    // çok öğeye bölünmüş" hatasıyla patlıyor. `textContent` düğüm
    // sınırlarını GÖRMEZDEN GELİR, birleşik metni ölçer.
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Seans' }).textContent).toMatch(/Mehmet Demir — /),
    )
    expect(odendiKutusu().checked).toBe(false)

    // A'ya dön: takvim YENİDEN YÜKLENMEDİ, dolayısıyla A'nın `true`'su ancak
    // yerel listedeki kopya tazelendiyse görünür.
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Seans' }).textContent).toMatch(/Ayşe Yılmaz — /),
    )
    expect(odendiKutusu().checked).toBe(true)
    expect(
      istekler.filter((i) => i.yol.startsWith('/api/randevular?') && i.method === 'GET'),
    ).toHaveLength(1)
  })

  // Görev 2 inceleme M1 (ZORUNLU): `useTakvimAkisi.odemeDegis` içinde
  // `odemeGuncelle(id, true)` SABİTLENDİĞİNDE bütün testler geçiyordu.
  // Kullanıcı işareti kaldırır, ekran `false`, sunucuya `true` gider —
  // sessizce yanlış bakiye. Panel birim testi (`SeansPaneli.test.tsx` "iki
  // yon") yalnızca geri çağrıyı ölçüyor; bu test ÇAĞRI ZİNCİRİNİN sonunu,
  // giden HTTP gövdesini ölçüyor.
  it('odeme GERI ALINABILIR: isaretle -> {odendi:true}, kaldir -> {odendi:false}; baska seansa gidip donunce kutu false', async () => {
    await seansAc()
    await cakismaSorgusunuBekle(randevuA.id)
    const once = istekler.length

    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(sunucuOdendi[randevuA.id]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
    expect(odendiKutusu().checked).toBe(true)

    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(sunucuOdendi[randevuA.id]).toBe(false))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
    expect(odendiKutusu().checked).toBe(false)

    // İki yön, sırasıyla, tam eşitlikle — ve başka hiçbir istek.
    expect(istekler.slice(once)).toEqual([
      { yol: `/api/randevular/${randevuA.id}/odeme`, method: 'PATCH', govde: { odendi: true } },
      { yol: `/api/randevular/${randevuA.id}/odeme`, method: 'PATCH', govde: { odendi: false } },
    ])

    // Yerel liste de geri alındı: A'ya dönünce kutu `false` açılır (takvim
    // yeniden yüklenmiyor, değer listedeki kopyadan geliyor).
    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Seans' }).textContent).toMatch(/Mehmet Demir — /),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Seans' }).textContent).toMatch(/Ayşe Yılmaz — /),
    )
    expect(odendiKutusu().checked).toBe(false)
  })

  // Görev 2 inceleme M7: uçuştaki yazma × hafta yüklemesi. Takvim GET'i
  // PATCH BİTMEDEN başlar (sunucu eski değeri okur) ve PATCH'ten SONRA
  // dönerse, yanıt listeye ESKİ değeri yazıyordu: kullanıcı "ödendi"
  // işaretler, haftalar arasında gidip gelir, kutu işaretsiz açılır — sunucu
  // ise `true`. Akış üretimdeki gibi: A açık, yazma uçuşta, "Sonraki hafta"
  // (A yok, panel kapanır), "Önceki hafta" (GET kapıda), yazma biter, GET
  // döner, A yeniden açılır.
  it.each([
    [
      'odeme',
      async () => userEvent.click(odendiKutusu()),
      () => expect(odendiKutusu().checked).toBe(true),
      () => sunucuOdendi[randevuA.id] === true,
    ],
    [
      'durum',
      async () => userEvent.click(screen.getByRole('button', { name: 'Geldi' })),
      () => {
        expect(screen.getByRole('button', { name: 'Geldi' }).getAttribute('aria-pressed')).toBe('true')
        expect(screen.getByRole('button', { name: 'Ayşe Yılmaz' }).getAttribute('data-durum')).toBe('geldi')
      },
      () => sunucuDurumu[randevuA.id] === 'geldi',
    ],
  ])(
    'ucustaki %s yazmasi, ONCE baslayip SONRA donen hafta yuklemesinde ESKI degere donmez',
    async (_ad, yazmaEylemi, yeniDegerGorunur, sunucuYazdi) => {
      haftaSuzgeci = true
      await seansAc()

      let yazmayiBirak: () => void = () => {}
      const yazmaKapisi = new Promise<void>((r) => { yazmayiBirak = r })
      odemeBekletici = yazmaKapisi
      durumBekletici = yazmaKapisi
      await yazmaEylemi()

      await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Seans' })).toBeNull())

      let haftayiBirak: () => void = () => {}
      haftaBekletici = new Promise<void>((r) => { haftayiBirak = r })
      const getSayisi = () =>
        istekler.filter((i) => i.yol.startsWith('/api/randevular?') && i.method === 'GET').length
      const onceki = getSayisi()
      await userEvent.click(screen.getByRole('button', { name: 'Önceki hafta' }))
      // GET yola çıktı ve sunucu ESKİ değeri okudu (anlık görüntü).
      await waitFor(() => expect(getSayisi()).toBe(onceki + 1))

      yazmayiBirak()
      await waitFor(() => expect(sunucuYazdi()).toBe(true))
      haftayiBirak()

      await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'Seans' }).textContent).toMatch(/Ayşe Yılmaz — /),
      )
      yeniDegerGorunur()
    },
  )

  it('"Geldi" isaretlenince alt satirda SECILI gorunen dugme Geldi olur (panel remount olmadan)', async () => {
    // `durumDegis` seçili randevunun kopyasını AYNI kimlikle tazeliyor; panel
    // yeniden mount edilmiyor ve `aria-pressed` prop'tan okunuyor. O tazeleme
    // kaldırılırsa vurgu "planlandi"da (hiçbir düğmede) kalır.
    await seansAc()
    const geldi = () => screen.getByRole('button', { name: 'Geldi' })
    expect(geldi().getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(geldi())
    await waitFor(() => expect(geldi().getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('button', { name: 'Gelmedi' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('odeme istegi basarisiz olursa kutu geri doner ve hata alert ile duyurulur (cagri noktasindan)', async () => {
    await seansAc()
    const kutu = odendiKutusu()
    // Sunucu reddediyor: bir sonraki PATCH /odeme 404.
    const oncekiFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      if (/\/odeme$/.test(yol)) {
        istekler.push({ yol, method: secenekler?.method ?? 'GET', govde: null })
        return {
          ok: false,
          status: 404,
          json: async () => ({ hata: 'Kayıt bulunamadı.' }),
        } as unknown as Response
      }
      return oncekiFetch(girdi, secenekler)
    }) as unknown as typeof fetch

    await userEvent.click(kutu)
    const uyari = await within(screen.getByRole('region', { name: 'Seans' })).findByRole('alert')
    expect(uyari.textContent).toContain('Kayıt bulunamadı.')
    expect(odendiKutusu().checked).toBe(false)
    expect(sunucuOdendi[randevuA.id]).toBeUndefined()
  })

  // Görev 2 inceleme M4 + M6. M4: `useTakvimAkisi.durumDegis` içindeki
  // `throw e` kaldırılınca hiçbir test kırılmıyordu — hata yutulur, panel
  // "başarılı" sanar ve kullanıcı hiçbir şey duymaz. M6: hata hem panelde
  // hem sayfa üstündeki takvim bandında görünüyordu ve panel kapansa da
  // bant kalıyordu. İddia: hata TAM BİR KEZ, alt satırın `alert`inde; panel
  // kapanınca ekranda hiç yok.
  it.each([
    [
      'durum',
      () => { durumHatasi = 'DURUM-YAZILAMADI' },
      'DURUM-YAZILAMADI',
      async () => userEvent.click(screen.getByRole('button', { name: 'Geldi' })),
    ],
    [
      'odeme',
      () => { odemeHatasi = 'ODEME-YAZILAMADI' },
      'ODEME-YAZILAMADI',
      async () => userEvent.click(odendiKutusu()),
    ],
  ])(
    '%s hatasi YALNIZCA alt satirda, TEK KEZ duyurulur; panel kapaninca ekranda kalmaz',
    async (_ad, kur, mesaj, eylem) => {
      kur()
      await seansAc()
      await eylem()

      const uyari = await within(screen.getByRole('region', { name: 'Seans' })).findByRole('alert')
      expect(uyari.textContent).toContain(mesaj)
      // Tek yerde: sayfanın geri kalanında ikinci bir kopya yok.
      expect(document.body.textContent!.split(mesaj)).toHaveLength(2)
      // İşlem gerçekten olmadı ve ekran bunu söylüyor.
      expect(screen.getByRole('button', { name: 'Geldi' }).getAttribute('aria-pressed')).toBe('false')
      expect(odendiKutusu().checked).toBe(false)

      await userEvent.click(screen.getByRole('button', { name: 'Seansı kapat' }))
      expect(screen.queryByRole('region', { name: 'Seans' })).toBeNull()
      expect(document.body.textContent).not.toContain(mesaj)
    },
  )

  it('bos notta sablon basliklari gorunur ama HICBIR yazma uretilmez', async () => {
    await seansAc()
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    expect(alan.value).toContain('Veri:')
    expect(alan.value).toContain('Plan:')

    await userEvent.click(screen.getByRole('button', { name: 'Seansı kapat' }))
    // BARİYER: panel gerçekten kapandı, yani editörün unmount tahliyesi
    // ÇALIŞTI. Tahliye yazmayı senkron başlatıyor (`void k(kayit)` ->
    // `fetch` ilk `await`ten önce çağrılıyor ve taklit isteği ilk satırında
    // kaydediyor); bir yazma olacak olsaydı şu an `istekler`de olurdu.
    // Eskiden burada sabit 30 ms vardı. ARTI YÖN aynı yol üzerinden
    // "resmi sekmede yazilan metin YALNIZCA /not adresine PUT edilir"de.
    expect(screen.queryByRole('region', { name: 'Seans' })).toBeNull()
    expect(yazmalar(`/api/randevular/${randevuA.id}/not`)).toHaveLength(0)
  })

  // Planın en sert kısıtı özel not için hiç koşulmamıştı: `NotEditoru`
  // 401 kurtarmasını yalnızca `not-1` anahtarıyla test ediyordu. Burası
  // ÇAĞRI NOKTASINDAN uçtan uca koşuyor — taslak anahtarı `ozel-<id>` ve
  // kurtarılan metin RESMÎ nota değil, özel nota yazılmalı.
  it('ozel not kaydedilirken 401 gelirse metin kaybolmaz ve kilit acilinca OZEL nota yazilir', async () => {
    const ozelYol = `/api/randevular/${randevuA.id}/ozel-not`
    ozelYazmaYetkisiz = true
    // SAHTE ZAMANLAYICI (eskiden gerçek 2000 ms + `timeout: 4000` payı): bu
    // test bilerek editörün ÇAĞRI NOKTASINDAKİ varsayılan gecikmesini
    // (2000 ms) ölçüyor — prop'la kısaltmak ölçülen yolu değiştirirdi. Saat
    // artık ELLE 2000 ms ilerletiliyor: yük altındaki bir makinede "4 s
    // içinde yazıldı mı" yarışı yok.
    //
    // `shouldAdvanceTime` ZORUNLU: RTL'nin `asyncWrapper`'ı her `findBy*`/
    // `waitFor` sonunda `setTimeout(0)` bekliyor ve sahte saati yalnızca
    // `jest` globali varsa ilerletiyor (Vitest'te yok) — saat durursa ilk
    // `findBy` sonsuza kadar asılı kalıyor (ölçüldü). Bu yüzden "gecikme
    // dolmadan yazma yok" yönü burada ÖLÇÜLMÜYOR (saat gerçek zamanla da
    // akıyor); o yön `NotEditoru.test.tsx`'te tam sahte saatle ölçülüyor.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    const kullanici = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const editorGecikmesi = async (ms: number) => {
      await act(() => vi.advanceTimersByTimeAsync(ms))
    }

    const { unmount } = render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await kullanici.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')
    await kullanici.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await kullanici.type(await screen.findByLabelText('Özel notum'), '-KAYBOLMAMALI')

    // Gecikme dolunca GERÇEK otomatik kayıt denenir ve 401 alır (unmount
    // tahliyesi değil — 401'in geldiği an üretimde budur).
    await editorGecikmesi(2000)
    await waitFor(() => expect(yazmalar(ozelYol)).toHaveLength(1))
    expect(await screen.findByText(/kaydedilemedi/i)).toBeDefined()

    // App'in 401'de yaptığı şey görsel bir perde değil, GERÇEK unmount.
    unmount()
    ozelYazmaYetkisiz = false
    const oncekiYazmaSayisi = yazmalar(ozelYol).length

    // Kilit açıldı: AnaEkran yeniden mount edildi, kullanıcı aynı seansı
    // ve aynı sekmeyi açtı.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await kullanici.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')
    await kullanici.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))

    const alan = (await screen.findByLabelText('Özel notum')) as HTMLTextAreaElement
    expect(alan.value).toContain('-KAYBOLMAMALI')
    expect(screen.getByText(/geri yüklendi/i)).toBeDefined()

    // Ekranda kalmakla yetinmiyor: ilk fırsatta (editör gecikmesi dolunca)
    // SUNUCUYA yazılıyor.
    await editorGecikmesi(2000)
    await waitFor(() => expect(yazmalar(ozelYol).length).toBeGreaterThan(oncekiYazmaSayisi))
    expect(
      (yazmalar(ozelYol).at(-1)!.govde as { icerik: string }).icerik,
    ).toContain('-KAYBOLMAMALI')
    // Ve kurtarılan ÖZEL metin resmî nota HİÇ yazılmadı.
    expect(yazmalar(`/api/randevular/${randevuA.id}/not`)).toHaveLength(0)
  })

  it('not yuklenirken 401 gelirse panel kapanir', async () => {
    notYetkisiz = true
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))

    // Kilit: ekranda danışan adı ve saati kalmamalı — ne seans paneli ne de
    // randevu paneli. Yazılmamış metin taslakta korunuyor.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Randevu' })).toBeNull())
    expect(screen.queryByRole('region', { name: 'Seans' })).toBeNull()
  })

  it('not yuklenemezse panel ACILMAZ, hata ve yeniden deneme gosterilir', async () => {
    notSunucuHatasi = true
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))

    // "yükleniyor…" yazan bir panel sonsuza kadar öyle kalırdı.
    const uyari = await screen.findByRole('alert')
    expect(uyari.textContent).toContain('Seans notu yüklenemedi')
    expect(uyari.textContent).toContain('Veritabanı okunamadı.')
    expect(screen.queryByRole('region', { name: 'Seans' })).toBeNull()

    notSunucuHatasi = false
    await userEvent.click(within(uyari).getByRole('button', { name: 'Yeniden dene' }))
    expect(await screen.findByLabelText('Seans notu')).toBeDefined()
  })

  // Görev 2 inceleme I1: durum/ödeme satırı panelin içindeydi ve panel
  // yalnızca iki not isteği de başarılıysa açılıyordu. İki istek AYRI ayrı
  // düşürülüyor: yalnızca "ikisi birden" kurulsaydı, satırı yalnızca
  // `not`un hatasına bağlayan bir uygulama da geçerdi.
  it.each([
    ['seans notu', () => { resmiNotSunucuHatasi = true }, 'Seans notu okunamadi.'],
    ['gecmis notlar', () => { gecmisSunucuHatasi = true }, 'Gecmis notlar okunamadi.'],
  ])(
    '%s yuklenemezse de Geldi ve Odendi erisilebilir ve GERCEK PATCH uretir',
    async (_ad, dusur, mesaj) => {
      dusur()
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
      await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))

      const uyari = await screen.findByRole('alert')
      expect(uyari.textContent).toContain(mesaj)
      // Ön koşul: gerçekten HATA dalındayız (panel açılmadı).
      expect(screen.queryByRole('region', { name: 'Seans' })).toBeNull()
      expect(screen.queryByLabelText('Seans notu')).toBeNull()

      const geldi = () => screen.getByRole('button', { name: 'Geldi' })
      const once = istekler.length
      await userEvent.click(geldi())
      await waitFor(() => expect(geldi().getAttribute('aria-pressed')).toBe('true'))
      await userEvent.click(odendiKutusu())
      await waitFor(() => expect(odendiKutusu().disabled).toBe(false))

      // GERÇEK istekler, yol + yöntem + gövde ile.
      expect(istekler.slice(once).filter((i) => i.method === 'PATCH')).toEqual([
        { yol: `/api/randevular/${randevuA.id}`, method: 'PATCH', govde: { durum: 'geldi' } },
        { yol: `/api/randevular/${randevuA.id}/odeme`, method: 'PATCH', govde: { odendi: true } },
      ])
      expect(sunucuOdendi[randevuA.id]).toBe(true)
      expect(odendiKutusu().checked).toBe(true)
    },
  )

  it('gecmis notlar yuklenemezse BOS LISTE gosterilmez', async () => {
    // Yutulup boş liste gösterilseydi, notu olan bir danışan için ekranda
    // "önceki seans notu yok" yazardı — sessiz bir yalan.
    // Not ve özel not BAŞARIYLA geliyor; yalnızca geçmiş isteği düşüyor.
    gecmisSunucuHatasi = true
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))

    const uyari = await screen.findByRole('alert')
    expect(uyari.textContent).toContain('Gecmis notlar okunamadi.')
    expect(screen.queryByText(/önceki seanslarından kayıtlı not yok/i)).toBeNull()
    expect(screen.queryByLabelText('Seans notu')).toBeNull()
  })
})

// Kiplerin KESİŞİMİ: seans geçişi × henüz tamamlanmamış istek. Tek tek
// "seans açılır" ve "not kaydedilir" testleri bu iki sınıfı hiç görmez.
describe('AnaEkran — seans geçişi × uçuştaki istek (Görev 9)', () => {
  const gercekFetch = globalThis.fetch
  let gecikmeler: Record<string, Promise<void>>

  function kapi() {
    let ac!: () => void
    const bekle = new Promise<void>((coz) => {
      ac = coz
    })
    return { bekle, ac }
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    gecikmeler = {}

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const method = secenekler?.method ?? 'GET'
      const govde = secenekler?.body ? JSON.parse(String(secenekler.body)) : null
      const kapi = gecikmeler[`${method} ${yol}`]
      if (kapi) await kapi

      const notlar = notYaniti(yol, method, govde)
      if (notlar) return notlar
      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => danisanlar } as unknown as Response
      }
      if (yol.startsWith('/api/cakisma')) {
        return {
          ok: true,
          json: async () => ({
            cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1,
          }),
        } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        if (method === 'GET') {
          return { ok: true, json: async () => [randevuA, randevuB] } as unknown as Response
        }
        return { ok: true, json: async () => ({}) } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  const alan = () => screen.getByLabelText('Seans notu') as HTMLTextAreaElement

  it('yeni seansin notu YUKLENIRKEN onceki seansin notu ekranda kalmaz', async () => {
    sunucuNotlari = { [randevuA.id]: { sablon: 'dap', icerik: 'A SEANSININ NOTU' } }
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')
    expect(alan().value).toBe('A SEANSININ NOTU')

    const b = kapi()
    gecikmeler[`GET /api/randevular/${randevuB.id}/not`] = b.bekle

    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))

    // B'nin verisi henüz gelmedi. Sıfırlama bir efekte bırakılsaydı, o
    // efekt çalışana kadar A'nın notu B'nin panelinde durur — yanlış
    // danışanın notu ekranda.
    expect(screen.queryByLabelText('Seans notu')).toBeNull()
    expect(document.body.textContent).not.toContain('A SEANSININ NOTU')

    b.ac()
    expect(await screen.findByLabelText('Seans notu')).toBeDefined()
  })

  it('geciken kayit yaniti, o sirada acilmis BASKA seansin notunu ezmez', async () => {
    sunucuNotlari = {
      [randevuA.id]: { sablon: 'dap', icerik: 'A metni' },
      [randevuB.id]: { sablon: 'dap', icerik: 'B METNI' },
    }
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')

    // A'nın kaydı uçuşta kalsın: unmount tahliyesi bu isteği atacak. Kapı
    // yazmadan ÖNCE kuruluyor: yük altında editörün kendi zamanlayıcısı
    // yazma sırasında dolsa bile o istek de kapıda bekler.
    const a = kapi()
    gecikmeler[`PUT /api/randevular/${randevuA.id}/not`] = a.bekle
    await userEvent.type(alan(), ' EK')

    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))
    await waitFor(() => expect(alan().value).toBe('B METNI'))

    // BARİYER (eskiden sabit 20 ms): A'nın kaydı uçuştayken taslağı depoda;
    // editör taslağı YALNIZCA `onKaydet` sözü — yani `notKaydet`in state
    // güncellemesi — çözüldükten SONRA temizliyor. Taslağın kalkması,
    // geciken yanıtın işlendiğinin gözlemlenebilir kanıtı.
    expect(taslakOku(`not-${randevuA.id}`)?.icerik).toContain(' EK')
    a.ac()
    await waitFor(() => expect(taslakOku(`not-${randevuA.id}`)).toBeUndefined())

    // Sekme gidip gelince editör yeniden mount olur ve o an geçerli olan
    // içerikle açılır: A'nın geciken yanıtı B'nin verisine yazılmış olsaydı
    // burada A'nın metni görünürdü.
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Seans Notu' }))
    expect(alan().value).toBe('B METNI')
  })
})

// ---------------------------------------------------------------------------
// Görev 10: danışan kartı + hızlı arama
//
// Bu testler AnaEkran seviyesinde çünkü ölçtükleri şey ÇAĞRI NOKTASINDA:
// `DanisanKarti.test.tsx` ve `HizliArama.test.tsx` her zaman temiz bir mount
// yapar ve "arama açık × sonuç var × 401 × danışan değişimi" kesişimlerini
// göremez (dördüncü ve beşinci biçim).
// ---------------------------------------------------------------------------

describe('AnaEkran — danışan kartı ve hızlı arama (Görev 10)', () => {
  const gercekFetch = globalThis.fetch

  // Danışan 1'in ek dosyaları; DELETE sunucuda gerçekten siliyor.
  let sunucuEkleri: {
    id: number
    client_id: number
    dosya_adi: string
    mime: string
    tur: string
    boyut: number
    eklenme_zamani: string
  }[] = []

  const kartDanisanlari = [
    { id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' },
    { id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif' },
    // Saklama süresi TAM BUGÜN dolan dosya: `yerelGun`'ün sınır davranışı
    // ancak böyle bir dosyada görünür (aşağıdaki gece yarısı bloğu).
    { id: 3, ad_soyad: 'Zeynep Kaya', telefon: null, durum: 'aktif' },
  ]

  // Bu hafta (2026-09-07 Pazartesi) ve GELECEK hafta bir randevu: aramadan
  // seansa gitmek gerçekten hafta değiştirmeyi gerektirsin.
  const buHafta = {
    id: 201, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
    baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
    durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
  }
  const gelecekHafta = {
    id: 202, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
    baslangic: '2026-09-14T10:00', bitis: '2026-09-14T11:00',
    durum: 'geldi', ucret: 45000, odendi: false, seri_id: null,
  }
  // BAŞKA danışanın ödenmemiş seansı: bakiyeye karışmamalı.
  const baskasininki = {
    id: 203, client_id: 2, danisan_adi: 'Mehmet Demir',
    baslangic: '2026-09-07T13:00', bitis: '2026-09-07T14:00',
    durum: 'geldi', ucret: 99900, odendi: false, seri_id: null,
  }
  // Özetteki borçlu Zeynep'in (id 3) GELİNMİŞ ve ödenmemiş seansı; hiçbir
  // testin gezdiği haftada değil. Tutar BİNLİK AYRAÇ gerektiriyor: özet ve
  // kart aynı borcu AYNI biçimde basmalı (Görev 4 inceleme I2).
  const zeynepinBorcu = {
    id: 204, client_id: 3, danisan_adi: 'Zeynep Kaya',
    baslangic: '2026-08-03T10:00', bitis: '2026-08-03T11:00',
    durum: 'geldi', ucret: 123450, odendi: false, seri_id: null,
  }
  const tumRandevular = [buHafta, gelecekHafta, baskasininki, zeynepinBorcu]
  const BAKIYE_450 = '450,00 TL'
  const BAKIYE_0 = '0,00 TL'

  const dosyalar: Record<number, unknown> = {
    1: {
      id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: '0555 111 22 33', durum: 'aktif',
      dogum_tarihi: '1990-04-15', basvuru_nedeni: 'Yoğun kaygı',
      risk_notu: 'RISK-NOTU-KANARYA', riza_tarihi: '2026-03-01', riza_dosya_id: null,
      son_temas: '2026-09-07', saklama_bitis: '2033-09-07',
    },
    2: {
      id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif',
      dogum_tarihi: null, basvuru_nedeni: null, risk_notu: null,
      riza_tarihi: null, riza_dosya_id: null, son_temas: null, saklama_bitis: null,
    },
    3: {
      id: 3, ad_soyad: 'Zeynep Kaya', telefon: '0555 999 88 77', durum: 'aktif',
      dogum_tarihi: null, basvuru_nedeni: null, risk_notu: null,
      riza_tarihi: '2019-09-09', riza_dosya_id: null,
      son_temas: '2019-09-09', saklama_bitis: '2026-09-09',
    },
  }

  const aramaSonuclari = [
    {
      tur: 'danisan', client_id: 1, danisan_adi: 'Ayşe Yılmaz',
      appointment_id: null, tarih: null, parca: 'Ayşe Yılmaz',
    },
    {
      tur: 'not', client_id: 1, danisan_adi: 'Ayşe Yılmaz',
      appointment_id: 202, tarih: '2026-09-14T10:00',
      parca: 'ARAMA-PARCASI-KANARYA',
    },
  ]

  let yetkisiz: boolean
  // IMPORTANT-A düzeltmesi: `yetkisiz` TÜM istekleri 401 yapıyor —
  // `dosyaGetir` hiçbir koşulda veri üretemediği için "yarım kart"
  // riski hiç OLUŞAMIYORDU (`DanisanDosyasi` `kart.dosya !== null` şartına
  // bağlı, bkz. `DanisanlarSekmesi.tsx`). Bu bayrak yalnızca EK LİSTESİ
  // isteğini (`Promise.all`'daki İKİNCİ istek) 401 yapar, `dosyaGetir`
  // BAŞARILI kalır — gerçek yarım-kart senaryosu.
  let ekIstegiYetkisiz: boolean
  let istekYollari: string[]
  // İndirilen Blob'lar (`danisanApi.veriRaporuIndir` sunucu yanıtını sarar).
  let uretilenBloblar: Blob[]
  // `POST /api/danisanlar/{id}/veri-raporu` gövdeleri (ham metin).
  let raporGovdeleri: string[]
  // Belirli bir isteği açıkça salınana kadar bekletir (Görev 9'daki
  // `kapi()` deseninin aynısı): "yeni veri gelene kadar öncekinin ekranda
  // kalmadığı" ancak bekleyen bir istekle ölçülebilir.
  let gecikmeler: Record<string, Promise<void>>
  // Dal incelemesi I1: sunucudaki durum/ödeme YAZMALARI. `GET /api/ay-ozeti`
  // Ayşe'nin 202 numaralı seansının borcunu BUNLARDAN hesaplar — "özet
  // tazelendi mi" ancak yazmadan sonra DEĞİŞEN bir yanıtla ölçülebilir.
  // Randevu listesi GET'i bunları bilerek YANSITMAZ: kartın uçuş yarışı
  // testi, yazmadan önce başlamış bir okumanın ESKİ değeri döndürmesine
  // dayanıyor.
  let sunucuOdemeleri: Record<number, boolean>
  let sunucuDurumlari: Record<number, string>
  /** Kurulursa `PATCH .../odeme` 500 döner ve sunucuda hiçbir şey değişmez. */
  let odemeHatasi: boolean

  function kapi() {
    let ac!: () => void
    const bekle = new Promise<void>((coz) => {
      ac = coz
    })
    return { bekle, ac }
  }

  const gercekOlustur = URL.createObjectURL
  const gercekSerbest = URL.revokeObjectURL

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    yetkisiz = false
    ekIstegiYetkisiz = false
    istekYollari = []
    gecikmeler = {}
    sunucuOdemeleri = {}
    sunucuDurumlari = {}
    odemeHatasi = false
    uretilenBloblar = []
    raporGovdeleri = []
    sunucuEkleri = [
      {
        id: 77, client_id: 1, dosya_adi: 'onam-formu.pdf', mime: 'application/pdf',
        tur: 'onam', boyut: 1024, eklenme_zamani: '2026-03-01T09:00:00Z',
      },
    ]
    // jsdom `createObjectURL`i uygulamıyor; taklit ediliyor VE üretilen Blob
    // yakalanıyor (`DanisanKarti.test.tsx` ile aynı desen).
    URL.createObjectURL = vi.fn((b: Blob) => {
      uretilenBloblar.push(b)
      return `blob:rapor-${uretilenBloblar.length}`
    }) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL

    // Özel not kanaryası: rapora sızarsa aşağıdaki test kırılır. Hem danışan
    // kimliği hem randevu kimlikleri dolduruluyor — sızıntıyı ekleyen kodun
    // `ozelNotApi.getir`e HANGİ kimliği geçirdiğini varsaymıyoruz.
    for (const id of [1, 2, 201, 202, 203]) sunucuOzelNotlari[id] = OZEL_NOT_KANARYASI
    sunucuGecmisi = [
      {
        appointment_id: 202, client_id: 1, seans_zamani: '2026-09-14T10:00',
        sablon: 'dap', icerik: RESMI_NOT_KANARYASI,
        guncelleme_zamani: '2026-09-14T12:00:00Z',
      },
    ]

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const method = secenekler?.method ?? 'GET'
      // Bu blokta `ekUcYaniti` KAYITTAN SONRA cagriliyor (digerlerinde
      // once): "saklama listesi yalnizca bir kez soruluyor mu" iddiasi
      // istegin `istekYollari`na dusmesini gerektiriyor.
      istekYollari.push(`${method} ${yol}`)
      const gecikme = gecikmeler[`${method} ${yol}`]
      if (gecikme) await gecikme

      if (yetkisiz) {
        return {
          ok: false, status: 401,
          json: async () => ({ hata: 'Oturum zaman aşımına uğradı.' }),
        } as unknown as Response
      }

      // Plan 4 Görev 4: ay sonu özeti. Borçlu Zeynep (id 3) — kartında
      // ayırt edici bir telefon var, "DOĞRU kart açıldı" ekrandan ölçülür.
      const odemeYazmasi = /^\/api\/randevular\/(\d+)\/odeme$/.exec(yol)
      if (odemeYazmasi && method === 'PATCH') {
        if (odemeHatasi) return hataYaniti(500, 'ODEME-YAZILAMADI')
        sunucuOdemeleri[Number(odemeYazmasi[1])] = (
          JSON.parse(String(secenekler?.body)) as { odendi: boolean }
        ).odendi
        return jsonYanit({})
      }
      const durumYazmasi = /^\/api\/randevular\/(\d+)$/.exec(yol)
      if (durumYazmasi && method === 'PATCH') {
        sunucuDurumlari[Number(durumYazmasi[1])] = (
          JSON.parse(String(secenekler?.body)) as { durum: string }
        ).durum
        return jsonYanit({})
      }

      // Ayşe'nin 202'si (geldi, 450 TL) yazmalara göre borçlu listesine girer
      // ya da çıkar; tahsilat ve Zeynep sabit.
      if (yol.startsWith('/api/ay-ozeti')) {
        const ayseBorclu =
          (sunucuDurumlari[202] ?? gelecekHafta.durum) === 'geldi' &&
          !(sunucuOdemeleri[202] ?? gelecekHafta.odendi)
        return jsonYanit({
          ay: '2026-09', seans_sayisi: 4, tahsilat_kurus: 180000,
          bekleyen_kurus: 60000 + (ayseBorclu ? 45000 : 0),
          borclular: [
            ...(ayseBorclu
              ? [{ client_id: 1, ad_soyad: 'Ayşe Yılmaz', borc_kurus: 45000, seans_sayisi: 1 }]
              : []),
            { client_id: 3, ad_soyad: 'Zeynep Kaya', borc_kurus: 123450, seans_sayisi: 1 },
          ],
        })
      }

      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc

      const notlar = notYaniti(yol, method, null)
      if (notlar) return notlar

      // Yanit sekli sunucunun `AramaYaniti`si: ciplak dizi DEGIL.
      if (yol.startsWith('/api/ara')) {
        return jsonYanit({ sonuclar: aramaSonuclari, kirpildi: false })
      }

      // Ek SILME: sunucu satiri gercekten kaldiriyor, boylece "kart
      // yeniden cekildi mi" iddiasi ekrandan olculebiliyor.
      const ekSilme = /^\/api\/ekler\/(\d+)$/.exec(yol)
      if (ekSilme && method === 'DELETE') {
        const id = Number(ekSilme[1])
        sunucuEkleri = sunucuEkleri.filter((e) => e.id !== id)
        return jsonYanit({})
      }

      const ekler = /^\/api\/danisanlar\/(\d+)\/ekler$/.exec(yol)
      if (ekler) {
        // IMPORTANT-A: yalnızca bu istek 401 dönebilir (bkz.
        // `ekIstegiYetkisiz` tanımı) — `dosyaGetir` BAŞARILI kalır.
        if (ekIstegiYetkisiz) {
          return {
            ok: false, status: 401,
            json: async () => ({ hata: 'Oturum zaman aşımına uğradı.' }),
          } as unknown as Response
        }
        return jsonYanit(Number(ekler[1]) === 1 ? sunucuEkleri : [])
      }

      // Plan 4 Gorev 7: sunucuda uretilen sifreli rapor. ACIKCA
      // karsilaniyor; asagidaki `/api/danisanlar` on ek eslesmesine
      // birakilsaydi yolu yanlis yazan bir mutasyon yine yesil gecerdi.
      if (/^\/api\/danisanlar\/\d+\/veri-raporu$/.test(yol) && method === 'POST') {
        raporGovdeleri.push(String(secenekler?.body ?? ''))
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'content-disposition': 'attachment; filename="danisan-veri-raporu-2026-09-09.pdf"',
          }),
          json: async () => ({}),
          blob: async () => new Blob(['%PDF-SIFRELI']),
        } as unknown as Response
      }

      const dosya = /^\/api\/danisanlar\/(\d+)$/.exec(yol)
      if (dosya) return jsonYanit(dosyalar[Number(dosya[1])])

      // Görev 8: `useDanisanSeanslari` — kart açılınca (Danışanlar sekmesi)
      // bu uç nokta da çağrılıyor. AÇIKÇA karşılanıyor; aşağıdaki genel
      // `/api/danisanlar` ön ek eşlemesine bırakılsaydı `kartDanisanlari`
      // (danışan LİSTESİ biçimi) dönerdi — `SeansListesi`nin beklediği
      // `baslangic` alanı olmayan bu yanıt `zamanMetni`de çöküyordu.
      const seanslarIstegi = /^\/api\/danisanlar\/(\d+)\/seanslar$/.exec(yol)
      if (seanslarIstegi) {
        const cid = Number(seanslarIstegi[1])
        return jsonYanit(
          tumRandevular
            .filter((r) => r.client_id === cid)
            // Sunucu EN YENİDEN ESKİYE sıralar (bkz. `SeansListesi.tsx`
            // modül başlığı) — `DanisanDosyasi` seçim yoksa `seanslar[0]`i
            // (en yeniyi) vurgular. Sıralanmamış bir mock bu testte YANLIŞ
            // seansın (201, bu haftaki) notunu çektirip 202'nin (gelecek
            // hafta, seçili) notuyla karışmadan ayrı bir GET üretiyordu.
            .sort((a, b) => (a.baslangic < b.baslangic ? 1 : -1))
            .map((r) => ({
              appointment_id: r.id,
              baslangic: r.baslangic,
              durum: sunucuDurumlari[r.id] ?? r.durum,
              ucret_kurus: r.ucret,
              odendi: sunucuOdemeleri[r.id] ?? r.odendi,
              not_ilk_satiri: null,
            })),
        )
      }

      if (yol.startsWith('/api/danisanlar')) return jsonYanit(kartDanisanlari)

      // Aralık SÜZÜLÜYOR: "hafta gerçekten değişti mi" ancak böyle ölçülür.
      const aralik = /^\/api\/randevular\?baslangic=([^&]+)&bitis=([^&]+)/.exec(yol)
      if (aralik) {
        const bas = decodeURIComponent(aralik[1])
        const bit = decodeURIComponent(aralik[2])
        return jsonYanit(tumRandevular.filter((r) => r.baslangic >= bas && r.baslangic < bit))
      }
      if (yol.startsWith('/api/randevular')) return jsonYanit([])

      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    URL.createObjectURL = gercekOlustur
    URL.revokeObjectURL = gercekSerbest
    vi.restoreAllMocks()
  })

  const cip = (ad: string) => screen.getByRole('button', { name: `${ad} dosyasını aç` })

  /**
   * Risk notunu AÇAR ve kanaryanın ekranda olduğunu doğrular.
   *
   * Risk notu artık katlanmış geliyor (danışan odada olabilir). "Kanarya
   * ekrandan gitti" diyen testlerin önce onu AÇMASI şart: kapalıyken metin
   * zaten DOM'da değil ve iddia hiçbir şeyi sınamayan bir yeşile dönerdi.
   */
  async function riskNotunuAc() {
    await userEvent.click(await screen.findByRole('button', { name: 'Risk notunu göster' }))
    await screen.findByText('RISK-NOTU-KANARYA')
  }

  async function aramayiAc() {
    await userEvent.click(screen.getByRole('button', { name: 'Hızlı arama (Ctrl+K)' }))
  }

  describe('ay sonu ozeti (Plan 4 Görev 4)', () => {
    const ozetIstekleri = () => istekYollari.filter((y) => y.includes('/api/ay-ozeti'))

    it('ozet KAPALI baslar: ana ekran acilisi ozet istegi ATMAZ; dugme TEK istek atar', async () => {
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      // Mount'un diğer istekleri (takvim, liste, saklama, yedek) bitmiş olsun
      // ki "istek yok" iddiası işlem ÖNCESİ durumla tatmin olmasın.
      await listeYuklenmesiniBekleVeTakvimeDon()
      await waitFor(() => expect(istekYollari.some((y) => y.startsWith('GET /api/randevular'))).toBe(true))
      expect(screen.queryByRole('region', { name: 'Ay sonu özeti' })).toBeNull()
      expect(ozetIstekleri()).toEqual([])

      await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))
      const bolge = await screen.findByRole('region', { name: 'Ay sonu özeti' })
      // Bugün 2026-09-09 (`setSystemTime`): açılış ayı Eylül.
      expect(within(bolge).getByRole('heading', { name: 'Eylül 2026' })).toBeDefined()
      await within(bolge).findByText('1.800,00 TL')
      expect(ozetIstekleri()).toEqual(['GET /api/ay-ozeti?ay=2026-09'])
    })

    it('borclu satiri GERCEK danisan kartini acar (GET /api/danisanlar/{id}); ekran yeniden render olunca ozet istegi tekrarlanmaz', async () => {
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      await listeYuklenmesiniBekleVeTakvimeDon()
      await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))
      const bolge = await screen.findByRole('region', { name: 'Ay sonu özeti' })
      const satir = await within(bolge).findByRole('button', { name: /Zeynep Kaya/ })

      expect(document.body.textContent).not.toContain('0555 999 88 77')
      const once = istekYollari.length
      // Borçlu satırına tıklamak `danisanaGit` çağırır (bkz. AnaEkran.tsx
      // modül başlığı): sekme Danışanlar'a döner VE Takvim sekmesi (Ay
      // sonu özeti paneli dahil) UNMOUNT olur — bu artık bir hata değil,
      // Görev 8'in tasarımı. `bolge` referansı bundan sonra ekranda değil.
      await userEvent.click(satir)

      // Zeynep'in (id 3) GERÇEK kartı: sunucudan çekilen dosyanın telefonu.
      // Telefon/Bakiye `DosyaBilgileri`de (Bilgiler alt sekmesi, varsayılan
      // DEĞİL — bkz. `dosyaBilgileriSekmesineGec` yardımcısı).
      await dosyaBilgileriSekmesineGec()
      expect(await screen.findByText('0555 999 88 77')).toBeDefined()
      // AYNI borç iki ekranda AYNI metin (binlik ayraçlı): özet satırında ve
      // kartın bakiyesinde. Eskiden kart "1234,50 ₺" basıyordu.
      expect(satir.textContent).toContain('1.234,50 TL')
      const bakiyeDt = screen.getAllByRole('term').find((e) => e.textContent === 'Bakiye')
      expect(bakiyeDt?.nextElementSibling?.textContent).toBe('1.234,50 TL')
      expect(istekYollari.slice(once)).toContain('GET /api/danisanlar/3')
      // Başka bir danışanın dosyası istenmedi.
      expect(
        istekYollari.slice(once).filter((y) => /^GET \/api\/danisanlar\/\d+$/.test(y)),
      ).toEqual(['GET /api/danisanlar/3'])

      // Kart açılışı AnaEkran'ı birkaç kez yeniden render etti (yeni
      // `onDanisanAc` closure'u, yeni `bugun` dizgisi): özet yine TEK istek.
      // (Panelin kendisi artık ekranda değil — DEĞİŞEN doğrulama SAYIM,
      // görünürlük değil; bkz. yukarıdaki gerekçe.)
      expect(ozetIstekleri()).toEqual(['GET /api/ay-ozeti?ay=2026-09'])
    })

    // Dal incelemesi I1 — AYNI borç iki ekranda farklıydı: özet açıkken
    // "Ödendi" işaretlenince kart yerelde yamanıyor, özet eski yanıtı
    // gösteriyordu. Kurulum: kart açık, özet açık, gelecek haftadaki 202
    // (Ayşe, geldi, 450 TL, ödenmemiş) seçili.
    const kartBakiyesi = () =>
      screen.getAllByRole('term').find((e) => e.textContent === 'Bakiye')?.nextElementSibling
        ?.textContent
    const ozetDegeri = (etiket: string) =>
      within(screen.getByRole('region', { name: 'Ay sonu özeti' }))
        .getAllByRole('term')
        .find((e) => e.textContent === etiket)?.nextElementSibling?.textContent
    const odendiKutusu = () => screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement

    async function seans202Ac() {
      await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
      await screen.findByLabelText('Seans notu')
      // Ön bariyer: panelin gecikmeli çakışma sorgusu ölçüm penceresine düşmesin.
      await waitFor(() =>
        expect(istekYollari.filter((y) => y.startsWith('GET /api/cakisma?'))).toHaveLength(1),
      )
    }

    async function ozetAcVeAyseBorcunuGor() {
      await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))
      const bolge = await screen.findByRole('region', { name: 'Ay sonu özeti' })
      await within(bolge).findByRole('button', { name: /Ayşe Yılmaz — 450,00 TL/ })
      expect(ozetDegeri('Bekleyen')).toBe('1.050,00 TL')
      return bolge
    }

    it.each([
      ['odeme', async () => userEvent.click(odendiKutusu())],
      ['durum', async () => userEvent.click(screen.getByRole('button', { name: 'Gelmedi' }))],
    ])(
      'ozet ACIKKEN %s yazmasi basarili olunca ozet TEK yeni istekle tazelenir; kart ve ozet AYNI borcu gosterir',
      async (_ad, yazmaEylemi) => {
        render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
        // Görev 8: kart (Danışanlar) ve özet/seans paneli (Takvim) artık AYNI
        // ANDA ekranda değil — ayrı sekmeler. Açık danışan dosyası state'i
        // (`AnaEkran`'daki `dosya` kancası) sekme değişiminden ETKİLENMEZ
        // (bkz. `AnaEkran.tsx` modül başlığı); yalnızca EKRANDAKİ panel
        // değişiyor. Kart önce açılıyor, sonra Takvim'e geçilip yazma orada
        // yapılıyor, sonunda Danışanlar'a dönüp bakiye YERELDE doğrulanıyor.
        await danisanlarSekmesineGec()
        await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
        await dosyaBilgileriSekmesineGec()
        await screen.findByText('0555 111 22 33')
        expect(kartBakiyesi()).toBe(BAKIYE_450)

        await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
        const bolge = await ozetAcVeAyseBorcunuGor()
        await seans202Ac()
        expect(ozetIstekleri()).toHaveLength(1)

        await yazmaEylemi()
        await waitFor(() => expect(ozetDegeri('Bekleyen')).toBe('600,00 TL'))
        expect(within(bolge).queryByRole('button', { name: /Ayşe Yılmaz/ })).toBeNull()
        // Bariyer: satırın kilidi kalktı (işlem zinciri bitti) — ardından
        // TAM BİR yeni özet isteği, aynı ay.
        await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
        expect(ozetIstekleri()).toEqual([
          'GET /api/ay-ozeti?ay=2026-09',
          'GET /api/ay-ozeti?ay=2026-09',
        ])

        // Kart ve özet AYNI şeyi söylüyor: Danışanlar sekmesine dönünce
        // (kart hâlâ AÇIK — sekme değişimi dosyayı kapatmaz) bakiye YERELDE
        // 0 olmalı, YENİ bir GET /api/danisanlar/1 olmadan.
        const onceki = istekYollari.filter((y) => y === 'GET /api/danisanlar/1').length
        await danisanlarSekmesineGec()
        await dosyaBilgileriSekmesineGec()
        expect(kartBakiyesi()).toBe(BAKIYE_0)
        expect(istekYollari.filter((y) => y === 'GET /api/danisanlar/1')).toHaveLength(onceki)
      },
    )

    it('ozet KAPALIYKEN odeme isaretlenince ozet istegi YOK', async () => {
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      // Bu test kartla İLGİLENMİYOR (yalnızca mount'un settle olduğu barrier).
      await listeYuklenmesiniBekleVeTakvimeDon()
      await seans202Ac()

      await userEvent.click(odendiKutusu())
      // BARİYER (biçim 6): PATCH yanıtı geldi ve kutunun kilidi kalktı.
      await waitFor(() => expect(sunucuOdemeleri[202]).toBe(true))
      await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
      expect(odendiKutusu().checked).toBe(true)
      expect(istekYollari).toContain('PATCH /api/randevular/202/odeme')
      expect(ozetIstekleri()).toEqual([])
      expect(screen.queryByRole('region', { name: 'Ay sonu özeti' })).toBeNull()
    })

    it('odeme yazmasi REDDEDILIRSE acik ozet yeniden ISTENMEZ ve eski borcu gostermeye devam eder', async () => {
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      // Bu test kartla İLGİLENMİYOR (yalnızca mount'un settle olduğu barrier).
      await listeYuklenmesiniBekleVeTakvimeDon()
      const bolge = await ozetAcVeAyseBorcunuGor()
      await seans202Ac()
      odemeHatasi = true

      await userEvent.click(odendiKutusu())
      // BARİYER (biçim 6): ret alt satıra ulaştı, kutu geri döndü, kilit kalktı.
      expect((await screen.findByRole('alert')).textContent).toContain('ODEME-YAZILAMADI')
      await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
      expect(odendiKutusu().checked).toBe(false)
      expect(istekYollari).toContain('PATCH /api/randevular/202/odeme')
      expect(ozetIstekleri()).toEqual(['GET /api/ay-ozeti?ay=2026-09'])
      expect(within(bolge).getByRole('button', { name: /Ayşe Yılmaz — 450,00 TL/ })).toBeDefined()
    })
  })

  it('danisan cipine tiklayinca kart acilir; bakiye YALNIZCA o danisanin seanslarindan', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await danisanlarSekmesineGec()
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await dosyaBilgileriSekmesineGec()

    expect(await screen.findByText('0555 111 22 33')).toBeDefined()
    // Ayşe: gelecek haftaki 450 TL'lik seans "geldi" ve ödenmemiş.
    // Mehmet'in 999 TL'lik ödenmemiş seansı bu sayıya KARIŞMAMALI —
    // aralık uç noktası danışan süzgeci sunmuyor, süzgeç istemcide.
    expect(screen.getByText('450,00 TL')).toBeDefined()
    expect(document.body.textContent).not.toContain('999,00 TL')
  })

  // Görev 2 inceleme M5: kart ve seans paneli aynı anda açık. Alt satırdan
  // ödeme/durum işaretlenince kartın bakiyesi bayat kalıyordu. Çözüm kartı
  // YENİDEN ÇEKMEK DEĞİL (silinemez `goruntuleme` satırı), listesini yerelde
  // yamamak — iddia hem bakiyeyi hem "hiç GET yok"u ölçüyor.
  it('kart ACIKKEN odeme ve durum isaretlenince kart bakiyesi YERELDE tazelenir; kart yeniden CEKILMEZ', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: kart (Danışanlar) ve seans paneli (Takvim) artık AYNI ANDA
    // ekranda değil — ayrı sekmeler. Kart AÇIK KALIYOR (`AnaEkran`'daki
    // `dosya` state'i sekme değişiminden etkilenmez, bkz. modül başlığı);
    // yalnızca EKRANDAKİ panel değişiyor. Bakiye bu yüzden her yazmadan
    // sonra Danışanlar sekmesine DÖNÜLEREK okunuyor — "YERELDE tazelenir"
    // iddiası bununla hâlâ tam ölçülüyor: dönüşte YENİ bir GET olmuyor.
    await danisanlarSekmesineGec()
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await dosyaBilgileriSekmesineGec()
    await screen.findByText('0555 111 22 33')
    async function bakiye() {
      await danisanlarSekmesineGec()
      await dosyaBilgileriSekmesineGec()
      const dt = screen.getAllByRole('term').find((e) => e.textContent === 'Bakiye')
      return dt?.nextElementSibling?.textContent
    }
    expect(await bakiye()).toBe(BAKIYE_450)

    // Gelecek haftadaki "geldi", 450 TL, ödenmemiş seansı (202) aç.
    await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')
    // Ön bariyer: panelin gecikmeli çakışma sorgusu ölçüm penceresine düşmesin.
    await waitFor(() =>
      expect(istekYollari.filter((y) => y.startsWith('GET /api/cakisma?'))).toHaveLength(1),
    )
    const once = istekYollari.length
    const kutu = () => screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement

    await userEvent.click(kutu())
    await waitFor(() => expect(kutu().disabled).toBe(false))
    expect(await bakiye()).toBe(BAKIYE_0)

    // İki yön: işareti kaldırınca borç GERİ gelir.
    await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
    await userEvent.click(kutu())
    await waitFor(() => expect(kutu().disabled).toBe(false))
    expect(await bakiye()).toBe(BAKIYE_450)

    // Durum da bakiyeyi etkiler: "gelmedi" sayılmaz.
    await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
    await userEvent.click(screen.getByRole('button', { name: 'Gelmedi' }))
    expect(await bakiye()).toBe(BAKIYE_0)

    // Kart yeniden ÇEKİLMEDİ (GET /api/danisanlar/1 YOK), takvim listesi de
    // yeniden ÇEKİLMEDİ (GET /api/randevular?... aralık sorgusu YOK) — asıl
    // korunan iddia bu. Pencere TAM EŞİTLİKLE ölçülüyor (MINOR-1).
    //
    // Son inceleme M1: eskiden buradaki her yazmanın ardından bir `GET
    // .../not` da vardı — `bakiye()`nin her çağrısında Danışanlar sekmesine
    // dönüş `DanisanDosyasi`yi yeniden monte ediyor ve bileşen AYNI notu
    // yeniden istiyordu (silinemez `goruntuleme` satırı). Not artık
    // `AnaEkran`'da yaşayan `useDosyaNotu`'da; sekme dönüşü onu yeniden
    // istemez (ve bu testte dosya Bilgiler alt sekmesinde kaldığı için hiç
    // istenmez — alt sekme de artık dönüşte korunuyor). Pencerede YALNIZCA
    // üç yazma kalmalı.
    const pencere = istekYollari.slice(once)
    expect(pencere).toEqual([
      'PATCH /api/randevular/202/odeme',
      'PATCH /api/randevular/202/odeme',
      'PATCH /api/randevular/202',
    ])
  })

  // Dal incelemesi (ledger KALAN): kartın uçuş yarışı. Kartın tüm-zaman
  // randevu okuması yazmadan ÖNCE başlar (sunucu ESKİ değeri okur — bu
  // taklitte liste GET'i yazmaları hiç yansıtmıyor) ve yazmadan SONRA döner.
  // O an kartın listesi henüz boş olduğu için `randevuYamala`nın yerel
  // yaması hiçbir şeye değmez; geç yanıt eski bakiyeyi basıyordu. Takvim
  // listesiyle AYNI mantıksal saat (`yazmaSaati.ts`) bunu kapatıyor.
  it.each([
    ['odeme', async () => userEvent.click(screen.getByRole('checkbox', { name: 'Ödendi' }))],
    ['durum', async () => userEvent.click(screen.getByRole('button', { name: 'Gelmedi' }))],
  ])(
    'kart YUKLENIRKEN %s isaretlenirse gec donen kart yaniti ESKI bakiyeyi gostermez',
    async (_ad, yazmaEylemi) => {
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      // Gelecek haftadaki 202 (Ayşe, geldi, 450 TL, ödenmemiş) seçili.
      await userEvent.click(await screen.findByRole('button', { name: 'Sonraki hafta' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
      await screen.findByLabelText('Seans notu')
      await waitFor(() =>
        expect(istekYollari.filter((y) => y.startsWith('GET /api/cakisma?'))).toHaveLength(1),
      )

      const tumZaman =
        'GET /api/randevular?baslangic=2000-01-01T00%3A00&bitis=2100-01-01T00%3A00'
      const k = kapi()
      gecikmeler[tumZaman] = k.bekle
      // Kart açılışı `danisanaGit` çağırır: sekme Danışanlar'a döner (bkz.
      // `AnaEkran.tsx` modül başlığı). Kartın kendi okuması (`tumZaman`
      // dahil) bu geçişten BAĞIMSIZ sürer — `useDanisanDosyasi` AnaEkran'da
      // yaşıyor, hangi sekmenin göründüğünden etkilenmiyor.
      await danisanlarSekmesineGec()
      await userEvent.click(cip('Ayşe Yılmaz'))
      // BARİYER: kartın okuması yola çıktı (yazmadan ÖNCE).
      await waitFor(() => expect(istekYollari).toContain(tumZaman))
      expect(screen.queryByText('0555 111 22 33')).toBeNull()

      // Yazma Takvim sekmesindeki seans panelinden yapılır: kart hâlâ
      // YÜKLENİYOR (Danışanlar sekmesinde DEĞİL, geri planda).
      await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
      await yazmaEylemi()
      // BARİYER: yazma sunucuda bitti ve satırın kilidi kalktı.
      await waitFor(() =>
        expect(istekYollari.some((y) => y.startsWith('PATCH /api/randevular/202'))).toBe(true),
      )
      await waitFor(() =>
        expect((screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement).disabled).toBe(false),
      )

      k.ac()
      await danisanlarSekmesineGec()
      await dosyaBilgileriSekmesineGec()
      await screen.findByText('0555 111 22 33')
      const bakiye = screen.getAllByRole('term').find((e) => e.textContent === 'Bakiye')
      expect(bakiye?.nextElementSibling?.textContent).toBe(BAKIYE_0)
    },
  )

  it('baska danisana gecince onceki kartin verisi EKRANDA KALMAZ', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await danisanlarSekmesineGec()
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await dosyaBilgileriSekmesineGec()
    await riskNotunuAc()

    // Mehmet'in dosyası UÇUŞTA kalsın: sıfırlama bir efekte bırakılsaydı,
    // o efekt çalışana kadar Ayşe'nin risk notu Mehmet'in kartında dururdu.
    // Bekleyen bir istek olmadan bu kare hiç görünmez ve test, korumayı
    // kaldıran mutasyonu YAKALAYAMAZ.
    const m = kapi()
    gecikmeler['GET /api/danisanlar/2'] = m.bekle

    await userEvent.click(cip('Mehmet Demir'))
    expect(document.body.textContent).not.toContain('RISK-NOTU-KANARYA')
    // Ayşe'nin telefonu da gitti (kartın tamamı boşaldı, tek alan değil).
    expect(document.body.textContent).not.toContain('0555 111 22 33')

    // ARTI YÖN: veri gelince Mehmet'in kendi kartı gerçekten açılıyor
    // (hiçbir şey göstermeyen bir ekran da üstteki iddiayı geçerdi).
    // Eksik onam artık `role="alert"` DEĞİL (Görev 7 düzeltmesi: alarm
    // değil bilgi), bu yüzden metinle ölçülüyor. Danışan değişince
    // `DanisanDosyasi` `key`iyle YENİDEN MONTE olur (bkz. o dosyanın modül
    // başlığı) ve alt sekme varsayılana ("Seanslar") döner — "Bilgiler"e
    // tekrar geçilmesi gerekir.
    m.ac()
    await dosyaBilgileriSekmesineGec()
    expect(await screen.findByText(/onam kaydı yok/i)).toBeDefined()
  })

  // Plan 4 Görev 7 — rapor SUNUCUDA üretilir. Plan 3'ün istemci testleri
  // (not sınırı 200, "önce rapor-kaydi", Blob metninde kanarya) kaldırıldı;
  // eşlemesi görev raporunda. İstemci tarafında kalan kavşak: rapor isteği
  // ne not çeker ne not içeriği taşır. Seans paneli AÇIK ve özel not BELLEKTE
  // iken ölçülüyor — sızıntının mümkün olabileceği tek durum (on birinci
  // biçim: paneli kapalı bir kurulum kavşağa hiç girmezdi).
  async function raporIste(parola: string) {
    await userEvent.click(screen.getByRole('button', { name: 'Danışan veri raporu dışa aktar' }))
    await userEvent.type(screen.getByLabelText('Rapor parolası'), parola)
    await userEvent.type(screen.getByLabelText('Parolayı tekrar girin'), parola)
    await userEvent.click(screen.getByRole('button', { name: 'Raporu oluştur' }))
  }

  it('seans paneli ve ozel not ACIKKEN rapor TEK POST /veri-raporu atar; govde yalniz parola+gun, not istegi YOK', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    // Ön koşul: özel not kanaryası GERÇEKTEN belleğe alındı.
    expect(((await screen.findByLabelText('Özel notum')) as HTMLTextAreaElement).value).toBe(
      OZEL_NOT_KANARYASI,
    )
    // Görev 8: kart artık Danışanlar sekmesinde açılıyor — bu geçiş Takvim
    // sekmesini (seans paneli dahil) UNMOUNT eder, ama özel not BELLEKTE
    // kalır (`useSeansNotlari` `AnaEkran`'da yaşıyor, görünürlükten
    // etkilenmiyor, bkz. modül başlığı). Rapor isteği zaten bu kancayı hiç
    // GÖRMÜYOR (`veriRaporuIndir(danisanId, parola)` imzasına bkz.) — asıl
    // güvenlik iddiası (sızıntı YOK) bu yüzden sekme geçişinden ETKİLENMEZ.
    await danisanlarSekmesineGec()
    await userEvent.click(cip('Ayşe Yılmaz'))
    await dosyaBilgileriSekmesineGec()
    await screen.findByText('0555 111 22 33')

    const once = istekYollari.length
    await raporIste('danisan-parolasi-1')
    await screen.findByText(/şifreli PDF olarak indirildi/)

    const raporIstekleri = istekYollari.slice(once)
    expect(raporIstekleri).toEqual(['POST /api/danisanlar/1/veri-raporu'])
    expect(raporGovdeleri).toHaveLength(1)
    const govde = JSON.parse(raporGovdeleri[0]) as Record<string, unknown>
    expect(Object.keys(govde).sort()).toEqual(['bugun', 'parola'])
    expect(govde.parola).toBe('danisan-parolasi-1')
    expect(raporGovdeleri[0]).not.toContain(OZEL_NOT_KANARYASI)
    expect(raporGovdeleri[0]).not.toContain(RESMI_NOT_KANARYASI)
    // İndirilen şey sunucunun baytları; istemci metin kurmadı.
    expect(uretilenBloblar).toHaveLength(1)
    expect(await uretilenBloblar[0].text()).toBe('%PDF-SIFRELI')
    // Parola hiçbir istek YOLUNDA değil.
    expect(istekYollari.some((y) => y.includes('danisan-parolasi-1'))).toBe(false)
  })

  it('rapor isteginde 401 gelirse dosya URETILMEZ ve sunucunun mesaji gosterilir', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await danisanlarSekmesineGec()
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await dosyaBilgileriSekmesineGec()
    await screen.findByText('0555 111 22 33')

    yetkisiz = true
    await raporIste('danisan-parolasi-1')
    await waitFor(() =>
      expect(screen.getByText('Oturum zaman aşımına uğradı.')).toBeDefined(),
    )
    expect(uretilenBloblar).toHaveLength(0)
    expect(document.body.innerHTML).not.toContain('danisan-parolasi-1')
  })

  // `yerelGun`'ün gerekçesi ("UTC'den türetmek sınırdaki bir dosyayı bir gün
  // kaydırırdı") testsizdi: diğer testler `setSystemTime(… 12:00)` kullanıyor
  // ve o saatte yerel gün ile UTC günü AYNI. `toISOString().slice(0, 10)`'a
  // dönen bir mutasyon tüm paketi yeşil bırakıyordu (onuncu biçim).
  //
  // Bu GERÇEK bir hata: Istanbul UTC+3, yani 00:00–03:00 arasında UTC hâlâ
  // dünkü tarihte. Kayan şey `bugun` ve o iki yere birden gidiyor —
  // `kalanGun` hesabı ve rapor dosya adındaki tarih.
  describe('yerel gün: gece yarısı ile 03:00 arası (Görev 10 inceleme M3)', () => {
    beforeEach(() => {
      // 09 Eylül 01:00 yerel (Europe/Istanbul, UTC+3) = 08 Eylül 22:00 UTC.
      vi.setSystemTime(new Date(2026, 8, 9, 1, 0))
    })

    it('saklama suresi BUGUN doluyorsa "doldu" yazar, "1 gun kaldi" degil', async () => {
      // UTC'den türetilseydi `bugun` 2026-09-08 olurdu, `kalanGun` 1 döner
      // ve ekran tam dolum gününde "1 gün kaldı" yazardı — imha kararını
      // veren insana yanlış tarih.
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      await danisanlarSekmesineGec()
      await userEvent.click(await screen.findByRole('button', { name: 'Zeynep Kaya dosyasını aç' }))
      await dosyaBilgileriSekmesineGec()
      await screen.findByText('0555 999 88 77')

      const bolum = screen.getByRole('region', { name: 'Saklama süresi' })
      expect(bolum.textContent).toContain('Saklama süresi doldu')
      expect(bolum.textContent).not.toContain('gün kaldı')
    })

    it('rapor isteginin `bugun`u YEREL gundur (dosya adi sunucuda ondan uretilir)', async () => {
      // Plan 4 Görev 7: dosya adını sunucu üretiyor ama günü istemciden
      // alıyor. UTC'den türetilseydi 01:00'de `2026-09-08` giderdi.
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      await danisanlarSekmesineGec()
      await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
      await dosyaBilgileriSekmesineGec()
      await screen.findByText('0555 111 22 33')

      await raporIste('danisan-parolasi-1')
      await screen.findByText(/şifreli PDF olarak indirildi/)
      expect(raporGovdeleri).toHaveLength(1)
      expect(JSON.parse(raporGovdeleri[0]).bugun).toBe('2026-09-09')
    })

    it('gun TIKLAMA ANINDA hesaplanir: kart gece yarisindan once acildiysa bile', async () => {
      // Kart 08 Eylül 23:50'de açılıp 09 Eylül 01:00'de kullanılıyor.
      // Render anındaki `bugun` prop'unu kullanan bir sürüm dünü gönderirdi.
      vi.setSystemTime(new Date(2026, 8, 8, 23, 50))
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      await danisanlarSekmesineGec()
      await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
      await dosyaBilgileriSekmesineGec()
      await screen.findByText('0555 111 22 33')

      vi.setSystemTime(new Date(2026, 8, 9, 1, 0))
      await raporIste('danisan-parolasi-1')
      await screen.findByText(/şifreli PDF olarak indirildi/)
      expect(JSON.parse(raporGovdeleri[0]).bugun).toBe('2026-09-09')
    })
  })

  it('Ctrl+K ile acilan aramadan seans secilince O HAFTAYA gidilir ve panel acilir', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await listeYuklenmesiniBekleVeTakvimeDon()

    // Görünen hafta 07–13 Eylül: hedef randevu (14 Eylül) ekranda YOK.
    expect(screen.queryByRole('button', { name: 'Ayşe Yılmaz' })).toBeDefined()

    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Danışan adı veya not içeriği' }),
      'kaygi',
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /14\.09\.2026 10:00 seansına git/ }),
    )

    // Seans paneli hedef randevuyla açıldı: başlıkta o seansın saati var.
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Seans' }).textContent).toMatch(
        /Ayşe Yılmaz — 14 Eylül 2026, 10:00/,
      ),
    )
    // Arama kapandı ve not parçası ekranda kalmadı.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.textContent).not.toContain('ARAMA-PARCASI-KANARYA')
  })

  it('aramadan danisan secilince kart acilir', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await listeYuklenmesiniBekleVeTakvimeDon()

    await aramayiAc()
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Danışan adı veya not içeriği' }),
      'ayse',
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /Ayşe Yılmaz — danışan dosyasını aç/ }),
    )

    // Arama `danisanaGit` çağırır: sekme Danışanlar'a döner (bkz.
    // `AnaEkran.tsx` modül başlığı). Risk notu `DosyaBilgileri`de.
    await dosyaBilgileriSekmesineGec()
    await riskNotunuAc()
  })

  it('kart acikken 401 gelirse kart KAPANIR ve icerigi ekranda kalmaz', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await danisanlarSekmesineGec()
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await dosyaBilgileriSekmesineGec()
    await riskNotunuAc()

    // Oturum kilitlendi; sonraki her istek 401. Haftayı değiştirmek
    // `yukle`'yi tetikler — bu düğme Takvim sekmesinde (kart AÇIK kalır,
    // yalnızca EKRANDAKİ panel değişir, bkz. `AnaEkran.tsx` modül başlığı).
    yetkisiz = true
    await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
    await userEvent.click(screen.getByRole('button', { name: /önceki hafta/i }))

    // Kart 401 aldığında GERÇEKTEN kapanır. CRITICAL-2 düzeltmesi: yalnızca
    // içerik yokluğuna (RISK-NOTU-KANARYA/telefon) bakan bir iddia, kartın
    // KAPANMASINDAN değil, "Bilgiler" alt sekmesinden "Seanslar"a (varsayılan)
    // dönmesinden de sağlanırdı — risk notu/telefon yalnızca Bilgiler'de
    // basılıyor ve `DanisanDosyasi` her Danışanlar sekmesine YENİDEN
    // GİRİŞTE varsayılana döner (bkz. `dosyaBilgileriSekmesineGec` modül
    // başlığı). Asıl kanıt dosyanın KENDİSİNİN (kendi küçük şeridinin) DOM'da
    // olmaması; içerik taraması bunun ÜSTÜNE ikinci bir savunma katmanı.
    await danisanlarSekmesineGec()
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: 'Seanslar' })).toBeNull(),
    )
    // Ürün amacı: hiçbir şey seçilmemişken sağ kolon yönlendirme metni
    // gösterir — kart gerçekten kapalı, yalnızca "arka planda" değil.
    expect(
      screen.getByText('Bir danışanın dosyasını açmak için soldaki listeden bir danışan seçin.'),
    ).toBeDefined()
    expect(document.body.textContent).not.toContain('RISK-NOTU-KANARYA')
    expect(document.body.textContent).not.toContain('0555 111 22 33')
  })

  it('401 kart YUKLENIRKEN gelirse yarim kart acilmaz', async () => {
    // Yarı dolu bir danışan kartı (rıza alanı boş görünen) "rıza alınmamış"
    // diye okunurdu — dosya aslında dolu olabilir.
    //
    // IMPORTANT-A düzeltmesi: eskiden `yetkisiz = true` TÜM istekleri 401
    // yapıyordu — `dosyaGetir` hiçbir koşulda veri üretemediği için
    // `DanisanDosyasi` zaten hiç MONTE OLAMIYORDU (yalnızca `kart.dosya
    // !== null` iken çiziliyor, bkz. `DanisanlarSekmesi.tsx`) ve "yarım
    // kart" riski hiç OLUŞAMIYORDU — test hiçbir şeyi ölçmüyordu (mutasyonla
    // doğrulandı: `useDanisanDosyasi`nin 401 dalı TAMAMEN silinince takım
    // yine 654/654 yeşil kalıyordu). Şimdi yalnızca EK LİSTESİ isteği
    // (`Promise.all`'daki İKİNCİ istek) 401 dönüyor, `dosyaGetir` BAŞARILI
    // kalıyor — gerçek yarım-kart senaryosu bu.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await danisanlarSekmesineGec()
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })
    ekIstegiYetkisiz = true
    // Ek listesi isteği KAPIDA bekletiliyor: `dosyaGetir` başarıyla
    // dönebilir ama `Promise.all` yine de tamamlanamaz. Bu, atomiklik
    // mutasyonunu (üç isteği sıralı `await`e çevirip ilk yanıtı hemen
    // state'e yazmak) YAKALAMAK için zorunlu — atomiklik BOZULSAYDI,
    // `dosyaGetir` döner dönmez (ekler HÂLÂ uçuştayken) kart YARIM açılırdı
    // ve bunu ancak TAM OLARAK bu pencerede, sonuç netleşmeden ÖNCE
    // ölçebiliriz (bkz. `docs/test-yesil-ama-korumuyor.md` 6. biçim).
    const k = kapi()
    gecikmeler['GET /api/danisanlar/1/ekler'] = k.bekle
    await userEvent.click(cip('Ayşe Yılmaz'))

    // BARİYER: `dosyaGetir` GERÇEKTEN döndü (kartın TEK BAŞARILI parçası),
    // ek listesi ise hâlâ kapıda.
    await waitFor(() => expect(istekYollari).toContain('GET /api/danisanlar/1'))
    // BU ANDA BİLE (dosya geldi, ekler uçuşta) yarım kart AÇILMAMALI —
    // atomiklik bozulsaydı burada telefon/şerit görünürdü.
    expect(screen.queryByRole('tab', { name: 'Seanslar' })).toBeNull()
    expect(document.body.textContent).not.toContain('0555 111 22 33')

    // Ek listesi isteği şimdi serbest bırakılıyor; 401 olarak döner.
    k.ac()

    // (1) "yüklenemedi" uyarısı YOK: 401 genel bir sunucu hatası değil,
    // oturum kapanmasıdır — `useDanisanDosyasi` bunu AYRI bir dalda
    // (`YetkisizHata`) ele alır, `kart.hata`'ya YAZMAZ.
    await waitFor(() =>
      expect(screen.queryByText(/Danışan dosyası yüklenemedi/)).toBeNull(),
    )
    // (2) Dosya AÇILMADI: kendi küçük şeridi (Seanslar/Bilgiler) DOM'da
    // yok, sağ kolon yönlendirme metnini gösteriyor — `Promise.all`
    // atomikliği sayesinde `dosyaGetir`in BAŞARILI yanıtı da EKRANA
    // SIZMIYOR.
    expect(screen.queryByRole('tab', { name: 'Seanslar' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Bilgiler' })).toBeNull()
    expect(
      screen.getByText('Bir danışanın dosyasını açmak için soldaki listeden bir danışan seçin.'),
    ).toBeDefined()
    // İkinci savunma katmanı: gövdede hiçbir alan da yok.
    expect(document.body.textContent).not.toContain('RISK-NOTU-KANARYA')
    expect(document.body.textContent).not.toContain('0555 111 22 33')
    expect(screen.queryByText(/onam kaydı yok/i)).toBeNull()

    // (3) `takvim.oturumKapandi()` GERÇEKTEN çağrıldı: Takvim sekmesindeki
    // randevu listesi de temizlendi (Ayşe'nin bu haftaki randevusu artık
    // ızgarada yok). Bu, `useDanisanDosyasi`'nin `onYetkisiz` geri
    // çağrısının (`takvim.oturumKapandi`) gerçekten tetiklendiğinin —
    // yalnızca kartın kendi state'ini değil, takvim seçimini de
    // kapattığının — kanıtı.
    await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
    expect(screen.queryByRole('button', { name: 'Ayşe Yılmaz' })).toBeNull()
  })

  it('kart acikken aramadan seansa gidilince kart KAPANIR', async () => {
    // Kiplerin kesişimi: kart (Danışanlar) açıkken Takvim sekmesindeki
    // aramadan bir seansa gidilir. Kart durumu (`dosya` kancası) sekme
    // değişiminden ETKİLENMEZ (bkz. `AnaEkran.tsx` modül başlığı) — bu
    // yüzden "GERÇEKTEN kapandı" iddiası Danışanlar sekmesine GERİ dönülüp
    // doğrulanıyor; Takvim sekmesindeyken risk notu zaten hiç MONTE değil
    // ve bu, kanıtsız bir yeşile yol açardı (bkz. `docs/test-yesil-ama-
    // korumuyor.md`).
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await danisanlarSekmesineGec()
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await dosyaBilgileriSekmesineGec()
    await riskNotunuAc()

    await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
    await aramayiAc()
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Danışan adı veya not içeriği' }),
      'kaygi',
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /14\.09\.2026 10:00 seansına git/ }),
    )

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Seans' }).textContent).toMatch(
        /Ayşe Yılmaz — 14 Eylül 2026, 10:00/,
      ),
    )
    // CRITICAL-2 düzeltmesi: asıl kanıt dosyanın KENDİSİNİN (kendi küçük
    // şeridinin) artık DOM'da olmaması — yalnızca içerik taraması, kart
    // "Bilgiler"den varsayılan "Seanslar"a dönmüş (ama KAPANMAMIŞ) olsa
    // bile aynı şekilde geçerdi, çünkü risk notu zaten yalnızca Bilgiler'de
    // basılıyor (bkz. yukarıdaki modül başlığı gerekçesi — aynı tuzağın
    // BİR KATMAN daha derinde tekrarı).
    await danisanlarSekmesineGec()
    expect(screen.queryByRole('tab', { name: 'Seanslar' })).toBeNull()
    expect(
      screen.getByText('Bir danışanın dosyasını açmak için soldaki listeden bir danışan seçin.'),
    ).toBeDefined()
    expect(document.body.textContent).not.toContain('RISK-NOTU-KANARYA')
  })

  it('ucusta bir hafta yuklemesi varken "seansa git" SESSIZCE DUSMEZ', async () => {
    // Görev 10 inceleme minor'u: `bekleyenSeans` yalnızca kimlik tutuyor ve
    // `yukle` onu KOŞULSUZ tüketiyordu. Uçuşta kalmış (başka bir haftaya
    // ait) bir yükleme geri döndüğünde bekleyen kimliği tüketir, kendi
    // listesinde hedefi bulamaz ve `null` seçerdi; ardından gelen DOĞRU
    // haftanın yüklemesi için tüketilecek bir şey kalmaz ve kullanıcının
    // tıkladığı seans hiç açılmazdı.
    //
    // Kurulum: iki hafta yüklemesi de kapıda bekletiliyor ve ESKİ olan
    // ÖNCE salınıyor — yarışın kaybedilen sırası tam olarak bu.
    const haftaYolu = (bas: string, bit: string) =>
      `GET /api/randevular?baslangic=${encodeURIComponent(bas)}&bitis=${encodeURIComponent(bit)}`
    const eski = kapi()
    const yeni = kapi()
    gecikmeler[haftaYolu('2026-09-07T00:00', '2026-09-13T23:59')] = eski.bekle
    gecikmeler[haftaYolu('2026-09-14T00:00', '2026-09-20T23:59')] = yeni.bekle

    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await aramayiAc()
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Danışan adı veya not içeriği' }),
      'kaygi',
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /14\.09\.2026 10:00 seansına git/ }),
    )

    // Görünen haftanın (eski) yüklemesi ŞİMDİ dönüyor: bekleyen seçimi
    // tüketmemeli.
    eski.ac()
    yeni.ac()

    // Panel hedef seansla açıldı.
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Seans' }).textContent).toMatch(
        /Ayşe Yılmaz — 14 Eylül 2026, 10:00/,
      ),
    )
  })

  it('arama sorgusu HICBIR istek yolunda not iceriğiyle birlikte tasinmaz; yalniz /api/ara', async () => {
    // Sorgu metni sunucuda loga yazılmıyor; arayüz de onu başka bir uç
    // noktaya taşımamalı (ör. "danışanları sorguyla filtrele" gibi bir
    // kolaylık eklenirse sorgu ikinci bir yola daha düşerdi).
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await listeYuklenmesiniBekleVeTakvimeDon()
    await aramayiAc()
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Danışan adı veya not içeriği' }),
      'kaygi',
    )
    await waitFor(() => expect(istekYollari.some((y) => y.includes('/api/ara'))).toBe(true))

    const sorguTasiyanlar = istekYollari.filter((y) => y.includes('kaygi'))
    expect(sorguTasiyanlar).toHaveLength(1)
    expect(sorguTasiyanlar[0]).toContain('/api/ara?q=kaygi')
  })
  // -------------------------------------------------------------------
  // PAROLA DEĞİŞTİRME — "kodda var, üründe yok"un bir örneği daha.
  // `keystore::change_password` Plan 1'den beri yazılı ve testliydi ama
  // hiçbir çağrı yeri yoktu: kullanıcı parolasını DEĞİŞTİREMİYORDU.
  // -------------------------------------------------------------------

  /** Görev 8: Parola bölümü artık Ayarlar sekmesinin İÇİNDE. */
  async function parolaFormunuAc() {
    await ayarlarSekmesineGec()
    const bolum = screen.getByRole('region', { name: 'Parola' })
    await userEvent.click(within(bolum).getByRole('button', { name: 'Parolayı değiştir' }))
    return bolum
  }

  async function parolayiDoldur(mevcut: string, yeni: string, tekrar = yeni) {
    await userEvent.type(screen.getByLabelText('Mevcut parolanız'), mevcut)
    await userEvent.type(screen.getByLabelText('Yeni parola'), yeni)
    await userEvent.type(screen.getByLabelText('Yeni parola (tekrar)'), tekrar)
  }

  /** Formdaki "Parolayı değiştir" (gönder) düğmesi — açan düğmeyle aynı ada
   *  sahip; gönder olan, `disabled` olabilendir (`type=button`, sonuncusu). */
  function gonderDugmesi() {
    const hepsi = screen.getAllByRole('button', { name: 'Parolayı değiştir' })
    return hepsi[hepsi.length - 1]
  }

  it('parola degistirilebilir ve sunucudaki parola GERCEKTEN degisir', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await parolaFormunuAc()
    await parolayiDoldur('gizli-parola-123', 'yepyeni-parola')
    await userEvent.click(gonderDugmesi())

    await screen.findByRole('status', { name: '' }).catch(() => null)
    await waitFor(() => expect(sunucuParolasi).toBe('yepyeni-parola'))
    // İstek gerçekten `/api/parola`ya gitti.
    expect(istekYollari).toContain('POST /api/parola')
  })

  it('basari mesaji KURTARMA KODU ve ESKI YEDEK gerceklerini yazar', async () => {
    // İki gerçek de kullanıcının ancak "çok geç" öğrenebileceği türden:
    // kurtarma kodunu parolasını unuttuğunda, eski yedeği de onu geri
    // yüklemeye çalıştığında. Ekran ikisini de ÖNCEDEN söylemeli.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await parolaFormunuAc()
    await parolayiDoldur('gizli-parola-123', 'yepyeni-parola')
    await userEvent.click(gonderDugmesi())

    const bilgi = await screen.findByText(/Parolanız değişti/)
    expect(bilgi.textContent).toContain('Kurtarma kodunuz aynı kaldı')
    // Dizgi OLDUĞU GİBİ aranıyor, `/i` bayrağıyla değil: JavaScript'te
    // `İ` (U+0130) `i`ye katlanmaz (birleşen noktalı `i̇` verir), yani
    // `/eski/i` "ESKİ"yi bulmaz. Bu kod tabanının Türkçe katlama dersinin
    // (bkz. `store::search`) istemci tarafındaki karşılığı.
    expect(bilgi.textContent).toContain('ESKİ parolanızla açılır')
    // `role="status"`: ekran okuyucu kullanıcısı da duymalı.
    expect(bilgi.getAttribute('role')).toBe('status')
  })

  it('yanlis mevcut parolada sunucunun mesaji gosterilir ve parola DEGISMEZ', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await parolaFormunuAc()
    await parolayiDoldur('bambaska-parola', 'yepyeni-parola')
    await userEvent.click(gonderDugmesi())

    expect(await screen.findByText(/Mevcut parolanız hatalı/)).toBeDefined()
    expect(sunucuParolasi).toBe('gizli-parola-123')
    // Form AÇIK kalır: kullanıcı düzeltip yeniden deneyebilmeli.
    expect(screen.getByLabelText('Mevcut parolanız')).toBeDefined()
    expect(screen.queryByText(/Parolanız değişti/)).toBeNull()
  })

  it('kisa yeni parolada AYRI bir mesaj gosterilir', async () => {
    // "Her hata parola hatasıdır" tuzağı: iki ret aynı metni vermemeli,
    // yoksa kullanıcı neyi düzelteceğini bilemez.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await parolaFormunuAc()
    await parolayiDoldur('gizli-parola-123', 'kisa')
    await userEvent.click(gonderDugmesi())

    expect(await screen.findByText(/en az 8 karakter/)).toBeDefined()
    expect(screen.queryByText(/Mevcut parolanız hatalı/)).toBeNull()
    expect(sunucuParolasi).toBe('gizli-parola-123')
  })

  it('yeni parola ile tekrari uyusmuyorsa istek HIC ATILMAZ', async () => {
    // Sunucu iki alanı karşılaştıramaz (ikincisi ona hiç gönderilmiyor):
    // yazım hatası yapan bir kullanıcı, yeni parolasını bilmeden
    // değiştirmiş olurdu.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await parolaFormunuAc()
    await parolayiDoldur('gizli-parola-123', 'yepyeni-parola', 'yepyeni-paroa')
    await userEvent.click(gonderDugmesi())

    expect(await screen.findByText(/tekrarı aynı değil/i)).toBeDefined()
    expect(istekYollari.filter((y) => y.includes('/api/parola'))).toHaveLength(0)
    expect(sunucuParolasi).toBe('gizli-parola-123')
  })

  it('parola HICBIR istek YOLUNDA tasinmaz', async () => {
    // URL'ler tarayıcı geçmişine ve genel amaçlı erişim günlüklerine
    // düşer; parola gövdede kalmalı (`ekYukle`nin dosya adı kararıyla
    // aynı sınıf).
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await parolaFormunuAc()
    await parolayiDoldur('gizli-parola-123', 'KANARYA-PAROLASI')
    await userEvent.click(gonderDugmesi())
    await waitFor(() => expect(istekYollari).toContain('POST /api/parola'))

    for (const yol of istekYollari) {
      expect(yol).not.toContain('KANARYA-PAROLASI')
      expect(yol).not.toContain('gizli-parola-123')
    }
  })

  // "form kapaninca girilen parolalar STATE ten silinir" ->
  // `AyarlarSekmesi.test.tsx`e taşındı (Görev 2): panel artık orada.

  it('parola alanlari `type=password`', async () => {
    // Ekran görünürken danışan odada olabilir (`HizliArama`nın kendi
    // gerekçesiyle aynı sınıf); parola düz metin olarak görünmemeli.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await parolaFormunuAc()

    for (const etiket of ['Mevcut parolanız', 'Yeni parola', 'Yeni parola (tekrar)']) {
      expect((screen.getByLabelText(etiket) as HTMLInputElement).type).toBe('password')
    }
  })

  // -------------------------------------------------------------------
  // Dal incelemesi: HTTP -> arayüz yönü. Üç uç noktanın istemcide hiçbir
  // çağrı yeri yoktu; aşağıdaki testler o çağrı yerlerini ölçüyor.
  // -------------------------------------------------------------------

  it('saklama suresi dolan dosyalar ANA EKRANDA listelenir ve tiklaninca kart acilir', async () => {
    // Tasarım §7: "süresi dolan dosyalar ana ekranda hatırlatma olarak
    // listelenir". Kart içindeki tekil gösterge bunun yerini tutmuyordu:
    // bir dosyanın süresinin dolduğunu görmek için o dosyayı AÇMAK
    // gerekiyordu, yani soru ekranda hiç sorulmuyordu.
    sunucuSaklamaDolanlar = [{ id: 3, ad_soyad: 'Zeynep Kaya', telefon: null, durum: 'aktif' }]
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: saklama hatırlatması artık Ayarlar sekmesinin İÇİNDE.
    await ayarlarSekmesineGec()

    const bolum = await screen.findByRole('region', { name: 'Saklama süresi dolan dosyalar' })
    expect(bolum.textContent).toContain('Zeynep Kaya')
    // İmha kararı insanın: bölüm bunu YAZMALI ve bir silme düğmesi
    // İÇERMEMELİ (plan global kısıtı).
    expect(bolum.textContent).toMatch(/kendiliğinden silinmez/i)
    expect(within(bolum).queryByRole('button', { name: /sil/i })).toBeNull()

    // İstek yerel takvim gününü taşımalı: karşılaştırma duvar saatine göre
    // ve UTC'den türetmek sınırdaki bir dosyayı listeden düşürürdü.
    expect(istekYollari).toContain('GET /api/saklama-suresi-dolanlar?bugun=2026-09-09')

    await userEvent.click(
      within(bolum).getByRole('button', { name: 'Zeynep Kaya dosyasını aç (saklama süresi doldu)' }),
    )
    // `saklama.onAc` = `danisanaGit`: sekme Danışanlar'a döner, dosya
    // varsayılan "Seanslar" alt sekmesiyle açılır. Başlık `Bilgiler`de.
    await dosyaBilgileriSekmesineGec()
    await screen.findByRole('heading', { name: 'Zeynep Kaya' })
  })

  it('EKSI YON: suresi dolan dosya yoksa hatirlatma HIC gorunmez', async () => {
    // Bu olmadan "her zaman bir bant bas" mutasyonu üstteki testi geçerdi.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await ayarlarSekmesineGec()
    expect(screen.queryByRole('region', { name: 'Saklama süresi dolan dosyalar' })).toBeNull()
  })

  // IMPORTANT-3: `GET /api/saklama-suresi-dolanlar` sunucuda SİLİNEMEZ bir
  // denetim kaydı bırakıyor (`LogHacmi::HerCagri`). Veri yalnızca Ayarlar
  // sekmesinde gösterildiği için istek de yalnızca o sekme GÖRÜNÜRKEN
  // atılmalı — açılışta (Takvim) atılırsa terapist Ayarlar'ı hiç açmasa
  // bile kalıcı, hiç görülmeyecek bir kayıt düşer.
  it('saklama-suresi-dolanlar istegi TAKVIMDE acilista ATILMAZ, Ayarlar a gecince atilir', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Takvim'in kendi mount istekleri (randevular) bitsin ki "istek yok"
    // iddiası işlem ÖNCESİ bir kareyle tatmin olmasın (biçim 6).
    await waitFor(() =>
      expect(istekYollari.some((y) => y.startsWith('GET /api/randevular'))).toBe(true),
    )
    expect(istekYollari.filter((y) => y.startsWith('GET /api/saklama-suresi-dolanlar'))).toEqual(
      [],
    )

    await ayarlarSekmesineGec()
    await waitFor(() =>
      expect(
        istekYollari.filter((y) => y.startsWith('GET /api/saklama-suresi-dolanlar')),
      ).toHaveLength(1),
    )
  })

  it('saklama listesi hafta degisiminde YENIDEN sorulmaz (silinemez log satiri)', async () => {
    // `clients::saklama_suresi_dolanlar` her çağrıda `LogHacmi::HerCagri`
    // ile SİLİNEMEZ bir `goruntuleme` satırı yazıyor. Liste gün içinde
    // değişmez; her hafta okunda yeniden sormak, hiçbir kazanç sağlamadan
    // kalıcı satır biriktirmek olurdu (`durumDegis`/`sil` ile aynı karar).
    sunucuSaklamaDolanlar = [{ id: 3, ad_soyad: 'Zeynep Kaya', telefon: null, durum: 'aktif' }]
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await ayarlarSekmesineGec()
    await screen.findByRole('region', { name: 'Saklama süresi dolan dosyalar' })

    // "Sonraki hafta" Takvim sekmesinde — saklama listesi hafta değiştiğinde
    // YENİDEN SORULMAMALI, sekme geçişi bunu bağımsız kanıtlamaz.
    await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    await waitFor(() =>
      expect(istekYollari.some((y) => y.includes('baslangic=2026-09-14'))).toBe(true),
    )

    expect(istekYollari.filter((y) => y.includes('/api/saklama-suresi-dolanlar'))).toHaveLength(1)

    // IMPORTANT-B düzeltmesi: yukarıdaki iddia Ayarlar'a hiç GERİ
    // dönmüyordu — `cekildiRef` koruması (bkz. `useDanisanListesi.ts`)
    // olmadan da (yalnızca `ayarlarGorunur` kontrolüyle) bu noktaya kadar
    // TEK istek atılırdı, çünkü henüz Ayarlar'a İKİNCİ kez girilmemişti.
    // Ayarlar → Takvim → Ayarlar tam turu: `cekildiRef` olmadan bu geçiş
    // İKİNCİ bir SİLİNEMEZ görüntüleme kaydı bırakırdı.
    await userEvent.click(screen.getByRole('tab', { name: /^Ayarlar/ }))
    await screen.findByRole('region', { name: 'Saklama süresi dolan dosyalar' })
    expect(istekYollari.filter((y) => y.includes('/api/saklama-suresi-dolanlar'))).toHaveLength(1)
  })

  it('depolama esigi asilinca uyari gorunur; asilmayinca GORUNMEZ', async () => {
    // Plan global kısıtındaki 500 MB eşiği HTTP'de vardı, üründe yoktu:
    // ekler 20 MB'a kadar BLOB tutuyor ve terapist veritabanı şişerken
    // hiçbir uyarı almıyordu.
    sunucuDepolama = { toplam_boyut: 600 * 1024 * 1024, esik: 500 * 1024 * 1024, uyari: true }
    const { unmount } = render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    // Görev 8: depolama uyarısı artık Ayarlar sekmesinin İÇİNDE.
    await ayarlarSekmesineGec()

    const uyari = await screen.findByText(/uyarı eşiğini aştı/i)
    // Eşik ve toplam SUNUCUDAN gelen sayılarla basılıyor; istemcide ikinci
    // bir kopya tutmak iki sayının sessizce ayrışması demekti.
    expect(uyari.textContent).toContain('600,0 MB')
    expect(uyari.textContent).toContain('500,0 MB')
    // Engellemiyor, bildiriyor.
    expect(uyari.textContent).toMatch(/engellenmiyor/i)

    unmount()

    // ARTI/EKSI YON: eşik aşılmamışken hiçbir bant yok. Bu olmadan "her
    // zaman uyar" mutasyonu yukarıdaki iddiayı geçerdi.
    sunucuDepolama = { toplam_boyut: 1024, esik: 500 * 1024 * 1024, uyari: false }
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await ayarlarSekmesineGec()
    expect(screen.queryByText(/uyarı eşiğini aştı/i)).toBeNull()
  })

  it('ek silme DELETE atar ve kart YENIDEN cekilir', async () => {
    // Uç nokta Görev 7'de yazılmıştı ama çağrı yeri yoktu: yanlış danışana
    // yüklenen bir onam PDF'i silinemiyordu.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await danisanlarSekmesineGec()
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await dosyaBilgileriSekmesineGec()
    // Ad iki yerde birden geciyor (ek listesi + riza belgesi secici):
    // indirme BAGLANTISI uzerinden aranmali.
    await screen.findByRole('link', { name: 'onam-formu.pdf' })

    await userEvent.click(screen.getByRole('button', { name: 'onam-formu.pdf dosyasını sil' }))
    // İKİ ADIMLI: ilk tıklama HİÇBİR istek atmaz.
    expect(istekYollari.some((y) => y.startsWith('DELETE /api/ekler'))).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(istekYollari).toContain('DELETE /api/ekler/77'))

    // Kart YENİDEN ÇEKİLİYOR (yalnızca yerel listeden düşürülmüyor):
    // sunucu aynı transaction'da `riza_dosya_id`'yi de temizliyor ve iki
    // kaynağın tutarlılığı ancak birlikte çekilerek korunur.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'onam-formu.pdf' })).toBeNull(),
    )
    expect(istekYollari.filter((y) => y === 'GET /api/danisanlar/1').length).toBeGreaterThan(1)
  })
})

// =====================================================================
// YEDEKLEME — tasarim §7'nin ana ekran karsiligi
// =====================================================================
//
// # Bu bloktaki testlerin olctugu sey
//
// `core::backup` bastan beri test edilmisti ve hepsi yesildi; eksik olan
// CAGRI YERIYDI. Dolayisiyla buradaki iddialar "yedek fonksiyonu calisiyor
// mu" degil, "urun kullanicinin verisini gercekten yedekliyor mu":
// otomatik yedek tetikleniyor mu, AYNI GUN ikinci kez tetiklenmiyor mu,
// alinamadiginda kullanici bunu ekranda goruyor mu.
describe('AnaEkran — yedekleme (tasarim §7)', () => {
  const gercekFetch = globalThis.fetch
  let istekler: { yol: string; method: string; govde: string | null }[]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 2026-09-09 Carsamba, YEREL saat 12:00. `BUGUN` bu gunun damgasi.
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    istekler = []

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      istekler.push({
        yol,
        method: secenekler?.method ?? 'GET',
        govde: (secenekler?.body as string) ?? null,
      })
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const notlar = notYaniti(yol, secenekler?.method ?? 'GET', null)
      if (notlar) return notlar
      if (yol.startsWith('/api/danisanlar')) return jsonYanit(danisanlar)
      if (yol.startsWith('/api/randevular')) return jsonYanit([])
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
  })

  async function ekraniAc(onGeriYukle = vi.fn()) {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={onGeriYukle} />)
    // Görev 8: Yedekleme bölümü artık Ayarlar sekmesinin İÇİNDE.
    await ayarlarSekmesineGec()
    await screen.findByRole('region', { name: 'Yedekleme' })
    return onGeriYukle
  }

  it('her sey CALISIRKEN de geri yukleme ekranina bir yol var (tasarim §7)', async () => {
    // Ekranin uc felaket yolu (bozuk veritabani, okunamayan anahtar, yeni
    // bilgisayar) `App` seviyesinde. Bu DORDUNCU yol: yanlislikla silinen
    // bir danisan ya da bozulan bir not ancak eski bir yedekten geri gelir
    // ve o an ortada hicbir felaket yoktur.
    const onGeriYukle = await ekraniAc()
    await userEvent.click(screen.getByRole('button', { name: 'Yedekten geri yükle' }))
    expect(onGeriYukle).toHaveBeenCalled()
    // Dugme HICBIR istek atmaz: geri yukleme diger ekranda onaylanir.
    expect(istekler.some((i) => i.yol === '/api/geri-yukleme')).toBe(false)
  })

  it('bugunun yedegi yoksa acilista OTOMATIK alinir ve damga YEREL takvim gunudur', async () => {
    sunucuYedekleri = []
    await ekraniAc()

    await waitFor(() => expect(yedekIstekleri.length).toBe(1))
    // Damga sunucudan degil ISTEMCIDEN geliyor (duvar saati sozlesmesi):
    // `toISOString().slice(0,10)` kullanan bir surum Istanbul'da 00:00-03:00
    // arasinda bir gun geriye yazardi. Burada saat 12:00 oldugu icin iki
    // yorum da ayni sonucu verir; ayrimi `yerelGun`'un kendi testi olcuyor.
    expect(yedekIstekleri[0]).toEqual({ damga: BUGUN, hedef_dizin: undefined })

    // Ekran sonucu gosteriyor: "yedegim aliniyor mu" sorusunun bir cevabi var.
    const bolum = screen.getByRole('region', { name: 'Yedekleme' })
    await waitFor(() => expect(bolum.textContent).toContain(BUGUN))
    expect(bolum.textContent).toContain('/Volumes/YEDEK/terapi')
  })

  it('bugunun yedegi VARSA ikinci kez alinmaz', async () => {
    // EKSI YON. Bu olmadan "her acilista yedek al" mutasyonu yukaridaki
    // testi gecerdi -- ve her acilis sunucuda SILINEMEZ bir `disa_aktarma`
    // satiri yazardi (bkz. `store::audit` hacim politikasi).
    await ekraniAc()
    await waitFor(() => expect(istekler.some((i) => i.yol === '/api/yedekler')).toBe(true))
    // Listeleme bitip otomatik yedek KARARI verildikten sonra olcuyoruz.
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Yedekleme' }).textContent).toContain(BUGUN),
    )
    expect(yedekIstekleri).toEqual([])
  })

  it('DUN alinmis bir yedek bugunu karsilamaz', async () => {
    // "Herhangi bir yedek varsa yeter" mutasyonunun kirildigi yer: tasarim
    // GUNDE BIR yedek istiyor, "bir kere" degil.
    sunucuYedekleri = [{ dosya_adi: 'yedek-2026-09-08.db', tarih: '2026-09-08', boyut: 4096 }]
    await ekraniAc()
    await waitFor(() => expect(yedekIstekleri.length).toBe(1))
    expect(yedekIstekleri[0].damga).toBe(BUGUN)
  })

  it('yedek alinamazsa ana ekranda KALICI uyari cikar ve sunucunun mesaji korunur', async () => {
    // Tasarim §7: "Yedek alinamazsa (disk dolu, klasor erisilemez) ana
    // ekranda kalici uyari cikar; sessiz gecilmez."
    sunucuYedekleri = []
    yedekAlmaHatasi = 'Bu klasöre yazılamıyor. Salt okunur bir disk olabilir.'
    await ekraniAc()

    const uyari = await screen.findByRole('alert')
    // Mesaj OLDUGU GIBI: "klasor bulunamadi" ile "klasore yazilamiyor" ayri
    // sorunlar ve kullanici hangisini duzeltecegini bilmeli.
    expect(uyari.textContent).toContain('Salt okunur bir disk olabilir.')

    // KALICI: baska bir etkilesim onu temizlemiyor. "Danışan ekle" artık
    // Danışanlar sekmesinde (Görev 8); aynı sekmedeki İLGİSİZ bir etkileşim
    // olarak parola formunu aç/kapa kullanılıyor.
    await userEvent.click(screen.getByRole('button', { name: 'Parolayı değiştir' }))
    expect(screen.getByRole('alert').textContent).toContain('Salt okunur bir disk olabilir.')
  })

  // "klasor secilmemisse uyari cikar; klasor secilince yedek HEMEN alinir"
  // -> `AyarlarSekmesi.test.tsx`e taşındı (Görev 2): panel artık orada.

  // IMPORTANT-1: `uyaran` bağlantısı (`AnaEkran.tsx` → `Sekmeler`) hiçbir
  // testte doğrudan ölçülmüyordu; `uyaran={undefined}` mutasyonu tüm takımı
  // yeşil bırakıyordu (inceleme). İki yönlü test: nokta yedek YOKKEN VAR,
  // yedek VARKEN (ve hata yokken) YOK.
  //
  // DÜZELTME (ikinci inceleme turu, MINOR): bu test aslında `yedekYok`
  // dalını DEĞİL, `yedekleme.uyari` dalını sınıyor — `yedekListeHatasi`
  // hem `yedek`i `null` bırakır (`yedekYok = true`) HEM DE `useYedekleme`
  // effect'inin `catch`inde `uyari`yi doldurur (bkz. o dosyanın kaynağı),
  // yani `AnaEkran.tsx`teki `ilgilenilmesiGereken = yedekYok ||
  // yedekleme.uyari !== null` ifadesindeki `yedekYok`'u TEK BAŞINA
  // yalıtmıyor. Bu, HOOK'UN TASARIMI GEREĞİ mümkün DEĞİL: `yedek` boş
  // kalan HER yol (klasör hiç seçilmemiş → `listele()` hata verir → hem
  // `yedek=null` HEM `uyari` dolar; klasör seçili ama liste boş → otomatik
  // `al()` HEMEN tetiklenir → ya BAŞARILI olup `yedekYok`'u false'a
  // düşürür ya da BAŞARISIZ olup `uyari`yi doldurur) `uyari`yi de
  // beraberinde dolduruyor ya da `yedekYok`'u false'a çeviriyor; `yedek
  // === null` VEYA `yedekler.length === 0` durup `uyari === null` kalan
  // KARARLI bir durum `useYedekleme.ts`'nin bugünkü mantığında YOK.
  // Dolayısıyla `yedekYok` dalı bu iki testten (IMPORTANT-1 + IMPORTANT-4)
  // BAĞIMSIZ ölçülemiyor; ikisi birlikte `ilgilenilmesiGereken`in HER İKİ
  // terimini de en az bir kez `true` yapıyor (mutasyon turunda ayrı ayrı
  // doğrulandı — IMPORTANT-4'ün mutasyonu yalnızca `uyari` terimini
  // kaldırıp IMPORTANT-1'i YEŞİL bıraktı), ki bu, formülün İKİ teriminin
  // de gerçekten katkıda bulunduğunu (birinin ölü kod olmadığını) kanıtlar
  // — yalnızca `yedekYok`ın TEK BAŞINA (uyari sıfırken) da tetikleyici
  // olduğunu doğrudan göstermez.
  it('IMPORTANT-1: yedek klasoru hic secilmemisken (yedek=null, ayrica uyari da dolar) Ayarlar sekmesinin erisilebilir adinda uyari VAR', async () => {
    yedekListeHatasi = 'Yedek klasörü henüz seçilmedi.'
    await ekraniAc()
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Ayarlar — ilgilenilmesi gereken bir şey var' }),
      ).toBeDefined(),
    )
  })

  it('IMPORTANT-1: yedek VE hata yokken Ayarlar sekmesinin erisilebilir adinda uyari YOK', async () => {
    // Üst düzey `beforeEach` zaten bugünün yedeğini kuruyor
    // (`sunucuYedekleri` BUGÜN damgalı bir kayıtla başlıyor) — otomatik
    // yedek denemesi bu yüzden hiç tetiklenmiyor, `uyari` hep `null` kalır.
    await ekraniAc()
    expect(screen.getByRole('tab', { name: 'Ayarlar' })).toBeDefined()
    expect(screen.queryByRole('tab', { name: /ilgilenilmesi gereken/ })).toBeNull()
  })

  // IMPORTANT-4: nokta yalnızca "hiç yedek yok" değil, "yedekler var ama
  // BUGÜNKÜ otomatik yedek BAŞARISIZ oldu" durumunu da kapsamalı — tasarım
  // §7'nin "sessiz geçilmez" sözü, terapist Ayarlar'ı hiç açmasa da geçerli
  // olmalı. Bu senaryoda `yedekleme.yedek` DOLU (geçmiş bir yedek listelendi)
  // ama `yedekleme.uyari` de dolu (bugünkü otomatik deneme 500 aldı) —
  // eski `yedekYok` tek başına bunu YAKALAMAZDI.
  it('IMPORTANT-4: yedekler VAR ama bugunku otomatik yedek basarisiz olunca uyari YINE VAR', async () => {
    sunucuYedekleri = [{ dosya_adi: 'yedek-2026-09-08.db', tarih: '2026-09-08', boyut: 4096 }]
    yedekAlmaHatasi = 'Bu klasöre yazılamıyor. Salt okunur bir disk olabilir.'
    await ekraniAc()
    // BARİYER: otomatik deneme GERÇEKTEN başarısız oldu (kalıcı uyarı bandı
    // ekranda), ondan SONRA sekme adını ölç.
    await screen.findByRole('alert')
    expect(
      screen.getByRole('tab', { name: 'Ayarlar — ilgilenilmesi gereken bir şey var' }),
    ).toBeDefined()
  })

  it('"Simdi yedek al" ayni gun icin bile yeniden yedek alir', async () => {
    // Otomatik yedek gunde bir kez; ELLE yedek kullanicinin acik istegidir
    // (ornegin dosyalari harici diske kopyalamadan once). Ikisini ayni
    // kurala baglamak, kullanicinin istedigi anda yedek almasini
    // engellerdi.
    await ekraniAc()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Yedekleme' }).textContent).toContain(BUGUN),
    )
    expect(yedekIstekleri).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Şimdi yedek al' }))
    await waitFor(() => expect(yedekIstekleri.length).toBe(1))
    expect(yedekIstekleri[0].damga).toBe(BUGUN)
  })
})

// Görev 8: `AnaEkran.tsx` modül başlığı "Yalnızca SEÇİLİ sekmenin paneli
// monte edilir" kuralının DOĞRUDAN testi. Dosyadaki diğer testlerin hiçbiri
// bunu BAĞIMSIZ ölçmüyor — hepsi ZATEN doğru sekmeye geçtiği için üç panel
// birden çizilse bile çoğu yeşil kalırdı (yalnızca `e2e/kabuk.spec.ts`teki
// "Şimdi yedek al görünmez" iddiası bunu yakalardı, o da yalnızca yavaş
// e2e turunda). Bu test aynı korumayı birim seviyesinde, hızlı ve doğrudan
// sağlıyor.
describe('AnaEkran — sekme izolasyonu (Görev 8)', () => {
  const gercekFetch = globalThis.fetch
  // IMPORTANT-2 düzeltmesi: bu blok ARTIK istek yollarını da kaydediyor —
  // "yalnızca seçili sekme monte edilir" testinin asıl kanıtı ürünün
  // gerçek kuralı olan "görünmeyen sekme İSTEK atmaz"dır (bkz. IMPORTANT-3),
  // yalnızca DOM varlığı değil.
  let istekYollari: string[]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    istekYollari = []
    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      const method = secenekler?.method ?? 'GET'
      istekYollari.push(`${method} ${yol}`)
      const ekUc = ekUcYaniti(yol, secenekler)
      if (ekUc) return ekUc
      const notlar = notYaniti(yol, method, null)
      if (notlar) return notlar
      if (/^\/api\/danisanlar\/\d+\/seanslar$/.test(yol)) return jsonYanit([])
      if (yol.startsWith('/api/danisanlar')) return jsonYanit(danisanlar)
      if (yol.startsWith('/api/randevular')) return jsonYanit([])
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  it('yalnizca SECILI sekmenin paneli monte edilir: diger sekmelerin icerigi DOM da hic YOK', async () => {
    // Sunucu her görüntülemeyi SİLİNEMEZ bir denetim kaydına yazıyor
    // (`store::audit`); görünmeyen bir sekmenin YİNE DE monte edilmesi hem
    // gereksiz istekler hem de ekranda BASILI OLMAMASI gereken bölümlerin
    // (danışan listesi, yedekleme klasörü) sessizce DOM'da durması demek.
    //
    // İKİ BAĞIMSIZ KANIT KULLANILIYOR (IMPORTANT-2 düzeltmesi):
    //
    // 1) `data-testid` sorguları, `getByRole` DEĞİL: `getByRole`/
    //    `queryByRole` `hidden` özniteliği taşıyan öğeleri erişilebilirlik
    //    ağacından ATLAR. Bir mutasyon üç paneli KOŞULSUZ monte edip
    //    yalnızca `hidden={sekme !== 'x'}` ile gizlese `queryByRole` yine
    //    `null` döner ve bu test YANLIŞLIKLA yeşil kalırdı (inceleme).
    //    `data-testid` gerçek DOM varlığını ölçer, `hidden`'ı görmezden
    //    gelmez.
    // 2) İstek sayımı: ürünün asıl kuralı "görünmeyen sekme İSTEK atmaz"dır
    //    (bkz. IMPORTANT-3, `useDanisanListesi`'nin `ayarlarGorunur`
    //    parametresi) — bu, panel MONTE olsa da olmasa da bağımsız ölçülen,
    //    daha temel bir iddia.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByTestId('takvim-sekmesi')

    // Takvim aktifken Danışanlar'ın ve Ayarlar'ın KÖKÜ DOM'da YOK.
    expect(screen.queryByTestId('danisanlar-sekmesi')).toBeNull()
    expect(screen.queryByTestId('ayarlar-sekmesi')).toBeNull()
    // Takvim'in kendi mount istekleri bitsin ki "saklama isteği yok" iddiası
    // işlem ÖNCESİ bir kareyle tatmin olmasın (biçim 6).
    await waitFor(() =>
      expect(istekYollari.some((y) => y.startsWith('GET /api/randevular'))).toBe(true),
    )
    expect(
      istekYollari.filter((y) => y.startsWith('GET /api/saklama-suresi-dolanlar')),
    ).toEqual([])

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    // Danışanlar aktifken Takvim'in ve Ayarlar'ın KÖKÜ DOM'da YOK.
    expect(screen.queryByTestId('takvim-sekmesi')).toBeNull()
    expect(screen.queryByTestId('ayarlar-sekmesi')).toBeNull()

    await userEvent.click(screen.getByRole('tab', { name: /^Ayarlar/ }))
    // Ayarlar aktifken Takvim'in ve Danışanlar'ın KÖKÜ DOM'da YOK.
    expect(screen.queryByTestId('takvim-sekmesi')).toBeNull()
    expect(screen.queryByTestId('danisanlar-sekmesi')).toBeNull()
    // Ayarlar bölümü kendisi GÖRÜNÜR — üç panelin de aslında monte
    // olabildiğini, yalnızca YANLIŞ ANDA olmadığını kanıtlıyor.
    expect(screen.getByTestId('ayarlar-sekmesi')).toBeDefined()
    // Ve şimdi (yalnızca ŞİMDİ) saklama isteği GERÇEKTEN atıldı — tam bir
    // kez, Takvim/Danışanlar'dayken biriken sıfır isteğin üstüne.
    await waitFor(() =>
      expect(
        istekYollari.filter((y) => y.startsWith('GET /api/saklama-suresi-dolanlar')),
      ).toHaveLength(1),
    )
  })
})
