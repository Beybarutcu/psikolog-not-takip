import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Randevu } from '../../takvim/HaftalikTakvim'
import { useTakvimAkisi } from './useTakvimAkisi'

const t = vi.hoisted(() => ({
  haftalar: {} as Record<string, unknown[]>,
  kapilar: {} as Record<string, Promise<void>>,
  hatalar: {} as Record<string, Error>,
  cagrilar: [] as string[],
}))

// Hafta listesi haftanın ilk gününe göre (`YYYY-AA-GG`) verilir; bir hafta
// için "kapı" kurulursa o yanıt kapı açılana kadar bekletilir; "hata"
// kurulursa o haftanın isteği (kapıdan sonra) reddedilir.
vi.mock('../../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../../api')>()
  return {
    ...gercek,
    takvimApi: {
      ...gercek.takvimApi,
      randevulariGetir: async (baslangic: string) => {
        const gun = baslangic.slice(0, 10)
        t.cagrilar.push(gun)
        const kapi = t.kapilar[gun]
        if (kapi) await kapi
        const hata = t.hatalar[gun]
        if (hata) throw hata
        return t.haftalar[gun] ?? []
      },
    },
  }
})

const A: Randevu = {
  id: 1, client_id: 1, danisan_adi: 'Ayşe Yılmaz', baslangic: '2026-09-08T10:00', bitis: '2026-09-08T11:00',
  durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
}
const B: Randevu = { ...A, id: 2, baslangic: '2026-08-25T10:00', bitis: '2026-08-25T11:00' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 9, 12, 0)) // hafta başı 7 Eylül
  t.haftalar = {}
  t.kapilar = {}
  t.hatalar = {}
  t.cagrilar = []
})
afterEach(() => vi.useRealTimers())

function kur() {
  return renderHook(() => useTakvimAkisi({ onYetkisiz: vi.fn() }))
}

/**
 * Kapıyı açar ve yanıtın `yukle`de TAMAMEN işlenmesini bekler. Doğru
 * uygulamada bayat bir yanıt ekranda hiçbir şeyi değiştirmez, yani
 * beklenecek gözlenebilir bir olay yok: gerçek bir `setTimeout(0)` sınırı
 * (sahte saat yalnızca `Date`), önündeki bütün mikro görevlerin — yanıtın
 * `yukle` devamı dahil — koştuğunu garanti eder.
 */
