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

/**
 * Başarısız bir yanıtı bu API'nin **tek** hata sözleşmesine çevirir.
 *
 * `istek`'ten ayrı bir fonksiyon olmasının nedeni `ekIndir`: o yol JSON
 * değil **ham bayt** okuyor, ama 401 davranışı birebir aynı olmak zorunda.
 * Kural tek yerde durmazsa ikinci yol onu er geç kaybeder (bu kod tabanında
 * "kilit_ac düzeltildi, kilitle unutuldu" ile aynı hata sınıfı).
 *
 * 401'de dinleyiciler **throw'dan ÖNCE ve senkron** tetiklenir: `App` kilit
 * ekranına dönmeyi buradan öğreniyor (`api.test.ts` sırayı ölçüyor).
 */
async function basarisizYanitiFirlat(yanit: Response): Promise<never> {
  const govde: { hata?: string } = await yanit.json().catch(() => ({}))
  const mesaj = govde.hata ?? 'Beklenmeyen bir hata oluştu.'
  if (yanit.status === 401) {
    for (const dinleyici of yetkisizDinleyiciler) dinleyici()
    throw new YetkisizHata(mesaj)
  }
  throw new Error(mesaj)
}

async function istek<T>(yol: string, secenekler?: RequestInit): Promise<T> {
  const yanit = await fetch(yol, {
    headers: { 'content-type': 'application/json' },
    ...secenekler,
  })
  if (!yanit.ok) await basarisizYanitiFirlat(yanit)
  return (await yanit.json().catch(() => ({}))) as T
}

export type Danisan = { id: number; ad_soyad: string; telefon: string | null; durum: string }

/**
 * Danışanın **tam** dosyası (`GET /api/danisanlar/{id}`).
 *
 * `Danisan` bilerek dar bırakıldı ve bu tip ondan TÜRETİLDİ: liste uç
 * noktası sunucuda aynı JSON'u döndürüyor (`clients::Danisan`'ın tamamı),
 * ama listeyi kullanan yerler (danışan çipleri, randevu açılır menüsü) risk
 * notunu ve rıza bilgisini **görmemeli**. Tek geniş bir tip kullanılsaydı,
 * "elimde zaten `Danisan` var" diyen bir bileşen risk notunu ekrana basmak
 * için hiçbir engelle karşılaşmazdı.
 *
 * Alanların hepsi `null` olabilir: dosya, danışan eklendikten sonra zamanla
 * doldurulur (`clients::guncelle` kısmi güncelleme yapar).
 */
export type DanisanDosyasi = Danisan & {
  dogum_tarihi: string | null
  basvuru_nedeni: string | null
  risk_notu: string | null
  riza_tarihi: string | null
  riza_dosya_id: number | null
  son_temas: string | null
  saklama_bitis: string | null
}

/** `GET /api/danisanlar/{id}/ekler` yanıtı (sunucudaki `EkBilgisi`). */
export type EkBilgisi = {
  id: number
  client_id: number
  dosya_adi: string
  mime: string
  tur: string
  boyut: number
  eklenme_zamani: string
}

/** Ek dosya türlerinin kapalı kümesi (`store::attachments::GECERLI_TURLER`). */
export const EK_TURLERI = ['onam', 'test', 'diger'] as const

/**
 * Dosya başına üst sınır — sunucudaki `AZAMI_DOSYA_BOYUTU` ile **aynı**.
 *
 * İstemci tarafında da kontrol ediliyor çünkü sunucu sınırı `axum`'un
 * `DefaultBodyLimit`'i ile uyguluyor ve o `413`'ü **JSON gövdesiz** döndürür:
 * `istek()` orada `govde.hata`yı bulamaz ve kullanıcıya "Beklenmeyen bir
 * hata oluştu." der. Yani 20 MB yüklendikten sonra nedeni öğrenilemeyen bir
 * ret. Buradaki kontrol isteği hiç atmadan nedenini söyler.
 */
export const AZAMI_EK_BOYUTU = 20 * 1024 * 1024

