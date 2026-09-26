import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YetkisizHata, type Danisan, type DanisanSeansi } from '../api'
import type { KartVerisi, useDanisanDosyasi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import type { useDanisanListesi } from '../screens/anaEkranKancalari/useDanisanListesi'
import { useDanisanSeanslari } from '../screens/anaEkranKancalari/useDanisanSeanslari'
import { useDosyaNotu } from '../screens/anaEkranKancalari/useDosyaNotu'
import type { Randevu } from '../takvim/HaftalikTakvim'
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
function sahteKart(seciliDanisanId: number | null, randevular: Randevu[] = []): KartVerisi {
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
    randevular,
    hata: null,
    randevularDamgasi: 0,
  }
}

function sahteDosya(seciliDanisanId: number | null, randevular: Randevu[] = []): ReturnType<typeof useDanisanDosyasi> {
  return {
    seciliDanisanId,
    kart: sahteKart(seciliDanisanId, randevular),
    depolama: null,
    ac: () => {},
    kapat: () => {},
    yenidenDene: () => {},
    rizaKaydet: async () => {},
    ekYukle: async () => {},
    ekSil: async () => {},
    randevuYamala: () => {},
    randevularTazele: () => {},
    dosyaAlanlariniYama: () => {},
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
    ekleniyor: false,
    saklamaDolanlar: [],
    saklamaDolandanDus: () => {},
    ekle: async () => null,
    arsivle: async () => {},
  }
}

// `SeansListesi` boşken `<p data-testid="seans-listesi">`, doluyken grupları
// taşıyan `<div data-testid="seans-listesi">` basıyor (bkz. o dosya); ikisinde
// de satır sayısı `<li>` adedinden okunabiliyor. Katlı "Yaklaşan"ın (B3)
// satırları DOM'da YOK; seçili seans oradaysa grup zorla açıktır. Bu
// dosyadaki sayım testlerinde her satır ya geçmişte ya seçili seansla aynı
// (zorla açık) Yaklaşan'da: sayım duvar saatinden bağımsız (saat 10 Eylül'e
// çekilerek denendi). Eskiden burada
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
  // Etiketler bu dosyanın konusu değil (bkz. `AnaEkran.etiket.test.tsx`):
  // boş, yüklenmiş bir liste.
  etiketBaglami: () => ({
    etiketler: [],
    hata: null,
    onYenidenDene: () => {},
    sozluk: null,
    onSozlukIste: () => {},
    onEkle: async () => {},
    onKaldir: async () => {},
    onEtiketAc: () => {},
    yazmaHatasi: null,
    onYazmaHatasiTemizle: () => {},
  }),
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
    etiketler: [],
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

/**
 * Tasarım B1. `liste` form alanları GERÇEK durumla sürülür (`useState`):
 * `sahteListe`'nin no-op ayarlayıcılarıyla formun açılıp kapanması
 * ölçülemezdi.
 */
