import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  api,
  AZAMI_EK_BOYUTU,
  aramaApi,
  ARAMA_SINIRI,
  danisanApi,
  ekIndir,
  ekIndirmeYolu,
  notApi,
  ozelNotApi,
  veritabaniBozukOlunca,
  VeritabaniBozukHata,
  yedekApi,
  YetkisizHata,
  yetkisizOlunca,
} from './api'

type Cagri = { yol: string; method: string; govde: unknown }

let cagrilar: Cagri[] = []
// Başlıklar AYRI bir dizide: `cagrilar` üzerinde tam nesne eşitliği
// (`toEqual`) kuran testler var ve oraya bir alan eklemek onları
// ilgisiz biçimde kırardı.
let basliklar: (HeadersInit | undefined)[] = []
const gercekFetch = globalThis.fetch

function sunucu(yanit: (yol: string) => { ok: boolean; status?: number; govde: unknown }) {
  globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
    const yol = typeof girdi === 'string' ? girdi : girdi.toString()
    cagrilar.push({
      yol,
      method: secenekler?.method ?? 'GET',
      // Gövde her zaman JSON DEĞİL: ek dosya yükleme ham `File` gönderiyor
      // (bkz. `danisanApi.ekYukle`). `JSON.parse` orada patlardı ve testin
      // gövdeyi hiç göremediği bir hataya dönerdi.
      govde:
        typeof secenekler?.body === 'string'
          ? JSON.parse(secenekler.body)
          : (secenekler?.body ?? null),
    })
    basliklar.push(secenekler?.headers)
    const y = yanit(yol)
    return { ok: y.ok, status: y.status ?? (y.ok ? 200 : 500), json: async () => y.govde } as
      unknown as Response
  }) as unknown as typeof fetch
}

