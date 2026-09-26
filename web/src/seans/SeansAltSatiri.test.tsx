import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { SeansAltSatiri } from './SeansAltSatiri'

// `SeansPaneli.test.tsx`'ten taşındı (Görev 7): alt satır artık panelin
// değil, not sayfasının üst satırının parçası (tasarım N2) ve danışan
// dosyasında ayrı satır olarak duruyor — testler bileşenin kendisini sürüyor.

const ornekRandevu: Randevu = {
  id: 101, client_id: 1, danisan_adi: 'Ayşe Yılmaz', baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
  durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
}
type SatirProps = React.ComponentProps<typeof SeansAltSatiri>

function propsKur(ozel: Partial<SatirProps> = {}) {
  return {
    randevu: ornekRandevu,
    onDurumDegis: vi.fn().mockResolvedValue(undefined),
    onOdemeDegis: vi.fn().mockResolvedValue(undefined),
    ...ozel,
  }
}
function satir(ozel: Partial<SatirProps> = {}) {
  return <SeansAltSatiri {...propsKur(ozel)} />
}
function kur(ozel: Partial<SatirProps> = {}) {
  const props = propsKur(ozel)
  return { ...props, ...render(<SeansAltSatiri {...props} />) }
}

afterEach(() => vi.restoreAllMocks())

