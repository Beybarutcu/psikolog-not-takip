import anaEkranKaynagi from './AnaEkran.tsx?raw'
import seansKancasiKaynagi from './anaEkranKancalari/useSeansNotlari.ts?raw'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { taslaklariUnut } from '../seans/taslak'
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

// Veri raporu sızıntı testinin iki kanaryası. `OZEL_NOT_KANARYASI` özel not
// tablosundan gelir ve HİÇBİR dışa aktarımda görünmemelidir;
// `RESMI_NOT_KANARYASI` görünmelidir (artı yön — hiçbir şey üretmeyen bir
// rapor da tek başına eksi yön iddiasını geçerdi).
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
    await screen.findByText('Ayşe Yılmaz')

    // Önce YOK: her `<p>`'ye status vermeyen, gerçekten sonuca bağlı olduğu.
    expect(screen.queryByRole('status')).toBeNull()

    await userEvent.click(arsivDugmesi('Ayşe Yılmaz'))
    await userEvent.click(screen.getByRole('button', { name: 'Evet, arşivle' }))

    expect(screen.getByRole('status').textContent ?? '').toMatch(/Ayşe Yılmaz arşivlendi/)
  })

  it('arşivleme iki adımlıdır: tek tıkla istek gitmez', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
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
    ozelYazmaYetkisiz = false
    sunucuOdendi = {}
    odemeBekletici = null
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
      const odeme = /^\/api\/randevular\/(\d+)\/odeme$/.exec(yol)
      if (odeme && method === 'PATCH') {
        if (odemeBekletici) await odemeBekletici
        sunucuOdendi[Number(odeme[1])] = (govde as { odendi: boolean }).odendi
        return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        if (method === 'GET') {
          return {
            ok: true,
            json: async () =>
              [randevuA, randevuB].map((r) => ({ ...r, odendi: sunucuOdendi[r.id] ?? r.odendi })),
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

  const odendiKutusu = () => screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement

  async function seansAc(ad = 'Ayşe Yılmaz') {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: ad })
    await userEvent.click(screen.getByRole('button', { name: ad }))
    await screen.findByLabelText('Seans notu')
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

    let coz: () => void = () => {}
    odemeBekletici = new Promise<void>((r) => { coz = r })
    const oncekiSayi = istekler.length

    await userEvent.click(kutu)
    // İstek uçuşta: kutu kilitli (ikinci bir tıklama ikinci PATCH üretemez).
    expect(kutu.disabled).toBe(true)
    coz()
    // BARİYER: işlem BİTTİ (kilit kalktı). Bu olmadan aşağıdaki "başka istek
    // yok" iddiası, `yukle()` henüz tetiklenmeden anında tatmin olurdu.
    await waitFor(() => expect(kutu.disabled).toBe(false))
    // Tazeleme sonrası olası bir efektin/yeniden yüklemenin istek atmasına
    // fırsat ver.
    await new Promise((r) => setTimeout(r, 30))

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
    await screen.findByText(/Mehmet Demir — /)
    expect(odendiKutusu().checked).toBe(false)

    // A'ya dön: takvim YENİDEN YÜKLENMEDİ, dolayısıyla A'nın `true`'su ancak
    // yerel listedeki kopya tazelendiyse görünür.
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByText(/Ayşe Yılmaz — /)
    expect(odendiKutusu().checked).toBe(true)
    expect(
      istekler.filter((i) => i.yol.startsWith('/api/randevular?') && i.method === 'GET'),
    ).toHaveLength(1)
  })

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

  it('bos notta sablon basliklari gorunur ama HICBIR yazma uretilmez', async () => {
    await seansAc()
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    expect(alan.value).toContain('Veri:')
    expect(alan.value).toContain('Plan:')

    await userEvent.click(screen.getByRole('button', { name: 'Seansı kapat' }))
    await new Promise((coz) => setTimeout(coz, 30))
    expect(yazmalar(`/api/randevular/${randevuA.id}/not`)).toHaveLength(0)
  })

  // Planın en sert kısıtı özel not için hiç koşulmamıştı: `NotEditoru`
  // 401 kurtarmasını yalnızca `not-1` anahtarıyla test ediyordu. Burası
  // ÇAĞRI NOKTASINDAN uçtan uca koşuyor — taslak anahtarı `ozel-<id>` ve
  // kurtarılan metin RESMÎ nota değil, özel nota yazılmalı.
  it('ozel not kaydedilirken 401 gelirse metin kaybolmaz ve kilit acilinca OZEL nota yazilir', async () => {
    const ozelYol = `/api/randevular/${randevuA.id}/ozel-not`
    ozelYazmaYetkisiz = true

    const { unmount } = render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    await userEvent.type(await screen.findByLabelText('Özel notum'), '-KAYBOLMAMALI')

    // Kayıt denendi ve 401 aldı; kullanıcıya söylendi. Bekleme payı
    // editörün varsayılan gecikmesinden (2000 ms) uzun: bu test bilerek
    // GERÇEK otomatik kaydı bekliyor, unmount tahliyesini değil — 401'in
    // geldiği an üretimde budur.
    await waitFor(() => expect(yazmalar(ozelYol).length).toBeGreaterThanOrEqual(1), {
      timeout: 4000,
    })
    expect(await screen.findByText(/kaydedilemedi/i)).toBeDefined()

    // App'in 401'de yaptığı şey görsel bir perde değil, GERÇEK unmount.
    unmount()
    ozelYazmaYetkisiz = false
    const oncekiYazmaSayisi = yazmalar(ozelYol).length

    // Kilit açıldı: AnaEkran yeniden mount edildi, kullanıcı aynı seansı
    // ve aynı sekmeyi açtı.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))

    const alan = (await screen.findByLabelText('Özel notum')) as HTMLTextAreaElement
    expect(alan.value).toContain('-KAYBOLMAMALI')
    expect(screen.getByText(/geri yüklendi/i)).toBeDefined()

    // Ekranda kalmakla yetinmiyor: ilk fırsatta SUNUCUYA yazılıyor.
    await waitFor(
      () => expect(yazmalar(ozelYol).length).toBeGreaterThan(oncekiYazmaSayisi),
      { timeout: 4000 },
    )
    expect(
      (yazmalar(ozelYol).at(-1)!.govde as { icerik: string }).icerik,
    ).toContain('-KAYBOLMAMALI')
    // Ve kurtarılan ÖZEL metin resmî nota HİÇ yazılmadı.
    expect(yazmalar(`/api/randevular/${randevuA.id}/not`)).toHaveLength(0)
    // Süre sınırı yükseltildi: bu test editörün GERÇEK gecikmesini
    // (2000 ms) iki kez bekliyor. Gecikmeyi kısaltmak için prop geçmek,
    // ölçülen yolu (çağrı noktasının kurduğu editör) değiştirmek olurdu.
  }, 20000)

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
    await userEvent.type(alan(), ' EK')

    // A'nın kaydı uçuşta kalsın: unmount tahliyesi bu isteği atacak.
    const a = kapi()
    gecikmeler[`PUT /api/randevular/${randevuA.id}/not`] = a.bekle

    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))
    await waitFor(() => expect(alan().value).toBe('B METNI'))

    a.ac()
    await new Promise((coz) => setTimeout(coz, 20))

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
  const tumRandevular = [buHafta, gelecekHafta, baskasininki]

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
  let istekYollari: string[]
  // Üretilen veri raporu Blob'ları. Raporun İÇİNDE ne olduğunu ölçmenin tek
  // yolu bu: `istekYollari` yalnızca hangi ucun çağrıldığını söyler ve
  // "rapora özel not girdi mi" sorusunu cevaplayamaz.
  let uretilenBloblar: Blob[]
  // Belirli bir isteği açıkça salınana kadar bekletir (Görev 9'daki
  // `kapi()` deseninin aynısı): "yeni veri gelene kadar öncekinin ekranda
  // kalmadığı" ancak bekleyen bir istekle ölçülebilir.
  let gecikmeler: Record<string, Promise<void>>

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
    istekYollari = []
    gecikmeler = {}
    uretilenBloblar = []
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
      if (yol.startsWith('/api/ay-ozeti')) {
        return jsonYanit({
          ay: '2026-09', seans_sayisi: 4, tahsilat_kurus: 180000, bekleyen_kurus: 60000,
          borclular: [{ client_id: 3, ad_soyad: 'Zeynep Kaya', borc_kurus: 60000, seans_sayisi: 1 }],
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
      if (ekler) return jsonYanit(Number(ekler[1]) === 1 ? sunucuEkleri : [])

      // Dal incelemesi C1: disa aktarim denetim kaydi. ACIKCA karsilaniyor;
      // asagidaki `/api/danisanlar` on ek eslesmesine birakilsaydi, yolu
      // yanlis yazan bir mutasyon (or. `.../rapor` ) yine yesil gecerdi.
      if (/^\/api\/danisanlar\/\d+\/rapor-kaydi$/.test(yol)) return jsonYanit({})

      const dosya = /^\/api\/danisanlar\/(\d+)$/.exec(yol)
      if (dosya) return jsonYanit(dosyalar[Number(dosya[1])])

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
      await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })
      // Mount'un diğer istekleri (takvim, liste, saklama, yedek) bitmiş olsun
      // ki "istek yok" iddiası işlem ÖNCESİ durumla tatmin olmasın.
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
      await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })
      await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))
      const bolge = await screen.findByRole('region', { name: 'Ay sonu özeti' })
      const satir = await within(bolge).findByRole('button', { name: /Zeynep Kaya/ })

      expect(document.body.textContent).not.toContain('0555 999 88 77')
      const once = istekYollari.length
      await userEvent.click(satir)

      // Zeynep'in (id 3) GERÇEK kartı: sunucudan çekilen dosyanın telefonu.
      expect(await screen.findByText('0555 999 88 77')).toBeDefined()
      expect(istekYollari.slice(once)).toContain('GET /api/danisanlar/3')
      // Başka bir danışanın dosyası istenmedi.
      expect(
        istekYollari.slice(once).filter((y) => /^GET \/api\/danisanlar\/\d+$/.test(y)),
      ).toEqual(['GET /api/danisanlar/3'])

      // Kart açılışı AnaEkran'ı birkaç kez yeniden render etti (yeni
      // `onDanisanAc` closure'u, yeni `bugun` dizgisi): özet yine TEK istek.
      expect(screen.getByRole('region', { name: 'Ay sonu özeti' })).toBeDefined()
      expect(ozetIstekleri()).toEqual(['GET /api/ay-ozeti?ay=2026-09'])
    })
  })

  it('danisan cipine tiklayinca kart acilir; bakiye YALNIZCA o danisanin seanslarindan', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))

    expect(await screen.findByText('0555 111 22 33')).toBeDefined()
    // Ayşe: gelecek haftaki 450 TL'lik seans "geldi" ve ödenmemiş.
    // Mehmet'in 999 TL'lik ödenmemiş seansı bu sayıya KARIŞMAMALI —
    // aralık uç noktası danışan süzgeci sunmuyor, süzgeç istemcide.
    expect(screen.getByText('450,00 ₺')).toBeDefined()
    expect(document.body.textContent).not.toContain('999,00 ₺')
  })

  it('baska danisana gecince onceki kartin verisi EKRANDA KALMAZ', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
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
    m.ac()
    expect(
      (await screen.findAllByRole('alert')).some((u) =>
        /açık rıza kaydı yok/i.test(u.textContent ?? ''),
      ),
    ).toBe(true)
  })

  it('veri raporu icin notlar SUNUCUNUN ust siniriyla (200) cekilir', async () => {
    // Rapor KVKK md. 11 kapsamında "elimdeki her şey" demektir. Daha düşük
    // bir limit, eksik olduğunu SÖYLEMEDEN eksik bir rapor üretirdi.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    // Kartın açıldığını gösteren dayanak telefon: risk notu katlanmış ve
    // burada onu açmanın bir gerekçesi yok.
    await screen.findByText('0555 111 22 33')

    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await waitFor(() =>
      expect(istekYollari).toContain('GET /api/danisanlar/1/notlar?limit=200'),
    )
  })

  // Dal incelemesi C1: dışa aktarım DENETİM KAYDI bırakır — ve önce onu
  // bırakır. Rapor tamamen istemcide üretildiği için sunucu bu isteği
  // görmezse dışa aktarımdan haberi olmaz; not listesi ise `goruntuleme`
  // yazıp 5 dakikalık pencerede birleşir (seans paneli aynı danışan için
  // açıldıysa iz SIFIRDIR).
  it('veri raporu disa aktarimi ONCE rapor-kaydi ucunu POST eder', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await screen.findByText('0555 111 22 33')

    // ÖN KOŞUL: kart açılışı bu ucu kendiliğinden çağırmıyor — çağırsaydı
    // aşağıdaki iddia "zaten öyleydi" ile tatmin olurdu.
    expect(istekYollari).not.toContain('POST /api/danisanlar/1/rapor-kaydi')

    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })

    const kayit = istekYollari.indexOf('POST /api/danisanlar/1/rapor-kaydi')
    const notlar = istekYollari.indexOf('GET /api/danisanlar/1/notlar?limit=200')
    expect(kayit, 'rapor-kaydi ucu cagrilmali').toBeGreaterThan(-1)
    // SIRA: kayıt notlardan ÖNCE. Kaydı sona koyan bir sürüm "ikisi de
    // çağrıldı" iddiasını geçerdi ama fail-closed sözünü tutmazdı.
    expect(kayit).toBeLessThan(notlar)
  })

  it('rapor kaydi REDDEDILIRSE hicbir rapor uretilmez (fail-closed)', async () => {
    // Kilitli oturumda kayıt yazılamaz; o hâlde dosya da diske yazılmamalı.
    // Ölçülen şey ekrandaki mesaj değil, Blob'un HİÇ üretilmemesi.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await screen.findByText('0555 111 22 33')

    yetkisiz = true
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))

    await waitFor(() =>
      expect(screen.getByText('Oturum zaman aşımına uğradı.')).toBeDefined(),
    )
    expect(uretilenBloblar).toHaveLength(0)
    expect(screen.queryByRole('link', { name: /raporu indir/i })).toBeNull()
    // Notlar bile çekilmedi: kayıt kapısı ilk sıradaydı.
    const kayitSonrasi = istekYollari.slice(
      istekYollari.indexOf('POST /api/danisanlar/1/rapor-kaydi') + 1,
    )
    expect(kayitSonrasi.some((y) => y.includes('/notlar?limit=200'))).toBe(false)
  })

  // C1 — DAVRANIŞSAL katman. `veriRaporu.test.ts` ve `DanisanKarti.test.tsx`
  // raporun ÜRETİCİSİNİ ölçüyor; ikisi de raporun NOT KAYNAĞINI seçen yeri
  // (`AnaEkran::raporNotlariGetir`) göremez. Kanaryayı sunucudaki özel not
  // tablosuna koyup üretilen dosyanın metnini okumak, o kavşağı ölçen tek
  // testtir.
  it('uretilen rapor METNI ozel not kanaryasini TASIMAZ, resmi notu TASIR', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await screen.findByText('0555 111 22 33')

    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })

    expect(uretilenBloblar).toHaveLength(1)
    const metin = await uretilenBloblar[0].text()
    // ARTI YÖN önce: hiçbir şey üretmeyen (ya da boş) bir rapor, aşağıdaki
    // eksi yön iddiasını tek başına geçerdi.
    expect(metin).toContain(RESMI_NOT_KANARYASI)
    expect(metin).not.toContain(OZEL_NOT_KANARYASI)
    // Özel notu getiren uç nokta HİÇ çağrılmadı: metinde görünmemesi
    // (ör. sızıntıyı ekleyen kodun içeriği kırpması) yeterli değil.
    expect(istekYollari.some((y) => y.includes('/ozel-not'))).toBe(false)
  })

  // C1 — DAVRANIŞSAL katmanın İKİNCİ durumu: SEANS PANELİ AÇIKKEN.
  //
  // Üstteki test doğru şeyi ölçüyor ama ihlalin gerçekleşebileceği duruma
  // hiç girmiyordu (on birinci biçimin tersi): kartı panel kapalıyken
  // açıyor, yani `seciliRandevu === null`. `raporNotlariGetir`'e
  // "özel notu da ekle" biçiminde bir sızıntı yazıldığında o dal
  // ULAŞILAMAZ kalıyor ve test yeşil geçiyor — mutasyon altında 344 web
  // testinden yalnızca YAPISAL olan kırılıyordu. Sızıntının mümkün olduğu
  // tek durum panelin açık (ve özel notun yüklü) olduğu durumdur; e2e onu
  // bilerek kapsıyor, birim testi kapsamıyordu.
  //
  // Üstteki test SİLİNMİYOR: ikisi farklı durumları ölçüyor (panel kapalı /
  // panel açık) ve panel kapalıyken "özel uç HİÇ çağrılmadı" iddiası
  // yalnızca orada yazılabilir.
  it('seans paneli ACIKKEN de uretilen rapor METNI ozel not kanaryasini TASIMAZ, resmi notu TASIR', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)

    // 1) Seans paneli AÇ: takvimdeki bloğa tıkla (`seciliRandevu` doluyor).
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')

    // 2) ÖZEL SEKMEYE geç: özel not panel açılışında değil, yalnızca sekmeye
    //    geçilince yükleniyor (Görev 9 düzeltmesi — görülmemiş `goruntuleme`
    //    satırı bırakmamak için). Kanarya gerçekten belleğe alınmadan
    //    "rapora girmedi" demek hiçbir şey kanıtlamaz.
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    expect(((await screen.findByLabelText('Özel notum')) as HTMLTextAreaElement).value).toBe(
      OZEL_NOT_KANARYASI,
    )
    const ozelIstekleri = istekYollari.filter((y) => y.includes('/ozel-not')).length
    expect(ozelIstekleri).toBeGreaterThan(0)

    // 3) Danışan kartını aç — panel AÇIK KALIYOR (ikisi bağımsız state).
    await userEvent.click(cip('Ayşe Yılmaz'))
    await screen.findByText('0555 111 22 33')
    // Ön koşul: panel gerçekten hâlâ açık. Kart açılınca panel kapansaydı bu
    // test yine üstteki (ulaşılamaz dal) duruma düşer, farkında olmadan.
    expect(screen.getByRole('region', { name: 'Seans' })).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })

    expect(uretilenBloblar).toHaveLength(1)
    const metin = await uretilenBloblar[0].text()
    // ARTI YÖN önce: hiçbir şey üretmeyen bir rapor eksi yönü de geçerdi.
    expect(metin).toContain(RESMI_NOT_KANARYASI)
    expect(metin).not.toContain(OZEL_NOT_KANARYASI)
    // Dışa aktarım YENİ bir özel not isteği DE atmadı. Burada "hiç çağrılmadı"
    // denemez (sekme meşru olarak çağırdı); ölçülen şey raporun kendi
    // isteğidir.
    expect(istekYollari.filter((y) => y.includes('/ozel-not')).length).toBe(ozelIstekleri)
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
      await userEvent.click(await screen.findByRole('button', { name: 'Zeynep Kaya dosyasını aç' }))
      await screen.findByText('0555 999 88 77')

      const bolum = screen.getByRole('region', { name: 'Saklama süresi' })
      expect(bolum.textContent).toContain('Saklama süresi doldu')
      expect(bolum.textContent).not.toContain('gün kaldı')
    })

    it('rapor dosya adindaki tarih YEREL gundur', async () => {
      render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
      await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
      await screen.findByText('0555 111 22 33')

      await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
      const bag = await screen.findByRole('link', { name: /raporu indir/i })
      expect(bag.getAttribute('download')).toBe('danisan-1-veri-raporu-2026-09-09.txt')
    })
  })

  // C1 — YAPISAL katman. Davranışsal test "bugün sızmıyor" der; bu test
  // "sızdıracak bir kaynak EKLENEMEZ" der.
  //
  // Tarama DOSYANIN TAMAMINDA değil, `raporNotlariGetir`'in GÖVDESİNDE:
  // `AnaEkran` özel notu seans panelinde meşru olarak kullanıyor
  // (`ozelNotApi.getir` / `ozelNotApi.kaydet`), yani dosya düzeyinde bir
  // "geçmiyor" iddiası yazılamaz. Korumanın konacağı yer, ihlalin
  // gerçekleşebileceği kavşaktır — raporun not kaynağını seçen fonksiyon.
  describe('rapor not kaynağı: `raporNotlariGetir` gövdesi', () => {
    function fonksiyonGovdesi(kaynak: string, imza: string): string {
      const bas = kaynak.indexOf(imza)
      expect(bas, `imza kaynakta bulunamadı: ${imza}`).toBeGreaterThan(-1)
      const acilis = kaynak.indexOf('{', bas)
      let derinlik = 0
      for (let i = acilis; i < kaynak.length; i++) {
        if (kaynak[i] === '{') derinlik += 1
        else if (kaynak[i] === '}') {
          derinlik -= 1
          if (derinlik === 0) return kaynak.slice(acilis + 1, i)
        }
      }
      throw new Error(`gövde kapanmadı: ${imza}`)
    }

    // Yorumlar ayıklanıyor: bir yorum kodun YAPISI hakkındaki iddiayı
    // tatmin edemez (dokuzuncu biçim, `HizliArama.test.tsx` ile aynı gerekçe).
    const govde = fonksiyonGovdesi(anaEkranKaynagi, 'async function raporNotlariGetir')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    it('kaynak ve govde gercekten okundu', () => {
      // Boş bir okuma aşağıdaki iddiayı hiçbir şeyi sınamayan yeşile çevirirdi.
      expect(anaEkranKaynagi).toContain('export function AnaEkran')
      // ARTI YÖN: `AnaEkran` özel notu BAŞKA bir amaçla gerçekten
      // ERİŞEBİLİYOR — yani aşağıdaki iddia "burada ozelNotApi yok" demenin
      // kısayolu değil, gövdeye özgü.
      //
      // Kanca ayrımından önce bu tek satırdı (`anaEkranKaynagi` içinde
      // `ozelNotApi.getir` aranıyordu); özel not yükleme `useSeansNotlari`'ye
      // taşınınca erişim YOLU iki adıma çıktı ve iddia da iki adımı birden
      // pinliyor: ekran kancayı içe aktarıyor VE kanca özel notu çekiyor.
      // (İkinci adım tek başına yeterli değildi: `AnaEkran` kancayı hiç
      // kullanmasaydı özel not bu ekranın erişim alanında olmazdı ve
      // aşağıdaki tarama yine kısayola dönerdi.)
      expect(anaEkranKaynagi).toContain("from './anaEkranKancalari/useSeansNotlari'")
      expect(seansKancasiKaynagi).toContain('ozelNotApi.getir')
      expect(govde).toContain('notApi.danisanNotlari')
      expect(govde).toContain('RAPOR_NOT_SINIRI')
    })

    it('govdede ozel nota giden hicbir yol YOKTUR', () => {
      expect(govde).not.toContain('ozelNotApi')
      expect(govde).not.toContain('ozel-not')
      expect(govde).not.toContain('OzelNot')
      expect(govde).not.toContain('private_notes')
    })

    it('rapor karta YALNIZCA `raporNotlariGetir` uzerinden not verilir', () => {
      // `notlariGetir` prop'u başka bir kaynağa bağlanırsa gövde taraması
      // (ve onun ölçtüğü kavşak) anlamsızlaşır.
      const kod = anaEkranKaynagi
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(kod).toContain('notlariGetir={raporNotlariGetir}')
      expect(kod.match(/notlariGetir=/g)).toHaveLength(1)
    })
  })

  it('Ctrl+K ile acilan aramadan seans secilince O HAFTAYA gidilir ve panel acilir', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })

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
    expect(await screen.findByText(/Ayşe Yılmaz — 14 Eylül 2026, 10:00/)).toBeDefined()
    // Arama kapandı ve not parçası ekranda kalmadı.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.textContent).not.toContain('ARAMA-PARCASI-KANARYA')
  })

  it('aramadan danisan secilince kart acilir', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })

    await aramayiAc()
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Danışan adı veya not içeriği' }),
      'ayse',
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /Ayşe Yılmaz — danışan dosyasını aç/ }),
    )

    await riskNotunuAc()
  })

  it('kart acikken 401 gelirse kart KAPANIR ve icerigi ekranda kalmaz', async () => {
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await riskNotunuAc()

    // Oturum kilitlendi; sonraki her istek 401. Haftayı değiştirmek
    // `yukle`'yi tetikler.
    yetkisiz = true
    await userEvent.click(screen.getByRole('button', { name: /önceki hafta/i }))

    await waitFor(() => expect(document.body.textContent).not.toContain('RISK-NOTU-KANARYA'))
    expect(document.body.textContent).not.toContain('0555 111 22 33')
  })

  it('401 kart YUKLENIRKEN gelirse yarim kart acilmaz', async () => {
    // Yarı dolu bir danışan kartı (rıza alanı boş görünen) "rıza alınmamış"
    // diye okunurdu — dosya aslında dolu olabilir.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })
    yetkisiz = true
    await userEvent.click(cip('Ayşe Yılmaz'))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Risk notunu göster' })).toBeNull(),
    )
    // Kartın HİÇBİR alanı gelmedi: risk notu katlanmış olduğu için tek
    // başına kanaryanın yokluğu bu testte hiçbir şey söylemezdi.
    expect(document.body.textContent).not.toContain('RISK-NOTU-KANARYA')
    expect(document.body.textContent).not.toContain('0555 111 22 33')
    expect(
      screen.queryAllByRole('alert').some((u) => /açık rıza kaydı yok/i.test(u.textContent ?? '')),
    ).toBe(false)
  })

  it('kart acikken aramadan seansa gidilince kart KAPANIR', async () => {
    // Kiplerin kesişimi: kart + arama + seans paneli aynı ekranda.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await riskNotunuAc()

    await aramayiAc()
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Danışan adı veya not içeriği' }),
      'kaygi',
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /14\.09\.2026 10:00 seansına git/ }),
    )

    await screen.findByText(/Ayşe Yılmaz — 14 Eylül 2026, 10:00/)
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
    await screen.findByText(/Ayşe Yılmaz — 14 Eylül 2026, 10:00/)
  })

  it('arama sorgusu HICBIR istek yolunda not iceriğiyle birlikte tasinmaz; yalniz /api/ara', async () => {
    // Sorgu metni sunucuda loga yazılmıyor; arayüz de onu başka bir uç
    // noktaya taşımamalı (ör. "danışanları sorguyla filtrele" gibi bir
    // kolaylık eklenirse sorgu ikinci bir yola daha düşerdi).
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })
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

  async function parolaFormunuAc() {
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
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })

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
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })

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
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })

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
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })

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
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })

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
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })

    await parolaFormunuAc()
    await parolayiDoldur('gizli-parola-123', 'KANARYA-PAROLASI')
    await userEvent.click(gonderDugmesi())
    await waitFor(() => expect(istekYollari).toContain('POST /api/parola'))

    for (const yol of istekYollari) {
      expect(yol).not.toContain('KANARYA-PAROLASI')
      expect(yol).not.toContain('gizli-parola-123')
    }
  })

  it('form kapaninca girilen parolalar STATE ten silinir', async () => {
    // Gizlenmiş ama duran bir parola alanı, katman bir sonraki açılışta
    // dolu gelirdi (`HizliArama`nın "kapanınca sonuçlar silinir"
    // kararıyla aynı ilke).
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })

    const bolum = await parolaFormunuAc()
    await parolayiDoldur('gizli-parola-123', 'yepyeni-parola')
    expect((screen.getByLabelText('Mevcut parolanız') as HTMLInputElement).value).toBe(
      'gizli-parola-123',
    )

    await userEvent.click(within(bolum).getByRole('button', { name: 'Vazgeç' }))
    await userEvent.click(within(bolum).getByRole('button', { name: 'Parolayı değiştir' }))

    expect((screen.getByLabelText('Mevcut parolanız') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Yeni parola') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Yeni parola (tekrar)') as HTMLInputElement).value).toBe('')
  })

  it('parola alanlari `type=password`', async () => {
    // Ekran görünürken danışan odada olabilir (`HizliArama`nın kendi
    // gerekçesiyle aynı sınıf); parola düz metin olarak görünmemeli.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })
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
    await screen.findByRole('heading', { name: 'Zeynep Kaya' })
  })

  it('EKSI YON: suresi dolan dosya yoksa hatirlatma HIC gorunmez', async () => {
    // Bu olmadan "her zaman bir bant bas" mutasyonu üstteki testi geçerdi.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })
    expect(screen.queryByRole('region', { name: 'Saklama süresi dolan dosyalar' })).toBeNull()
  })

  it('saklama listesi hafta degisiminde YENIDEN sorulmaz (silinemez log satiri)', async () => {
    // `clients::saklama_suresi_dolanlar` her çağrıda `LogHacmi::HerCagri`
    // ile SİLİNEMEZ bir `goruntuleme` satırı yazıyor. Liste gün içinde
    // değişmez; her hafta okunda yeniden sormak, hiçbir kazanç sağlamadan
    // kalıcı satır biriktirmek olurdu (`durumDegis`/`sil` ile aynı karar).
    sunucuSaklamaDolanlar = [{ id: 3, ad_soyad: 'Zeynep Kaya', telefon: null, durum: 'aktif' }]
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await screen.findByRole('region', { name: 'Saklama süresi dolan dosyalar' })

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    await waitFor(() =>
      expect(istekYollari.some((y) => y.includes('baslangic=2026-09-14'))).toBe(true),
    )

    expect(istekYollari.filter((y) => y.includes('/api/saklama-suresi-dolanlar'))).toHaveLength(1)
  })

  it('depolama esigi asilinca uyari gorunur; asilmayinca GORUNMEZ', async () => {
    // Plan global kısıtındaki 500 MB eşiği HTTP'de vardı, üründe yoktu:
    // ekler 20 MB'a kadar BLOB tutuyor ve terapist veritabanı şişerken
    // hiçbir uyarı almıyordu.
    sunucuDepolama = { toplam_boyut: 600 * 1024 * 1024, esik: 500 * 1024 * 1024, uyari: true }
    const { unmount } = render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)

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
    await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' })
    expect(screen.queryByText(/uyarı eşiğini aştı/i)).toBeNull()
  })

  it('ek silme DELETE atar ve kart YENIDEN cekilir', async () => {
    // Uç nokta Görev 7'de yazılmıştı ama çağrı yeri yoktu: yanlış danışana
    // yüklenen bir onam PDF'i silinemiyordu.
    render(<AnaEkran kilitle={vi.fn()} onGeriYukle={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
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

    // KALICI: baska bir etkilesim onu temizlemiyor.
    await userEvent.click(screen.getByRole('button', { name: 'Danışan ekle' }))
    expect(screen.getByRole('alert').textContent).toContain('Salt okunur bir disk olabilir.')
  })

  it('klasor secilmemisse uyari cikar; klasor secilince yedek HEMEN alinir', async () => {
    yedekListeHatasi = 'Yedek klasörü belli değil. Yedeklerinizin bulunduğu klasörün yolunu yazın.'
    sunucuYedekleri = []
    await ekraniAc()

    expect((await screen.findByRole('alert')).textContent).toMatch(/klasörü belli değil/i)
    // Klasor secilmeden hicbir yedek DENENMEZ: sunucu zaten reddederdi ve
    // her deneme bos yere bir istek olurdu.
    expect(yedekIstekleri).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Yedek klasörünü değiştir' }))
    await userEvent.type(
      screen.getByLabelText(/yedeklerin yazılacağı klasörün yolu/i),
      '/Volumes/USB/yedek',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve yedek al' }))

    // Klasoru secmek ile ilk yedegi almak TEK islem: ayri bir "ayarla"
    // adimi olsaydi kullanici "yedegim var" sanip yedeksiz kalirdi.
    await waitFor(() => expect(yedekIstekleri.length).toBe(1))
    expect(yedekIstekleri[0]).toEqual({ damga: BUGUN, hedef_dizin: '/Volumes/USB/yedek' })

    // Uyari kalkiyor ve yeni klasor ekranda.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('region', { name: 'Yedekleme' }).textContent).toContain(
      '/Volumes/USB/yedek',
    )
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