async function kapiyiAcVeBekle(ac: () => void) {
  await act(async () => {
    ac()
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('useTakvimAkisi.randevuyaGit (tasarım N8, inceleme odağı 4)', () => {
  it('7.1 başka haftadaki seans: seçim kapanır, hafta değişir, seçim hafta YÜKLENİNCE yapılır', async () => {
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [B] }
    const { result } = kur()
    await waitFor(() => expect(result.current.randevular).toHaveLength(1))
    act(() => result.current.randevuSec(A))
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    expect(result.current.seciliRandevu).toBeNull()
    expect(result.current.gecisBekliyor).toBe(true)
    await waitFor(() => expect(result.current.seciliRandevu?.id).toBe(B.id))
    expect(result.current.haftaBasi.getTime()).toBe(new Date(2026, 7, 24).getTime())
    expect(result.current.gecisBekliyor).toBe(false)
    expect(result.current.kaydirmaIstegi).toBe(B.id)
  })

  it('7.2 aynı haftadaki seans: yeni istek YOK, hemen seçilir', async () => {
    const A2: Randevu = { ...A, id: 3, baslangic: '2026-09-10T10:00', bitis: '2026-09-10T11:00' }
    t.haftalar = { '2026-09-07': [A, A2] }
    const { result } = kur()
    await waitFor(() => expect(result.current.randevular).toHaveLength(2))
    const istek = t.cagrilar.length
    act(() => result.current.randevuSec(A))
    act(() => result.current.randevuyaGit(A2.id, A2.baslangic))
    expect(result.current.seciliRandevu?.id).toBe(A2.id)
    expect(result.current.gecisBekliyor).toBe(false)
    expect(t.cagrilar.length).toBe(istek)
  })

  it('7.3 hedef o haftada yoksa (silinmiş) seçim açılmaz, geçiş biter', async () => {
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [] }
    const { result } = kur()
    await waitFor(() => expect(result.current.randevular).toHaveLength(1))
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    await waitFor(() => expect(result.current.gecisBekliyor).toBe(false))
    expect(result.current.seciliRandevu).toBeNull()
  })

  // Kontrolör kararı F8: iki hafta da kapılı ve ESKİ hafta ÖNCE bırakılıyor —
  // seçim beklerken bayat bir yanıt gelir. Yalnızca hedef hafta önce dönseydi
  // bekleyen seçim bayat yanıt gelmeden tüketilmiş olur ve "bekleyen seçim
  // bloğu hafta korumasının ÖNÜNDE" mutasyonu yeşil kalırdı.
  it('7.4 hafta koruması: seçim BEKLERKEN geç dönen ESKİ hafta yanıtı bekleyen seçimi tüketmez, listeyi ezmez', async () => {
    let eskiyiAc!: () => void
    let hedefiAc!: () => void
    t.kapilar = {
      '2026-09-07': new Promise<void>((r) => { eskiyiAc = r }),
      '2026-08-24': new Promise<void>((r) => { hedefiAc = r }),
    }
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [B] }
    const { result } = kur()
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    // Bariyer: iki haftanın isteği de gerçekten gitti ve ikisi de kapıda.
    expect(t.cagrilar).toEqual(['2026-09-07', '2026-08-24'])

    await kapiyiAcVeBekle(eskiyiAc)
    expect(result.current.gecisBekliyor).toBe(true)
    expect(result.current.seciliRandevu).toBeNull()
    expect(result.current.randevular).toEqual([])

    await kapiyiAcVeBekle(hedefiAc)
    expect(result.current.seciliRandevu?.id).toBe(B.id)
    expect(result.current.gecisBekliyor).toBe(false)
    expect(result.current.randevular.map((r) => r.id)).toEqual([B.id])
  })

  it('7.4b ters sıra: hedef hafta önce döner, SONRA gelen eski hafta seçimi ve listeyi ezmez', async () => {
    let eskiyiAc!: () => void
    t.kapilar = { '2026-09-07': new Promise<void>((r) => { eskiyiAc = r }) }
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [B] }
    const { result } = kur()
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    await waitFor(() => expect(result.current.seciliRandevu?.id).toBe(B.id))
    await kapiyiAcVeBekle(eskiyiAc)
    expect(result.current.randevular.map((r) => r.id)).toEqual([B.id])
    expect(result.current.seciliRandevu?.id).toBe(B.id)
  })

  // Hata dalı da aynı korumanın arkasında: ESKİ haftanın hatası bekleyen
  // seçimi iptal ederse terapist "Bu seansa git"e bastığı hâlde seansı değil
  // boş bir ızgarayı görür.
  it('7.4c seçim beklerken ESKİ haftanın HATASI geçişi iptal etmez; hedef hafta gelince seçilir', async () => {
    let eskiyiAc!: () => void
    let hedefiAc!: () => void
    t.kapilar = {
      '2026-09-07': new Promise<void>((r) => { eskiyiAc = r }),
      '2026-08-24': new Promise<void>((r) => { hedefiAc = r }),
    }
    t.hatalar = { '2026-09-07': new Error('Sunucuya ulaşılamadı.') }
    t.haftalar = { '2026-08-24': [B] }
    const { result } = kur()
    act(() => result.current.randevuyaGit(B.id, B.baslangic))

    await kapiyiAcVeBekle(eskiyiAc)
    expect(result.current.gecisBekliyor).toBe(true)
    expect(result.current.hata).toBeNull()

    await kapiyiAcVeBekle(hedefiAc)
    expect(result.current.seciliRandevu?.id).toBe(B.id)
    expect(result.current.gecisBekliyor).toBe(false)
  })

  it('7.4d hedef haftanın KENDİ hatası geçişi bitirir (sonsuza kadar "Seans açılıyor…" kalmaz)', async () => {
    t.haftalar = { '2026-09-07': [A] }
    t.hatalar = { '2026-08-24': new Error('Sunucuya ulaşılamadı.') }
    const { result } = kur()
    await waitFor(() => expect(result.current.randevular).toHaveLength(1))
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    expect(result.current.gecisBekliyor).toBe(true)
    await waitFor(() => expect(result.current.gecisBekliyor).toBe(false))
    expect(result.current.hata).toBe('Sunucuya ulaşılamadı.')
    expect(result.current.seciliRandevu).toBeNull()
  })

  it('7.4e oturum kapanınca (401/kilit) bekleyen geçiş düşer: yoldaki hedef hafta seansı AÇMAZ', async () => {
    let hedefiAc!: () => void
    t.kapilar = { '2026-08-24': new Promise<void>((r) => { hedefiAc = r }) }
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [B] }
    const { result } = kur()
    await waitFor(() => expect(result.current.randevular).toHaveLength(1))
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    expect(result.current.gecisBekliyor).toBe(true)

    act(() => result.current.oturumKapandi())
    expect(result.current.gecisBekliyor).toBe(false)

    await kapiyiAcVeBekle(hedefiAc)
    expect(result.current.seciliRandevu).toBeNull()
    expect(result.current.gecisBekliyor).toBe(false)
  })

  it('panelKapat haftayı değiştirmez ("Takvime dön" aynı haftayı gösterir)', async () => {
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [B] }
    const { result } = kur()
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    await waitFor(() => expect(result.current.seciliRandevu?.id).toBe(B.id))
    act(() => result.current.panelKapat())
    expect(result.current.seciliRandevu).toBeNull()
    expect(result.current.haftaBasi.getTime()).toBe(new Date(2026, 7, 24).getTime())
  })
})
