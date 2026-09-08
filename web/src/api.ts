import type { Randevu } from './takvim/HaftalikTakvim'

// Sunucu 401 döndürdüğünde (oturum kilitlendi/hareketsizlik zaman aşımı)
// çağıran taraf bunu sıradan bir hatadan ayırt edebilmeli — genel bir hata
// mesajı göstermek yerine kilit ekranına dönmesi gerekiyor. `name` alanı
// üzerinden ayırt edilebilir bir hata sınıfı kullanılıyor.
export class YetkisizHata extends Error {
  constructor(mesaj: string) {
    super(mesaj)
    this.name = 'YetkisizHata'
  }
}

type YetkisizDinleyici = () => void
const yetkisizDinleyiciler = new Set<YetkisizDinleyici>()

// Uygulamanın tek bir yerde (App.tsx) merkezi olarak 401'den haberdar
// olmasını sağlar: takvim ızgarası, ileride eklenecek randevu paneli (Görev
// 10) ya da Plan 3'teki not editörü gibi herhangi bir bileşen `takvimApi`/
// `api` üzerinden istek yaparken 401 alırsa, o bileşenin kendi hata
// yönetiminden bağımsız olarak App.tsx haberdar edilir ve kilit ekranına
// dönülür. Dinleyiciyi kaydeden taraf, döndürülen fonksiyonu çağırarak
// aboneliği iptal edebilir (bileşen kaldırıldığında).
export function yetkisizOlunca(dinleyici: YetkisizDinleyici): () => void {
  yetkisizDinleyiciler.add(dinleyici)
  return () => {
    yetkisizDinleyiciler.delete(dinleyici)
  }
}

async function istek<T>(yol: string, secenekler?: RequestInit): Promise<T> {
  const yanit = await fetch(yol, {
    headers: { 'content-type': 'application/json' },
    ...secenekler,
  })
  const govde = await yanit.json().catch(() => ({}))
  if (!yanit.ok) {
    const mesaj = govde.hata ?? 'Beklenmeyen bir hata oluştu.'
    if (yanit.status === 401) {
      for (const dinleyici of yetkisizDinleyiciler) dinleyici()
      throw new YetkisizHata(mesaj)
    }
    throw new Error(mesaj)
  }
  return govde as T
}

export type Danisan = { id: number; ad_soyad: string; telefon: string | null; durum: string }

export const takvimApi = {
  danisanlariGetir: () => istek<Danisan[]>('/api/danisanlar'),
  danisanEkle: (ad_soyad: string, telefon?: string) =>
    istek<Danisan>('/api/danisanlar', {
      method: 'POST',
      body: JSON.stringify({ ad_soyad, telefon }),
    }),
  randevulariGetir: (baslangic: string, bitis: string) =>
    istek<Randevu[]>(
      `/api/randevular?baslangic=${encodeURIComponent(baslangic)}&bitis=${encodeURIComponent(bitis)}`,
    ),
  randevuOlustur: (govde: {
    client_id: number
    baslangic: string
    bitis: string
    ucret?: number | null
    tekrar_sayisi?: number
  }) => istek<Randevu[]>('/api/randevular', { method: 'POST', body: JSON.stringify(govde) }),
  // Mevcut bir randevunun alanlarını değiştirir. `randevuOlustur` (POST) her
  // çağrıda YENİ kayıt üretir — düzenleme için onu çağırmak randevunun
  // kopyasını oluşturur (bkz. dal incelemesi C1). Sunucuda ayrı bir metot
  // (PUT) kullanılıyor; PATCH'in `{durum}` sözleşmesi dokunulmadan kaldı.
  randevuGuncelle: (
    id: number,
    govde: { client_id: number; baslangic: string; bitis: string; ucret?: number | null },
  ) =>
    istek<Randevu>(`/api/randevular/${id}`, {
      method: 'PUT',
      body: JSON.stringify(govde),
    }),
  randevuDurumu: (id: number, durum: string) =>
    istek<Record<string, never>>(`/api/randevular/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ durum }),
    }),
  randevuSil: (id: number) =>
    istek<Record<string, never>>(`/api/randevular/${id}`, { method: 'DELETE' }),
  cakismaKontrol: (baslangic: string, bitis: string, haricId?: number) => {
    const p = new URLSearchParams({ baslangic, bitis })
    if (haricId !== undefined) p.set('haric_id', String(haricId))
    return istek<Randevu[]>(`/api/cakisma?${p}`)
  },
}

export const api = {
  durumAl: () =>
    istek<{
      kurulum_gerekli: boolean
      kilitli: boolean
      keystore_bozuk: boolean
      // Uygulamanın veri klasörünün gerçek yolu. Bozuk keystore ekranı bunu
      // kullanıcıya gösterir: macOS'ta bu klasör Finder'da gizlidir, yol
      // yazılmadan kurtarma adımları uygulanamaz.
      veri_dizini: string
    }>('/api/durum'),
  kurulumYap: (parola: string) =>
    istek<{ kurtarma_kodu: string }>('/api/kurulum', {
      method: 'POST',
      body: JSON.stringify({ parola }),
    }),
  kilitAc: (girdi: { parola?: string; kurtarma_kodu?: string }) =>
    istek<Record<string, never>>('/api/kilit-ac', {
      method: 'POST',
      body: JSON.stringify(girdi),
    }),
  kilitle: () => istek<Record<string, never>>('/api/kilitle', { method: 'POST' }),
}