/** Tek bir arama sonucu (`GET /api/ara` yanıtı; sunucudaki `AramaSonucu`). */
export type AramaSonucu = {
  /** `"danisan"` veya `"not"`. */
  tur: string
  client_id: number
  danisan_adi: string
  appointment_id: number | null
  tarih: string | null
  /** Eşleşmenin çevresinden alınan bağlam parçası. */
  parca: string
}

/**
 * Bir aramanın döndürebileceği en fazla sonuç — sunucudaki `AZAMI_SONUC`.
 *
 * Sunucu `limit`i `1..=50` aralığına kırpıyor; daha büyük bir sayı göndermek
 * sessizce 50'ye düşerdi. Değerin burada da yazılı olmasının nedeni yalnızca
 * istek kurmak değil: `/api/ara` yanıtı **"daha fazla sonuç var" işareti
 * taşımıyor** (Görev 6'nın bilinen boşluğu; bütçe paylaştırması sessiz kaybı
 * hafifletti, kaldırmadı). Arayüzün "sonuç sayısı == sınır" durumunu
 * ölçebilmesi için sınırı bilmesi gerekiyor.
 */
export const ARAMA_SINIRI = 50

/**
 * Ek dosyanın indirme adresi.
 *
 * Bağlantının `href`'i olarak **duruyor** (bağlam menüsü, "bağlantıyı farklı
 * kaydet", orta tıklama gerçek bir kaynak adresi görsün) ama tıklama
 * `ekIndir`'e yönlendiriliyor — gerekçe orada.
 */
export function ekIndirmeYolu(ekId: number): string {
  return `/api/ekler/${ekId}`
}

/**
 * Ek dosyayı indirir — **düz gezinme yapmadan** (dal incelemesi I3).
 *
 * # Bulgu: kilitli oturumda bağlantı SPA'yı yıkıyordu
 *
 * Bağlantı düz bir `<a href="/api/ekler/{id}">` idi ve `download`
 * özniteliği bilerek yoktu: başarı yolunda tarayıcı sunucunun
 * `Content-Disposition: attachment` başlığını görüp indiriyor, sayfa
 * gezinmiyordu. Ama **401 yolunda** o başlık yok (`guard::acik_baglanti`
 * JSON gövde döner), dolayısıyla tarayıcı düz gezinme yapıyordu: SPA
 * belgesi ham JSON ile değişiyor, React ağacı yok oluyor ve Görev 8'in
 * bütün 401 tasarımı devre dışı kalıyordu. Taslak deposu bileşen ağacının
 * dışında ama **aynı JS bağlamında**; o da gidiyordu.
 *
 * Somut senaryo: not yazılıyor → kart açılıp onam PDF'ine bakılıyor →
 * 5 dk boşta kalma kilidi → bağlantıya tıklanıyor → uygulama gider,
 * yazılmamış taslak metin gider.
 *
 * # Neden `istek()` yolu seçildi, "401'i de gezinmez yapmak" değil
 *
 * İki seçenek vardı. (a) Sunucunun 401 yanıtına da `Content-Disposition`
 * koymak (ya da bağlantıya `download` özniteliği eklemek): gezinmeyi
 * durdurur ama kullanıcıya **anlamsız bir JSON dosyası indirtir** ve SPA
 * kilit ekranına HİÇ dönmez — oturumun kilitli olduğunu bir sonraki istek
 * 401 alana kadar hiçbir yerden öğrenmez. (b) İndirmeyi `fetch`'ten
 * geçirmek: 401 tam olarak diğer 25 uçla aynı mekanizmadan geçer,
 * dinleyiciler senkron tetiklenir, `App` kilit ekranına döner ve taslak
 * **bellekte kalır**. (b) seçildi.
 *
 * # "İçerik JS'e çekilmez" kararı ne oldu
 *
 * Eski gerekçe "içeriği JS'e çekmek dosyayı ekrana basılabilir hâle
 * getirirdi" diyordu. Korunması gereken değişmez bu değil, onun sonucuydu:
 * **danışan belgesi SPA içinde gömülü GÖSTERİLMEZ.** Bu burada da
 * korunuyor: bayt dizisi hiçbir bileşene geçmiyor, hiçbir state'e
 * yazılmıyor, `<img>/<iframe>/<object>` hedefi olmuyor; yalnızca geçici bir
 * `blob:` URL'e sarılıp `download` özniteliğiyle diske yazdırılıyor ve URL
 * hemen serbest bırakılıyor. Sunucunun `Content-Disposition: attachment` +
 * `X-Content-Type-Options: nosniff` başlıkları **kaldırılmadı**; hâlâ
 * gönderiliyor ve sunucu testleriyle sabitleniyor (bir gün bu dosya
 * `window.open`'a dönerse tek savunma onlar olur).
 *
 * Dosya adı `download` özniteliğine konuyor: sunucunun RFC 5987 kodlu
 * `filename*`'i `fetch` yolunda tarayıcıya ulaşmıyor.
 */
