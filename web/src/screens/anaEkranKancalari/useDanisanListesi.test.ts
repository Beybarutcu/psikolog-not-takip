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

  // İnceleme M1: danışan silinemez ve adda benzersizlik yok; POST sürerken
  // ikinci Enter/tıklama KALICI bir kopya kayıt yaratırdı. İlk iki çağrı
  // AYNI kapanıştan (aynı çizimden) geliyor: durum bayrağı henüz
  // güncellenmemişken de ikinci çağrı istek atmamalı.
  it('ekleme uçuştayken ikinci çağrı istek ATMAZ ve null döner; bayrak uçuş boyunca kalkık, bitince iner ve yeni ekleme yapılabilir', async () => {
    let coz!: (d: Danisan) => void
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE]).mockResolvedValue([AYSE, YENI])
    taklit.danisanEkle.mockImplementationOnce(
      () =>
        new Promise<Danisan>((c) => {
          coz = c
        }),
    )
    const { result } = await kur()
    expect(result.current.ekleniyor).toBe(false)

    let ilk!: Promise<Danisan | null>
    let ikinci!: Promise<Danisan | null>
    act(() => {
      ilk = result.current.ekle()
      ikinci = result.current.ekle()
    })
    expect(await ikinci).toBeNull()
    expect(taklit.danisanEkle).toHaveBeenCalledTimes(1)
    expect(result.current.ekleniyor).toBe(true)

    // Yeniden çizimden sonraki gönderim de istek atmaz.
    let ucuncu: Danisan | null = YENI
    await act(async () => {
      ucuncu = await result.current.ekle()
    })
    expect(ucuncu).toBeNull()
    expect(taklit.danisanEkle).toHaveBeenCalledTimes(1)

    await act(async () => {
      coz(YENI)
      await ilk
    })
    expect(await ilk).toEqual(YENI)
    expect(result.current.ekleniyor).toBe(false)
    expect(result.current.hata).toBeNull()

    // Bayrak GERÇEKTEN iner: sonraki ekleme istek atar.
    taklit.danisanEkle.mockResolvedValueOnce({ ...YENI, id: 10, ad_soyad: 'Can Öz' })
    act(() => result.current.setYeniAdSoyad('Can Öz'))
    await act(async () => {
      await result.current.ekle()
    })
    expect(taklit.danisanEkle).toHaveBeenCalledTimes(2)
  })

  it('POST başarısız olunca bayrak iner: düzeltilen ikinci deneme istek atar', async () => {
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE]).mockResolvedValueOnce([AYSE, YENI])
    taklit.danisanEkle
      .mockRejectedValueOnce(new Error('Telefon en az 7 rakam içermeli.'))
      .mockResolvedValueOnce(YENI)
    const { result } = await kur()

    await act(async () => {
      await result.current.ekle()
    })
    expect(result.current.ekleniyor).toBe(false)

    let donen: Danisan | null = null
    await act(async () => {
      donen = await result.current.ekle()
    })
    expect(donen).toEqual(YENI)
    expect(taklit.danisanEkle).toHaveBeenCalledTimes(2)
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
