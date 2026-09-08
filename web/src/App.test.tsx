import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { BOSTA_KALMA_MS } from './bostaKalma'

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

// Dal incelemesi I3: yukarıdaki test TEPKİSEL yarıyı kapsıyor (bir istek
// 401 alınca ekran kalkar). Aşağıdaki ÖNGÖRÜLÜ yarı: hiçbir istek
// yapılmadan, kullanıcı etkinliği olmadan süre dolunca arayüz sunucuya
// sorar ve kilitliyse veri ekrandan GERÇEKTEN kalkar (unmount).
describe('App — boşta kalma kilidi ekrana ulaşır (I3)', () => {
  const gercekFetch = globalThis.fetch

  beforeEach(() => {
    // `shouldAdvanceTime`: sahte zamanlayıcılar gerçek zamanla da ilerler,
    // böylece RTL'nin findBy*/waitFor'u çalışmaya devam eder ama biz yine
    // de 300 saniyeyi elle atlayabiliriz.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    vi.restoreAllMocks()
  })

  it('etkinlik olmadan süre dolunca sunucuya sorar ve takvim ekrandan kalkar', async () => {
    let kilitli = false
    let durumCagrisi = 0

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()

      if (yol.startsWith('/api/durum')) {
        durumCagrisi += 1
        return {
          ok: true,
          json: async () => ({
            kurulum_gerekli: false, kilitli, keystore_bozuk: false, veri_dizini: '/veri',
          }),
        } as unknown as Response
      }
      if (yol.startsWith('/api/danisanlar')) {
        return { ok: true, json: async () => [] } as unknown as Response
      }
      if (yol.startsWith('/api/randevular')) {
        return {
          ok: true,
          json: async () => [{
            id: 1, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
            baslangic: '2026-09-08T14:00', bitis: '2026-09-08T15:00',
            durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
          }],
        } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch

    render(<App />)
    expect(await screen.findByText('Ayşe Yılmaz')).toBeDefined()

    const ilkDurumCagrisi = durumCagrisi
    // Terapist danışanı kapıya kadar geçiriyor: hiçbir tıklama, hiçbir
    // istek yok. Sunucu bu sürede oturumu kilitliyor.
    kilitli = true
    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS))

    expect(durumCagrisi).toBeGreaterThan(ilkDurumCagrisi)
    expect(await screen.findByRole('heading', { name: 'Kilitli' })).toBeDefined()

    // Görsel perde değil, gerçek unmount: veri DOM'da hiç kalmamalı.
    expect(screen.queryByText('Ayşe Yılmaz')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Terapi Notları' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kilitle' })).toBeNull()
  })

  it('kilit ekranındayken boşta kalma yoklaması yapılmaz', async () => {
    let durumCagrisi = 0
    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      if (yol.startsWith('/api/durum')) {
        durumCagrisi += 1
        return {
          ok: true,
          json: async () => ({
            kurulum_gerekli: false, kilitli: true, keystore_bozuk: false, veri_dizini: '/veri',
          }),
        } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Kilitli' })).toBeDefined()

    const kilitliyken = durumCagrisi
    await act(() => vi.advanceTimersByTimeAsync(BOSTA_KALMA_MS * 2))
    expect(durumCagrisi).toBe(kilitliyken)
  })
})