beforeEach(() => {
  cagrilar = []
  basliklar = []
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

  it('danisanNotlari `once` verilince kesmeyi sorguya koyar, verilmeyince KOYMAZ', async () => {
    // `once` opsiyonel ve varsayılanı YOK: veri raporu (KVKK md. 11) tüm
    // notları istiyor, "önceki seans notları" paneli ise kesmeyi geçmek
    // zorunda (bkz. `store::notes::danisan_notlari` belgesi).
    await notApi.danisanNotlari(3, 4, '2026-09-07T10:00')
    expect(cagrilar[0].yol).toBe('/api/danisanlar/3/notlar?limit=4&once=2026-09-07T10%3A00')

    await notApi.danisanNotlari(3, 200)
    expect(cagrilar[1].yol).toBe('/api/danisanlar/3/notlar?limit=200')
    expect(cagrilar[1].yol).not.toContain('once')
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

// --- Görev 10: danışan dosyası, ekler ve arama ---------------------------

describe('danisanApi — danışan dosyası ve ekler', () => {
  it('dosyaGetir tek danışanın dosyasına gider', async () => {
    await danisanApi.dosyaGetir(12)
    expect(cagrilar).toEqual([{ yol: '/api/danisanlar/12', method: 'GET', govde: null }])
  })

  it('rizaKaydet PATCH ile YALNIZCA rıza alanlarını gönderir', async () => {
    // `DanisanGuncelleme`'de `son_temas`, `saklama_bitis` ve `durum` BİLEREK
    // yok (bkz. `store::clients`); istemci de onları göndermemeli. Fazladan
    // alan sunucuda sessizce yok sayılır ve "arayüz saklama tarihini
    // yazabiliyor" yanılsaması yaratırdı.
    await danisanApi.rizaKaydet(12, { riza_tarihi: '2026-03-01', riza_dosya_id: 5 })
    expect(cagrilar[0].yol).toBe('/api/danisanlar/12')
    expect(cagrilar[0].method).toBe('PATCH')
    expect(cagrilar[0].govde).toEqual({ riza_tarihi: '2026-03-01', riza_dosya_id: 5 })
  })

  it('rizaKaydet bağı koparmak için açık null gönderir', async () => {
    // Sunucu "alan yok" ile "alan null"u AYIRT EDİYOR (`acik_null_ayirt_et`):
    // alanı hiç göndermemek "dokunma" demek olurdu ve yanlış dosya seçen
    // kullanıcı bağı KOPARAMAZDI.
    await danisanApi.rizaKaydet(12, { riza_tarihi: '2026-03-01', riza_dosya_id: null })
    expect(cagrilar[0].govde).toEqual({ riza_tarihi: '2026-03-01', riza_dosya_id: null })
    expect(JSON.stringify(cagrilar[0].govde)).toContain('null')
  })

  it('ekleriGetir danışanın ek listesine gider', async () => {
    await danisanApi.ekleriGetir(12)
    expect(cagrilar).toEqual([{ yol: '/api/danisanlar/12/ekler', method: 'GET', govde: null }])
  })

  // Görev 7 sözleşmesi: üstveri BAŞLIKLARDA, içerik HAM GÖVDEDE.
  // `multipart/form-data` 20 MB'lık GEÇERLİ bir dosyayı 20 MB'ı aşan bir
  // gövdeye çevirir (sınır `AZAMI_GOVDE_BOYUTU == AZAMI_DOSYA_BOYUTU`);
  // sorgu dizgisi reddedildi çünkü dosya adı sağlık verisidir.
  it('ekYukle ham gövde + başlık sözleşmesini kullanır, multipart DEĞİL', async () => {
    const dosya = new File(['icerik'], 'onam.pdf', { type: 'application/pdf' })
    await danisanApi.ekYukle(12, dosya, 'onam')

    expect(cagrilar[0].yol).toBe('/api/danisanlar/12/ekler')
    expect(cagrilar[0].method).toBe('POST')
    // Gövde dosyanın KENDİSİ — `FormData` değil.
    expect(cagrilar[0].govde).toBe(dosya)
    expect(cagrilar[0].govde).not.toBeInstanceOf(FormData)

    const b = basliklar[0] as Record<string, string>
    expect(b['content-type']).toBe('application/pdf')
    expect(b['x-dosya-adi']).toBe('onam.pdf')
    expect(b['x-ek-turu']).toBe('onam')
  })

  it('ekYukle Türkçe dosya adını yüzde kodlar (HTTP başlıkları ASCII)', async () => {
    const dosya = new File(['x'], 'değerlendirme.pdf', { type: 'application/pdf' })
    await danisanApi.ekYukle(12, dosya, 'test')
    const b = basliklar[0] as Record<string, string>
    expect(b['x-dosya-adi']).toBe(encodeURIComponent('değerlendirme.pdf'))
    // Ham ad başlığa KONMAZ: `HeaderValue::from_str` ASCII dışını reddeder,
    // istek sessizce başarısız olurdu.
    expect(b['x-dosya-adi']).not.toContain('ğ')
  })

  it('ekYukle boş MIME değerinde güvenli türe düşer', async () => {
    // Tarayıcı bazı dosyalar için `type`i boş verir; boş bir `content-type`
    // başlığı sunucuda "başlık eksik" hatasına dönerdi.
    const dosya = new File(['x'], 'a.bin', { type: '' })
    await danisanApi.ekYukle(12, dosya, 'diger')
    expect((basliklar[0] as Record<string, string>)['content-type']).toBe(
      'application/octet-stream',
    )
  })

  it('ekYukle sınırı aşan dosyayı SUNUCUYA HİÇ GÖNDERMEZ', async () => {
    // Sunucu 413 döner ama gövdesi JSON değildir; `istek()` orada
    // "Beklenmeyen bir hata oluştu." gösterirdi — kullanıcı 20 MB'ı
    // yükledikten sonra neden reddedildiğini öğrenemezdi.
    const buyuk = new File([new Uint8Array(AZAMI_EK_BOYUTU + 1)], 'buyuk.bin', {
      type: 'application/octet-stream',
    })
    await expect(danisanApi.ekYukle(12, buyuk, 'diger')).rejects.toThrow(/20 MB/)
    expect(cagrilar).toHaveLength(0)
  })

  it('ekYukle hata mesajına dosya adını KOYMAZ', async () => {
    // Dosya adı sağlık verisidir (sunucu da aynı kararı veriyor: ham değer
    // hiçbir hata mesajına konmaz). Hata metni ekranın dışına düşebilir.
    const buyuk = new File([new Uint8Array(AZAMI_EK_BOYUTU + 1)], 'HIV-raporu.pdf', {
      type: 'application/pdf',
    })
    await expect(danisanApi.ekYukle(12, buyuk, 'diger')).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('HIV') }),
    )
  })

  it('tam sınırdaki dosya REDDEDİLMEZ', async () => {
    // Ters yön: "her dosyayı reddet" de üstteki testleri geçerdi.
    const tam = new File([new Uint8Array(AZAMI_EK_BOYUTU)], 'tam.bin', {
      type: 'application/octet-stream',
    })
    await danisanApi.ekYukle(12, tam, 'diger')
    expect(cagrilar).toHaveLength(1)
  })

  it('AZAMI_EK_BOYUTU sunucudaki 20 MB sınırıyla aynıdır', () => {
    // İki sabit iki ayrı dilde; ayrışmaları sessiz olurdu.
    expect(AZAMI_EK_BOYUTU).toBe(20 * 1024 * 1024)
  })

  it('ekIndirmeYolu tam olarak /api/ekler/{id} üretir', () => {
    // Bağlantının `href`'i bu adres olarak DURUYOR (bağlam menüsü gerçek
    // bir kaynak görsün); tıklama `ekIndir`'den geçiyor (bkz. I3).
    expect(ekIndirmeYolu(9)).toBe('/api/ekler/9')
  })
})

// --- Dal incelemesi I3: ek indirme DÜZ GEZİNME yapmaz ------------------
//
// Bağlantı düz bir `<a href>` idi. Başarı yolunda sunucunun
// `Content-Disposition: attachment` başlığı gezinmeyi engelliyordu; 401
// yolunda o başlık YOK, dolayısıyla tarayıcı ham JSON'a GEZİNİYOR, SPA
// belgesi değişiyor, React ağacı ve (aynı JS bağlamındaki) taslak deposu
// yok oluyordu.
describe('ekIndir — kilitli oturumda SPA yıkılmaz', () => {
  const gercekOlustur = URL.createObjectURL
  const gercekSerbest = URL.revokeObjectURL
  let uretilenBloblar: Blob[]

  beforeEach(() => {
    uretilenBloblar = []
    URL.createObjectURL = vi.fn((b: Blob) => {
      uretilenBloblar.push(b)
      return `blob:ek-${uretilenBloblar.length}`
    }) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    URL.createObjectURL = gercekOlustur
    URL.revokeObjectURL = gercekSerbest
  })

  function ikiliSunucu(yanit: { ok: boolean; status?: number; govde?: unknown; bayt?: string }) {
    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, s?: RequestInit) => {
      cagrilar.push({ yol: String(girdi), method: s?.method ?? 'GET', govde: null })
      return {
        ok: yanit.ok,
        status: yanit.status ?? (yanit.ok ? 200 : 500),
        json: async () => yanit.govde ?? {},
        blob: async () => new Blob([yanit.bayt ?? '']),
      } as unknown as Response
    }) as unknown as typeof fetch
  }

  it('ARTI YON: basarili indirme GET /api/ekler/{id} yapar ve dosya adini verir', async () => {
    ikiliSunucu({ ok: true, bayt: 'PDF-BAYTLARI' })

    await ekIndir({ id: 9, dosya_adi: 'onam.pdf' })

    expect(cagrilar).toEqual([{ yol: '/api/ekler/9', method: 'GET', govde: null }])
    expect(uretilenBloblar).toHaveLength(1)
    expect(await uretilenBloblar[0].text()).toBe('PDF-BAYTLARI')
  })

  it('401de dinleyiciyi throwdan ONCE tetikler ve YetkisizHata firlatir', async () => {
    // Kilit mekanizmasının TAM OLARAK diğer 25 uçla aynı olması gereken
    // yer burası: `App` kilit ekranına dönmeyi bu dinleyiciden öğreniyor.
    ikiliSunucu({ ok: false, status: 401, govde: { hata: 'Oturum kilitli.' } })
    const sira: string[] = []
    const birak = yetkisizOlunca(() => sira.push('dinleyici'))

    await expect(
      ekIndir({ id: 9, dosya_adi: 'onam.pdf' }).catch((e) => {
        sira.push('throw')
        throw e
      }),
    ).rejects.toBeInstanceOf(YetkisizHata)

    expect(sira).toEqual(['dinleyici', 'throw'])
    birak()
  })

  it('401de HICBIR blob uretilmez', async () => {
    // Gezinme yerine hata: 401 gövdesi (JSON) diske ya da ekrana bir dosya
    // olarak DA gitmemeli.
    ikiliSunucu({ ok: false, status: 401, govde: { hata: 'Oturum kilitli.' } })
    await expect(ekIndir({ id: 9, dosya_adi: 'onam.pdf' })).rejects.toThrow('Oturum kilitli.')
    expect(uretilenBloblar).toHaveLength(0)
  })

  it('404te de firlatir, gezinmez', async () => {
    ikiliSunucu({ ok: false, status: 404, govde: { hata: 'Kayıt bulunamadı.' } })
    await expect(ekIndir({ id: 9, dosya_adi: 'onam.pdf' })).rejects.toThrow('Kayıt bulunamadı.')
    expect(uretilenBloblar).toHaveLength(0)
  })
})

