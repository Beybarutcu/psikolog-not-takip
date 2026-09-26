import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IstekHatasi, type SeansNotu } from '../api'
import { OkumaPenceresi } from './OkumaPenceresi'

const t = vi.hoisted(() => ({ notGetir: vi.fn() }))
vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return { ...gercek, notApi: { ...gercek.notApi, notGetir: t.notGetir } }
})

const not: SeansNotu = {
  appointment_id: 42, client_id: 1, danisan_adi: 'Ayşe Yılmaz', seans_zamani: '2026-09-07T10:00',
  sablon: 'serbest', icerik: '<p>OKUMA <strong>KANARYA</strong></p>', onizleme: 'OKUMA KANARYA',
  guncelleme_zamani: 'z',
}

beforeEach(() => t.notGetir.mockReset())

describe('OkumaPenceresi (tasarım P1)', () => {
  it('9.1 başlıkta danışan adı ve tarih-saat; not salt okunur; düzenleme/özel not/durum YOK; pencere başlığı ad taşımaz', async () => {
    t.notGetir.mockResolvedValue(not)
    const onceki = document.title
    render(<OkumaPenceresi randevuId={42} />)
    const baslik = await screen.findByRole('heading', { level: 1 })
    expect(baslik.textContent).toContain('Ayşe Yılmaz')
    expect(baslik.textContent).toContain('7 Eylül 2026, 10:00')
    expect(screen.getByText('KANARYA').tagName).toBe('STRONG')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(t.notGetir).toHaveBeenCalledTimes(1)
    expect(t.notGetir).toHaveBeenCalledWith(42)
    expect(document.title).toBe(onceki)
  })

  it('9.2 olmayan seans (404) anlaşılır mesaj; boş not "yazılmamış" der', async () => {
    t.notGetir.mockRejectedValueOnce(new IstekHatasi('Kayıt bulunamadı.', 404))
    const { unmount } = render(<OkumaPenceresi randevuId={7} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Bu seans bulunamadı')
    unmount()
    t.notGetir.mockResolvedValueOnce({ ...not, icerik: '' })
    render(<OkumaPenceresi randevuId={42} />)
    expect(await screen.findByText('Bu seans için not yazılmamış.')).toBeDefined()
  })
})
