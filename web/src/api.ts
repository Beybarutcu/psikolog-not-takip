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
  // Arşivleme FİZİKSEL SİLME DEĞİLDİR: sunucudaki `clients::arsivle` yalnızca
  // `durum`'u 'arsiv' yapar; danışanın randevuları, notları ve dosyaları
  // yerinde kalır, danışan yalnızca aktif listeden (ve onunla beslenen randevu
  // açılır menüsünden) düşer. Uç nokta bu yüzden `DELETE` değil, ne yaptığını
  // adında söyleyen bir `POST` — ve arayüz metni de aynı şeyi söylemeli.
  danisanArsivle: (id: number) =>
    istek<Record<string, never>>(`/api/danisanlar/${id}/arsivle`, { method: 'POST' }),
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
  // Seri silme geri alınamaz bir işlem: onay metninin kaç randevunun
  // gideceğini söyleyebilmesi için önce sayı sorulur. Seri ekrandaki
  // haftanın çok ötesine uzanabildiği için bu sayı yalnızca sunucuda bilinir.
  seriSayisi: (seriId: string, buTarihtenItibaren: string) =>
    istek<{ adet: number }>(
      `/api/randevular/seri/${encodeURIComponent(seriId)}` +
        `?bu_tarihten_itibaren=${encodeURIComponent(buTarihtenItibaren)}`,
    ).then((y) => y.adet),
  // Geçmiş randevular SİLİNMEZ (sunucudaki `seriyi_sil` yalnızca verilen
  // tarihten itibaren siler) — arayüz metni bunu açıkça söylemeli.
  seriSil: (seriId: string, buTarihtenItibaren: string) =>
    istek<{ silinen: number }>(
      `/api/randevular/seri/${encodeURIComponent(seriId)}` +
        `?bu_tarihten_itibaren=${encodeURIComponent(buTarihtenItibaren)}`,
      { method: 'DELETE' },
    ).then((y) => y.silinen),
  // `tekrarSayisi` verilirse sunucu serinin TÜM haftalarını tek istekte
  // kontrol eder. Haftaları burada hesaplayıp tek tek sormuyoruz: hafta
  // ilerletme duvar saati aritmetiğidir ve `Date` ile yapılırsa yaz saati
  // değişiminde saat kayabilir (bkz. dal incelemesi I2 ve sunucudaki
  // `bir_hafta_sonra`).
  cakismaKontrol: (
    baslangic: string,
    bitis: string,
    haricId?: number,
    tekrarSayisi?: number,
  ) => {
    const p = new URLSearchParams({ baslangic, bitis })
    if (haricId !== undefined) p.set('haric_id', String(haricId))
    if (tekrarSayisi !== undefined) p.set('tekrar_sayisi', String(tekrarSayisi))
    return istek<SeriCakismasi>(`/api/cakisma?${p}`)
  },
}

// Çakışma kontrolünün yanıtı. Çıplak dizi değil: uyarı metninin "kaç
// haftada çakışma var" diyebilmesi için hafta sayısı gerekiyor.
export type SeriCakismasi = {
  cakisanlar: Randevu[]
  cakisan_hafta_sayisi: number
  kontrol_edilen_hafta: number
}

/** `GET/PUT /api/randevular/{id}/not` yanıtı (sunucudaki `SeansNotu`). */
export type SeansNotu = {
  appointment_id: number
  client_id: number
  sablon: string
  icerik: string
  guncelleme_zamani: string
}

/**
 * `GET/PUT /api/randevular/{id}/ozel-not` yanıtı (sunucudaki `OzelNot`).
 *
 * `sablon` alanı YOK ve olmamalı: özel notun şablonu yoktur. Şekil resmî
 * nottan bilerek farklı — iki sözleşme birbirine karışamasın (bkz.
 * `server/src/routes/private_notes.rs`).
 */
export type OzelNot = {
  appointment_id: number
  icerik: string
  guncelleme_zamani: string
}

/**
 * **Resmî** seans notu istemcisi (`progress_notes`).
 *
 * # Burada özel nota giden hiçbir yol YOKTUR
 *
 * Sunucuda ayrım yapısaldır: `routes::notes` ile `routes::private_notes`
 * ayrı modüller, ayrı yol önekleri. Aynı ayrım istemcide de yapısal olmalı,
 * çünkü sızıntının istemci tarafındaki biçimi şudur: ileride bir dışa
 * aktarım, yazdırma ya da rapor ekranı "notları getiren istemciyi" arar,
 * `notApi`'yi bulur ve olduğu gibi kullanır. O nesnenin özel nota erişimi
 * olsaydı tek bir yeniden kullanım özel notu rapora koyardı.
 *
 * Bu yüzden özel not `ozelNotApi`'de, AYRI bir nesnede duruyor ve buradaki
 * hiçbir fonksiyonun ürettiği URL `ozel` geçmiyor. `api.test.ts` bunu hem
 * URL'ler üzerinden hem de "resmî istemci hiçbir koşulda `ozel-not` yoluna
 * gitmez" biçiminde ölçüyor.
 */
export const notApi = {
  notGetir: (randevuId: number) => istek<SeansNotu>(`/api/randevular/${randevuId}/not`),
  notKaydet: (randevuId: number, sablon: string, icerik: string) =>
    istek<SeansNotu>(`/api/randevular/${randevuId}/not`, {
      method: 'PUT',
      body: JSON.stringify({ sablon, icerik }),
    }),
  // Danışanın geçmiş notları — YALNIZCA resmî notlar. Sunucudaki
  // `notes::danisan_listesi` özel not tablosuna hiç bakmaz; istemcide de
  // bu listeyi besleyen ikinci bir kaynak yok.
  //
  // `limit` çağıranın kararı ve zorunlu: sunucu `?limit=`i 1..=200 aralığına
  // kırpıyor, ama varsayılanı 50. "Son üç seans" gösteren bir panelin 50
  // seans notunun TAM İÇERİĞİNİ indirmesi için hiçbir sebep yok.
  danisanNotlari: (danisanId: number, limit: number) =>
    istek<SeansNotu[]>(`/api/danisanlar/${danisanId}/notlar?limit=${limit}`),
}

/**
 * Terapistin **özel** notunun istemcisi (`private_notes`) — ve istemcide bu
 * tabloya erişen tek yer.
 *
 * Liste döndüren bir fonksiyon burada bilerek YOKTUR; sunucuda da yoktur.
 * Böyle bir şeye ihtiyaç doğarsa gerekçesi bu başlıkta yeniden tartışılmalı.
 */
export const ozelNotApi = {
  getir: (randevuId: number) => istek<OzelNot>(`/api/randevular/${randevuId}/ozel-not`),
  // Gövde yalnızca `icerik` taşır: `sablon` göndermek sunucuda sessizce
  // yok sayılırdı ve arayüzde "özel notun da şablonu var" yanılsaması
  // yaratırdı.
  kaydet: (randevuId: number, icerik: string) =>
    istek<OzelNot>(`/api/randevular/${randevuId}/ozel-not`, {
      method: 'PUT',
      body: JSON.stringify({ icerik }),
    }),
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
