import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RandevuPaneli } from './RandevuPaneli'

const danisanlar = [
  { id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' },
  { id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif' },
]

const mevcut = {
  id: 7, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T14:00', bitis: '2026-09-07T15:00',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}

function kur(ozel = {}) {
  const props = {
    zaman: '2026-09-07T14:00',
    randevu: null as typeof mevcut | null,
    danisanlar,
    onKaydet: vi.fn().mockResolvedValue(undefined),
    onDurumDegis: vi.fn().mockResolvedValue(undefined),
    onSil: vi.fn().mockResolvedValue(undefined),
    onKapat: vi.fn(),
    cakismaKontrol: vi.fn().mockResolvedValue([]),
    ...ozel,
  }
  render(<RandevuPaneli {...props} />)
  return props
}

describe('RandevuPaneli', () => {
  it('yeni randevuda danışan seçilmeden kaydetmez', async () => {
    const props = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(screen.getByText(/danışan seçin/i)).toBeDefined()
    expect(props.onKaydet).not.toHaveBeenCalled()
  })

  it('danışan ve süre ile kaydeder', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 2,
        baslangic: '2026-09-07T14:00',
        bitis: '2026-09-07T15:00',
      }),
    )
  })

  it('ücreti kuruşa çevirir', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '450')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ ucret: 45000 }))
  })

  it('çakışma varsa uyarır ama kaydetmeyi engellemez', async () => {
    const props = kur({ cakismaKontrol: vi.fn().mockResolvedValue([mevcut]) })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '2')

    await waitFor(() => expect(screen.getByText(/bu saatte başka randevu var/i)).toBeDefined())

    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(props.onKaydet).toHaveBeenCalled()
  })

  it('tekrar sayısı verilince kaydete geçirilir', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByLabelText('Her hafta tekrarla'))
    await userEvent.clear(screen.getByLabelText('Kaç hafta'))
    await userEvent.type(screen.getByLabelText('Kaç hafta'), '8')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ tekrar_sayisi: 8 }))
  })

  it('mevcut randevuda durum düğmeleri görünür ve çalışır', async () => {
    const props = kur({ randevu: mevcut })
    await userEvent.click(screen.getByRole('button', { name: 'Geldi' }))
    expect(props.onDurumDegis).toHaveBeenCalledWith(7, 'geldi')
  })

  it('yeni randevuda durum düğmeleri görünmez', () => {
    kur()
    expect(screen.queryByRole('button', { name: 'Geldi' })).toBeNull()
  })

  it('silme onay ister', async () => {
    const props = kur({ randevu: mevcut })
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    expect(props.onSil).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Evet, sil' }))
    expect(props.onSil).toHaveBeenCalledWith(7)
  })

  // --- Görev 10 inceleme bulguları --------------------------------------

  afterEach(() => {
    vi.useRealTimers()
  })

  it('Bulgu 2: kaydet sürerken düğme devre dışı kalır, çift tıklama tek çağrı üretir', async () => {
    let cozKaydet: () => void = () => {}
    const onKaydet = vi.fn(
      () => new Promise<void>((resolve) => {
        cozKaydet = resolve
      }),
    )
    const props = kur({ onKaydet })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')

    const kaydetDugmesi = screen.getByRole('button', { name: 'Kaydet' })
    await userEvent.click(kaydetDugmesi)
    expect((kaydetDugmesi as HTMLButtonElement).disabled).toBe(true)

    // İşlem sürerken ikinci tıklama devre dışı düğmede yok sayılır.
    await userEvent.click(kaydetDugmesi)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)

    cozKaydet()
    await waitFor(() => expect((kaydetDugmesi as HTMLButtonElement).disabled).toBe(false))
  })

  it('Bulgu 2: silme sürerken "Evet, sil" devre dışı kalır, çift tıklama tek çağrı üretir', async () => {
    let cozSil: () => void = () => {}
    const onSil = vi.fn(
      () => new Promise<void>((resolve) => {
        cozSil = resolve
      }),
    )
    const props = kur({ randevu: mevcut, onSil })
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))

    const evetSil = screen.getByRole('button', { name: 'Evet, sil' })
    await userEvent.click(evetSil)
    expect((evetSil as HTMLButtonElement).disabled).toBe(true)

    await userEvent.click(evetSil)
    expect(props.onSil).toHaveBeenCalledTimes(1)

    cozSil()
    await waitFor(() => expect((evetSil as HTMLButtonElement).disabled).toBe(false))
  })

  it('Bulgu 3: çakışma kontrolü süre değişince gecikmeli (debounce) çağrılır', async () => {
    vi.useFakeTimers()
    try {
      const cakismaKontrol = vi.fn().mockResolvedValue([])
      kur({ cakismaKontrol })

      // Mount anında bir zamanlayıcı kurulur ama 300ms dolmadan istek gitmez.
      await act(() => vi.advanceTimersByTimeAsync(200))
      expect(cakismaKontrol).not.toHaveBeenCalled()
      await act(() => vi.advanceTimersByTimeAsync(100))
      expect(cakismaKontrol).toHaveBeenCalledTimes(1)

      const sureAlani = screen.getByLabelText('Süre (dakika)')
      // Art arda üç değişiklik — eski yarış durumu koruması (iptal bayrağı)
      // hâlâ geçerli olmalı, ama debounce sayesinde tek istek gitmeli.
      fireEvent.change(sureAlani, { target: { value: '61' } })
      fireEvent.change(sureAlani, { target: { value: '62' } })
      fireEvent.change(sureAlani, { target: { value: '63' } })

      await act(() => vi.advanceTimersByTimeAsync(200))
      expect(cakismaKontrol).toHaveBeenCalledTimes(1) // henüz 300ms dolmadı

      await act(() => vi.advanceTimersByTimeAsync(150))
      expect(cakismaKontrol).toHaveBeenCalledTimes(2) // yalnızca son değerle
    } finally {
      vi.useRealTimers()
    }
  })

  it('Bulgu 5: ücret sayıya çevrilemiyorsa kaydetmeyi durdurur ve uyarı gösterir', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(screen.getByText(/ücret.*sayısal/i)).toBeDefined()
    expect(props.onKaydet).not.toHaveBeenCalled()
  })

  it('Bulgu 5: ücret alanı boşsa kaydetmeye devam eder (null geçerli)', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ ucret: null }))
  })

  it('Bulgu 4: sunucu hatası panelin içinde de gösterilir', async () => {
    const onKaydet = vi.fn().mockRejectedValue(new Error('Ücret negatif olamaz.'))
    kur({ onKaydet })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(await screen.findByText('Ücret negatif olamaz.')).toBeDefined()
  })
})
