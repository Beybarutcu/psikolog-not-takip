import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YetkisizHata, type DanisanSeansi } from '../api'
import type { KartVerisi, useDanisanDosyasi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import type { useDanisanListesi } from '../screens/anaEkranKancalari/useDanisanListesi'
import { useDanisanSeanslari } from '../screens/anaEkranKancalari/useDanisanSeanslari'
import { DanisanlarSekmesi } from './DanisanlarSekmesi'

// `danisanApi.seanslar` test başına değiştirilebilir. `null` iken GERÇEK
// istemci çalışır. Desen `AyOzeti.test.tsx`deki `taklit` ile AYNI.
const taklit = vi.hoisted(() => ({
  seanslar: null as null | ((clientId: number) => Promise<DanisanSeansi[]>),
}))

vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return {
    ...gercek,
    danisanApi: {
      ...gercek.danisanApi,
      seanslar: (clientId: number) => (taklit.seanslar ?? gercek.danisanApi.seanslar)(clientId),
    },
  }
})

afterEach(() => {
  taklit.seanslar = null
})

function sahteKart(seciliDanisanId: number | null): KartVerisi {
  return { id: seciliDanisanId, dosya: null, ekler: [], randevular: [], hata: null }
}

function sahteDosya(seciliDanisanId: number | null): ReturnType<typeof useDanisanDosyasi> {
  return {
    seciliDanisanId,
    kart: sahteKart(seciliDanisanId),
    depolama: null,
    ac: () => {},
    kapat: () => {},
    yenidenDene: () => {},
    rizaKaydet: async () => {},
    ekYukle: async () => {},
    ekSil: async () => {},
    randevuYamala: () => {},
  }
}

function sahteListe(): ReturnType<typeof useDanisanListesi> {
  return {
    danisanlar: [],
    formAcik: false,
    setFormAcik: () => {},
    yeniAdSoyad: '',
    setYeniAdSoyad: () => {},
    yeniTelefon: '',
    setYeniTelefon: () => {},
    hata: null,
    arsivOnayi: null,
    setArsivOnayi: () => {},
    arsivBilgisi: null,
    setArsivBilgisi: () => {},
    arsivSuruyor: false,
    saklamaDolanlar: [],
    ekle: async () => {},
    arsivle: async () => {},
  }
}

function seansSayisi(): string | null {
  return screen.getByTestId('danisan-dosyasi-sag-kolon').getAttribute('data-seans-sayisi')
}

/**
 * Gerçek kullanım şeklinin (`AnaEkran`, Görev 8'de) KÜÇÜLTÜLMÜŞ hâli:
 * `useDanisanSeanslari`i BURADA çağırır ve sonucunu `DanisanlarSekmesi`ye
 * prop olarak geçirir — tıpkı `liste`/`dosya`nın da kendi kancalarından
 * geldiği gibi. `seanslar` verisinin kendisi bu görevde ekrana BASILMIYOR
 * (bkz. `DanisanlarSekmesi.tsx` modül başlığı); bu yüzden akışın
 * gözlemlenebilir kanıtı `data-seans-sayisi` — sağ kolonun her render'da
 * `useDanisanSeanslari`nin ürettiği listenin UZUNLUĞUNU taşıyan bir prob.
 */
function Kapsayici({
  seciliDanisanId,
  onYetkisiz = () => {},
}: {
  seciliDanisanId: number | null
  /** Varsayılan no-op: yalnızca 401 testi gerçek bir `vi.fn()` geçirir. */
  onYetkisiz?: () => void
}) {
  const { seanslar } = useDanisanSeanslari({ clientId: seciliDanisanId, onYetkisiz })
  return (
    <DanisanlarSekmesi
      liste={sahteListe()}
      dosya={sahteDosya(seciliDanisanId)}
      seanslar={seanslar}
      onDanisanSec={() => {}}
      veriRaporuIndir={async () => {}}
    />
  )
}

function seans(oz: Partial<DanisanSeansi> = {}): DanisanSeansi {
  return {
    appointment_id: 1,
    baslangic: '2026-09-14T10:00',
    durum: 'geldi',
    ucret_kurus: 15000,
    odendi: false,
    not_ilk_satiri: null,
    ...oz,
  }
}

/** Test açıkça çözene/reddedene kadar bekleyen bir söz (`AyOzeti.test.tsx`in
 * `kapi`sı — burada `reddet` de ekli, 401/404 testleri için). */