// Plan 4 Görev 2 — tasarım §6: "Panelin altında tek satırda: geldi/gelmedi/
// iptal + ücret + ödendi."
describe('SeansAltSatiri — durum, ücret, ödendi', () => {
  it('odendi kutusu isaretlenince TEK istek gider ve kutu isaretli kalir', async () => {
    const onOdemeDegis = vi.fn().mockResolvedValue(undefined)
    kur({ randevu: { ...ornekRandevu, ucret: 45000, odendi: false }, onOdemeDegis })
    const kutu = screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement
    expect(kutu.checked).toBe(false)
    await userEvent.click(kutu)
    expect(onOdemeDegis).toHaveBeenCalledTimes(1)
    expect(onOdemeDegis).toHaveBeenCalledWith(true)
    expect(kutu.checked).toBe(true)
  })

  it('odeme istegi basarisiz olursa kutu ESKI haline doner ve hata duyurulur', async () => {
    const onOdemeDegis = vi.fn().mockRejectedValue(new Error('Kayıt bulunamadı.'))
    kur({ randevu: { ...ornekRandevu, ucret: 45000, odendi: false }, onOdemeDegis })
    const kutu = screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement
    await userEvent.click(kutu)
    expect((await screen.findByRole('alert')).textContent).toContain('Kayıt bulunamadı.')
    expect(kutu.checked).toBe(false)
  })

  it('ucret TL olarak gosterilir; ucret yoksa bunu soyler', () => {
    const { rerender } = kur({ randevu: { ...ornekRandevu, ucret: 45050 } })
    expect(screen.getByText('450,50 TL')).toBeDefined()
    rerender(satir({ randevu: { ...ornekRandevu, ucret: null } }))
    expect(screen.getByText('Ücret girilmemiş')).toBeDefined()
  })

  it('secili durum aria-pressed ile belirtilir', () => {
    kur({ randevu: { ...ornekRandevu, durum: 'gelmedi' } })
    expect(screen.getByRole('button', { name: 'Gelmedi' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Geldi' }).getAttribute('aria-pressed')).toBe('false')
  })

  // --- Brief'in dört iddiasının yanındakiler --------------------------------

  it('isaretli kutunun isareti kaldirilinca false gider (iki yon)', async () => {
    // Yalnızca `true` gönderen bir uygulama ilk testi geçerdi.
    const onOdemeDegis = vi.fn().mockResolvedValue(undefined)
    kur({ randevu: { ...ornekRandevu, ucret: 45000, odendi: true }, onOdemeDegis })
    const kutu = screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement
    expect(kutu.checked).toBe(true)
    await userEvent.click(kutu)
    expect(onOdemeDegis).toHaveBeenCalledExactlyOnceWith(false)
    expect(kutu.checked).toBe(false)
  })

  it('istek suruyorken ikinci tiklama IKINCI istek uretmez', async () => {
    // Denetim hacmi: bir ödeme işaretleme tek PATCH. Hızlı çift tıklama
    // (işaretle + geri al) iki yazma ve iki silinemez satır bırakırdı.
    let coz: () => void = () => {}
    const onOdemeDegis = vi.fn(() => new Promise<void>((r) => { coz = r }))
    kur({ randevu: { ...ornekRandevu, odendi: false }, onOdemeDegis })
    const kutu = screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement
    await userEvent.click(kutu)
    await userEvent.click(kutu)
    expect(onOdemeDegis).toHaveBeenCalledTimes(1)
    coz()
    await waitFor(() => expect(kutu.disabled).toBe(false))
    expect(kutu.checked).toBe(true)
  })

  // Görev 2 inceleme M2: durum düğmelerinin kilidi (`disabled`) testsizdi.
  // Kaldırıldığında hızlı bir çift tıklama iki PATCH ve sunucuda iki
  // silinemez denetim satırı üretir.
  it('durum istegi suruyorken HICBIR alt satir denetimi ikinci istek uretemez; kilit kalkinca uretir', async () => {
    let coz: () => void = () => {}
    const onDurumDegis = vi.fn(() => new Promise<void>((r) => { coz = r }))
    const onOdemeDegis = vi.fn().mockResolvedValue(undefined)
    kur({ onDurumDegis, onOdemeDegis })
    const dugme = (ad: string) => screen.getByRole('button', { name: ad }) as HTMLButtonElement
    const kutu = () => screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement

    await userEvent.click(dugme('Geldi'))
    expect(onDurumDegis).toHaveBeenCalledExactlyOnceWith('geldi')
    for (const ad of ['Geldi', 'Gelmedi', 'İptal']) expect(dugme(ad).disabled).toBe(true)
    expect(kutu().disabled).toBe(true)

    await userEvent.click(dugme('Geldi'))
    await userEvent.click(dugme('Gelmedi'))
    await userEvent.click(kutu())
    expect(onDurumDegis).toHaveBeenCalledTimes(1)
    expect(onOdemeDegis).not.toHaveBeenCalled()

    // ARTI YÖN: kilit kalkınca yeni istek GİDER — "hep kilitli" bir satır da
    // üstteki iddiaları geçerdi.
    coz()
    await waitFor(() => expect(dugme('Gelmedi').disabled).toBe(false))
    await userEvent.click(dugme('Gelmedi'))
    expect(onDurumDegis).toHaveBeenCalledTimes(2)
    expect(onDurumDegis).toHaveBeenLastCalledWith('gelmedi')
  })

  it('durum dugmesi onDurumDegis e kodu gecirir; hata alert ile duyurulur', async () => {
    const onDurumDegis = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Randevu güncellenemedi.'))
    kur({ onDurumDegis })
    expect(screen.queryByRole('alert')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Geldi' }))
    expect(onDurumDegis).toHaveBeenCalledWith('geldi')

    await userEvent.click(screen.getByRole('button', { name: 'İptal' }))
    expect(onDurumDegis).toHaveBeenLastCalledWith('iptal')
    expect((await screen.findByRole('alert')).textContent).toContain('Randevu güncellenemedi.')
  })

  it('durum prop u degisince (ayni seans) aria-pressed onu izler', () => {
    // `useTakvimAkisi.durumDegis` seçili randevunun kopyasını AYNI kimlikle
    // tazeliyor, panel yeniden mount EDİLMİYOR. Durum yerel bir kopyada
    // tutulsaydı "Geldi"ye basınca vurgu eski düğmede kalırdı.
    const { rerender } = kur({ randevu: { ...ornekRandevu, durum: 'planlandi' } })
    expect(screen.getByRole('button', { name: 'Geldi' }).getAttribute('aria-pressed')).toBe('false')
    rerender(satir({ randevu: { ...ornekRandevu, durum: 'geldi' } }))
    expect(screen.getByRole('button', { name: 'Geldi' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Gelmedi' }).getAttribute('aria-pressed')).toBe('false')
  })
})