describe('DanisanlarSekmesi — arama ve ekleme (tasarım B1)', () => {
  afterEach(() => vi.restoreAllMocks())

  const UC: Danisan[] = [
    { id: 1, ad_soyad: 'Ayşe Kaya', telefon: null, durum: 'aktif' },
    { id: 2, ad_soyad: 'Ipek Sahin', telefon: null, durum: 'aktif' },
    { id: 3, ad_soyad: 'İpek Işık', telefon: null, durum: 'aktif' },
  ]

  function DurumluSekme({
    ekle = async () => null,
    onDanisanSec = () => {},
    baslangicFormAcik = false,
    ekleniyor = false,
  }: {
    ekle?: () => Promise<Danisan | null>
    onDanisanSec?: (id: number) => void
    baslangicFormAcik?: boolean
    /** Kancanın uçuş bayrağı (`useDanisanListesi.ekleniyor`); asıl koruma orada. */
    ekleniyor?: boolean
  }) {
    const [formAcik, setFormAcik] = useState(baslangicFormAcik)
    const [yeniAdSoyad, setYeniAdSoyad] = useState('')
    const [yeniTelefon, setYeniTelefon] = useState('')
    const liste = {
      ...sahteListe(UC),
      formAcik,
      setFormAcik,
      yeniAdSoyad,
      setYeniAdSoyad,
      yeniTelefon,
      setYeniTelefon,
      ekle,
      ekleniyor,
    }
    return (
      <DanisanlarSekmesi
        liste={liste}
        dosya={sahteDosya(null)}
        seanslar={bosSeanslar()}
        dosyaNotu={bosDosyaNotu()}
        altSekme="seanslar"
        onAltSekme={() => {}}
        {...ILGISIZ}
        onDanisanSec={onDanisanSec}
      />
    )
  }

  const aramaKutusu = () => screen.getByRole('searchbox', { name: 'Danışan ara' }) as HTMLInputElement
  const acmaDugmeleri = () =>
    screen.queryAllByRole('button', { name: /dosyasını aç$/ }).map((b) => b.textContent)
  const vurgulu = () => document.querySelector('li[data-vurgulu="evet"] button')?.textContent ?? null
  const BILGI = 'Arşivlenmiş danışanlar bu listede aranmaz; ⌘K hızlı arama arşivi de tarar.'

  it('kutu imleci KENDİLİĞİNDEN almaz; yazdıkça Türkçe katlamayla süzer; sunucuya istek gitmez', async () => {
    const fetchCasusu = vi.spyOn(globalThis, 'fetch')
    render(<DurumluSekme />)
    expect(document.activeElement).toBe(document.body)
    expect(aramaKutusu().getAttribute('placeholder')).toBe('Danışan ara…')

    await userEvent.type(aramaKutusu(), 'IŞIK')
    expect(acmaDugmeleri()).toEqual(['İpek Işık'])
    await userEvent.clear(aramaKutusu())
    await userEvent.type(aramaKutusu(), 'ipek')
    expect(acmaDugmeleri()).toEqual(['Ipek Sahin', 'İpek Işık'])
    await userEvent.clear(aramaKutusu())
    await userEvent.type(aramaKutusu(), '  ayşe ')
    expect(acmaDugmeleri()).toEqual(['Ayşe Kaya'])
    expect(fetchCasusu).not.toHaveBeenCalled()
  })

  it('yazınca ilk eşleşme vurgulu; ↑/↓ vurguyu taşır (uçlarda durur); Enter vurgulu dosyayı açar, imleç kutuda kalır', async () => {
    const onDanisanSec = vi.fn()
    render(<DurumluSekme onDanisanSec={onDanisanSec} />)
    await userEvent.type(aramaKutusu(), 'ipek')
    expect(vurgulu()).toBe('Ipek Sahin')
    const etkin = aramaKutusu().getAttribute('aria-activedescendant')
    expect(document.getElementById(etkin ?? '')?.textContent).toBe('Ipek Sahin')

    await userEvent.keyboard('{ArrowDown}')
    expect(vurgulu()).toBe('İpek Işık')
    await userEvent.keyboard('{ArrowDown}')
    expect(vurgulu()).toBe('İpek Işık')
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(vurgulu()).toBe('Ipek Sahin')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onDanisanSec).toHaveBeenCalledExactlyOnceWith(3)
    expect(document.activeElement).toBe(aramaKutusu())
  })

  it('boş kutuda vurgu yok, ↓ ilk danışanı vurgular; Esc kutuyu temizler ve vurguyu kaldırır', async () => {
    render(<DurumluSekme />)
    await userEvent.click(aramaKutusu())
    expect(vurgulu()).toBeNull()
    await userEvent.keyboard('{ArrowDown}')
    expect(vurgulu()).toBe('Ayşe Kaya')

    await userEvent.type(aramaKutusu(), 'ayşe')
    expect(acmaDugmeleri()).toEqual(['Ayşe Kaya'])
    await userEvent.keyboard('{Escape}')
    expect(aramaKutusu().value).toBe('')
    expect(acmaDugmeleri()).toHaveLength(3)
    expect(vurgulu()).toBeNull()
    expect(aramaKutusu().getAttribute('aria-activedescendant')).toBeNull()
  })

  it('oklarla vurgulanan satır görünür alana getirilir; açılış KAYDIRMAZ', async () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<DurumluSekme />)
    expect(kaydir).not.toHaveBeenCalled()
    await userEvent.click(aramaKutusu())
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(kaydir).toHaveBeenLastCalledWith({ block: 'nearest' })
    expect(kaydir.mock.contexts.at(-1)).toBe(document.querySelector('li[data-vurgulu="evet"]'))
    // Halka satırın İÇİNDE: kolonun `overflow-y-auto`'su (overflow-x de
    // `auto` hesaplanır) dışa taşan `ring-2`'nin sağını ve solunu kırpardı.
    expect(document.querySelector('li[data-vurgulu="evet"]')?.className).toContain('ring-inset')
  })

  // İnceleme I1. macOS'ta "kâ" (ölü tuş ya da basılı tutma) bir IME
  // birleştirmesidir: Return harfi onaylar, dosya açmaz (açmak silinemez bir
  // görüntüleme satırı yazar); Esc birleştirmeyi iptal eder, aramayı silmez.
  // `keyCode` 229: Safari birleştirmeyi bitiren keydown'da `isComposing`'i
  // `false` verir.
  it('IME birleştirmesi sürerken Enter dosya AÇMAZ, Esc kutuyu temizlemez, ↓ vurguyu taşımaz; birleştirme dışında Enter açar', async () => {
    const onDanisanSec = vi.fn()
    render(<DurumluSekme onDanisanSec={onDanisanSec} />)
    await userEvent.type(aramaKutusu(), 'ipek')
    expect(vurgulu()).toBe('Ipek Sahin')

    fireEvent.keyDown(aramaKutusu(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(aramaKutusu(), { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(aramaKutusu(), { key: 'ArrowDown', isComposing: true })
    fireEvent.keyDown(aramaKutusu(), { key: 'ArrowDown', keyCode: 229 })
    fireEvent.keyDown(aramaKutusu(), { key: 'Escape', isComposing: true })
    fireEvent.keyDown(aramaKutusu(), { key: 'Escape', keyCode: 229 })
    expect(onDanisanSec).not.toHaveBeenCalled()
    expect(vurgulu()).toBe('Ipek Sahin')
    expect(aramaKutusu().value).toBe('ipek')

    // Koruma her Enter'ı yutmuyor: birleştirme bitince aynı tuş dosyayı açar.
    fireEvent.keyDown(aramaKutusu(), { key: 'Enter' })
    expect(onDanisanSec).toHaveBeenCalledExactlyOnceWith(2)
  })

  // İnceleme M1. Asıl koruma kancada (`useDanisanListesi.ekle`, uçuş
  // bayrağı; bkz. `useDanisanListesi.test.ts`). Burada ölçülen: bayrak
  // kalkıkken "Ekle" devre dışı ve Enter (örtük gönderim) de göndermez.
  it('ekleme uçuştayken "Ekle" devre dışı; Enter ve tıklama ekle ÇAĞIRMAZ; bayrak inince Enter kaydeder', async () => {
    const ekle = vi.fn(async () => null)
    const { rerender } = render(<DurumluSekme ekle={ekle} baslangicFormAcik ekleniyor />)
    const gonder = screen.getByRole('button', { name: 'Ekle' }) as HTMLButtonElement
    expect(gonder.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText('Ad soyad'), 'Zeynep Ak{Enter}')
    await userEvent.click(gonder)
    expect(ekle).not.toHaveBeenCalled()

    rerender(<DurumluSekme ekle={ekle} baslangicFormAcik ekleniyor={false} />)
    expect(gonder.disabled).toBe(false)
    await userEvent.type(screen.getByLabelText('Ad soyad'), '{Enter}')
    expect(ekle).toHaveBeenCalledTimes(1)
  })

  it('eşleşme yoksa kısayol ve sabit bilgi satırı; kısayol formu o adla açar, imleç ad alanında; Enter kaydeder, dosya YENİ kimlikle açılır, arama temizlenir', async () => {
    const yeni: Danisan = { id: 9, ad_soyad: 'Zeynep Ak', telefon: null, durum: 'aktif' }
    const ekle = vi.fn(async () => yeni)
    const onDanisanSec = vi.fn()
    render(<DurumluSekme ekle={ekle} onDanisanSec={onDanisanSec} />)

    // Eşleşme varken kısayol ve bilgi satırı YOK (boş sorguda da).
    expect(screen.queryByText(BILGI)).toBeNull()
    await userEvent.type(aramaKutusu(), 'ayş')
    expect(screen.queryByRole('button', { name: /adıyla yeni danışan ekle$/ })).toBeNull()

    await userEvent.clear(aramaKutusu())
    await userEvent.type(aramaKutusu(), '  Zeynep Ak ')
    expect(acmaDugmeleri()).toEqual([])
    expect(screen.getByText(BILGI)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: "'Zeynep Ak' adıyla yeni danışan ekle" }))
    const ad = screen.getByLabelText('Ad soyad') as HTMLInputElement
    expect(ad.value).toBe('Zeynep Ak')
    expect(document.activeElement).toBe(ad)

    await userEvent.keyboard('{Enter}')
    expect(ekle).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onDanisanSec).toHaveBeenCalledExactlyOnceWith(9))
    expect(aramaKutusu().value).toBe('')
  })

  it('ekleme başarısızsa (ekle null) dosya AÇILMAZ, arama korunur', async () => {
    const onDanisanSec = vi.fn()
    render(<DurumluSekme ekle={async () => null} onDanisanSec={onDanisanSec} />)
    await userEvent.type(aramaKutusu(), 'Zeynep Ak')
    await userEvent.click(screen.getByRole('button', { name: "'Zeynep Ak' adıyla yeni danışan ekle" }))
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(onDanisanSec).not.toHaveBeenCalled()
    expect(aramaKutusu().value).toBe('Zeynep Ak')
  })

  it('form: "Danışan ekle" ile açılınca imleç ad alanında; Esc kapatır; form AÇIK monte olunca imleç kendiliğinden GİTMEZ', async () => {
    const { unmount } = render(<DurumluSekme />)
    await userEvent.click(screen.getByRole('button', { name: 'Danışan ekle' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Ad soyad'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByLabelText('Ad soyad')).toBeNull()
    unmount()

    // Sekmeye dönüş (yeniden monte) form açıkken olur: odak isteği YOK.
    render(<DurumluSekme baslangicFormAcik />)
    expect(screen.getByLabelText('Ad soyad')).toBeDefined()
    expect(document.activeElement).toBe(document.body)
  })

  it('sol kolon kendi içinde kayar (sticky + self-start + 100dvh + overflow)', () => {
    render(<DurumluSekme />)
    const sutun = screen.getByTestId('danisan-listesi-sutunu')
    for (const sinif of ['sticky', 'top-0', 'self-start', 'max-h-[100dvh]', 'overflow-y-auto']) {
      expect(sutun.className, sinif).toContain(sinif)
    }
    expect(sutun.contains(aramaKutusu())).toBe(true)
  })
})

/**
 * Tasarım A2/B2: dosya özetinin "şimdi"si uygulamanın TEK kaynağından
 * (`useDakikalikSimdi`, burada `DanisanlarSekmesi`'nde çağrılır). Emsal:
 * `yerelGun.test.ts` (yalnızca Date ve interval sahte).
 */
describe('DanisanlarSekmesi — dosya özeti tek "şimdi"den (tasarım A2, B2)', () => {
  afterEach(() => vi.useRealTimers())

  function randevu(oz: Partial<Randevu>): Randevu {
    return {
      id: 1, client_id: 1, danisan_adi: 'Danışan 1',
      baslangic: '2026-09-24T10:00', bitis: '2026-09-24T10:50',
      durum: 'planlandi', ucret: null, odendi: false, seri_id: null, ...oz,
    }
  }
  function ciz(randevular: Randevu[]) {
    render(
      <DanisanlarSekmesi
        liste={sahteListe()}
        dosya={sahteDosya(1, randevular)}
        seanslar={bosSeanslar()}
        dosyaNotu={bosDosyaNotu()}
        altSekme="seanslar"
        onAltSekme={() => {}}
        {...ILGISIZ}
      />,
    )
  }

  // İstanbul UTC+3: 00:30'da UTC günü hâlâ DÜN (21:30). `toISOString`'den
  // türeyen bir "şimdi" dünkü 23:00'ı gelecek sayar: "Son" kaybolur.
  it('İstanbul 00:30: dünkü 23:00 seansı "Son", bugünkü 01:00 "Sıradaki"', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 25, 0, 30))
    ciz([
      randevu({ id: 1, baslangic: '2026-09-24T23:00', bitis: '2026-09-24T23:50', durum: 'geldi' }),
      randevu({ id: 2, baslangic: '2026-09-25T01:00', bitis: '2026-09-25T01:50' }),
    ])
    expect(screen.getByTestId('dosya-ozeti').textContent).toBe(
      "1. seans · Eylül 2026'dan beri · Son: 24 Eylül · Sıradaki: Cuma 25 Eylül 01:00",
    )
  })

  it('dakikalık tik: 13:59\'da "Sıradaki" olan 14:00 seansı 14:00\'te artık sıradaki değil', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 8, 24, 13, 59))
    ciz([randevu({ id: 1, baslangic: '2026-09-24T14:00', bitis: '2026-09-24T14:50' })])
    expect(screen.getByTestId('dosya-ozeti').textContent).toBe('Sıradaki: Perşembe 24 Eylül 14:00')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    // Süren seans ne sıradaki ne işaretlenmemiş: satırın hiçbir parçası kalmaz.
    expect(screen.queryByTestId('dosya-ozeti')).toBeNull()
  })
})