export async function ekIndir(ek: { id: number; dosya_adi: string }): Promise<void> {
  const yanit = await fetch(ekIndirmeYolu(ek.id))
  if (!yanit.ok) await basarisizYanitiFirlat(yanit)

  const url = URL.createObjectURL(await yanit.blob())
  try {
    const bag = document.createElement('a')
    bag.href = url
    bag.download = ek.dosya_adi
    bag.click()
  } finally {
    // Kişisel veri taşıyan bir blob URL'i sayfa ömrü boyunca canlı
    // bırakmak, onu adresi bilen her koda açık tutardı (`DanisanKarti`'nin
    // rapor blob'u için verilen kararın aynısı). Bir sonraki makro
    // görevde serbest bırakılıyor: aynı karede iptal etmek bazı
    // tarayıcılarda indirmeyi yarıda keser.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

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
  /**
   * Bir randevu silinirse **kaç notun** yok olacağı.
   *
   * `progress_notes` ve `private_notes` `ON DELETE CASCADE` taşıyor: randevu
   * silinince seans notu ve özel not da gider (bkz. dal incelemesi I2).
   * Onay metni bunu söylemek zorunda ve sayı yalnızca sunucuda bilinir.
   * Yanıt **yalnızca sayı** taşır; not içeriği bu yolla asla gelmez.
   */
  silinecekNotSayisi: (id: number) =>
    istek<{ not_adedi: number }>(`/api/randevular/${id}/silinecekler`).then((y) => y.not_adedi),
  // Seri silme geri alınamaz bir işlem: onay metninin kaç randevunun VE kaç
  // notun gideceğini söyleyebilmesi için önce sayılar sorulur. Seri
  // ekrandaki haftanın çok ötesine uzanabildiği için bunlar yalnızca
  // sunucuda bilinir.
  //
  // İki sayı TEK istekten gelir: ayrı ayrı sorulsalardı onay metni iki
  // farklı ana ait iki sayıyı yan yana gösterebilirdi.
  seriSayisi: (seriId: string, buTarihtenItibaren: string) =>
    istek<{ adet: number; not_adedi: number }>(
      `/api/randevular/seri/${encodeURIComponent(seriId)}` +
        `?bu_tarihten_itibaren=${encodeURIComponent(buTarihtenItibaren)}`,
    ).then((y) => ({ adet: y.adet, notAdedi: y.not_adedi })),
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

/**
 * `takvimApi.seriSayisi`'nin sonucu — seri silme onayının söyleyeceği iki
 * sayı (dal incelemesi I2).
 *
 * Çıplak `number` DEĞİL: eskiden yalnızca `adet` dönüyordu ve onay metni
 * notlardan hiç söz etmiyordu; 52 haftalık bir serinin gelecekteki tüm
 * seans/özel notları sessizce gidiyordu.
 */
export type SeriSilmeOnizlemesi = {
  /** Silinecek randevu sayısı (geçmiş üyeler hariç). */
  adet: number
  /** Onlarla birlikte gidecek seans + özel not sayısı. */
  notAdedi: number
}

// Çakışma kontrolünün yanıtı. Çıplak dizi değil: uyarı metninin "kaç
// haftada çakışma var" diyebilmesi için hafta sayısı gerekiyor.
export type SeriCakismasi = {
  cakisanlar: Randevu[]
  cakisan_hafta_sayisi: number
  kontrol_edilen_hafta: number
}

/**
 * `GET/PUT /api/randevular/{id}/not` yanıtı (sunucudaki `SeansNotu`).
 *
 * `seans_zamani` ile `guncelleme_zamani` AYNI ŞEY DEĞİLDİR ve karıştırmak
 * ekranda sessiz bir yalan üretir: birincisi randevunun başlangıcı
 * (`appointments.baslangic`, listenin sıralama anahtarı), ikincisi notun son
 * düzenlenme anı. Geçen ayki bir seansın notu bugün düzeltilmiş olabilir.
 */
export type SeansNotu = {
  appointment_id: number
  client_id: number
  /** Randevunun başlangıcı — yerel naive biçim (`2026-09-07T10:00`). */
  seans_zamani: string
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
  //
  // `once` ("bu seans başlamadan önce") OPSİYONEL: verilmezse kesme yok.
  // "Önceki seans notları" paneli bunu geçmek ZORUNDADIR — geçmeyen bir
  // çağrı, açık seanstan SONRAKİ seansların notlarını "önceki" diye
  // gösterir (bkz. `store::notes::danisan_notlari` belgesindeki `once`
  // başlığı). Veri raporu ise bilerek geçmez: KVKK md. 11 "elimdeki her
  // şey" demektir.
  danisanNotlari: (danisanId: number, limit: number, once?: string) =>
    istek<SeansNotu[]>(
      `/api/danisanlar/${danisanId}/notlar?limit=${limit}` +
        (once === undefined ? '' : `&once=${encodeURIComponent(once)}`),
    ),
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

/**
 * Danışan **dosyası** istemcisi: tek danışanın tam kaydı, rıza alanları ve
 * ekli dosyaları.
 *
 * # Burada da özel nota giden bir yol YOKTUR
 *
 * `notApi`/`ozelNotApi` ayrımıyla aynı gerekçe (bkz. `notApi` başlığı): bir
 * "danışan veri raporu" ekranı doğal olarak "danışanın her şeyini getiren
 * istemciyi" arar. Bu nesne danışanın kimlik/rıza/saklama alanlarını ve ek
 * dosya ÜSTVERİSİNİ verir; not içeriği için tek yol `notApi.danisanNotlari`,
 * yani yalnızca **resmî** notlara giden fonksiyondur.
 */
export const danisanApi = {
  dosyaGetir: (id: number) => istek<DanisanDosyasi>(`/api/danisanlar/${id}`),
  /**
   * Rıza alanlarını günceller (`PATCH /api/danisanlar/{id}`).
   *
   * Gövde YALNIZCA rıza alanlarını taşır. `son_temas`/`saklama_bitis`
   * sunucudaki `DanisanGuncelleme`'de bilerek yok (ikisi birbirine bağlı ve
   * tek yazma yolu `son_temasi_tazele`); `durum` da yok (arşivlemenin tek
   * yolu `arsivle`). Onları buraya koymak sunucuda sessizce yok sayılır ve
   * arayüzde "yazabiliyorum" yanılsaması yaratırdı.
   *
   * `riza_dosya_id` **açıkça** gönderilir — `null` dâhil. Sunucu "alan yok"
   * ile "alan null"u ayırt ediyor (`acik_null_ayirt_et`): alanı hiç
   * göndermemek "dokunma" demektir ve yanlış dosya bağlayan kullanıcı bağı
   * koparamazdı.
   */
  rizaKaydet: (id: number, alan: { riza_tarihi: string; riza_dosya_id: number | null }) =>
    istek<DanisanDosyasi>(`/api/danisanlar/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        riza_tarihi: alan.riza_tarihi,
        riza_dosya_id: alan.riza_dosya_id,
      }),
    }),
  ekleriGetir: (id: number) => istek<EkBilgisi[]>(`/api/danisanlar/${id}/ekler`),
  /**
   * Veri raporu dışa aktarımını denetim kaydına yazdırır
   * (`POST /api/danisanlar/{id}/rapor-kaydi`).
   *
   * # Neden bu çağrı var
   *
   * Rapor tamamen İSTEMCİDE üretiliyor (`veriRaporu.ts` + `Blob`), yani
   * sunucu dosyanın diske yazıldığını başka hiçbir yerden göremez. Rapor
   * için çekilen not listesi (`notApi.danisanNotlari`) `goruntuleme` yazıyor
   * ve 5 dakikalık pencerede **birleşiyor** — seans paneli aynı danışan için
   * açıldıysa dışa aktarım denetim kaydında hiç iz bırakmıyordu. Tasarım §4
   * dışa aktarmayı açıkça sayıyor; emsal `attachments::icerik_getir` (tek
   * bir ek indirmesi bile `DisaAktarma` + `HerCagri`).
   *
   * # ÖNCE çağrılır — fail-closed
   *
   * `DanisanKarti::raporHazirla` bunu notları çekmeden ÖNCE `await` eder;
   * reddedilirse (kilitli oturum → 401, bilinmeyen danışan → 404, disk
   * hatası → 500) rapor **hiç üretilmez**. Plan 1'in kurulum/kilit-açma
   * kararıyla aynı gerekçe: kaydedilemeyecek bir erişime izin verilmez.
   *
   * Gövde bilerek boş: rapor içeriği (ad, not metni, dosya adları) sunucuya
   * ve loga ASLA gitmez.
   *
   * PLAN 4: dışa aktarım sunucuya taşınıp parola korumalı üretildiğinde
   * (tasarım §10) raporu üreten uç noktanın kendisi loglayacak ve bu çağrı
   * kaldırılacak.
   */
  raporKaydiOlustur: (id: number) =>
    istek<Record<string, never>>(`/api/danisanlar/${id}/rapor-kaydi`, { method: 'POST' }),
  /**
   * Ek dosya yükler (`POST /api/danisanlar/{id}/ekler`).
   *
   * # Sözleşme standart DEĞİL ve bilerek öyle
   *
   * Üstveri **başlıklarda**, içerik **ham gövdede** (Görev 7 kararı):
   * - `multipart/form-data` kullanılmadı çünkü sınır kontrolü gövde
   *   boyutuna bakıyor (`AZAMI_GOVDE_BOYUTU == AZAMI_DOSYA_BOYUTU`) ve
   *   multipart, 20 MB'lık **geçerli** bir dosyayı sınırı aşan bir gövdeye
   *   çevirirdi. `<form enctype="multipart/form-data">` bu uç noktada
   *   ÇALIŞMAZ.
   * - Sorgu dizgisi kullanılmadı çünkü **dosya adı sağlık verisidir**
   *   ("HIV-raporu.pdf") ve URL'ler sunucu günlüklerine düşer.
   *
   * Dosya adı yüzde kodlanır: HTTP başlık değerleri ASCII'dir, Türkçe bir ad
   * doğrudan konulamaz (sunucu `yuzde_coz` ile çözüyor).
   */
  ekYukle: (danisanId: number, dosya: File, tur: string) => {
    if (dosya.size > AZAMI_EK_BOYUTU) {
      // Dosya ADI mesaja KONMAZ: sağlık verisidir ve hata metinleri ekranın
      // dışına düşebilir (sunucu da aynı kararı veriyor).
      return Promise.reject(
        new Error(
          `Dosya en fazla 20 MB olabilir; seçilen dosya ${(dosya.size / (1024 * 1024)).toFixed(1)} MB.`,
        ),
      )
    }
    return istek<EkBilgisi>(`/api/danisanlar/${danisanId}/ekler`, {
      method: 'POST',
      headers: {
        // Tarayıcı bazı dosyalar için `type`'ı boş verir; boş bir başlık
        // sunucuda "`content-type` eksik" hatasına dönerdi.
        'content-type': dosya.type || 'application/octet-stream',
        'x-dosya-adi': encodeURIComponent(dosya.name),
        'x-ek-turu': tur,
      },
      body: dosya,
    })
  },
}

/**
 * Hızlı arama istemcisi (`GET /api/ara`).
 *
 * Tek fonksiyonlu: sunucudaki `store::search` `private_notes` tablosunu hiç
 * tanımıyor ve istemcide de aramaya **ikinci bir kaynak** eklenemesin diye
 * nesne bilerek dar. Sorgu metni sunucuda erişim loguna yazılmıyor; arayüz
 * de onu hiçbir yere (konsol dâhil) düşürmez.
 */
export const aramaApi = {
  ara: (sorgu: string) =>
    istek<AramaSonucu[]>(`/api/ara?q=${encodeURIComponent(sorgu)}&limit=${ARAMA_SINIRI}`),
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