function kapi<T>() {
  let coz!: (v: T) => void
  let reddet!: (e: unknown) => void
  const promise = new Promise<T>((c, r) => {
    coz = c
    reddet = r
  })
  return { promise, coz, reddet }
}

describe('DanisanlarSekmesi', () => {
  it('danışan seçilmemişken sağ kolonda yönlendirme yazısı olur', () => {
    render(
      <DanisanlarSekmesi
        liste={sahteListe()}
        dosya={sahteDosya(null)}
        seanslar={[]}
        onDanisanSec={() => {}}
        veriRaporuIndir={async () => {}}
      />,
    )
    // `jest-dom` bu pakette kurulu değil (`test-kurulum.ts`'te yok,
    // `TakvimSekmesi.test.tsx`deki aynı gerekçe): `toBeInTheDocument`
    // burada TANIMSIZ olurdu, `queryByText` + `toBeNull` deseni kullanılır.
    expect(screen.queryByText(/dosyasını açmak için soldaki listeden/i)).not.toBeNull()
  })

  it('seçili danışan değişince seans listesi yeniden çekilir', async () => {
    const cagrilanIdler: number[] = []
    taklit.seanslar = (clientId: number) => {
      cagrilanIdler.push(clientId)
      return Promise.resolve([seans({ appointment_id: clientId * 100 })])
    }

    const { rerender } = render(<Kapsayici seciliDanisanId={1} />)
    await waitFor(() => expect(cagrilanIdler).toContain(1))
    await waitFor(() => expect(seansSayisi()).toBe('1'))

    rerender(<Kapsayici seciliDanisanId={2} />)
    await waitFor(() => expect(cagrilanIdler).toContain(2))
    await waitFor(() => expect(seansSayisi()).toBe('1'))
    // İKİ ayrı çağrı: yalnızca ilk seçimde istek atılıp sonucun ikinci
    // danışan için de aynen kullanılmadığının kanıtı.
    expect(cagrilanIdler).toEqual([1, 2])
  })

  it('geciken yanıt yeni seçimin listesini ezmez', async () => {
    // 1 numaralı danışanın yanıtı GEÇ geliyor; arada 2'ye geçiliyor. Geciken
    // yanıt ekrana yazılırsa 2'nin dosyasında 1'in seansları görünür —
    // Plan 3'te aynı sınıf hata gerçekten oldu (bir danışanın notu başka
    // danışanın dosyasında görünmüştü).
    const kapi1 = kapi<DanisanSeansi[]>()
    const kapi2 = kapi<DanisanSeansi[]>()
    const istenenler: number[] = []
    taklit.seanslar = (clientId: number) => {
      istenenler.push(clientId)
      return clientId === 1 ? kapi1.promise : kapi2.promise
    }

    const { rerender } = render(<Kapsayici seciliDanisanId={1} />)
    await waitFor(() => expect(istenenler).toContain(1))

    rerender(<Kapsayici seciliDanisanId={2} />)
    await waitFor(() => expect(istenenler).toContain(2))

    // 2'nin yanıtı ÖNCE gelir: BOŞ liste.
    await act(async () => {
      kapi2.coz([])
    })
    await waitFor(() => expect(seansSayisi()).toBe('0'))

    // 1'in GECİKEN yanıtı şimdi gelir: dolu bir liste. Ekran hâlâ 2
    // numaralı danışanı gösteriyor, bu yanıt görünmemeli.
    await act(async () => {
      kapi1.coz([seans({ appointment_id: 999 }), seans({ appointment_id: 998 })])
    })
    expect(seansSayisi()).toBe('0')
  })

  it('bilinmeyen/silinmiş danışan (404) boş dosya olarak ele alınır, hata banner BASILMAZ', async () => {
    // `danisanApi.seanslar` gerçek istemcide sunucunun 404'ünü 401 ve
    // "veritabanı bozuk" DIŞINDA sıradan bir `Error` olarak fırlatır (bkz.
    // `api.ts::basarisizYanitiFirlat` — ayrı bir `Bulunamadi` sınıfı yok).
    // Bu test tam o dalı sınar: arşivlenmiş/silinmiş bir danışana tıklayan
    // terapist çökmüş bir ekran DEĞİL, boş bir dosya görmeli.
    //
    // `seansSayisi() === '0'` TEK BAŞINA zayıf bir iddiadır: başlangıç
    // state'i zaten boş olduğu için "reject hiç yakalanmasa" bile bu sayı
    // hâlâ '0' görünür (inceleme bulgusu — 10. biçim tam olarak bu tuzak).
    // Asıl kanıt: `.then`in reddedilme kolu GERÇEKTEN çalıştı mı? Bunu
    // `unhandledRejection`ı DOĞRUDAN dinleyerek ölçüyoruz -- catch dalı
    // kaldırılır ya da `throw e` ile yeniden fırlatılırsa üretim kodunun
    // KENDİ `.then()` zincirinden (test'in kendi `kapiReddet.promise`
    // referansından BAĞIMSIZ, çünkü `.then()` YENİ bir promise döndürür)
    // yakalanmamış bir ret çıkar ve bu dinleyici onu yakalar.
    const yakalanmamislar: unknown[] = []
    const dinle = (e: unknown) => yakalanmamislar.push(e)
    process.on('unhandledRejection', dinle)

    try {
      const kapiReddet = kapi<DanisanSeansi[]>()
      taklit.seanslar = () => kapiReddet.promise
      const reddetSessizce = kapiReddet.promise.catch(() => {})

      render(<Kapsayici seciliDanisanId={1} />)

      // Reddetme, `useDanisanSeanslari`nin `.then` ikinci koluna (`e:
      // unknown`) düşüyor; `act` içinde çözülüyor ki React state
      // güncellemesi testin gördüğü render ile aynı turda olsun.
      await act(async () => {
        kapiReddet.reddet(new Error('Danışan bulunamadı.'))
      })
      await reddetSessizce
      // `unhandledRejection` Node'da bir sonraki mikro görev turunda
      // yayılır; bir turluk bekleme bu event loop dönüşünü garantiler.
      await new Promise((r) => setTimeout(r, 0))

      await waitFor(() => expect(seansSayisi()).toBe('0'))
      // Bugün hiçbir yerde bir "seans listesi hatası" banner'ı yok (bu görev
      // seans verisini henüz ekrana basmıyor, bkz. `DanisanlarSekmesi.tsx`
      // modül başlığı) -- ama gerçek gereksinim tam olarak bu: birileri
      // catch dalını "404'te hata göster" diye değiştirirse burada bir
      // `role="alert"` belirmemeli. `dosya.kart.hata` `null` kaldığı için
      // BUGÜNKÜ tek alarm kaynağı (kart yüklemesi) da devre dışı; ekranda
      // hiç `alert` OLMAMALI.
      expect(screen.queryByRole('alert')).toBeNull()
      // Asıl koruma: reddedilme gerçekten yakalandı, üretim kodunun kendi
      // zincirinden sızan yakalanmamış bir ret YOK.
      expect(yakalanmamislar).toEqual([])
    } finally {
      process.off('unhandledRejection', dinle)
    }
  })

  it('401 alınca onYetkisiz çağrılır ve seans listesi temizlenir', async () => {
    // Kardeş kanca `useDanisanDosyasi` için `AnaEkran.test.tsx`de bu sınıfın
    // çok sayıda testi var; bu kancanın kendi 401 dalı (84-88. satırlar,
    // `onYetkisiz()` + `setDurum(null)`) hiç ölçülmüyordu.
    const onYetkisiz = vi.fn()
    const kapi1 = kapi<DanisanSeansi[]>()
    const kapi2Reddet = kapi<DanisanSeansi[]>()
    const reddetSessizce = kapi2Reddet.promise.catch(() => {})
    taklit.seanslar = (clientId: number) => (clientId === 1 ? kapi1.promise : kapi2Reddet.promise)

    const { rerender } = render(<Kapsayici seciliDanisanId={1} onYetkisiz={onYetkisiz} />)
    // Önce DOLU bir liste yüklensin ki aşağıdaki "temizlendi" iddiası
    // anlamlı olsun -- başlangıç zaten boş olsaydı 401'in HİÇBİR ŞEY
    // yapmadığı bir mutasyon da bu testi yeşil geçirirdi.
    await act(async () => {
      kapi1.coz([seans({ appointment_id: 1 }), seans({ appointment_id: 2 })])
    })
    await waitFor(() => expect(seansSayisi()).toBe('2'))

    rerender(<Kapsayici seciliDanisanId={2} onYetkisiz={onYetkisiz} />)
    await act(async () => {
      kapi2Reddet.reddet(new YetkisizHata('Oturum kilitli.'))
    })
    await reddetSessizce

    await waitFor(() => expect(onYetkisiz).toHaveBeenCalledTimes(1))
    expect(seansSayisi()).toBe('0')
  })
})
