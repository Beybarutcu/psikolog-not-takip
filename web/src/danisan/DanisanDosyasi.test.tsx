import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DanisanDosyasi as DanisanKaydi, DanisanSeansi, SeansNotu } from '../api'
import type { KartVerisi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import { taslaklariUnut } from '../seans/taslak'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { DanisanDosyasi, type DosyaAltSekme } from './DanisanDosyasi'

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
    danisan_adi: 'Ayşe Kaya',
    seans_zamani: '2026-09-14T10:00',
    sablon: 'serbest',
    icerik: '',
    onizleme: null,
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
    simdi: '2026-09-20T12:00',
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

/**
 * Alt sekmeyi ve seçimi GERÇEK durumla tutan sarmalayıcı (üretimde
 * `AnaEkran` + `useDanisanSeanslari`). B2 bağlantılarının "Seanslar'a geç
 * ve seç" etkisi yalnızca böyle ölçülür.
 */
function Kontrollu({
  ilkAltSekme = 'seanslar',
  ilkSecili = null,
  ...oz
}: Partial<Proplar> & { ilkAltSekme?: DosyaAltSekme; ilkSecili?: number | null }) {
  const [altSekme, setAltSekme] = useState<DosyaAltSekme>(ilkAltSekme)
  const [secili, setSecili] = useState<number | null>(ilkSecili)
  return (
    <DanisanDosyasi
      {...proplar({ ...oz, altSekme, onAltSekme: setAltSekme, seciliSeansId: secili, onSeansSec: setSecili })}
    />
  )
}

function randevu(oz: Partial<Randevu>): Randevu {
  return {
    id: 1, client_id: 12, danisan_adi: 'Ayşe Yılmaz',
    baslangic: '2026-09-14T10:00', bitis: '2026-09-14T10:50',
    durum: 'geldi', ucret: 90000, odendi: false, seri_id: null, ...oz,
  }
}

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

describe('DanisanDosyasi — bos not, takvimdeki SeansPaneli ile AYNI acilir (Gorev 6e)', () => {
  // Eskiden bu ekran bos icerigi HAM ('') aciyordu; SeansPaneli.tsx (takvim)
  // aynı seansı şablon başlıklarıyla açıyordu. Aynı seans, hangi ekrandan
  // bakıldığına göre farklı görünüyordu -- "iki ekran aynı seansı aynı
  // gösterir" kuralının dışındaydı. Karar: dosya ekranı da SeansPaneli'nin
  // davranışını benimser (bkz. `DanisanDosyasi.tsx`'teki NotEditoru yorumu).
  it('sunucudaki not BOSSA sablon basliklari acilista gorunur', () => {
    render(
      <DanisanDosyasi
        {...proplar({
          seanslar: [seans({ appointment_id: 7 })],
          seciliSeansId: 7,
          not: not({ appointment_id: 7, sablon: 'dap', icerik: '' }),
        })}
      />,
    )
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    // Textarea test yüzeyi (`test-kurulum.ts`): `.value` iddiaları buna dayanıyor.
    expect(alan.tagName).toBe('TEXTAREA')
    expect(alan.value).toContain('<h2>Veri</h2>')
    expect(alan.value).toContain('<h2>Değerlendirme</h2>')
    expect(alan.value).toContain('<h2>Plan</h2>')
  })

  it('basliklar acilista HICBIR kayit uretmez', async () => {
    vi.useFakeTimers()
    try {
      const onNotKaydet = vi.fn(async () => {})
      const { unmount } = render(
        <DanisanDosyasi
          {...proplar({
            seanslar: [seans({ appointment_id: 7 })],
            seciliSeansId: 7,
            not: not({ appointment_id: 7, sablon: 'dap', icerik: '' }),
            onNotKaydet,
          })}
        />,
      )
      await act(() => vi.advanceTimersByTimeAsync(10_000))
      expect(onNotKaydet).not.toHaveBeenCalled()
      unmount()
      expect(onNotKaydet).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('DOLU notun basina baslik EKLENMEZ', () => {
    render(
      <DanisanDosyasi
        {...proplar({
          seanslar: [seans({ appointment_id: 7 })],
          seciliSeansId: 7,
          not: not({ appointment_id: 7, sablon: 'dap', icerik: 'zaten yazilmis metin' }),
        })}
      />,
    )
    expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toBe(
      'zaten yazilmis metin',
    )
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

// Plan B Görev 3 — başlık özeti (tasarım B2). "Şimdi" = proplar'ın simdi'si (20 Eylül 12:00).
describe('DanisanDosyasi — başlık özeti (tasarım B2)', () => {
  afterEach(() => vi.restoreAllMocks())

  const RANDEVULAR = [
    randevu({ id: 1, baslangic: '2026-03-03T10:00', bitis: '2026-03-03T10:50', odendi: true }),
    randevu({ id: 2, baslangic: '2026-09-08T10:00', bitis: '2026-09-08T10:50' }),
    randevu({ id: 3, baslangic: '2026-09-15T10:00', bitis: '2026-09-15T10:50', durum: 'gelmedi' }),
    randevu({ id: 4, baslangic: '2026-09-17T10:00', bitis: '2026-09-17T10:50', durum: 'iptal' }),
    randevu({ id: 5, baslangic: '2026-09-18T10:00', bitis: '2026-09-18T10:50', durum: 'planlandi' }),
    randevu({ id: 6, baslangic: '2026-09-24T14:00', bitis: '2026-09-24T14:50', durum: 'planlandi' }),
  ]
  // Aynı seansların dosya listesi karşılığı (sunucu sırası: en yeni üstte).
  const SEANSLAR = [...RANDEVULAR].reverse().map((r) =>
    seans({ appointment_id: r.id, baslangic: r.baslangic, durum: r.durum, ucret_kurus: r.ucret, odendi: r.odendi }),
  )
  const OZET =
    "2. seans · Mart 2026'dan beri · Son: 8 Eylül · Sıradaki: Perşembe 24 Eylül 14:00 · Ödenmemiş: 1.800,00 TL (+1 işaretlenmemiş)"
  const kartIle = (randevular: Randevu[]) => ({ ...sahteKart(), randevular })
  const ozet = () => screen.getByTestId('dosya-ozeti')
  const aktifSatir = () =>
    within(screen.getByTestId('seans-listesi')).getByRole('button', { current: true }).textContent

  it('adın hemen altında tek satır; iki alt sekmede de görünür', () => {
    const { rerender } = render(
      <DanisanDosyasi {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 5 })} />,
    )
    expect(ozet().textContent).toBe(OZET)
    expect(ozet().previousElementSibling).toBe(screen.getByRole('heading', { level: 2 }))
    rerender(
      <DanisanDosyasi
        {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 5, altSekme: 'bilgiler' })}
      />,
    )
    expect(ozet().textContent).toBe(OZET)
  })

  it('"Ödenmemiş" Bilgiler\'deki bakiyeyle AYNI sayı (gelmedi borcu dahil)', () => {
    render(<DanisanDosyasi {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, altSekme: 'bilgiler' })} />)
    const ozettekiBorc = /Ödenmemiş: ([\d.,]+ TL)/.exec(ozet().textContent ?? '')?.[1]
    const bakiye = screen.getAllByRole('term').find((e) => e.textContent === 'Bakiye')?.nextElementSibling?.textContent
    expect(ozettekiBorc).toBe('1.800,00 TL')
    expect(bakiye).toBe(ozettekiBorc)
  })

  it('olmayan parça yazılmaz: randevu yoksa satır yok; borç yokken işaretlenmemiş kendi parçasıdır', () => {
    const { rerender } = render(<DanisanDosyasi {...proplar({ kart: kartIle([]) })} />)
    expect(screen.queryByTestId('dosya-ozeti')).toBeNull()
    rerender(<DanisanDosyasi {...proplar({ kart: kartIle([RANDEVULAR[4]]) })} />)
    expect(ozet().textContent).toBe('1 işaretlenmemiş seans')
    expect(within(ozet()).queryAllByRole('button')).toHaveLength(0)
  })

  it('bağlantı Seanslar alt sekmesine geçer ve o seansı seçer (Bilgiler\'den de)', async () => {
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={SEANSLAR} ilkAltSekme="bilgiler" ilkSecili={5} />)
    await userEvent.click(within(ozet()).getByRole('button', { name: 'Son: 8 Eylül' }))
    expect(screen.getByRole('tab', { name: 'Seanslar' }).getAttribute('aria-selected')).toBe('true')
    expect(aktifSatir()).toContain('8 Eylül 2026, 10:00')
    // Odak TAŞINMAZ (tasarım B2): bağlantı seçer ve gösterir, imleci
    // listeye ya da nota götürmez; tıklanan bağlantı odakta kalır.
    expect(document.activeElement).toBe(within(ozet()).getByRole('button', { name: 'Son: 8 Eylül' }))

    await userEvent.click(within(ozet()).getByRole('button', { name: "Mart 2026'dan beri" }))
    expect(aktifSatir()).toContain('3 Mart 2026, 10:00')
    await userEvent.click(within(ozet()).getByRole('button', { name: 'Sıradaki: Perşembe 24 Eylül 14:00' }))
    expect(aktifSatir()).toContain('24 Eylül 2026, 14:00')
    expect(document.activeElement).toBe(
      within(ozet()).getByRole('button', { name: 'Sıradaki: Perşembe 24 Eylül 14:00' }),
    )
  })

  it('seans etiket süzgecinde gizliyse süzgeç "Tüm seanslar"a çekilir; görünüyorsa süzgeç korunur', async () => {
    const etiketli = SEANSLAR.map((s) =>
      s.appointment_id === 1 ? { ...s, etiketler: ['kaygı'] } : s.appointment_id === 2 ? { ...s, etiketler: ['uyku'] } : s,
    )
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={etiketli} ilkSecili={5} />)
    const secim = () => screen.getByLabelText('Etikete göre süz') as HTMLSelectElement
    await userEvent.selectOptions(secim(), 'kaygı')
    await userEvent.click(within(ozet()).getByRole('button', { name: 'Son: 8 Eylül' }))
    expect(secim().value).toBe('')
    expect(aktifSatir()).toContain('8 Eylül 2026, 10:00')

    // EKSİ YÖN: hedef süzgeçte görünüyorsa süzgece dokunulmaz.
    await userEvent.selectOptions(secim(), 'kaygı')
    await userEvent.click(within(ozet()).getByRole('button', { name: "Mart 2026'dan beri" }))
    expect(secim().value).toBe('kaygı')
    expect(aktifSatir()).toContain('3 Mart 2026, 10:00')
  })

  it('bağlantı seçilen satırı görünür alana getirir; ZATEN seçili seansın bağlantısı da yeniden getirir', async () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={SEANSLAR} ilkSecili={2} />)
    const satirDugmesi = (metin: string) =>
      within(screen.getByTestId('seans-listesi')).getByText(metin).closest('button')
    // Açılışta seçili satır (takvimden/aramadan gelmekle aynı yol).
    expect(kaydir).toHaveBeenCalledTimes(1)
    expect(kaydir.mock.contexts[0]).toBe(satirDugmesi('8 Eylül 2026, 10:00'))

    await userEvent.click(within(ozet()).getByRole('button', { name: "Mart 2026'dan beri" }))
    expect(kaydir).toHaveBeenCalledTimes(2)
    expect(kaydir.mock.contexts[1]).toBe(satirDugmesi('3 Mart 2026, 10:00'))
    expect(kaydir).toHaveBeenLastCalledWith({ block: 'nearest' })

    // Seçim DEĞİŞMEDİ ama kullanıcı istedi (listeyi kaydırmış olabilir).
    await userEvent.click(within(ozet()).getByRole('button', { name: "Mart 2026'dan beri" }))
    expect(kaydir).toHaveBeenCalledTimes(3)
  })

  it('özet ve bağlantılar istek ATMAZ (tek kaynak kart.randevular)', async () => {
    const fetchCasusu = vi.spyOn(globalThis, 'fetch')
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={SEANSLAR} ilkAltSekme="bilgiler" ilkSecili={5} />)
    // Üç bağlantının üçü de (ilki Bilgiler'den: alt sekme geçişi de dahil).
    for (const ad of ['Son: 8 Eylül', "Mart 2026'dan beri", 'Sıradaki: Perşembe 24 Eylül 14:00']) {
      await userEvent.click(within(ozet()).getByRole('button', { name: ad }))
    }
    expect(aktifSatir()).toContain('24 Eylül 2026, 14:00')
    expect(fetchCasusu).not.toHaveBeenCalled()
  })
})