describe('api.parolaDegistir — parola değiştirme', () => {
  it('POST ile /api/parola adresine iki parolayi da GOVDEDE gonderir', async () => {
    await api.parolaDegistir('eski-parola', 'yeni-parola')
    expect(cagrilar).toEqual([
      {
        yol: '/api/parola',
        method: 'POST',
        govde: { mevcut_parola: 'eski-parola', yeni_parola: 'yeni-parola' },
      },
    ])
  })

  it('parola URL de tasinmaz', async () => {
    // URL'ler tarayici gecmisine ve genel amacli erisim gunluklerine duser;
    // govdeler dusmez (`ekYukle`nin dosya adi ve `yedekApi.listele`nin
    // klasor yolu kararlariyla ayni sinif). Bir gun birileri "kolaylik
    // olsun" diye sorgu dizesine tasirsa bu test kirilir.
    await api.parolaDegistir('KANARYA-ESKI', 'KANARYA-YENI')
    expect(cagrilar[0].yol).toBe('/api/parola')
    expect(cagrilar[0].yol).not.toContain('KANARYA')
  })

  it('mevcut parola ZORUNLU olarak gonderilir', async () => {
    // Yalnizca yeni parola gonderen bir istemci, sunucunun dogrulamasini
    // fiilen atlatamaz (sunucu 401 doner) ama arayuz "parolam degisti"
    // sanabilirdi. Alanin gonderildigi burada sabitleniyor.
    await api.parolaDegistir('mevcut', 'yenisi-uzun')
    const govde = cagrilar[0].govde as Record<string, unknown>
    expect(govde.mevcut_parola).toBe('mevcut')
  })

  it('401de YetkisizHata firlatir (merkezi mekanizmadan gecer)', async () => {
    sunucu(() => ({ ok: false, status: 401, govde: { hata: 'Mevcut parolanız hatalı.' } }))
    await expect(api.parolaDegistir('yanlis', 'yenisi-uzun')).rejects.toThrow(
      'Mevcut parolanız hatalı.',
    )
  })

  it('400te sunucunun mesaji OLDUGU GIBI firlatilir', async () => {
    // "Her hata parola hatasidir" tuzagi: kisa parola ile yanlis parola ayri
    // sorunlar ve kullanici hangisini duzeltecegini bilmeli.
    sunucu(() => ({
      ok: false,
      status: 400,
      govde: { hata: 'Yeni parola en az 8 karakter olmalı. Parolanız değişmedi.' },
    }))
    await expect(api.parolaDegistir('dogru', 'kisa')).rejects.toThrow(
      'Yeni parola en az 8 karakter olmalı. Parolanız değişmedi.',
    )
  })
})

