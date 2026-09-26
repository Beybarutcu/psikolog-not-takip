import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DanisanSeansi, SeansNotu } from '../api'
import type { EtiketBaglami } from '../etiket/EtiketSatiri'
import type { useSeansNotlari } from '../screens/anaEkranKancalari/useSeansNotlari'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { SeansSayfasi } from './SeansSayfasi'
import { taslaklariUnut } from './taslak'

const oncekiApi = vi.hoisted(() => ({ seanslar: vi.fn(), notGetir: vi.fn() }))
vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return {
    ...gercek,
    danisanApi: { ...gercek.danisanApi, seanslar: oncekiApi.seanslar },
    notApi: { ...gercek.notApi, notGetir: oncekiApi.notGetir },
    takvimApi: {
      ...gercek.takvimApi,
      cakismaKontrol: async () => ({ cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1 }),
    },
  }
})

const randevu: Randevu = {
  id: 101, client_id: 1, danisan_adi: 'Ayşe Yılmaz', baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}
const resmiNot: SeansNotu = {
  appointment_id: 101, client_id: 1, danisan_adi: 'Ayşe Yılmaz', seans_zamani: '2026-09-07T10:00',
  sablon: 'serbest', icerik: '<p>bu seansin resmi notu</p>', onizleme: 'bu seansin resmi notu',
  guncelleme_zamani: '2026-09-07T06:00:00Z',
}
const GIZLI = 'GIZLI-OZEL-SAYFA'
const GECEN_HAFTA: DanisanSeansi = {
  appointment_id: 90, baslangic: '2026-08-31T10:00', durum: 'geldi', ucret_kurus: null, odendi: false,
  not_ilk_satiri: 'gecen hafta', etiketler: [],
}

function akis(ozel: Partial<ReturnType<typeof useSeansNotlari>['seans']> = {}): ReturnType<typeof useSeansNotlari> {
  return {
    seans: { id: randevu.id, not: resmiNot, ozelNot: null, ozelHata: null, hata: null, ...ozel },
    notKaydet: vi.fn(async () => {}),
    notYansit: vi.fn(),
    ozelNotKaydet: vi.fn(async () => {}),
    ozelSekmeAcildi: vi.fn(),
    ozelYenidenDene: vi.fn(),
    yenidenDene: vi.fn(),
  }
}

const etiket: EtiketBaglami = {
  etiketler: [], hata: null, onYenidenDene: vi.fn(), sozluk: null, onSozlukIste: vi.fn(),
  onEkle: vi.fn(async () => {}), onKaldir: vi.fn(async () => {}), onEtiketAc: vi.fn(),
  yazmaHatasi: null, onYazmaHatasiTemizle: vi.fn(),
}

