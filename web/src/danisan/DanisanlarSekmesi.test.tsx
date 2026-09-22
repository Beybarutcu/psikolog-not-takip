import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YetkisizHata, type Danisan, type DanisanSeansi } from '../api'
import type { KartVerisi, useDanisanDosyasi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import type { useDanisanListesi } from '../screens/anaEkranKancalari/useDanisanListesi'
import { useDanisanSeanslari } from '../screens/anaEkranKancalari/useDanisanSeanslari'
import { useDosyaNotu } from '../screens/anaEkranKancalari/useDosyaNotu'
import type { DosyaAltSekme } from './DanisanDosyasi'
import { DanisanlarSekmesi } from './DanisanlarSekmesi'

// `danisanApi.seanslar` test başına değiştirilebilir. `null` iken GERÇEK
// istemci çalışır. Desen `AyOzeti.test.tsx`deki `taklit` ile AYNI.
//
// `notApi.notGetir` de burada sabit bir taklitle örtülüyor: `DanisanDosyasi`
// artık gerçekten mount olduğunda (kart.dosya doldurulduğu için, bkz.
// `sahteKart`) açılışta en yeni seansın notunu ÇEKMEYE çalışır. Bu dosyanın
// testleri not içeriğiyle ilgilenmiyor (onu `DanisanDosyasi.test.tsx` ölçer)
// — taklit yalnızca gerçek `fetch`in jsdom'da başarısız olup gürültülü bir
// reddedilmeyi konsola yazmasını önlüyor.
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
    notApi: {
      ...gercek.notApi,
      notGetir: (randevuId: number) =>
        Promise.resolve({
          appointment_id: randevuId,
          client_id: 0,
          seans_zamani: '2026-09-14T10:00',
          sablon: 'serbest',
          icerik: '',
          guncelleme_zamani: '2026-09-14T10:05:00',
        }),
    },
  }
})

afterEach(() => {
  taklit.seanslar = null
})