describe('aramaApi — hızlı arama', () => {
  it('sorguyu kodlar ve limiti sunucunun üst sınırına sabitler', async () => {
    await aramaApi.ara('kaygı & panik')
    expect(cagrilar[0].method).toBe('GET')
    expect(cagrilar[0].yol).toBe(
      `/api/ara?q=${encodeURIComponent('kaygı & panik')}&limit=${ARAMA_SINIRI}`,
    )
  })

  it('ARAMA_SINIRI sunucunun AZAMI_SONUC degeriyle aynıdır', () => {
    // Sunucu `limit`i `1..=50` aralığına kırpıyor. İstemci daha büyük bir
    // sayı gönderirse sessizce 50'ye düşer ve "sonuç sayısı == sınır"
    // uyarısı (sonuçlar kırpıldı) HİÇ tetiklenmezdi.
    expect(ARAMA_SINIRI).toBe(50)
  })

  it('arama istemcisinde özel nota giden hiçbir yol yoktur', () => {
    // Sunucudaki `store::search` `private_notes`u hiç tanımıyor; istemcide
    // de aramaya ikinci bir kaynak eklenemesin diye nesne tek fonksiyonlu.
    expect(Object.keys(aramaApi)).toEqual(['ara'])
  })
})

describe('danışan dosyası uç noktalarında 401', () => {
  it('dosyaGetir 401de dinleyiciyi throwdan ÖNCE tetikler', async () => {
    sunucu(() => ({ ok: false, status: 401, govde: { hata: 'Oturum kilitli.' } }))
    const sira: string[] = []
    const birak = yetkisizOlunca(() => sira.push('dinleyici'))

    await expect(
      danisanApi.dosyaGetir(12).catch((e) => {
        sira.push('throw')
        throw e
      }),
    ).rejects.toBeInstanceOf(YetkisizHata)

    expect(sira).toEqual(['dinleyici', 'throw'])
    birak()
  })

  it('arama 401de de aynı mekanizmayı çalıştırır', async () => {
    sunucu(() => ({ ok: false, status: 401, govde: { hata: 'Oturum kilitli.' } }))
    const dinleyici = vi.fn()
    const birak = yetkisizOlunca(dinleyici)
    await expect(aramaApi.ara('kaygi')).rejects.toBeInstanceOf(YetkisizHata)
    expect(dinleyici).toHaveBeenCalledTimes(1)
    birak()
  })

  it('danisanApi tam olarak dosya uc noktalarini tasir, ozel nota giden yol YOKTUR', () => {
    // `notApi` / `ozelNotApi` / `aramaApi` için bu sabitleme vardı;
    // `danisanApi` için yoktu ve o, danışan kartını (dolayısıyla veri
    // raporunu) besleyen nesnedir. Buraya eklenecek bir `ozelNotlar`
    // fonksiyonu, kartın "özel nota giden bir yolu yok" güvencesini tek
    // hamlede bozardı — aynı sınıf (C1).
    expect(Object.keys(danisanApi)).toEqual([
      'dosyaGetir',
      'rizaKaydet',
      'ekleriGetir',
      // Dal incelemesi C1: disa aktarimin denetim kaydi. Veri GETIRMEZ --
      // govdesi bos bir POST'tur ve yaniti kullanilmaz; nesnenin gizlilik
      // sozunu genisletmez.
      'raporKaydiOlustur',
      'ekYukle',
      // Dal incelemesi (HTTP -> arayuz taramasi): ucu de yalnizca dosya/ek
      // ustverisine ve bir SAYIYA dokunuyor; not icerigine giden yeni bir
      // yol acmiyorlar.
      'ekSil',
      'saklamaSuresiDolanlar',
      'depolamaDurumu',
    ])
  })

  it('raporKaydiOlustur tam olarak POST /api/danisanlar/{id}/rapor-kaydi eder', async () => {
    // Yol duz literal ve govde BOS: rapor icerigi (ad, not metni, dosya
    // adlari) sunucuya ve loga ASLA gitmez.
    await danisanApi.raporKaydiOlustur(7)
    expect(cagrilar).toEqual([
      { yol: '/api/danisanlar/7/rapor-kaydi', method: 'POST', govde: null },
    ])
  })

  it('raporKaydiOlustur 401de YetkisizHata firlatir (fail-closed dayanagi)', async () => {
    // Kart bu firlatmaya guveniyor: sessizce basarili donseydi kilitli
    // oturumda KAYITSIZ bir rapor uretilebilirdi.
    sunucu(() => ({ ok: false, status: 401, govde: { hata: 'Oturum kilitli.' } }))
    await expect(danisanApi.raporKaydiOlustur(7)).rejects.toBeInstanceOf(YetkisizHata)
  })

  it('raporKaydiOlustur 404te de firlatir', async () => {
    // 401 disindaki redler de fail-closed olmali: 404/500 alinip yine de
    // rapor uretilirse kayitsiz bir kopya olusur.
    sunucu(() => ({ ok: false, status: 404, govde: { hata: 'Kayıt bulunamadı.' } }))
    await expect(danisanApi.raporKaydiOlustur(7)).rejects.toThrow('Kayıt bulunamadı.')
  })
})

