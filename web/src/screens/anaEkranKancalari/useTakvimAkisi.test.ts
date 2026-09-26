import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Randevu } from '../../takvim/HaftalikTakvim'
import { useTakvimAkisi } from './useTakvimAkisi'

const t = vi.hoisted(() => ({
  haftalar: {} as Record<string, unknown[]>,
  kapilar: {} as Record<string, Promise<void>>,
  hatalar: {} as Record<string, Error>,
  sirayla: {} as Record<string, { kapi: Promise<void>; liste: unknown[] }[]>,
  cagrilar: [] as string[],
}))

// Hafta listesi haftanın ilk gününe göre (`YYYY-AA-GG`) verilir; bir hafta
// için "kapı" kurulursa o yanıt kapı açılana kadar bekletilir; "hata"
// kurulursa o haftanın isteği (kapıdan sonra) reddedilir. `sirayla`: AYNI
// haftanın art arda istekleri için istek başına kapı ve liste (sırayla
// tüketilir; boşalınca yukarıdaki kurallar geçerli).
vi.mock('../../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../../api')>()
  return {
    ...gercek,
    takvimApi: {
      ...gercek.takvimApi,
      randevulariGetir: async (baslangic: string) => {
        const gun = baslangic.slice(0, 10)
        t.cagrilar.push(gun)
        const sira = t.sirayla[gun]?.shift()
        if (sira) {
          await sira.kapi
          return sira.liste
        }
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
  t.sirayla = {}
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

  // Düzeltme turu 1 (inceleme): bekleyen geçiş, SONRAKİ bir kullanıcı
  // seçimiyle iptal edilmeliydi. Etmezse hafta yüklenince hedef, kullanıcının
  // daha yeni seçimini ezer — ör. aynı haftada listede olmayan hedef için
  // yeniden yükleme sürerken bilgi satırındaki "sıradaki"ye tıklamak.
  describe('7.4f bekleyen geçiş sırasında kullanıcı seçimi (son seçim kazanır)', () => {
    const A2: Randevu = { ...A, id: 3, baslangic: '2026-09-10T10:00', bitis: '2026-09-10T11:00' }
    // Aynı haftada, ilk listede YOK (yeniden yüklemede gelir).
    const H: Randevu = { ...A, id: 5, baslangic: '2026-09-11T10:00', bitis: '2026-09-11T11:00' }

    async function bekleyenKur() {
      t.haftalar = { '2026-09-07': [A, A2] }
      const r = kur()
      await waitFor(() => expect(r.result.current.randevular).toHaveLength(2))
      let ac!: () => void
      t.sirayla = { '2026-09-07': [{ kapi: new Promise<void>((c) => { ac = c }), liste: [A, A2, H] }] }
      act(() => r.result.current.randevuyaGit(H.id, H.baslangic))
      // Ön koşul: gerçekten bekleyen bir geçiş ve yolda bir yeniden yükleme.
      expect(r.result.current.gecisBekliyor).toBe(true)
      expect(t.cagrilar).toEqual(['2026-09-07', '2026-09-07'])
      return { ...r, ac }
    }

    it('randevuSec(B): hafta dönünce seçim B, hedef DEĞİL; geçiş biter', async () => {
      const { result, ac } = await bekleyenKur()
      act(() => result.current.randevuSec(A2, { kaydir: true }))
      expect(result.current.gecisBekliyor).toBe(false)
      await kapiyiAcVeBekle(ac)
      expect(result.current.seciliRandevu?.id).toBe(A2.id)
      expect(result.current.kaydirmaIstegi).toBe(A2.id)
      expect(result.current.gecisBekliyor).toBe(false)
    })

    it('bosSaatSec: hafta dönünce boş saat seçili kalır, hedef AÇILMAZ', async () => {
      const { result, ac } = await bekleyenKur()
      act(() => result.current.bosSaatSec('2026-09-09T09:00'))
      expect(result.current.gecisBekliyor).toBe(false)
      await kapiyiAcVeBekle(ac)
      expect(result.current.seciliRandevu).toBeNull()
      expect(result.current.seciliBosSaat).toBe('2026-09-09T09:00')
      expect(result.current.gecisBekliyor).toBe(false)
    })

    it('panelKapat: hafta dönünce hiçbir şey seçilmez', async () => {
      const { result, ac } = await bekleyenKur()
      act(() => result.current.panelKapat())
      expect(result.current.gecisBekliyor).toBe(false)
      await kapiyiAcVeBekle(ac)
      expect(result.current.seciliRandevu).toBeNull()
      expect(result.current.gecisBekliyor).toBe(false)
    })

    // ARTI YÖN: iptal yalnızca SONRAKİ seçimde — hiç dokunulmayan geçiş hâlâ
    // hedefi açar (her şeyi iptal eden bir kanca üsttekileri de geçerdi).
    it('kullanıcı hiçbir şey seçmezse hafta dönünce hedef seçilir', async () => {
      const { result, ac } = await bekleyenKur()
      await kapiyiAcVeBekle(ac)
      expect(result.current.seciliRandevu?.id).toBe(H.id)
      expect(result.current.gecisBekliyor).toBe(false)
    })
  })

  // Düzeltme turu 1 (inceleme): AYNI hafta için geçişten ÖNCE yola çıkmış bir
  // GET (ör. "Güncelle"nin yeniden yüklemesi) hafta korumasından geçer; onun
  // bayat listesi bekleyen seçimi tüketip geçişi SESSİZCE bitirmemeli.
  it('7.4g aynı haftada geçişten ÖNCE başlamış GET bekleyen seçimi tüketmez; geçişin kendi yüklemesi hedefi seçer', async () => {
    const H: Randevu = { ...A, id: 5, baslangic: '2026-09-11T10:00', bitis: '2026-09-11T11:00' }
    let eskiyiAc!: () => void
    let yeniyiAc!: () => void
    t.sirayla = {
      '2026-09-07': [
        { kapi: new Promise<void>((c) => { eskiyiAc = c }), liste: [A] },
        { kapi: new Promise<void>((c) => { yeniyiAc = c }), liste: [A, H] },
      ],
    }
    const { result } = kur()
    act(() => result.current.randevuyaGit(H.id, H.baslangic))
    // Ön koşul: aynı haftanın iki isteği yolda (açılış + geçişin yüklemesi).
    expect(t.cagrilar).toEqual(['2026-09-07', '2026-09-07'])

    await kapiyiAcVeBekle(eskiyiAc)
    expect(result.current.gecisBekliyor).toBe(true)
    expect(result.current.seciliRandevu).toBeNull()

    await kapiyiAcVeBekle(yeniyiAc)
    expect(result.current.seciliRandevu?.id).toBe(H.id)
    expect(result.current.gecisBekliyor).toBe(false)
  })

  // Hafta koruması bekleyen seçim için hâlâ YÜK TAŞIYOR: geçiş beklerken
  // kullanıcı hafta değiştirirse hedef haftanın (artık bayat) yanıtı, hedefi
  // GÖRÜNMEYEN bir haftada seçmemeli.
  it('7.4h seçim beklerken hafta değişirse bayat hedef hafta yanıtı hedefi SEÇMEZ; görünen haftanın yanıtı geçişi bitirir', async () => {
    let hedefiAc!: () => void
    let yeniHaftayiAc!: () => void
    t.kapilar = {
      '2026-08-24': new Promise<void>((c) => { hedefiAc = c }),
      '2026-08-31': new Promise<void>((c) => { yeniHaftayiAc = c }),
    }
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [B], '2026-08-31': [] }
    const { result } = kur()
    await waitFor(() => expect(result.current.randevular).toHaveLength(1))
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    act(() => result.current.haftaDegis(1))
    expect(result.current.haftaBasi.getTime()).toBe(new Date(2026, 7, 31).getTime())

    await kapiyiAcVeBekle(hedefiAc)
    expect(result.current.seciliRandevu).toBeNull()

    await kapiyiAcVeBekle(yeniHaftayiAc)
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