describe('DanisanlarSekmesi — liste düzeni tek "şimdi"den (tasarım A2, B3)', () => {
  afterEach(() => vi.useRealTimers())

  function sabitSeanslar(liste: DanisanSeansi[], secili: number): ReturnType<typeof useDanisanSeanslari> {
    return { ...bosSeanslar(), seanslar: liste, yuklendi: true, seciliSeansId: secili }
  }
  function ciz(liste: DanisanSeansi[], secili: number) {
    render(
      <DanisanlarSekmesi
        liste={sahteListe()}
        dosya={sahteDosya(1)}
        seanslar={sabitSeanslar(liste, secili)}
        dosyaNotu={bosDosyaNotu()}
        altSekme="seanslar"
        onAltSekme={() => {}}
        {...ILGISIZ}
      />,
    )
  }
  const basliklar = () =>
    within(screen.getByTestId('seans-listesi')).getAllByRole('heading').map((h) => h.textContent)

  it('İstanbul 00:30: dünkü 23:00 geçmişte (Eylül grubu), bugünkü 01:00 Yaklaşan\'da', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 25, 0, 30))
    ciz(
      [
        seans({ appointment_id: 2, baslangic: '2026-09-25T01:00', durum: 'planlandi' }),
        seans({ appointment_id: 1, baslangic: '2026-09-24T23:00', durum: 'geldi' }),
      ],
      1,
    )
    expect(basliklar()).toEqual(['Yaklaşan (1)', 'Eylül 2026 · 1 seans'])
  })

  it('dakikalık tik: 14:00 seansı 13:59\'da Yaklaşan\'da, 14:00\'te Eylül grubunda', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 8, 24, 13, 59))
    ciz(
      [
        seans({ appointment_id: 7, baslangic: '2026-09-24T14:00', durum: 'planlandi' }),
        seans({ appointment_id: 6, baslangic: '2026-09-24T10:00', durum: 'geldi' }),
      ],
      6,
    )
    expect(basliklar()).toEqual(['Yaklaşan (1)', 'Eylül 2026 · 1 seans'])
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(basliklar()).toEqual(['Eylül 2026 · 1 seans'])
    expect(screen.getByTestId('seans-listesi').textContent).toContain('24 Eylül 2026, 14:00')
  })
})
