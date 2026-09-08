import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnaEkran } from './AnaEkran'

// Görev 10 inceleme Bulgu 1: RandevuPaneli, seçili randevu/boş saat değişince
// yeniden mount edilecek bir `key` almadan önce, panel içindeki state
// (silme onayı, doldurulmuş form alanları) bir seçimden diğerine sızıyordu.
// Bu testler AnaEkran seviyesinde çalışır çünkü asıl düzeltme (key) çağrı
// noktasında (AnaEkran.tsx) — RandevuPaneli.test.tsx'teki testler her
// zaman temiz bir mount yaptığından bu regresyonu yakalayamaz.

const danisanlar = [
  { id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' },
  { id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif' },
]

const randevuA = {
  id: 101, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
  durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
}
const randevuB = {
  id: 102, client_id: 2, danisan_adi: 'Mehmet Demir',
  baslangic: '2026-09-07T13:00', bitis: '2026-09-07T14:00',
  durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
}

describe('AnaEkran — panel kimliği (Görev 10 inceleme Bulgu 1)', () => {
  const gercekFetch = globalThis.fetch

  beforeEach(() => {
    // haftaninBasi(new Date()) mount sırasında gerçek saate bağlı olmasın diye
    // yalnızca Date sabitleniyor (App.test.tsx'teki desenle aynı).
    vi.useFakeTimers({ toFake: ['Date'] })
    // 2026-09-09 Çarşamba → hafta başı 2026-09-07 Pazartesi.
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => danisanlar } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        return { ok: true, json: async () => [randevuA, randevuB] } as unknown as Response
      }
      if (yol.startsWith('/api/cakisma')) {
        return { ok: true, json: async () => [] } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  it('A için silme onayı açıkken B seçilince onay B üzerinde sızmaz', async () => {
    render(<AnaEkran kilitle={vi.fn()} />)

    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })

    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    expect(screen.getByText(/kalıcı olarak silinsin mi/i)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))

    // Panel B'yi göstermeli; A'da açılmış silme onayı B'ye sızmamalı,
    // aksi hâlde kullanıcı sadece gezinirken "Evet, sil"e basıp B'yi silebilir.
    expect(screen.queryByText(/kalıcı olarak silinsin mi/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Evet, sil' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sil' })).toBeDefined()
  })

  it('A\'da form alanları doldurulup boş bir saate geçilince alanlar temiz gelir', async () => {
    render(<AnaEkran kilitle={vi.fn()} />)

    await screen.findByRole('button', { name: 'Ayşe Yılmaz' })

    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.clear(screen.getByLabelText('Süre (dakika)'))
    await userEvent.type(screen.getByLabelText('Süre (dakika)'), '45')
    expect((screen.getByLabelText('Süre (dakika)') as HTMLInputElement).value).toBe('45')

    // Boş bir saate tıkla (09:00, 08 satırından farklı bir aria-label).
    const bosSaat = screen.getAllByLabelText(/boş$/).find((el) =>
      el.getAttribute('aria-label')?.includes('09:00'),
    )
    expect(bosSaat).toBeDefined()
    await userEvent.click(bosSaat!)

    // Yeni panel varsayılan süreyle (60) açılmalı, 45 değeri sızmamalı.
    expect((screen.getByLabelText('Süre (dakika)') as HTMLInputElement).value).toBe('60')
    expect((screen.getByLabelText('Danışan') as HTMLSelectElement).value).toBe('')
  })
})
