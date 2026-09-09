import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('AnaEkran — panel kimliği (Görev 10 inceleme Bulgu 1)', () => {
  const gercekFetch = globalThis.fetch

  beforeEach(() => {
    // haftaninBasi(new Date()) mount sırasında gerçek saate bağlı olmasın diye
    // yalnızca Date sabitleniyor (App.test.tsx'teki desenle aynı).
    vi.useFakeTimers({ toFake: ['Date'] })
    // 2026-09-09 Çarşamba → hafta başı 2026-09-07 Pazartesi.
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
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
    render(<AnaEkran kilitle={vi.fn()} />)

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
    render(<AnaEkran kilitle={vi.fn()} />)

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
      const method = secenekler?.method ?? 'GET'
      istekler.push({
        yol,
        method,
        govde: secenekler?.body ? JSON.parse(String(secenekler.body)) : null,
      })
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
    render(<AnaEkran kilitle={vi.fn()} />)
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
    render(<AnaEkran kilitle={vi.fn()} />)
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
      const method = secenekler?.method ?? 'GET'
      istekler.push({ yol, method })
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
    render(<AnaEkran kilitle={vi.fn()} />)
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
    render(<AnaEkran kilitle={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })
    expect(takvimGetSayisi()).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(screen.getByRole('button', { name: 'Evet, sil' }))

    expect(
      istekler.filter((i) => i.yol.startsWith('/api/randevular/') && i.method === 'DELETE'),
    ).toHaveLength(1)
    expect(takvimGetSayisi()).toBe(1)
    expect(screen.queryByRole('button', { name: /Ayşe Yılmaz/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Mehmet Demir/ })).toBeDefined()
  })

  it('mount tek bir takvim isteği atar, hafta değişimi tam olarak bir tane daha', async () => {
    render(<AnaEkran kilitle={vi.fn()} />)
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
      const method = secenekler?.method ?? 'GET'
      istekler.push({ yol, method })
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

  it('arşivleme iki adımlıdır: tek tıkla istek gitmez', async () => {
    render(<AnaEkran kilitle={vi.fn()} />)
    await screen.findByText('Ayşe Yılmaz')

    await userEvent.click(screen.getAllByRole('button', { name: 'Arşivle' })[0])

    // Onay ekranda, ama HENÜZ hiçbir yazma isteği gitmedi.
    expect(screen.getByText(/Ayşe Yılmaz arşivlensin mi\?/)).toBeDefined()
    expect(istekler.filter((i) => i.method === 'POST')).toHaveLength(0)
    // Ön koşul olarak danışan hâlâ listede — "işlem öncesi durumla tatmin
    // olan assertion" tuzağına düşmemek için aşağıdaki testte listeden
    // GERÇEKTEN düştüğü ayrıca doğrulanıyor.
    expect(within(danisanListesi()).getByText('Ayşe Yılmaz')).toBeDefined()
  })

  it('onay metni arşivlemenin silme OLMADIĞINI söyler', async () => {
    render(<AnaEkran kilitle={vi.fn()} />)
    await screen.findByText('Ayşe Yılmaz')
    await userEvent.click(screen.getAllByRole('button', { name: 'Arşivle' })[0])

    const metin = screen.getByText(/arşivlensin mi\?/).textContent ?? ''
    // Kullanıcı "sildim, gitti" sanmamalı: metin kayıtların DURDUĞUNU
    // açıkça söylemeli...
    expect(metin).toMatch(/silinmez/)
    expect(metin).toMatch(/notları/)
    // ...ve "hiçbir şey olmadı" da sanmamalı: ne değişiyor, o da yazıyor.
    expect(metin).toMatch(/listeden ve randevu seçiminden kaldırılır/)
  })

  it('onaylanınca arşivlenir, listeden düşer ve ne olduğu yazılır', async () => {
    render(<AnaEkran kilitle={vi.fn()} />)
    await screen.findByText('Ayşe Yılmaz')

    await userEvent.click(screen.getAllByRole('button', { name: 'Arşivle' })[0])
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
    render(<AnaEkran kilitle={vi.fn()} />)
    await screen.findByText('Ayşe Yılmaz')
    const oncekiGet = istekler.filter(
      (i) => i.yol === '/api/danisanlar' && i.method === 'GET',
    ).length
    expect(oncekiGet).toBe(1)

    await userEvent.click(screen.getAllByRole('button', { name: 'Arşivle' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Evet, arşivle' }))

    expect(
      istekler.filter((i) => i.yol === '/api/danisanlar' && i.method === 'GET'),
    ).toHaveLength(1)
  })

  it('Vazgeç hiçbir istek atmaz ve danışanı listede bırakır', async () => {
    render(<AnaEkran kilitle={vi.fn()} />)
    await screen.findByText('Ayşe Yılmaz')

    await userEvent.click(screen.getAllByRole('button', { name: 'Arşivle' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))

    expect(screen.queryByText(/arşivlensin mi\?/)).toBeNull()
    expect(istekler.filter((i) => i.method === 'POST')).toHaveLength(0)
    expect(within(danisanListesi()).getByText('Ayşe Yılmaz')).toBeDefined()
  })

  it('bir danışan için açılan onay başka danışana sızmaz', async () => {
    // Görev 10 inceleme Bulgu 1 ile aynı sınıf: onay state\'i seçime bağlı
    // olmazsa kullanıcı A için onay açıp B\'yi arşivleyebilir.
    render(<AnaEkran kilitle={vi.fn()} />)
    await screen.findByText('Ayşe Yılmaz')

    const dugmeler = screen.getAllByRole('button', { name: 'Arşivle' })
    await userEvent.click(dugmeler[0])
    expect(screen.getByText(/Ayşe Yılmaz arşivlensin mi\?/)).toBeDefined()

    await userEvent.click(screen.getAllByRole('button', { name: 'Arşivle' })[1])
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

    render(<AnaEkran kilitle={vi.fn()} />)
    await screen.findByText('Ayşe Yılmaz')
    await userEvent.click(screen.getAllByRole('button', { name: 'Arşivle' })[0])
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
    render(<AnaEkran kilitle={vi.fn()} />)
    await screen.findByText('Ayşe Yılmaz')

    await userEvent.click(screen.getByRole('button', { name: 'Danışan ekle' }))
    await userEvent.type(screen.getByLabelText('Ad soyad'), 'Zeynep Kaya')
    await userEvent.type(screen.getByLabelText('Telefon'), 'asdfgh')
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }))

    expect(await screen.findByText(/Telefon en az 7 rakam içermeli/)).toBeDefined()
    expect(screen.queryByText('Danışan eklenemedi.')).toBeNull()
  })
})
