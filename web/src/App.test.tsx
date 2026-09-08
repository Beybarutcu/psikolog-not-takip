import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  const gercekFetch = globalThis.fetch

  beforeEach(() => {
    // haftaninBasi(new Date()) mount sırasında gerçek saate bağlı olmasın diye
    // yalnızca Date sabitleniyor (setTimeout vb. gerçek kalıyor, RTL'nin
    // findBy*/waitFor'u gerçek zamanlayıcılarla çalışmaya devam ediyor).
    vi.useFakeTimers({ toFake: ['Date'] })
    // 2026-09-09 Çarşamba → hafta başı 2026-09-07 Pazartesi.
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  it('bir API çağrısı 401 döndüğünde kilit ekranına döner ve takvim verisi ekranda kalmaz', async () => {
    let kilitli = false
    let randevuCagrisi = 0

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()

      if (yol.startsWith('/api/durum')) {
        return {
          ok: true,
          json: async () => ({ kurulum_gerekli: false, kilitli, keystore_bozuk: false }),
        } as unknown as Response
      }

      if (yol.startsWith('/api/randevular')) {
        randevuCagrisi += 1
        if (randevuCagrisi === 1) {
          // İlk çağrı: oturum açık, randevu normal şekilde geliyor.
          return {
            ok: true,
            json: async () => [{
              id: 1, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
              baslangic: '2026-09-08T14:00', bitis: '2026-09-08T15:00',
              durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
            }],
          } as unknown as Response
        }
        // İkinci çağrı: hareketsizlikten oturum sunucu tarafında kilitlendi.
        kilitli = true
        return {
          ok: false,
          status: 401,
          json: async () => ({ hata: 'Oturum zaman aşımına uğradı.' }),
        } as unknown as Response
      }

      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch

    render(<App />)

    // Önce normal akış: takvim yükleniyor ve danışan adı görünüyor.
    expect(await screen.findByText('Ayşe Yılmaz')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Terapi Notları' })).toBeDefined()

    // Hafta değiştirmek yeni bir /api/randevular çağrısı tetikler; bu sefer 401 döner.
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))

    // Arayüz kilit ekranına dönmeli...
    expect(await screen.findByRole('heading', { name: 'Kilitli' })).toBeDefined()

    // ...ve takvim/danışan verisi ekranda kalmamalı: AnaEkran tamamen kalkmış olmalı.
    expect(screen.queryByText('Ayşe Yılmaz')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Terapi Notları' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kilitle' })).toBeNull()
  })
})