// Plan B Görev 4 — uzun geçmiş (tasarım B3). "Şimdi" 20 Eylül 12:00.
describe('DanisanDosyasi — uzun geçmiş (tasarım B3)', () => {
  afterEach(() => vi.restoreAllMocks())

  const RANDEVULAR = [
    randevu({ id: 6, baslangic: '2026-09-24T14:00', bitis: '2026-09-24T14:50', durum: 'planlandi' }),
    randevu({ id: 1, baslangic: '2026-09-14T10:00', bitis: '2026-09-14T10:50' }),
    randevu({ id: 2, baslangic: '2026-09-08T10:00', bitis: '2026-09-08T10:50' }),
    randevu({ id: 3, baslangic: '2026-08-31T10:00', bitis: '2026-08-31T10:50' }),
  ]
  const SEANSLAR = [
    seans({ appointment_id: 6, baslangic: '2026-09-24T14:00', durum: 'planlandi' }),
    seans({ appointment_id: 1, baslangic: '2026-09-14T10:00', etiketler: ['kaygı'] }),
    seans({ appointment_id: 2, baslangic: '2026-09-08T10:00' }),
    seans({ appointment_id: 3, baslangic: '2026-08-31T10:00', etiketler: ['kaygı'] }),
  ]
  const kartIle = (randevular: Randevu[]) => ({ ...sahteKart(), randevular })
  const liste = () => screen.getByTestId('seans-listesi')
  const basliklar = () => within(liste()).getAllByRole('heading').map((h) => h.textContent)
  const numara = (t: string) =>
    within(within(liste()).getByText(t).closest('button') as HTMLElement).queryByTestId('seans-numarasi')?.textContent ?? null

  it('gruplama süzgeçten SONRA; numara süzgeçten bağımsız (kart.randevular\'dan)', async () => {
    render(<DanisanDosyasi {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 1 })} />)
    expect(basliklar()).toEqual(['Yaklaşan (1)', 'Eylül 2026 · 2 seans', 'Ağustos 2026 · 1 seans'])
    expect(numara('14 Eylül 2026, 10:00')).toBe('#3')
    expect(numara('31 Ağustos 2026, 10:00')).toBe('#1')

    await userEvent.selectOptions(screen.getByLabelText('Etikete göre süz'), 'kaygı')
    expect(basliklar()).toEqual(['Eylül 2026 · 1 seans', 'Ağustos 2026 · 1 seans'])
    expect(numara('14 Eylül 2026, 10:00')).toBe('#3')
    expect(numara('31 Ağustos 2026, 10:00')).toBe('#1')
  })

  it('B2 "Sıradaki" bağlantısı katlı Yaklaşan\'ı açar, satırı seçer ve görünür alana getirir', async () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={SEANSLAR} ilkSecili={1} />)
    const dugme = within(liste()).getByRole('button', { name: 'Yaklaşan (1)' })
    expect(dugme.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(
      within(screen.getByTestId('dosya-ozeti')).getByRole('button', { name: 'Sıradaki: Perşembe 24 Eylül 14:00' }),
    )
    expect(dugme.getAttribute('aria-expanded')).toBe('true')
    const hedef = within(liste()).getByText('24 Eylül 2026, 14:00').closest('button')
    expect(hedef?.getAttribute('aria-current')).toBe('true')
    expect(kaydir.mock.contexts.at(-1)).toBe(hedef)
  })

  it('aylar arasında taşınan randevu: boşalan ay başlığı kalkar, #n ve "…\'dan beri" yeni sıraya göre', () => {
    const { rerender } = render(
      <DanisanDosyasi {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 1 })} />,
    )
    expect(screen.getByTestId('dosya-ozeti').textContent).toContain("Ağustos 2026'dan beri")

    // Takvimde taşıma: kart `randevularTazele` ile, liste `yapiDegisti` ile
    // yeniden çekilir; ikisi de yeni başlangıcı taşır.
    rerender(
      <DanisanDosyasi
        {...proplar({
          kart: kartIle(
            RANDEVULAR.map((r) => (r.id === 3 ? { ...r, baslangic: '2026-09-10T10:00', bitis: '2026-09-10T10:50' } : r)),
          ),
          seanslar: SEANSLAR.map((x) => (x.appointment_id === 3 ? { ...x, baslangic: '2026-09-10T10:00' } : x)),
          seciliSeansId: 1,
        })}
      />,
    )
    expect(basliklar()).toEqual(['Yaklaşan (1)', 'Eylül 2026 · 3 seans'])
    expect(numara('8 Eylül 2026, 10:00')).toBe('#1')
    expect(numara('10 Eylül 2026, 10:00')).toBe('#2')
    expect(numara('14 Eylül 2026, 10:00')).toBe('#3')
    expect(screen.getByTestId('dosya-ozeti').textContent).toContain("Eylül 2026'dan beri")
  })

  it('liste sütunu kendi içinde kayar; not sütunu ondan ayrı', () => {
    render(
      <DanisanDosyasi
        {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 1, not: not({ appointment_id: 1 }) })}
      />,
    )
    const sutun = screen.getByTestId('seans-listesi-sutunu')
    for (const sinif of ['sticky', 'top-0', 'self-start', 'max-h-[100dvh]', 'overflow-y-auto']) {
      expect(sutun.className, sinif).toContain(sinif)
    }
    expect(sutun.contains(liste())).toBe(true)
    expect(sutun.contains(screen.getByLabelText('Seans notu'))).toBe(false)
    // Sütundaki tam genişlik süzgeç seçiminin odak çerçevesi de kırpılmaz
    // (satırlar ve Yaklaşan düğmesi `SeansListesi.test.tsx`'te).
    const secim = screen.getByLabelText('Etikete göre süz')
    expect(sutun.contains(secim)).toBe(true)
    for (const sinif of ['focus-visible:outline-hidden', 'focus-visible:ring-2', 'focus-visible:ring-inset']) {
      expect(secim.className, sinif).toContain(sinif)
    }
  })

  // Kullanıcı isteği 2026-09-27 ("araç çubuğu örtmesin notu"): not sütunu
  // ekranın kalanını doldurur ve notla uzamaz; uzun not yüzeyin kendi yazı
  // alanında kayar (`BicimliYuzey`). Yerleşim `e2e/yerlesim.spec.ts` > "arac
  // cubugu notu ortmez"de ölçülür; burada yapı ve sınıflar.
  it('not sütunu ekran boyu esnek sütun: editör, etiket ve durum satırı içinde; editör kalanı alır', () => {
    // İnceleme M1: sütunun üst kenarı sabit (`13rem`) değil, ÖLÇÜLÜR:
    // ızgaranın sayfa kaymamışken üst kenarı (kutunun üstü + `scrollY`).
    // jsdom yerleşim ölçmez: ızgaranın kutusu ve sayfa kayması taklit.
    const kutu = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = this.id === 'danisan-dosyasi-panel-seanslar' ? 179.4 : 0
      return { top, bottom: top, left: 0, right: 0, x: 0, y: top, width: 0, height: 0, toJSON: () => ({}) }
    })
    const kayma = Object.getOwnPropertyDescriptor(window, 'scrollY')
    Object.defineProperty(window, 'scrollY', { value: 40, configurable: true })
    render(
      <DanisanDosyasi
        {...proplar({
          kart: kartIle(RANDEVULAR),
          seanslar: SEANSLAR,
          seciliSeansId: 1,
          not: not({ appointment_id: 1 }),
          etiketBaglami: () => ({
            etiketler: [], hata: null, onYenidenDene: vi.fn(), sozluk: null, onSozlukIste: vi.fn(),
            onEkle: vi.fn(async () => {}), onKaldir: vi.fn(async () => {}), onEtiketAc: vi.fn(),
            yazmaHatasi: null, onYazmaHatasiTemizle: vi.fn(),
          }),
        })}
      />,
    )
    const sutun = screen.getByTestId('seans-notu-sutunu')
    try {
      for (const sinif of ['sticky', 'top-0', 'self-start', 'flex', 'flex-col', 'min-h-[calc(100dvh-var(--not-sutunu-ust,12rem)-1rem)]']) {
        expect(sutun.classList.contains(sinif), sinif).toBe(true)
      }
      // 179,4 + 40 = 219,4 → 219 px: sütunun sayfadaki üst kenarı.
      expect(screen.getByRole('tabpanel').style.getPropertyValue('--not-sutunu-ust')).toBe('219px')
    } finally {
      kutu.mockRestore()
      if (kayma) Object.defineProperty(window, 'scrollY', kayma)
      else delete (window as { scrollY?: number }).scrollY
    }
    const editor = screen.getByLabelText('Seans notu')
    expect(sutun.contains(editor)).toBe(true)
    expect(sutun.contains(screen.getByRole('group', { name: 'Seans durumu' }))).toBe(true)
    expect(sutun.contains(screen.getByTestId('etiket-satiri'))).toBe(true)
    // Editörün kökü (`NotEditoru`) sütunun doğrudan çocuğu ve kalan boyu alır.
    const editorKoku = Array.from(sutun.children).find((c) => c.contains(editor))!
    for (const sinif of ['flex', 'flex-1', 'flex-col']) expect(editorKoku.classList.contains(sinif), sinif).toBe(true)
  })
})
