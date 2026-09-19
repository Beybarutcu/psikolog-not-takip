import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DanisanDosyasi as DanisanKaydi, DanisanSeansi, SeansNotu } from '../api'
import type { KartVerisi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import { taslaklariUnut } from '../seans/taslak'
import { DanisanDosyasi } from './DanisanDosyasi'

// `notApi`/`takvimApi` test başına değiştirilebilir taklitlerle örtülüyor —
// desen `DanisanlarSekmesi.test.tsx`deki `taklit` ile AYNI. `null` iken
// çağrı reddedilir (varsayılan, "bu test bu çağrıyı beklemiyor" anlamına
// gelir); testler yalnızca ihtiyaç duydukları fonksiyonu doldurur.
const taklit = vi.hoisted(() => ({
  notGetir: null as null | ((id: number) => Promise<SeansNotu>),
  notKaydet: null as null | ((id: number, sablon: string, icerik: string) => Promise<SeansNotu>),
  randevuDurumu: null as null | ((id: number, durum: string) => Promise<unknown>),
  odemeGuncelle: null as null | ((id: number, odendi: boolean) => Promise<unknown>),
}))

vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return {
    ...gercek,
    notApi: {
      ...gercek.notApi,
      notGetir: (id: number) =>
        (taklit.notGetir ?? (() => Promise.reject(new Error('bu testte notGetir taklidi yok'))))(
          id,
        ),
      notKaydet: (id: number, sablon: string, icerik: string) =>
        (
          taklit.notKaydet ??
          (() => Promise.reject(new Error('bu testte notKaydet taklidi yok')))
        )(id, sablon, icerik),
    },
    takvimApi: {
      ...gercek.takvimApi,
      randevuDurumu: (id: number, durum: string) =>
        (
          taklit.randevuDurumu ??
          (() => Promise.reject(new Error('bu testte randevuDurumu taklidi yok')))
        )(id, durum),
      odemeGuncelle: (id: number, odendi: boolean) =>
        (
          taklit.odemeGuncelle ??
          (() => Promise.reject(new Error('bu testte odemeGuncelle taklidi yok')))
        )(id, odendi),
    },
  }
})

afterEach(() => {
  taklit.notGetir = null
  taklit.notKaydet = null
  taklit.randevuDurumu = null
  taklit.odemeGuncelle = null
  // `taslak.ts` deposu modül düzeyinde: bir testin bıraktığı taslak,
  // aynı `taslakAnahtari`yi (`danisan-not-<id>`) kullanan bir sonraki
  // testin editörüne "geri yüklendi" diye sızabilir.
  taslaklariUnut()
  // Yalnızca kaydetme testi sahte saat kullanıyor; burada koşulsuz geri
  // alınması o testin başarısız olup `vi.useRealTimers()`e hiç
  // ulaşamadığı bir durumda bile sonraki testleri korur.
  vi.useRealTimers()
})

const danisanFixture: DanisanKaydi = {
  id: 12,
  ad_soyad: 'Ayşe Yılmaz',
  telefon: null,
  durum: 'aktif',
  dogum_tarihi: null,
  basvuru_nedeni: null,
  risk_notu: null,
  riza_tarihi: null,
  riza_dosya_id: null,
  son_temas: null,
  saklama_bitis: null,
}

