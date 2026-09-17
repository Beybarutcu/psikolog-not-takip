import { render, screen, waitFor } from '@testing-library/react'
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
})
