import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DanisanDosyasi as DanisanKaydi, DanisanSeansi, SeansNotu } from '../api'
import type { KartVerisi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import { taslaklariUnut } from '../seans/taslak'
import { DanisanDosyasi } from './DanisanDosyasi'

// Son inceleme C1/C2/M1: `DanisanDosyasi` artık DURUMSUZ — seçili seans,
// not, alt sekme ve bütün yazmalar yukarıda (`AnaEkran` + kancalar). Bu
// dosyanın testleri bileşenin kendi sözleşmesini ölçüyor: gösterdiği şey
// prop'lardan gelir, yaptığı her yazma DOĞRU seans kimliğiyle yukarıya
// iletilir. Uçtan uca yayılım (takvim ↔ dosya) `AnaEkran.test.tsx`'teki
// "C1"/"C2" bloklarında GERÇEK kancalarla ölçülüyor.

afterEach(() => {
  // `taslak.ts` deposu modül düzeyinde: bir testin bıraktığı taslak, aynı
  // `taslakAnahtari`yi kullanan bir sonraki testin editörüne sızabilir.
  taslaklariUnut()
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
  return {
    id: dosya?.id ?? null,
    dosya,
    ekler: [],
    randevular: [],
    hata: null,
    randevularDamgasi: 0,
  }
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

type Proplar = Parameters<typeof DanisanDosyasi>[0]

function proplar(oz: Partial<Proplar> = {}): Proplar {
  return {
    kart: sahteKart(),
    seanslar: [],
    seciliSeansId: null,
    onSeansSec: vi.fn(),
    not: null,
    notHata: null,
    onNotYenidenDene: vi.fn(),
    onNotKaydet: vi.fn(async () => {}),
    onDurumDegis: vi.fn(async () => {}),
    onOdemeDegis: vi.fn(async () => {}),
    altSekme: 'seanslar',
    onAltSekme: vi.fn(),
    bugun: '2026-09-14',
    veriRaporuIndir: async () => {},
    ekYukle: async () => {},
    ekSil: async () => {},
    onRizaKaydet: async () => {},
    onKapat: () => {},
    ...oz,
  }
}

const IKI_SEANS = [
  seans({ appointment_id: 1, baslangic: '2026-09-14T10:00', odendi: true }),
  seans({ appointment_id: 2, baslangic: '2026-09-07T10:00', odendi: false }),
]

describe('DanisanDosyasi', () => {
  // Son inceleme I2: Seanslar alt sekmesinde açık dosyanın KİME ait olduğu
  // hiçbir yerde yazmıyordu; terapist yanlış danışanın seansına not
  // yazabilirdi. Ad artık başlıkta, iki alt sekmede de.
  it('danışanın adı başlıkta: Seanslar alt sekmesinde de, Bilgiler alt sekmesinde de', () => {
    const { rerender } = render(<DanisanDosyasi {...proplar({ seanslar: [seans()] })} />)
    expect(screen.getByRole('tab', { name: 'Seanslar' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('seans-listesi')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Ayşe Yılmaz' })).toBeDefined()

    rerender(<DanisanDosyasi {...proplar({ seanslar: [seans()], altSekme: 'bilgiler' })} />)
    // Aynı ad İKİ kez basılmıyor: `DosyaBilgileri` kendi ad başlığını artık
    // taşımıyor.
    expect(screen.getAllByRole('heading', { name: 'Ayşe Yılmaz' })).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Danışan bilgileri' })).toBeDefined()
    expect(screen.queryByTestId('seans-listesi')).toBeNull()
  })

  it('alt sekme düğmeleri seçimi YUKARIYA bildirir (alt sekme bileşende yaşamaz — M1)', async () => {
    const onAltSekme = vi.fn()
    render(<DanisanDosyasi {...proplar({ seanslar: [seans()], onAltSekme })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    expect(onAltSekme).toHaveBeenCalledWith('bilgiler')
    // Bileşen kendi başına sekme DEĞİŞTİRMEZ: prop hâlâ 'seanslar'.
    expect(screen.getByTestId('seans-listesi')).toBeDefined()
  })

  it('seçili seans prop\'tan gelir; başka satıra tıklamak o seansın kimliğini bildirir', async () => {
    const onSeansSec = vi.fn()
    render(
      <DanisanDosyasi
        {...proplar({ seanslar: IKI_SEANS, seciliSeansId: 2, onSeansSec, not: not({ appointment_id: 2, icerik: 'İki numaralı not' }) })}
      />,
    )
    const liste = screen.getByTestId('seans-listesi')
    const aktif = within(liste).getByRole('button', { current: true })
    expect(aktif.textContent).toContain('7 Eylül 2026, 10:00')
    expect(screen.getByDisplayValue('İki numaralı not')).toBeDefined()

    await userEvent.click(within(liste).getByText('14 Eylül 2026, 10:00').closest('button')!)
    expect(onSeansSec).toHaveBeenCalledWith(1)
  })

  it('not başka bir seansa aitse gösterilmez (seçim değişti, yenisi yükleniyor)', () => {
    render(
      <DanisanDosyasi
        {...proplar({ seanslar: IKI_SEANS, seciliSeansId: 2, not: not({ appointment_id: 1, icerik: 'BIR-NUMARALI-KANARYA' }) })}
      />,
    )
    expect(document.body.textContent).not.toContain('BIR-NUMARALI-KANARYA')
    expect(screen.queryByLabelText('Seans notu')).toBeNull()
    expect(screen.getByText('Seans notu yükleniyor…')).toBeDefined()
  })

  it('seans yoksa not editörü render edilmez, bilgi mesajı görünür', () => {
    render(<DanisanDosyasi {...proplar({ seanslar: [] })} />)
    expect(screen.getAllByText('Bu danışanın kayıtlı bir seansı yok.').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Seans notu')).toBeNull()
  })

  // Son inceleme I4: yüklenemeyen liste "seansı yok" DEĞİLDİR.
  it('seans listesi yüklenemediyse "Seanslar yüklenemedi" + Yeniden dene; "seansı yok" YOK', async () => {
    const onSeansYenidenDene = vi.fn()
    render(
      <DanisanDosyasi
        {...proplar({ seanslar: [], seansHata: 'Sunucu hatası.', onSeansYenidenDene })}
      />,
    )
    const alarm = screen.getByRole('alert')
    expect(alarm.textContent).toContain('Seanslar yüklenemedi')
    expect(alarm.textContent).toContain('Sunucu hatası.')
    expect(screen.queryByText('Bu danışanın kayıtlı bir seansı yok.')).toBeNull()
    await userEvent.click(within(alarm).getByRole('button', { name: 'Yeniden dene' }))
    expect(onSeansYenidenDene).toHaveBeenCalledTimes(1)
  })

  it('"Geldi" ve "Ödendi" SEÇİLİ seansın kimliğiyle yukarıya gider (API çağrısı bileşende YOK)', async () => {
    const onDurumDegis = vi.fn(async () => {})
    const onOdemeDegis = vi.fn(async () => {})
    render(
      <DanisanDosyasi
        {...proplar({
          seanslar: [seans({ appointment_id: 5, durum: 'planlandi' }), seans({ appointment_id: 9, baslangic: '2026-09-01T10:00' })],
          seciliSeansId: 5,
          not: not({ appointment_id: 5 }),
          onDurumDegis,
          onOdemeDegis,
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Geldi' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ödendi' }))
    expect(onDurumDegis).toHaveBeenCalledWith(5, 'geldi')
    expect(onOdemeDegis).toHaveBeenCalledWith(5, true)
  })

  it('durum düğmesinin seçili hâli prop\'taki listeden okunur (yama yukarıda)', () => {
    const { rerender } = render(
      <DanisanDosyasi
        {...proplar({ seanslar: [seans({ appointment_id: 5, durum: 'planlandi' })], seciliSeansId: 5, not: not({ appointment_id: 5 }) })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Geldi' }).getAttribute('aria-pressed')).toBe('false')
    rerender(
      <DanisanDosyasi
        {...proplar({ seanslar: [seans({ appointment_id: 5, durum: 'geldi' })], seciliSeansId: 5, not: not({ appointment_id: 5 }) })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Geldi' }).getAttribute('aria-pressed')).toBe('true')
  })

  // CRITICAL (Görev 6 inceleme turu): `SeansAltSatiri` "Ödendi" kutusunu
  // yalnızca MOUNT'ta okur. Seçim artık YUKARIDAN geldiği için geçiş bir
  // prop değişimi (`rerender`) — üretimdeki gerçek geçiş bu (4. biçim).
  it('seçili seans değişince "Ödendi" kutusu YENİ seansın değerini gösterir (key regresyonu)', () => {
    const { rerender } = render(
      <DanisanDosyasi {...proplar({ seanslar: IKI_SEANS, seciliSeansId: 1, not: not({ appointment_id: 1 }) })} />,
    )
    const kutu = () => screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement
    expect(kutu().checked).toBe(true)
    rerender(
      <DanisanDosyasi {...proplar({ seanslar: IKI_SEANS, seciliSeansId: 2, not: not({ appointment_id: 2 }) })} />,
    )
    expect(kutu().checked).toBe(false)
  })

  it('seans notuna yazmak, gecikme dolunca onNotKaydet\'i SEÇİLİ seansın kimliği/şablon/içerikle çağırır', async () => {
    const kayitlar: Array<[number, { sablon: string; icerik: string }]> = []
    render(
      <DanisanDosyasi
        {...proplar({
          seanslar: [seans({ appointment_id: 3 })],
          seciliSeansId: 3,
          not: not({ appointment_id: 3, sablon: 'dap', icerik: '' }),
          onNotKaydet: async (id, kayit) => {
            kayitlar.push([id, kayit])
          },
        })}
      />,
    )
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    vi.useFakeTimers()
    fireEvent.change(alan, { target: { value: 'Danışan bugün daha rahat görünüyordu' } })
    // `NotEditoru`nun varsayılan gecikmesi (2000 ms), gerçek üründeki hâliyle.
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(kayitlar).toEqual([
      [3, { sablon: 'dap', icerik: 'Danışan bugün daha rahat görünüyordu' }],
    ])
  })

  it('not yüklenemezse hata banner\'ı görünür, boş editör AÇILMAZ; "Yeniden dene" yukarıya bildirir', async () => {
    const onNotYenidenDene = vi.fn()
    render(
      <DanisanDosyasi
        {...proplar({ seanslar: [seans()], seciliSeansId: 1, notHata: 'sunucuya ulaşılamadı', onNotYenidenDene })}
      />,
    )
    const alarm = screen.getByRole('alert')
    expect(within(alarm).getByText(/sunucuya ulaşılamadı/)).toBeDefined()
    expect(screen.queryByLabelText('Seans notu')).toBeNull()
    await userEvent.click(within(alarm).getByRole('button', { name: 'Yeniden dene' }))
    expect(onNotYenidenDene).toHaveBeenCalledTimes(1)
  })
})

// Plan 6 Görev 6 — etikete göre süzme ve seçili seansın etiket satırı.
describe('DanisanDosyasi — etiketler', () => {
  function baglam(etiketler: { id: number; ad: string }[] = []) {
    return {
      etiketler: etiketler.map((e) => ({ ...e, kullanim: 1 })),
      hata: null,
      onYenidenDene: vi.fn(),
      sozluk: null,
      onSozlukIste: vi.fn(),
      onEkle: vi.fn(async () => {}),
      onKaldir: vi.fn(async () => {}),
      onEtiketAc: vi.fn(),
      yazmaHatasi: null,
      onYazmaHatasiTemizle: vi.fn(),
    }
  }

  const ETIKETLI = [
    seans({ appointment_id: 1, baslangic: '2026-09-14T10:00', etiketler: ['kaygı', 'uyku'] }),
    seans({ appointment_id: 2, baslangic: '2026-09-07T10:00', etiketler: ['aile'] }),
    seans({ appointment_id: 3, baslangic: '2026-08-31T10:00', etiketler: [] }),
  ]
  const satirlar = () =>
    within(screen.getByTestId('seans-listesi'))
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')

  it('"Etikete göre süz" yalnızca bu danışanın seanslarında kullanılan etiketleri sunar ve listeyi süzer', async () => {
    render(<DanisanDosyasi {...proplar({ seanslar: ETIKETLI, seciliSeansId: 1 })} />)
    const secim = screen.getByLabelText('Etikete göre süz') as HTMLSelectElement
    expect([...secim.options].map((o) => o.textContent)).toEqual([
      'Tüm seanslar',
      'aile',
      'kaygı',
      'uyku',
    ])
    expect(satirlar()).toHaveLength(3)

    await userEvent.selectOptions(secim, 'kaygı')
    expect(satirlar()).toHaveLength(1)
    expect(satirlar()[0]).toContain('14 Eylül 2026, 10:00')
    // Satır etiketlerini gösterir.
    expect(satirlar()[0]).toContain('kaygı')
    expect(satirlar()[0]).toContain('uyku')

    await userEvent.selectOptions(secim, '')
    expect(satirlar()).toHaveLength(3)
  })

  it('hiç etiket yoksa süzme seçimi çizilmez', () => {
    render(<DanisanDosyasi {...proplar({ seanslar: IKI_SEANS, seciliSeansId: 1 })} />)
    expect(screen.queryByLabelText('Etikete göre süz')).toBeNull()
  })

  it('seçili etiket son seanstan da kaldırılınca süzgeç "Tüm seanslar"a döner', async () => {
    const { rerender } = render(
      <DanisanDosyasi {...proplar({ seanslar: ETIKETLI, seciliSeansId: 1 })} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Etikete göre süz'), 'aile')
    expect(satirlar()).toHaveLength(1)

    rerender(
      <DanisanDosyasi
        {...proplar({
          seanslar: ETIKETLI.map((s) => (s.appointment_id === 2 ? { ...s, etiketler: [] } : s)),
          seciliSeansId: 1,
        })}
      />,
    )
    expect((screen.getByLabelText('Etikete göre süz') as HTMLSelectElement).value).toBe('')
    expect(satirlar()).toHaveLength(3)
  })

  it('etiket satırı SEÇİLİ seansın bağlamıyla çizilir', () => {
    const etiketBaglami = vi.fn((id: number) =>
      baglam(id === 2 ? [{ id: 9, ad: 'aile' }] : [{ id: 7, ad: 'kaygı' }]),
    )
    render(
      <DanisanDosyasi {...proplar({ seanslar: ETIKETLI, seciliSeansId: 2, etiketBaglami })} />,
    )
    expect(etiketBaglami).toHaveBeenCalledWith(2)
    expect(screen.getByRole('button', { name: 'aile etiketini kaldır' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'kaygı etiketini kaldır' })).toBeNull()
  })

  // `DanisanDosyasi` seçim değişince yeniden monte OLMUYOR (üretimde de:
  // listeden başka bir seansa tıklamak yalnızca `seciliSeansId`'yi
  // değiştirir). `EtiketSatiri`'nin kutudaki yazısı ve hatası yerel state —
  // `key` olmadan önceki seansa yazılan ad yeni seansın kutusunda kalır ve
  // Enter onu yanlış seansa ekler.
  it('seans değişince etiket kutusundaki yazı ve hata kalmaz (EtiketSatiri key\'li)', async () => {
    const etiketBaglami = () => baglam()
    const { rerender } = render(
      <DanisanDosyasi {...proplar({ seanslar: ETIKETLI, seciliSeansId: 1, etiketBaglami })} />,
    )
    const kutu = screen.getByLabelText('Etiket ekle') as HTMLInputElement
    await userEvent.type(kutu, 'a'.repeat(41) + '{Enter}')
    expect(screen.getByRole('alert').textContent).toContain('en fazla 40 karakter')
    expect(kutu.value).toHaveLength(41)

    rerender(
      <DanisanDosyasi {...proplar({ seanslar: ETIKETLI, seciliSeansId: 2, etiketBaglami })} />,
    )
    expect((screen.getByLabelText('Etiket ekle') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