// =====================================================================
// YEDEKLEME ISTEMCISI
// =====================================================================

describe('yedekApi — yedek alma, listeleme, geri yükleme', () => {
  it('yedek alma damgayı ve (verilmişse) klasörü gövdede gönderir', async () => {
    await yedekApi.al('2026-09-09', '/Volumes/USB/yedek')
    expect(cagrilar).toEqual([
      {
        yol: '/api/yedek',
        method: 'POST',
        govde: { damga: '2026-09-09', hedef_dizin: '/Volumes/USB/yedek' },
      },
    ])
  })

  it('klasör verilmezse gövdede hedef_dizin YOKTUR (kayıtlı ayar kullanılır)', async () => {
    await yedekApi.al('2026-09-09')
    expect(cagrilar[0].govde).toEqual({ damga: '2026-09-09' })
  })

  it('klasör yolu SORGU DİZESİNDE değil, gövdede gider', async () => {
    // Yol kullanıcının adını içerebilir (`/Users/ayse/Dropbox/...`) ve
    // URL'ler tarayıcı geçmişine ve genel amaçlı erişim günlüklerine düşer
    // (`ekYukle`'nin dosya adı kararıyla aynı sınıf).
    await yedekApi.listele('/Users/ayse/Dropbox/yedek')
    expect(cagrilar[0].yol).toBe('/api/yedekler')
    expect(cagrilar[0].yol).not.toContain('ayse')
    expect(cagrilar[0].govde).toEqual({ dizin: '/Users/ayse/Dropbox/yedek' })
    expect(cagrilar[0].method).toBe('POST')
  })

  it('geri yükleme yol değil DOSYA ADI gönderir', async () => {
    await yedekApi.geriYukle({ dosya_adi: 'yedek-2026-09-08.db', parola: 'gizli' })
    expect(cagrilar).toEqual([
      {
        yol: '/api/geri-yukleme',
        method: 'POST',
        govde: { dosya_adi: 'yedek-2026-09-08.db', parola: 'gizli' },
      },
    ])
  })
})

