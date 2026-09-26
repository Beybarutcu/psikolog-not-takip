import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Danisan } from '../../api'
import { useDanisanListesi } from './useDanisanListesi'

const taklit = vi.hoisted(() => ({
  danisanEkle: vi.fn(),
  danisanlariGetir: vi.fn(),
}))

vi.mock('../../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../../api')>()
  return {
    ...gercek,
    takvimApi: {
      ...gercek.takvimApi,
      danisanEkle: (ad: string, telefon?: string) => taklit.danisanEkle(ad, telefon),
      danisanlariGetir: () => taklit.danisanlariGetir(),
    },
  }
})

afterEach(() => {
  taklit.danisanEkle.mockReset()
  taklit.danisanlariGetir.mockReset()
})

const AYSE: Danisan = { id: 1, ad_soyad: 'Ayşe Kaya', telefon: null, durum: 'aktif' }
const YENI: Danisan = { id: 9, ad_soyad: 'Zeynep Ak', telefon: null, durum: 'aktif' }

async function kur() {
  const kanca = renderHook(() => useDanisanListesi({ ayarlarGorunur: false }))
  await waitFor(() => expect(kanca.result.current.danisanlar).toEqual([AYSE]))
  act(() => {
    kanca.result.current.setFormAcik(true)
    kanca.result.current.setYeniAdSoyad('  Zeynep Ak ')
  })
  return kanca
}

describe('useDanisanListesi.ekle (tasarım B1)', () => {
  it('POST yanıtındaki danışanı döndürür; liste yeniden çekilir; form kapanır ve boşalır', async () => {
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE]).mockResolvedValueOnce([AYSE, YENI])
    taklit.danisanEkle.mockResolvedValue(YENI)
    const { result } = await kur()

    let donen: Danisan | null = null
    await act(async () => {
      donen = await result.current.ekle()
    })

    expect(donen).toEqual(YENI)
    expect(taklit.danisanEkle).toHaveBeenCalledExactlyOnceWith('Zeynep Ak', undefined)
    expect(result.current.danisanlar).toEqual([AYSE, YENI])
    expect(result.current.formAcik).toBe(false)
    expect(result.current.yeniAdSoyad).toBe('')
    expect(result.current.hata).toBeNull()
  })

  it('yeniden çekme BAŞARISIZ olsa da ekleme başarılıdır: "eklenemedi" yok, danışan döner ve listeye yerelde eklenir', async () => {
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE]).mockRejectedValueOnce(new Error('Ağ hatası'))
    taklit.danisanEkle.mockResolvedValue(YENI)
    const { result } = await kur()

    let donen: Danisan | null = null
    await act(async () => {
      donen = await result.current.ekle()
    })

    expect(donen).toEqual(YENI)
    expect(result.current.hata).toBeNull()
    expect(result.current.danisanlar).toEqual([AYSE, YENI])
    expect(result.current.formAcik).toBe(false)
  })

  it('POST başarısızsa null döner, sunucu mesajı olduğu gibi gösterilir, alanlar ve form korunur', async () => {
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE])
    taklit.danisanEkle.mockRejectedValue(new Error('Telefon en az 7 rakam içermeli.'))
    const { result } = await kur()

    let donen: Danisan | null = YENI
    await act(async () => {
      donen = await result.current.ekle()
    })

    expect(donen).toBeNull()
    expect(result.current.hata).toBe('Telefon en az 7 rakam içermeli.')
    expect(result.current.yeniAdSoyad).toBe('  Zeynep Ak ')
    expect(result.current.formAcik).toBe(true)
    expect(taklit.danisanlariGetir).toHaveBeenCalledTimes(1)
  })

  it('boş ad: istek yok, null', async () => {
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE])
    const { result } = await kur()
    act(() => result.current.setYeniAdSoyad('   '))

    let donen: Danisan | null = YENI
    await act(async () => {
      donen = await result.current.ekle()
    })

    expect(donen).toBeNull()
    expect(result.current.hata).toBe('Lütfen ad soyad girin.')
    expect(taklit.danisanEkle).not.toHaveBeenCalled()
  })
})