function kur(ozel: Partial<React.ComponentProps<typeof SeansSayfasi>> = {}) {
  const props = {
    randevu,
    seansAkisi: akis(),
    danisanlar: [{ id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' }],
    onTakvimeDon: vi.fn(),
    onDanisanAc: vi.fn(),
    onDurumDegis: vi.fn().mockResolvedValue(undefined),
    onOdemeDegis: vi.fn().mockResolvedValue(undefined),
    onRandevuKaydet: vi.fn(async () => {}),
    onRandevuSil: vi.fn(async () => {}),
    onSeriSil: vi.fn(async () => {}),
    onSeansaGit: vi.fn(),
    seansListesiOnbellegi: null as DanisanSeansi[] | null,
    etiket,
    ...ozel,
  }
  return { ...props, ...render(<SeansSayfasi {...props} />), props }
}

beforeEach(() => {
  taslaklariUnut()
  oncekiApi.seanslar.mockReset().mockResolvedValue([])
  oncekiApi.notGetir.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('SeansSayfasi (tasarım N1-N4)', () => {
  it('7.5 üst satır: Takvime dön, danışan adı (dosyaya), tarih-saat; bölge adı "Seans"', async () => {
    const p = kur()
    const sayfa = screen.getByRole('region', { name: 'Seans' })
    expect(sayfa.getAttribute('data-testid')).toBe('seans-bolumu')
    expect(sayfa.textContent).toContain('7 Eylül 2026, 10:00')
    await userEvent.click(screen.getByRole('button', { name: 'Takvime dön' }))
    expect(p.onTakvimeDon).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    expect(p.onDanisanAc).toHaveBeenCalledTimes(1)
    expect(p.onDanisanAc).toHaveBeenCalledWith(1)
  })

  it('7.6 N3: randevu formu KAPALI başlar; "Randevuyu düzenle" açar, "Kapat" gizler', async () => {
    kur()
    expect(screen.queryByRole('heading', { name: 'Randevu' })).toBeNull()
    const dugme = screen.getByRole('button', { name: 'Randevuyu düzenle' })
    expect(dugme.getAttribute('aria-expanded')).toBe('false')
    // Kapalıyken `aria-controls` YOK: form çizilmiyor, var olmayan bir id'yi
    // göstermek ekran okuyucuya kırık bir bağ verir (`SeansPaneli` sekme kuralı).
    expect(dugme.getAttribute('aria-controls')).toBeNull()
    await userEvent.click(dugme)
    expect(screen.getByRole('heading', { name: 'Randevu' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Güncelle' })).toBeDefined()
    const kapat = screen.getByRole('button', { name: 'Kapat' })
    expect(kapat.getAttribute('aria-expanded')).toBe('true')
    // Açıkken gerçek form kabını gösterir (ARTI YÖN: hiç `aria-controls`
    // koymayan bir düğme de üstteki iddiayı geçerdi).
    const hedef = kapat.getAttribute('aria-controls')
    expect(hedef).toBe('seans-randevu-formu')
    expect(document.getElementById(hedef!)!.contains(screen.getByRole('heading', { name: 'Randevu' }))).toBe(true)
    await userEvent.click(kapat)
    expect(screen.queryByRole('heading', { name: 'Randevu' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Randevuyu düzenle' }).getAttribute('aria-controls')).toBeNull()
  })

  it('7.7 N2: durum, ücret ve Ödendi üst satırda; yazma yolu çağıranın', async () => {
    const p = kur()
    const grup = screen.getByRole('group', { name: 'Seans durumu' })
    await userEvent.click(within(grup).getByRole('button', { name: 'Gelmedi' }))
    expect(p.onDurumDegis).toHaveBeenCalledWith('gelmedi')
    expect(screen.getByText('450,00 TL')).toBeDefined()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ödendi' }))
    expect(p.onOdemeDegis).toHaveBeenCalledWith(true)
  })

  it('7.8 N4: editör alanı sekmeli; özel not sekmeye girilmeden istenmez', async () => {
    const p = kur()
    expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toBe('<p>bu seansin resmi notu</p>')
    expect(p.seansAkisi.ozelSekmeAcildi).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    expect(p.seansAkisi.ozelSekmeAcildi).toHaveBeenCalledTimes(1)
  })

  it('7.9 not okunamazsa hata ve Yeniden dene; durum düğmeleri YİNE var, önceki notlar sütunu yok', async () => {
    const p = kur({ seansAkisi: akis({ not: null, hata: 'Sunucuya ulaşılamadı.' }) })
    expect(screen.getByRole('alert').textContent).toContain('Sunucuya ulaşılamadı.')
    await userEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }))
    expect(p.seansAkisi.yenidenDene).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('group', { name: 'Seans durumu' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Önceki seans notları' })).toBeNull()
  })

  it('7.10 özel not önceki notlar sütununda HİÇBİR biçimde görünmez (özel sekme açık, eski not açılmış)', async () => {
    oncekiApi.seanslar.mockResolvedValue([GECEN_HAFTA])
    oncekiApi.notGetir.mockResolvedValue({ ...resmiNot, appointment_id: 90, icerik: '<p>gecen hafta</p>' })
    kur({ seansAkisi: akis({ ozelNot: { appointment_id: 101, icerik: GIZLI, guncelleme_zamani: 'z' } }) })
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    expect((screen.getByLabelText('Özel notum') as HTMLTextAreaElement).value).toBe(GIZLI)
    const sutun = screen.getByRole('region', { name: 'Önceki seans notları' })
    await userEvent.click(await within(sutun).findByRole('button', { name: /31 Ağustos 2026, 10:00/ }))
    await waitFor(() => expect(sutun.textContent).toContain('gecen hafta'))
    expect(sutun.textContent).not.toContain(GIZLI)
    expect(oncekiApi.notGetir).toHaveBeenCalledWith(90)
  })

  it('8.8 geniş okuma sütunu yarıya büyütür; editör AYNI düğüm kalır (yazılmamış metin kaybolmaz)', async () => {
    oncekiApi.seanslar.mockResolvedValue([GECEN_HAFTA])
    oncekiApi.notGetir.mockResolvedValue({ ...resmiNot, appointment_id: 90, icerik: '<p>gecen hafta</p>' })
    kur()
    const editor = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '<p>yazılıyor</p>' } })
    const sutun = screen.getByRole('region', { name: 'Önceki seans notları' }).parentElement!
    expect(sutun.className).toContain('w-80')
    await userEvent.click(await screen.findByRole('button', { name: /31 Ağustos 2026, 10:00/ }))
    await waitFor(() => expect(sutun.className).toContain('w-1/2'))
    expect(screen.getByLabelText('Seans notu')).toBe(editor)
    expect(editor.value).toBe('<p>yazılıyor</p>')
  })

  it('"Bu seansa git" sayfanın onSeansaGit özelliğine (takvim.randevuyaGit) seansın kimliği ve başlangıcıyla gider', async () => {
    oncekiApi.seanslar.mockResolvedValue([GECEN_HAFTA])
    oncekiApi.notGetir.mockResolvedValue({ ...resmiNot, appointment_id: 90, icerik: '<p>gecen hafta</p>' })
    const p = kur()
    await userEvent.click(await screen.findByRole('button', { name: /31 Ağustos 2026, 10:00/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Bu seansa git' }))
    expect(p.onSeansaGit).toHaveBeenCalledTimes(1)
    expect(p.onSeansaGit).toHaveBeenCalledWith(90, '2026-08-31T10:00')
  })

  it('preflight F7: sayfa danışan dosyasının önbelleğini panele geçirir; önbellek varken liste İSTENMEZ', async () => {
    kur({ seansListesiOnbellegi: [{ ...GECEN_HAFTA, not_ilk_satiri: 'ONBELLEKTEN' }] })
    const sutun = screen.getByRole('region', { name: 'Önceki seans notları' })
    expect(sutun.textContent).toContain('ONBELLEKTEN')
    await new Promise((r) => setTimeout(r, 0))
    expect(oncekiApi.seanslar).not.toHaveBeenCalled()
  })

  // Sayfa randevu KİMLİĞİYLE `key`li: randevu formdan BAŞKA bir danışana
  // taşınınca sayfa yeniden kurulmaz, yalnızca `randevu` prop'u değişir
  // (dördüncü biçim: geçiş). Önceki danışanın açık notu yeni danışanın
  // sayfasında kalsaydı ekranda yanlış danışanın notu dururdu.
  it('randevu başka danışana taşınınca eski danışanın açık notu ekranda KALMAZ; sütun daralır, liste yeni danışan için', async () => {
    oncekiApi.seanslar.mockImplementation(async (id: number) => (id === 1 ? [GECEN_HAFTA] : []))
    oncekiApi.notGetir.mockResolvedValue({ ...resmiNot, appointment_id: 90, icerik: '<p>AYSE GECEN HAFTA</p>' })
    const { rerender, props } = kur()
    const sutun = () => screen.getByRole('region', { name: 'Önceki seans notları' }).parentElement!
    await userEvent.click(await screen.findByRole('button', { name: /31 Ağustos 2026, 10:00/ }))
    await waitFor(() => expect(sutun().textContent).toContain('AYSE GECEN HAFTA'))
    expect(sutun().className).toContain('w-1/2')

    rerender(<SeansSayfasi {...props} randevu={{ ...randevu, client_id: 2, danisan_adi: 'Mehmet Demir' }} />)
    await waitFor(() => expect(oncekiApi.seanslar).toHaveBeenLastCalledWith(2))
    expect(document.body.textContent).not.toContain('AYSE GECEN HAFTA')
    expect(sutun().className).toContain('w-80')
    expect(await within(sutun()).findByText('Bu seanstan önce kayıtlı seans yok.')).toBeDefined()
  })
})
