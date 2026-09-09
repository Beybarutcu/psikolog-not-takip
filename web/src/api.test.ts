import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notApi, ozelNotApi, YetkisizHata, yetkisizOlunca } from './api'

type Cagri = { yol: string; method: string; govde: unknown }

let cagrilar: Cagri[] = []
const gercekFetch = globalThis.fetch

function sunucu(yanit: (yol: string) => { ok: boolean; status?: number; govde: unknown }) {
  globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
    const yol = typeof girdi === 'string' ? girdi : girdi.toString()
    cagrilar.push({
      yol,
      method: secenekler?.method ?? 'GET',
      govde: secenekler?.body ? JSON.parse(String(secenekler.body)) : null,
    })
    const y = yanit(yol)
    return { ok: y.ok, status: y.status ?? (y.ok ? 200 : 500), json: async () => y.govde } as
      unknown as Response
  }) as unknown as typeof fetch
}

beforeEach(() => {
  cagrilar = []
  sunucu(() => ({ ok: true, govde: {} }))
})

afterEach(() => {
  globalThis.fetch = gercekFetch
  vi.restoreAllMocks()
})

describe('notApi — resmî seans notu', () => {
  it('notGetir tam olarak /api/randevular/{id}/not adresine gider', async () => {
    await notApi.notGetir(7)
    expect(cagrilar).toEqual([{ yol: '/api/randevular/7/not', method: 'GET', govde: null }])
  })

  it('notKaydet PUT ile {sablon, icerik} gönderir', async () => {
    await notApi.notKaydet(7, 'soap', 'metin')
    expect(cagrilar).toHaveLength(1)
    expect(cagrilar[0].yol).toBe('/api/randevular/7/not')
    expect(cagrilar[0].method).toBe('PUT')
    expect(cagrilar[0].govde).toEqual({ sablon: 'soap', icerik: 'metin' })
  })

  it('danisanNotlari verilen limiti sorguya koyar', async () => {
    await notApi.danisanNotlari(3, 4)
    expect(cagrilar[0].yol).toBe('/api/danisanlar/3/notlar?limit=4')
    expect(cagrilar[0].method).toBe('GET')
  })
})

describe('ozelNotApi — özel not', () => {
  it('getir tam olarak /api/randevular/{id}/ozel-not adresine gider', async () => {
    await ozelNotApi.getir(7)
    expect(cagrilar).toEqual([{ yol: '/api/randevular/7/ozel-not', method: 'GET', govde: null }])
  })

  it('kaydet PUT ile YALNIZCA {icerik} gönderir, sablon göndermez', async () => {
    await ozelNotApi.kaydet(7, 'gizli')
    expect(cagrilar[0].yol).toBe('/api/randevular/7/ozel-not')
    expect(cagrilar[0].method).toBe('PUT')
    // Tam eşitlik: fazladan bir `sablon` alanı sunucuda sessizce yok sayılır
    // ve arayüzde "özel notun da şablonu var" yanılsaması yaratırdı.
    expect(cagrilar[0].govde).toEqual({ icerik: 'gizli' })
  })
})

// Sunucudaki ayrımın (`routes::notes` / `routes::private_notes`, ayrı yol
// önekleri) istemci karşılığı. Sızıntının istemci biçimi: ileride bir dışa
// aktarım ekranı "notları getiren istemciyi" arar, `notApi`'yi bulur ve
// olduğu gibi kullanır.
describe('resmî not istemcisi özel nota YAPISAL olarak erişemez', () => {
  it('notApi\'nin hiçbir fonksiyonu ozel-not yoluna gitmez', async () => {
    await notApi.notGetir(7)
    await notApi.notKaydet(7, 'dap', 'metin')
    await notApi.danisanNotlari(3, 4)

    expect(cagrilar).toHaveLength(3)
    for (const c of cagrilar) {
      expect(c.yol).not.toContain('ozel')
    }
  })

  it('ARTI YÖN: özel nota giden tek yol ozelNotApi ve o gerçekten ozel-not yoluna gider', async () => {
    // Bu yarı olmadan "hiçbir yere gitmeyen" bir istemci de üstteki testi
    // geçerdi (tek yönlü mutasyon kapsamı).
    await ozelNotApi.getir(7)
    await ozelNotApi.kaydet(7, 'gizli')

    expect(cagrilar).toHaveLength(2)
    for (const c of cagrilar) {
      expect(c.yol).toBe('/api/randevular/7/ozel-not')
    }
  })

  it('notApi ile ozelNotApi ayrı nesnelerdir; birinde diğerinin fonksiyonu yoktur', () => {
    // Tek bir nesnede toplanırlarsa yukarıdaki yapısal ayrım kaybolur:
    // "notları getiren istemci"yi bulan geliştirici özel notu da bulur.
    const resmiAnahtarlar = Object.keys(notApi)
    expect(resmiAnahtarlar).toEqual(['notGetir', 'notKaydet', 'danisanNotlari'])
    expect(Object.keys(ozelNotApi)).toEqual(['getir', 'kaydet'])
  })
})

// `istek()`'in 401 mekanizması not uç noktalarında da geçerli olmalı:
// dinleyiciler throw'dan ÖNCE senkron tetiklenir (App.tsx buna dayanarak
// AnaEkran'ı gerçekten unmount eder).
describe('not uç noktalarında 401', () => {
  it('dinleyici throw\'dan ÖNCE senkron tetiklenir ve YetkisizHata atılır', async () => {
    sunucu(() => ({ ok: false, status: 401, govde: { hata: 'Oturum zaman aşımına uğradı.' } }))
    const sira: string[] = []
    const birak = yetkisizOlunca(() => sira.push('dinleyici'))

    await expect(
      notApi.notKaydet(7, 'dap', 'metin').catch((e) => {
        sira.push('throw')
        throw e
      }),
    ).rejects.toBeInstanceOf(YetkisizHata)

    expect(sira).toEqual(['dinleyici', 'throw'])
    birak()
  })

  it('özel not kaydında da aynı mekanizma çalışır', async () => {
    sunucu(() => ({ ok: false, status: 401, govde: { hata: 'Oturum zaman aşımına uğradı.' } }))
    const dinleyici = vi.fn()
    const birak = yetkisizOlunca(dinleyici)

    await expect(ozelNotApi.kaydet(7, 'gizli')).rejects.toBeInstanceOf(YetkisizHata)
    expect(dinleyici).toHaveBeenCalledTimes(1)
    birak()
  })
})