// =====================================================================
// "VERITABANI BOZUK" MEKANIZMASI -- 401'in birebir esi
// =====================================================================

describe('veritabani_bozuk yanıtı', () => {
  it('dinleyici throw edilmeden ÖNCE senkron tetiklenir ve VeritabaniBozukHata atılır', async () => {
    sunucu(() => ({
      ok: false,
      status: 500,
      govde: { hata: 'Kayıt dosyanız açıldı ama içeriği bozuk.', veritabani_bozuk: true },
    }))
    const sira: string[] = []
    const birak = veritabaniBozukOlunca(() => sira.push('dinleyici'))

    await expect(
      notApi.notGetir(7).catch((e) => {
        sira.push('throw')
        throw e
      }),
    ).rejects.toBeInstanceOf(VeritabaniBozukHata)

    expect(sira).toEqual(['dinleyici', 'throw'])
    birak()
  })

  it('bayrak YOKKEN sıradan bir hata atılır ve dinleyici tetiklenmez', async () => {
    // EKSİ YÖN: karar sunucunun AYRI BAYRAĞINA bakıyor, hata METNİNE değil.
    // Metin kullanıcı için yazılmıştır ve yarın değişebilir; ekran seçimini
    // ona bağlamak, metni düzelten birinin geri yükleme ekranını sessizce
    // devre dışı bırakması demekti.
    sunucu(() => ({
      ok: false,
      status: 500,
      govde: { hata: 'Kayıt dosyanız açıldı ama içeriği bozuk.' },
    }))
    const dinleyici = vi.fn()
    const birak = veritabaniBozukOlunca(dinleyici)

    await expect(notApi.notGetir(7)).rejects.not.toBeInstanceOf(VeritabaniBozukHata)
    expect(dinleyici).not.toHaveBeenCalled()
    birak()
  })

  it('401 hâlâ YetkisizHata: iki mekanizma birbirini gölgelemez', async () => {
    sunucu(() => ({
      ok: false,
      status: 401,
      govde: { hata: 'Oturum kilitli.', veritabani_bozuk: true },
    }))
    const bozukDinleyici = vi.fn()
    const birak = veritabaniBozukOlunca(bozukDinleyici)

    // Kilitli oturum HER ZAMAN kilit ekranina gider: 401 once degerlendirilir.
    await expect(notApi.notGetir(7)).rejects.toBeInstanceOf(YetkisizHata)
    expect(bozukDinleyici).not.toHaveBeenCalled()
    birak()
  })
})
