import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
})