function sahteKart(dosya: DanisanKaydi | null = danisanFixture): KartVerisi {
  return { id: dosya?.id ?? null, dosya, ekler: [], randevular: [], hata: null }
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

function not(oz: Partial<SeansNotu> = {}): SeansNotu {
  return {
    appointment_id: 1,
    client_id: 12,
    seans_zamani: '2026-09-14T10:00',
    sablon: 'serbest',
    icerik: '',
    guncelleme_zamani: '2026-09-14T10:05:00',
    ...oz,
  }
}

function proplar(oz: Partial<Parameters<typeof DanisanDosyasi>[0]> = {}) {
  return {
    kart: sahteKart(),
    seanslar: [] as DanisanSeansi[],
    bugun: '2026-09-14',
    veriRaporuIndir: async () => {},
    ekYukle: async () => {},
    ekSil: async () => {},
    onRizaKaydet: async () => {},
    onKapat: () => {},
    ...oz,
  }
}

describe('DanisanDosyasi', () => {
  it('varsayılan alt sekme Seanslar\'dır ve seans listesi görünür', async () => {
    taklit.notGetir = () => Promise.resolve(not())
    render(<DanisanDosyasi {...proplar({ seanslar: [seans()] })} />)

    const seansSekmesi = screen.getByRole('tab', { name: 'Seanslar' })
    const bilgilerSekmesi = screen.getByRole('tab', { name: 'Bilgiler' })
    expect(seansSekmesi.getAttribute('aria-selected')).toBe('true')
    expect(bilgilerSekmesi.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByTestId('seans-listesi')).toBeDefined()
    // Aynı danışan adı iki kez basılmamalı: Bilgiler sekmesi henüz açık
    // değilken `DanisanKarti` DOM'da yok.
    expect(screen.queryByRole('heading', { name: 'Ayşe Yılmaz' })).toBeNull()
  })

  it('Bilgiler sekmesine geçince danışan kartı görünür, Seanslar içeriği kaybolur', async () => {
    const kullanici = userEvent.setup()
    taklit.notGetir = () => Promise.resolve(not())
    render(<DanisanDosyasi {...proplar({ seanslar: [seans()] })} />)

    await kullanici.click(screen.getByRole('tab', { name: 'Bilgiler' }))

    expect(screen.getByRole('heading', { name: 'Ayşe Yılmaz' })).toBeDefined()
    expect(screen.queryByTestId('seans-listesi')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Bilgiler' }).getAttribute('aria-selected')).toBe(
      'true',
    )
  })

  it('açılışta en yeni seansın notu otomatik yüklenir ve editörde görünür', async () => {
    const istenenler: number[] = []
    taklit.notGetir = (id: number) => {
      istenenler.push(id)
      return Promise.resolve(
        not({
          appointment_id: id,
          icerik: id === 1 ? 'En yeni seansın notu' : 'Eski seansın notu',
        }),
      )
    }

    render(
      <DanisanDosyasi
        {...proplar({
          // Sunucu en yeniden eskiye döndürür: appointment_id 1 EN YENİ.
          seanslar: [
            seans({ appointment_id: 1, baslangic: '2026-09-14T10:00' }),
            seans({ appointment_id: 2, baslangic: '2026-09-07T10:00' }),
          ],
        })}
      />,
    )

    await waitFor(() => expect(istenenler).toContain(1))
    expect(
      await screen.findByDisplayValue('En yeni seansın notu'),
    ).toBeDefined()
    expect(istenenler).toEqual([1])
  })

  it('farklı bir seansa tıklayınca o seansın notu yeniden yüklenir', async () => {
    const kullanici = userEvent.setup()
    const istenenler: number[] = []
    taklit.notGetir = (id: number) => {
      istenenler.push(id)
      return Promise.resolve(
        not({ appointment_id: id, icerik: id === 1 ? 'Bir numaralı not' : 'İki numaralı not' }),
      )
    }

    render(
      <DanisanDosyasi
        {...proplar({
          seanslar: [
            seans({ appointment_id: 1, baslangic: '2026-09-14T10:00' }),
            seans({ appointment_id: 2, baslangic: '2026-09-07T10:00' }),
          ],
        })}
      />,
    )
    await screen.findByDisplayValue('Bir numaralı not')

    const ikinciSatir = screen.getByText('7 Eylül 2026, 10:00').closest('button')
    expect(ikinciSatir).not.toBeNull()
    await kullanici.click(ikinciSatir!)

    await waitFor(() => expect(istenenler).toEqual([1, 2]))
    expect(await screen.findByDisplayValue('İki numaralı not')).toBeDefined()
  })

  it('seans yoksa not editörü render edilmez, bilgi mesajı görünür', () => {
    render(<DanisanDosyasi {...proplar({ seanslar: [] })} />)
    expect(screen.getAllByText('Bu danışanın kayıtlı bir seansı yok.').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Seans notu')).toBeNull()
  })

  it('"Geldi" işaretlemek takvimApi.randevuDurumu\'nu doğru kimlikle çağırır ve rozeti günceller', async () => {
    const kullanici = userEvent.setup()
    taklit.notGetir = () => Promise.resolve(not())
    const cagrilar: Array<[number, string]> = []
    taklit.randevuDurumu = (id, durum) => {
      cagrilar.push([id, durum])
      return Promise.resolve({})
    }

    render(
      <DanisanDosyasi
        {...proplar({ seanslar: [seans({ appointment_id: 5, durum: 'planlandi' })] })}
      />,
    )
    await screen.findByLabelText('Seans notu')

    const geldiDugmesi = screen.getByRole('button', { name: 'Geldi' })
    expect(geldiDugmesi.getAttribute('aria-pressed')).toBe('false')

    await kullanici.click(geldiDugmesi)

    await waitFor(() => expect(cagrilar).toEqual([[5, 'geldi']]))
    await waitFor(() => expect(geldiDugmesi.getAttribute('aria-pressed')).toBe('true'))
  })

  it('"Ödendi" kutusunu işaretlemek takvimApi.odemeGuncelle\'yi doğru kimlikle çağırır', async () => {
    const kullanici = userEvent.setup()
    taklit.notGetir = () => Promise.resolve(not())
    const cagrilar: Array<[number, boolean]> = []
    taklit.odemeGuncelle = (id, odendi) => {
      cagrilar.push([id, odendi])
      return Promise.resolve(undefined)
    }

    render(
      <DanisanDosyasi
        {...proplar({ seanslar: [seans({ appointment_id: 9, odendi: false })] })}
      />,
    )
    await screen.findByLabelText('Seans notu')

    const odendiKutusu = screen.getByRole('checkbox', { name: 'Ödendi' })
    await kullanici.click(odendiKutusu)

    await waitFor(() => expect(cagrilar).toEqual([[9, true]]))
  })

  // CRITICAL (inceleme turu): `SeansAltSatiri` "Ödendi" kutusunun ilk
  // değerini YALNIZCA MOUNT'ta okur (`useState(randevu.odendi)`, bkz. o
  // dosyanın modül başlığı). `key` verilmeden seans değiştirilirse bileşen
  // yeniden mount OLMAZ ve önceki seansın iyimser kutu değeri ekranda
  // kalır — `AnaEkran.test.tsx`teki "seans degisince Odendi kutusu YENI
  // randevunun degerini gosterir" testinin küçültülmüş hâli. Somut ürün
  // sonucu: ödenmemiş bir seans "ödendi" görünür (ücret hiç istenmez) ya
  // da terapist kutuyu "düzeltmek" için tıklarsa `odemeGuncelle` YANLIŞ
  // seansa gider ve sunucudaki değeri GERÇEKTEN bozar.
  it('seans değişince "Ödendi" kutusu YENİ seansın değerini gösterir (key regresyonu)', async () => {
    const kullanici = userEvent.setup()
    taklit.notGetir = () => Promise.resolve(not())

    render(
      <DanisanDosyasi
        {...proplar({
          seanslar: [
            seans({ appointment_id: 1, baslangic: '2026-09-14T10:00', odendi: true }),
            seans({ appointment_id: 2, baslangic: '2026-09-07T10:00', odendi: false }),
          ],
        })}
      />,
    )
    await screen.findByLabelText('Seans notu')

    function odendiKutusu(): HTMLInputElement {
      return screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement
    }

    // Açılışta en yeni seans (appointment_id 1, odendi:true) seçili.
    expect(odendiKutusu().checked).toBe(true)

    // Listeden eski seansa (appointment_id 2, odendi:false) geç.
    const ikinciSatir = screen.getByText('7 Eylül 2026, 10:00').closest('button')
    expect(ikinciSatir).not.toBeNull()
    await kullanici.click(ikinciSatir!)

    // Kutu YENİ seansın (odendi:false) değerini göstermeli — `key`siz bir
    // `SeansAltSatiri`, önceki seansın `true` iyimser durumunu taşırdı.
    expect(odendiKutusu().checked).toBe(false)
  })

  // IMPORTANT (inceleme turu): ürünün "not düzenlemek için takvime dönmek
  // gerekmez" amacının KAYDETME yarısı hiç ölçülmüyordu. `notKaydet`
  // gövdesini boşaltan bir mutasyon, terapist yazıp "Kaydedildi" görse
  // BİLE notun sunucuya hiç gitmediği bir regresyonu yeşil bırakırdı.
  it('seans notuna yazmak, gecikme dolunca notApi.notKaydet\'i doğru kimlik/şablon/içerikle çağırır', async () => {
    taklit.notGetir = () => Promise.resolve(not({ appointment_id: 3, sablon: 'dap', icerik: '' }))
    const kayitlar: Array<{ id: number; sablon: string; icerik: string }> = []
    taklit.notKaydet = (id, sablon, icerik) => {
      kayitlar.push({ id, sablon, icerik })
      return Promise.resolve(not({ appointment_id: id, sablon, icerik }))
    }

    render(<DanisanDosyasi {...proplar({ seanslar: [seans({ appointment_id: 3 })] })} />)
    // Yükleme GERÇEK zamanlayıcıyla bekleniyor (bu kısım `findBy*`
    // kullanabiliyor); sahte saat yalnızca YAZDIKTAN sonra devreye girer —
    // `NotEditoru.test.tsx`teki gerekçeyle aynı: saat durunca `findBy*`nin
    // kendi `waitFor`u da faked `setTimeout`e takılıp asılı kalırdı.
    const alan = (await screen.findByLabelText('Seans notu')) as HTMLTextAreaElement

    vi.useFakeTimers()
    fireEvent.change(alan, { target: { value: 'Danışan bugün daha rahat görünüyordu' } })
    // `NotEditoru`nun varsayılan gecikmesi (`gecikmeMs`, 2000 ms) — burada
    // hiç geçirilmiyor, gerçek üründeki HÂLİYLE ölçülüyor.
    await act(() => vi.advanceTimersByTimeAsync(2000))

    expect(kayitlar).toEqual([
      { id: 3, sablon: 'dap', icerik: 'Danışan bugün daha rahat görünüyordu' },
    ])
  })

  // IMPORTANT (inceleme turu): hata dalı (satır ~233-243: `role="alert"` +
  // "Yeniden dene" + `notTazeleme`) hiç ölçülmüyordu; o bloğu tümüyle
  // silen bir mutasyon 7/7 yeşil bırakıyordu.
  it('not yüklenemezse hata banner\'ı görünür; "Yeniden dene" notu yeniden çeker', async () => {
    const kullanici = userEvent.setup()
    let deneme = 0
    taklit.notGetir = () => {
      deneme += 1
      return deneme === 1
        ? Promise.reject(new Error('sunucuya ulaşılamadı'))
        : Promise.resolve(not({ icerik: 'ikinci denemede geldi' }))
    }

    render(<DanisanDosyasi {...proplar({ seanslar: [seans()] })} />)

    const alarm = await screen.findByRole('alert')
    expect(within(alarm).getByText(/sunucuya ulaşılamadı/)).toBeDefined()
    // Hata gösterilirken boş bir editör AÇILMAMALI: sunucudaki notun
    // üstüne yazılan bir metin var olanı ezerdi.
    expect(screen.queryByLabelText('Seans notu')).toBeNull()

    await kullanici.click(within(alarm).getByRole('button', { name: 'Yeniden dene' }))

    expect(await screen.findByDisplayValue('ikinci denemede geldi')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(deneme).toBe(2)
  })
})