// `kart.dosya !== null` olmadıkça `DanisanlarSekmesi` sağ kolonda
// `DanisanDosyasi`yi (dolayısıyla `SeansListesi`yi) hiç MOUNT etmiyor —
// bu, `useDanisanDosyasi`nin kendi akışı (kart.dosya, kart.ekler ve
// kart.randevular AYRI bir yükleme). Bu dosyanın testleri seans listesinin
// akışını (`useDanisanSeanslari`) ölçüyor, danışan dosyasının kendisini
// değil; bu yüzden `dosya` burada minimal ama GEÇERLİ bir sahte kayıtla
// dolduruluyor (gerçek alan adları `DanisanKarti.test.tsx`teki fixture ile
// aynı).
function sahteKart(seciliDanisanId: number | null): KartVerisi {
  return {
    id: seciliDanisanId,
    dosya:
      seciliDanisanId === null
        ? null
        : {
            id: seciliDanisanId,
            ad_soyad: `Danışan ${seciliDanisanId}`,
            telefon: null,
            durum: 'aktif',
            dogum_tarihi: null,
            basvuru_nedeni: null,
            risk_notu: null,
            riza_tarihi: null,
            riza_dosya_id: null,
            son_temas: null,
            saklama_bitis: null,
          },
    ekler: [],
    randevular: [],
    hata: null,
  }
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

function sahteListe(danisanlar: Danisan[] = []): ReturnType<typeof useDanisanListesi> {
  return {
    danisanlar,
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

// `SeansListesi` boşken `<p data-testid="seans-listesi">`, doluyken
// `<ul data-testid="seans-listesi">` basıyor (bkz. o dosya); ikisinde de
// satır sayısı `<li>` adedinden okunabiliyor. Eskiden burada
// `data-seans-sayisi` diye bir test probu vardı (Görev 5) — bu görev onu
// kaldırdı, aşağıdaki sayım artık GERÇEK render'dan okunuyor.
function seansSayisi(): number {
  return screen.getByTestId('seans-listesi').querySelectorAll('li').length
}

/** Kancasız çağrılar için boş bir seans akışı (yalnızca ilk test). */
function bosSeanslar(): ReturnType<typeof useDanisanSeanslari> {
  return {
    seanslar: [],
    yuklendi: false,
    hata: null,
    yenidenDene: () => {},
    seciliSeansId: null,
    seansSec: () => {},
    yamala: () => {},
    yapiDegisti: () => {},
  }
}

function bosDosyaNotu(): ReturnType<typeof useDosyaNotu> {
  return { not: null, hata: null, notYansit: () => {}, yenidenDene: () => {} }
}

/** Kancasız `DanisanlarSekmesi`nin zorunlu ama bu testlerde ilgisiz prop'ları. */
const ILGISIZ = {
  onDanisanSec: () => {},
  veriRaporuIndir: async () => {},
  onNotKaydet: async () => {},
  onDurumDegis: async () => {},
  onOdemeDegis: async () => {},
}

/**
 * Gerçek kullanım şeklinin (`AnaEkran`) KÜÇÜLTÜLMÜŞ hâli: `useDanisanSeanslari`
 * ve `useDosyaNotu`yu BURADA çağırır ve sonuçlarını `DanisanlarSekmesi`ye
 * prop olarak geçirir — tıpkı `liste`/`dosya`nın da kendi kancalarından
 * geldiği gibi. `yuklendi` de aynı hattan (bkz. `SeansListesi.test.tsx`
 * "veri henüz yüklenmedi" testi — buradaki asıl kanıt ORADA).
 */
function Kapsayici({
  seciliDanisanId,
  onYetkisiz = () => {},
}: {
  seciliDanisanId: number | null
  /** Varsayılan no-op: yalnızca 401 testi gerçek bir `vi.fn()` geçirir. */
  onYetkisiz?: () => void
}) {
  const seanslar = useDanisanSeanslari({
    clientId: seciliDanisanId,
    gorunur: true,
    onYetkisiz,
    simdi: () => '2026-09-20T12:00',
  })
  const dosyaNotu = useDosyaNotu({ appointmentId: seanslar.seciliSeansId, gorunur: true })
  const [altSekme, setAltSekme] = useState<DosyaAltSekme>('seanslar')
  return (
    <DanisanlarSekmesi
      liste={sahteListe()}
      dosya={sahteDosya(seciliDanisanId)}
      seanslar={seanslar}
      dosyaNotu={dosyaNotu}
      altSekme={altSekme}
      onAltSekme={setAltSekme}
      {...ILGISIZ}
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
        seanslar={bosSeanslar()}
        dosyaNotu={bosDosyaNotu()}
        altSekme="seanslar"
        onAltSekme={() => {}}
        {...ILGISIZ}
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
    await waitFor(() => expect(seansSayisi()).toBe(1))

    rerender(<Kapsayici seciliDanisanId={2} />)
    await waitFor(() => expect(cagrilanIdler).toContain(2))
    await waitFor(() => expect(seansSayisi()).toBe(1))
    // İKİ ayrı çağrı: yalnızca ilk seçimde istek atılıp sonucun ikinci
    // danışan için de aynen kullanılmadığının kanıtı.
    expect(cagrilanIdler).toEqual([1, 2])
  })

  // `yuklendi`: gerçek uçtan uca akışın (`e2e/kabuk.spec.ts`) DAYANDIĞI
  // senkronizasyon bariyeri burada birim seviyesinde ölçülüyor: yanıt gelene
  // kadar `false`, geldikten sonra `true`. Asıl kanıt (mutasyon turunda
  // ölçülen) `SeansListesi.test.tsx`teki iki doğrudan test; bu test yalnızca
  // hattın (`useDanisanSeanslari` → `DanisanlarSekmesi` → `DanisanDosyasi` →
  // `SeansListesi`) GERÇEKTEN bağlı olduğunu kanıtlıyor.
  it('data-yuklendi yanıt gelene kadar "hayir", geldikten sonra "evet"', async () => {
    const kapi1 = kapi<DanisanSeansi[]>()
    taklit.seanslar = () => kapi1.promise

    render(<Kapsayici seciliDanisanId={1} />)

    expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('hayir')

    await act(async () => {
      kapi1.coz([seans({ appointment_id: 1 })])
    })

    await waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )
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
    await waitFor(() => expect(seansSayisi()).toBe(0))

    // 1'in GECİKEN yanıtı şimdi gelir: dolu bir liste. Ekran hâlâ 2
    // numaralı danışanı gösteriyor, bu yanıt görünmemeli.
    await act(async () => {
      kapi1.coz([seans({ appointment_id: 999 }), seans({ appointment_id: 998 })])
    })
    expect(seansSayisi()).toBe(0)
  })

  // Son inceleme I4 — DAVRANIŞ DEĞİŞTİ. Bu testin Görev 5'teki hâli "404 boş
  // dosya olarak ele alınır, hata banner BASILMAZ" idi. 404 gerekçesi bu yolda
  // fiilen işlemiyordu (bilinmeyen danışanda kartın `dosyaGetir`'i de 404
  // alıyor ve dosya hiç çizilmiyor); geriye kalan tek etki geçici bir 500/ağ
  // hatasında Seanslar'ın "Bu danışanın kayıtlı bir seansı yok." demesiydi —
  // seansı olan bir danışan için sessiz bir yalan. Artık hata GÖSTERİLİYOR.
  //
  // Görev 5'in asıl korumasının yarısı AYNEN korunuyor: reddin GERÇEKTEN
  // yakalandığı `unhandledRejection` dinlenerek ölçülüyor. `.then`in ret kolu
  // kaldırılır ya da `throw e` ile yeniden fırlatılırsa üretim kodunun KENDİ
  // zincirinden yakalanmamış bir ret çıkar ve bu dinleyici onu yakalar (ekran
  // iddiası tek başına zayıftı: başlangıç durumu zaten "boş"tu — 10. biçim).
  it.each([
    ['404', 'Danışan bulunamadı.'],
    ['500', 'Veritabanı okunamadı.'],
  ])(
    'seans listesi hatası (%s) "Seanslar yüklenemedi" gösterir, "seansı yok" DEMEZ; ret yakalanır; Yeniden dene listeyi getirir',
    async (_kod, mesaj) => {
      const yakalanmamislar: unknown[] = []
      const dinle = (e: unknown) => yakalanmamislar.push(e)
      process.on('unhandledRejection', dinle)

      try {
        const kapiReddet = kapi<DanisanSeansi[]>()
        const reddetSessizce = kapiReddet.promise.catch(() => {})
        let deneme = 0
        taklit.seanslar = () => {
          deneme += 1
          return deneme === 1
            ? kapiReddet.promise
            : Promise.resolve([seans({ appointment_id: 1, not_ilk_satiri: 'geri geldi' })])
        }

        render(<Kapsayici seciliDanisanId={1} />)
        await act(async () => {
          kapiReddet.reddet(new Error(mesaj))
        })
        await reddetSessizce
        // `unhandledRejection` Node'da HANGİ event loop turunda yayılacağını
        // garanti etmez; birkaç makro görev turu boyunca bekleniyor (Görev 5
        // inceleme notu — tek bir `setTimeout(0)` yük altında turu kaçırabilir).
        for (let tur = 0; tur < 10; tur++) {
          await new Promise((r) => setTimeout(r, 0))
        }

        const alarm = await screen.findByRole('alert')
        expect(alarm.textContent).toContain('Seanslar yüklenemedi')
        expect(alarm.textContent).toContain(mesaj)
        expect(screen.queryByText('Bu danışanın kayıtlı bir seansı yok.')).toBeNull()
        expect(yakalanmamislar).toEqual([])

        // "Yeniden dene" gerçekten yeniden ister ve liste gelir.
        await userEvent.click(within(alarm).getByRole('button', { name: 'Yeniden dene' }))
        await waitFor(() => expect(seansSayisi()).toBe(1))
        expect(deneme).toBe(2)
        expect(screen.queryByRole('alert')).toBeNull()
      } finally {
        process.off('unhandledRejection', dinle)
      }
    },
  )

  // Son inceleme I2: listedeki açık danışan yalnızca `aria-current`
  // taşıyordu, GÖRSEL bir vurgu yoktu. İki yön: seçili çip vurgulu, diğeri
  // DEĞİL (her çipi vurgulayan bir uygulama da tek yönlü testi geçerdi).
  it('açık dosyanın danışan çipi görsel olarak vurgulanır, diğeri vurgulanmaz', () => {
    const iki: Danisan[] = [
      { id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' },
      { id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif' },
    ]
    render(
      <DanisanlarSekmesi
        liste={sahteListe(iki)}
        dosya={sahteDosya(1)}
        seanslar={bosSeanslar()}
        dosyaNotu={bosDosyaNotu()}
        altSekme="seanslar"
        onAltSekme={() => {}}
        {...ILGISIZ}
      />,
    )
    const satir = (ad: string) =>
      screen.getByRole('button', { name: `${ad} dosyasını aç` }).closest('li') as HTMLElement
    expect(satir('Ayşe Yılmaz').getAttribute('data-secili')).toBe('evet')
    expect(satir('Ayşe Yılmaz').className).toContain('font-semibold')
    expect(satir('Mehmet Demir').getAttribute('data-secili')).toBeNull()
    expect(satir('Mehmet Demir').className).not.toContain('font-semibold')
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
    await waitFor(() => expect(seansSayisi()).toBe(2))

    rerender(<Kapsayici seciliDanisanId={2} onYetkisiz={onYetkisiz} />)
    await act(async () => {
      kapi2Reddet.reddet(new YetkisizHata('Oturum kilitli.'))
    })
    await reddetSessizce

    await waitFor(() => expect(onYetkisiz).toHaveBeenCalledTimes(1))
    expect(seansSayisi()).toBe(0)
  })
})

/**
 * Bayatlık (bkz. `useDanisanSeanslari` modül başlığı): yamanamayan yazmalar
 * listeyi YENİDEN ÇEKTİRİR, ama yalnızca liste görünürken. Kanca doğrudan
 * sürülüyor — `AnaEkran` düzeyindeki senaryolar `AnaEkran.yayilim.test.tsx`
 * "Bayatlık" bloğunda; buradakiler o senaryolarda ayırt edilemeyen iki
 * savunmayı AYRI AYRI ölçüyor.
 */
describe('useDanisanSeanslari — bayatlık', () => {
  function kanca(gorunur: boolean) {
    return renderHook(
      (p: { gorunur: boolean }) =>
        useDanisanSeanslari({
          clientId: 1,
          gorunur: p.gorunur,
          onYetkisiz: () => {},
          simdi: () => '2026-09-20T12:00',
        }),
      { initialProps: { gorunur } },
    )
  }

  it('listede olmayan seans seçilince liste bir kez yeniden çekilir ve O seans seçili olur', async () => {
    // İkinci savunma: bildirimi atlayan bir yazma yolu olsa bile takvimden
    // gelinen seans yüklü listede yoksa varsayılana (BAŞKA seansa) düşülmez.
    let sunucu = [seans({ appointment_id: 7, baslangic: '2026-09-07T10:00' })]
    let cagri = 0
    taklit.seanslar = () => {
      cagri += 1
      return Promise.resolve(sunucu)
    }
    const { result } = kanca(true)
    await waitFor(() => expect(result.current.yuklendi).toBe(true))
    expect(result.current.seciliSeansId).toBe(7)
    expect(cagri).toBe(1)

    sunucu = [seans({ appointment_id: 21, baslangic: '2026-09-21T10:00' }), ...sunucu]
    act(() => result.current.seansSec(1, 21))
    // Bayat liste ekrana gitmez: seçim varsayılana (7) DÜŞMEZ.
    expect(result.current.seciliSeansId).toBeNull()
    await waitFor(() => expect(result.current.seciliSeansId).toBe(21))
    expect(cagri).toBe(2)

    // Listede OLAN seans seçmek yeniden çekmez.
    act(() => result.current.seansSec(1, 7))
    expect(result.current.seciliSeansId).toBe(7)
    await new Promise((r) => setTimeout(r, 20))
    expect(cagri).toBe(2)
  })

  it('görünmezken bayatlanan liste ÇEKİLMEZ; görünür olunca TEK istek, gidip gelince ikincisi yok', async () => {
    let cagri = 0
    taklit.seanslar = () => {
      cagri += 1
      return Promise.resolve([seans({ appointment_id: 7 })])
    }
    const { result, rerender } = kanca(true)
    await waitFor(() => expect(result.current.yuklendi).toBe(true))
    expect(cagri).toBe(1)

    rerender({ gorunur: false })
    act(() => result.current.yapiDegisti([1]))
    await new Promise((r) => setTimeout(r, 20))
    expect(cagri).toBe(1)
    expect(result.current.yuklendi).toBe(false)

    rerender({ gorunur: true })
    await waitFor(() => expect(result.current.yuklendi).toBe(true))
    expect(cagri).toBe(2)
    rerender({ gorunur: false })
    rerender({ gorunur: true })
    await new Promise((r) => setTimeout(r, 20))
    expect(cagri).toBe(2)

    // Başka danışanı etkileyen yazma açık listeye dokunmaz.
    act(() => result.current.yapiDegisti([2]))
    await new Promise((r) => setTimeout(r, 20))
    expect(cagri).toBe(2)
    expect(result.current.yuklendi).toBe(true)
  })

  it('yeniden çekmeler SIRA DIŞI dönerse eski yanıt yenisini ezmez', async () => {
    const kapilar: ReturnType<typeof kapi<DanisanSeansi[]>>[] = []
    taklit.seanslar = () => {
      const k = kapi<DanisanSeansi[]>()
      kapilar.push(k)
      return k.promise
    }
    const { result } = kanca(true)
    await act(async () => kapilar[0].coz([seans({ appointment_id: 7 })]))
    await waitFor(() => expect(result.current.yuklendi).toBe(true))

    // İkinci okuma (bayatlık) uçuşta; seçilen 21 bayat listede yok -> üçüncü.
    act(() => result.current.yapiDegisti([1]))
    await waitFor(() => expect(kapilar).toHaveLength(2))
    act(() => result.current.seansSec(1, 21))
    await waitFor(() => expect(kapilar).toHaveLength(3))

    const yeni = [seans({ appointment_id: 21 }), seans({ appointment_id: 7 })]
    await act(async () => kapilar[2].coz(yeni))
    await act(async () => kapilar[1].coz([seans({ appointment_id: 7 })]))
    await waitFor(() => expect(result.current.yuklendi).toBe(true))
    expect(result.current.seanslar.map((s) => s.appointment_id)).toEqual([21, 7])
    expect(result.current.seciliSeansId).toBe(21)
  })
})
