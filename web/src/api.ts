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

/**
 * Sunucu "veritabanı bozuk" dediğinde fırlatılır.
 *
 * `YetkisizHata` ile aynı gerekçe ve aynı sınıftan bir ayrım: bu, sıradan
 * bir 500 değildir. Kullanıcının parolası **doğrudur** ve yapılması gereken
 * tek şey yedekten geri yüklemektir; genel bir hata mesajı göstermek onu
 * parolasını yeniden denemeye, sonra da "her şeyi silip baştan kurmaya"
 * iter — bu kod tabanında dört katmanda bulunan hata sınıfının tam olarak
 * kendisi.
 */
export class VeritabaniBozukHata extends Error {
  constructor(mesaj: string) {
    super(mesaj)
    this.name = 'VeritabaniBozukHata'
  }
}

/**
 * 401 ve "veritabanı bozuk" DIŞINDAKİ başarısız yanıtlar. `Error`'ın alt
 * sınıfı — mesajı okuyan bütün çağıranlar aynen çalışır; HTTP durumunu da
 * taşır ki çağıran "kayıt yok" (404) ile gerçek bir hatayı ayırabilsin.
 *
 * Tek kullanıcısı bugün etiketli seanslar paneli (son inceleme I1): takvimde
 * bir randevu silinince panel yeniden okunur ve o randevu etiketin SON
 * seansıysa etiket sunucuda tetikleyiciyle silinmiştir — yanıt 404'tür.
 * Bu bir hata değil, "bu etiketi taşıyan seans kalmadı"nın kendisidir;
 * panel onu boş liste olarak gösterir (bkz. `useEtiketler.acikYukle`).
 */
export class IstekHatasi extends Error {
  readonly durum: number
  constructor(mesaj: string, durum: number) {
    super(mesaj)
    this.name = 'IstekHatasi'
    this.durum = durum
  }
}

type YetkisizDinleyici = () => void
const yetkisizDinleyiciler = new Set<YetkisizDinleyici>()
const bozukDinleyiciler = new Set<YetkisizDinleyici>()

/**
 * `veritabani_bozuk` yanıtından merkezî olarak haberdar olmayı sağlar —
 * 401 mekanizmasının (`yetkisizOlunca`) birebir eşi.
 *
 * Neden dinleyici, neden `KilitEkrani`'nin kendi `catch`'i değil: bozuk
 * veritabanı **hangi ekranda** olunduğundan bağımsız bir durumdur ve
 * gidilecek yer her zaman aynıdır (geri yükleme ekranı). Kararı `App`
 * veriyor; ekranların bunu bilmesine gerek yok.
 */
export function veritabaniBozukOlunca(dinleyici: YetkisizDinleyici): () => void {
  bozukDinleyiciler.add(dinleyici)
  return () => {
    bozukDinleyiciler.delete(dinleyici)
  }
}

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
  const govde: { hata?: string; veritabani_bozuk?: boolean } = await yanit
    .json()
    .catch(() => ({}))
  const mesaj = govde.hata ?? 'Beklenmeyen bir hata oluştu.'
  if (yanit.status === 401) {
    for (const dinleyici of yetkisizDinleyiciler) dinleyici()
    throw new YetkisizHata(mesaj)
  }
  // Karar sunucunun AYRI BAYRAĞINA bakılarak veriliyor, hata metnine göre
  // DEĞİL: metin kullanıcı için yazılmıştır ve yarın değişebilir; ekran
  // seçimini ona bağlamak, metni düzelten birinin geri yükleme ekranını
  // sessizce devre dışı bırakması demekti.
  if (govde.veritabani_bozuk === true) {
    for (const dinleyici of bozukDinleyiciler) dinleyici()
    throw new VeritabaniBozukHata(mesaj)
  }
  throw new IstekHatasi(mesaj, yanit.status)
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

/**
 * Danışanın tek bir seansı (`GET /api/danisanlar/{id}/seanslar` yanıtındaki
 * bir satır; sunucudaki `DanisanSeansi`, Plan 5 Görev 4).
 *
 * # `ucret_kurus: number | null` — `null` ile `0` KARIŞTIRILMAZ
 *
 * Sunucuda `appointments.ucret` sütunu `NULL` olabilir ve `NULL`'ün anlamı
 * iki şeyden biridir: "ücretsiz seans" ya da "ücret hiç girilmemiş" — şema
 * düzeyinde ayırt edilmez. Sunucu (`store::danisan_seanslari`) bu ayrımı
 * BİLEREK korur: `NULL` JSON'da `null` kalır, `0`'a sadeleşmez. Bu tip o
 * ayrımı aynen TAŞIR; `null` iken `tlMetni(0)` BASILMAZ — çağıran taraf ayrı
 * bir işaret ("—" gibi) kullanır.
 *
 * # `not_ilk_satiri: string | null` — `null` ile `''` KARIŞTIRILMAZ
 *
 * Not YOKSA `null` ("not yazılmamış"); not açılıp boş bırakıldıysa `''`
 * ("not açılmış ama boş"). Bu görev bu alanı görüntülemeyebilir ama tipi
 * doğru taşımak zorunda — sonraki görev (Seanslar alt sekmesi) ikisini
 * farklı gösterecek.
 */
export type DanisanSeansi = {
  appointment_id: number
  /**
   * Randevunun DUVAR SAATİ başlangıcı (`YYYY-AA-GGTSS:DD`, 16 karakter) —
   * zaman dilimi TAŞIMAZ. `new Date()`e verilmez (`Randevu.baslangic` ile
   * aynı gerekçe, bkz. `HaftalikTakvim.ts`): UTC varsayımına düşmek saati
   * kaydırırdı.
   */
  baslangic: string
  durum: string
  ucret_kurus: number | null
  odendi: boolean
  not_ilk_satiri: string | null
  /**
   * Seansın etiket ADLARI, sunucunun `store::tags::etiket_sirasi` sırasıyla
   * (Türk alfabesi, büyük/küçük harf duyarsız — istemcideki eşi
   * `etiket/etiketAdi.ts::etiketSirasi`; Plan 6 Görev 6,
   * `store::danisan_seanslari` modül başlığı "Etiketler").
   * Etiketsiz seansta `[]`. Dosyadaki "Etikete göre süz" seçimi ve satırdaki
   * çipler buradan; etiket yazması listeyi yeniden çekmez,
   * `useDanisanSeanslari.yamala` ile bu alanı yamanır (bkz. `AnaEkran.tsx`).
   */
  etiketler: string[]
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
 * `GET /api/depolama-durumu` yanıtı (sunucudaki `DepolamaDurumu`).
 *
 * Eşik sunucudan geliyor ve burada **sabitlenmiyor**: iki kopya sessizce
 * ayrışırdı (`AZAMI_EK_BOYUTU`'nun aksine — o, isteği hiç atmadan reddedebilmek
 * için istemcide de duruyor ve sunucu testiyle eşitliği pinleniyor; bu ise
 * yalnızca gösterim için).
 */
export type DepolamaDurumu = {
  /** Tüm eklerin toplam boyutu (bayt). */
  toplam_boyut: number
  /** Uyarı eşiği (bayt) — plan global kısıtı: 500 MB. */
  esik: number
  /** `toplam_boyut > esik`. **Hiçbir işlemi durdurmaz**, yalnızca bildirir. */
  uyari: boolean
}

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
  /** `"danisan"`, `"not"` veya `"etiket"` (Görev 7). */
  tur: string
  /** `tur === 'etiket'` iken anlamsız: `0`. */
  client_id: number
  /** `tur === 'etiket'` iken boş dizgi. */
  danisan_adi: string
  appointment_id: number | null
  tarih: string | null
  /** Eşleşmenin çevresinden alınan bağlam parçası; `tur === 'etiket'` iken boş dizgi. */
  parca: string
  /** Yalnızca `tur === 'etiket'` iken dolu: etiketin kimliği. */
  tag_id: number | null
  /** Yalnızca `tur === 'etiket'` iken dolu: etiketin görünen adı. */
  etiket_adi: string | null
  /** Yalnızca `tur === 'etiket'` iken dolu: etiketin kaç seansa bağlı olduğu. */
  kullanim: number | null
}

/**
 * `GET /api/ara` yanıtı (sunucudaki `AramaYaniti`).
 *
 * Çıplak dizi DEĞİL: `kirpildi` olmadan "sonuç yok" ile "sonuç kırpıldı"
 * ayırt edilemiyordu. Bütçe paylaştırması sessiz kaybı hafifletti ama
 * kaldırmadı — 61 danışan eşleşirse 12'si hâlâ düşer ve terapist var olan
 * bir notu bulamadığını fark etmezdi.
 *
 * `kirpildi` sunucuda **ölçülür** (her iki sorgu `LIMIT sinir + 1` ile
 * çalışır), istemcide tahmin edilmez.
 */
export type AramaYaniti = {
  sonuclar: AramaSonucu[]
  /** Eşleşen en az bir kayıt daha var ama sınıra sığmadı. */
  kirpildi: boolean
}

/**
 * Bir aramanın döndürebileceği en fazla sonuç — sunucudaki `AZAMI_SONUC`.
 *
 * Sunucu `limit`i `1..=50` aralığına kırpıyor; daha büyük bir sayı göndermek
 * sessizce 50'ye düşerdi, bu yüzden istek bu değerle kurulur.
 *
 * # Eskiden bir de "kırpılma sezgisi" için kullanılıyordu; ARTIK DEĞİL
 *
 * `/api/ara` yanıtı kırpılma işareti taşımadığı için arayüz
 * "sonuç sayısı == sınır" diye tahmin yürütüyordu. O sezgi **iki yönde de
 * yanlıştı**: tam 50 eşleşmede (hiçbiri düşmemişken) uyarıyor, iki kipin
 * bütçesi ayrı ayrı dolduğunda (toplam 50'nin altındayken de düşen eşleşme
 * varken) uyarmıyordu. Bugün karar sunucudan gelen `kirpildi` alanına ait.
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
    // bırakmak, onu adresi bilen her koda açık tutardı (`DosyaBilgileri`'nin
    // rapor blob'u için verilen kararın aynısı). Bir sonraki makro
    // görevde serbest bırakılıyor: aynı karede iptal etmek bazı
    // tarayıcılarda indirmeyi yarıda keser.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/**
 * `takvimApi.randevuDurumu`'nun yanıtı (sunucudaki `SonTemasSonucu`,
 * Görev 3). Üç alan BİRLİKTE gelir ya da hiç gelmez — `durum_guncelle`
 * yalnızca "geldi" işaretlemesi danışanın son temasını GERÇEKTEN ileri
 * taşıdıysa doldurur (bkz. çağırma yeri).
 */
export type DurumYaniti = {
  client_id?: number
  son_temas?: string
  saklama_bitis?: string
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
  /**
   * `PATCH /api/randevular/{id} {durum}`.
   *
   * # Yanıt: `DurumYaniti` (Görev 3 — "saklama süresi doldu" bayatlığı)
   *
   * "Geldi" işaretlemek sunucuda danışanın `son_temas`/`saklama_bitis`ini
   * ileri taşıyabilir (`appointments::son_temasi_isaretle`) ve bu GERÇEKTEN
   * değiştiyse yanıt artık `client_id`/`son_temas`/`saklama_bitis`i de
   * taşıyor — üçü BİRLİKTE ya var ya yok (bkz. sunucudaki `SonTemasSonucu`).
   * Diğer her durumda (`gelmedi`/`iptal`/`planlandi`, ya da geçmişe dönük bir
   * "geldi") yanıt eskisi gibi `{}`. Çağıran (`AnaEkran.durumDegis`) bu
   * alanları görünce kartı ve saklama listesini YEREL yamalar — ikisi de
   * sunucuda `LogHacmi::HerCagri` olduğu için yeniden ÇEKİLMEZ.
   */
  randevuDurumu: (id: number, durum: string) =>
    istek<DurumYaniti>(`/api/randevular/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ durum }),
    }),
  // "Ödendi" işaretini koyar/geri alır (`PATCH /api/randevular/{id}/odeme`,
  // yanıt 204 — gövde yok). Ayrı yol: yukarıdaki PATCH'in `{durum}`
  // sözleşmesine dokunulmaz. Panel bağlantısı Plan 4 Görev 2'de.
  odemeGuncelle: (id: number, odendi: boolean): Promise<void> =>
    istek<unknown>(`/api/randevular/${id}/odeme`, {
      method: 'PATCH',
      body: JSON.stringify({ odendi }),
    }).then(() => undefined),
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
   * Danışanın TÜM seansları — notu olsun olmasın, en yeniden eskiye
   * (`GET /api/danisanlar/{id}/seanslar`, Plan 5 Görev 4).
   *
   * Bilinmeyen (silinmiş/arşivlenmiş değil, hiç var olmamış ya da geçersiz)
   * `id` için sunucu **404** döner — boş dizi DEĞİL. `istek()` bu durumu
   * sıradan bir `Error` olarak fırlatır (401 ve "veritabanı bozuk" dışında
   * ayrı bir hata sınıfı yok); çağıran taraf (`useDanisanSeanslari`) bunu
   * "boş dosya" olarak ele almalı, çökmüş bir ekran olarak DEĞİL.
   */
  seanslar: (clientId: number) =>
    istek<DanisanSeansi[]>(`/api/danisanlar/${clientId}/seanslar`),
  /**
   * Danışan veri raporunu (KVKK md. 11) **sunucuda** üretilmiş, AES-256
   * parola korumalı PDF olarak indirir
   * (`POST /api/danisanlar/{id}/veri-raporu`, Plan 4 Görev 6–7).
   *
   * - Parola **gövdede** gider; URL'ye (geçmiş, günlükler) asla girmez.
   * - `bugun` istemcinin **yerel** takvim günüdür (`yerelGun`) ve yalnızca
   *   dosya adına girer; sunucunun UTC günü Türkiye'de 00:00–03:00 arasında
   *   dünü verirdi. Sunucu geçersiz günü `400` ile reddeder.
   * - Denetim kaydını sunucu, raporu ürettiği adımda kendisi yazar; ayrı bir
   *   "kayıt" çağrısı yoktur (Plan 3'ün `rapor-kaydi` ucu kaldırıldı).
   * - İndirme `ekIndir` ile aynı desen: `fetch` → 401 dinleyicileri
   *   (`basarisizYanitiFirlat`) → `blob:` URL → `download` → URL serbest.
   *   Hata yolunda (400 ana parola reddi, 401, 404, 500) dosya üretilmez,
   *   sunucunun `hata` metni fırlatılır ve sayfa gezinmez.
   *
   * Blob'un TEK kaynağı sunucunun yanıtıdır (`yanit.blob()`): istemci rapor
   * metni üretmez. Bunu `istemciRaporUretimi.test.ts` `web/src`'nin
   * tamamında yapısal olarak ölçer.
   *
   * Dosya adı sunucunun `Content-Disposition`'ından okunur (danışan adı
   * içermez); okunamazsa sabit bir ad kullanılır.
   */
  veriRaporuIndir: async (id: number, parola: string, bugun: string): Promise<void> => {
    const yanit = await fetch(`/api/danisanlar/${id}/veri-raporu`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parola, bugun }),
    })
    if (!yanit.ok) await basarisizYanitiFirlat(yanit)

    const ek = yanit.headers?.get('content-disposition') ?? ''
    const ad = /filename="([^"]+)"/.exec(ek)?.[1] ?? 'danisan-veri-raporu.pdf'
    const url = URL.createObjectURL(await yanit.blob())
    try {
      const bag = document.createElement('a')
      bag.href = url
      bag.download = ad
      bag.click()
    } finally {
      // `ekIndir` ile ayni gerekce: bir sonraki makro gorevde serbest.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    }
  },
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
  /**
   * Ek dosyayı **kalıcı olarak** siler (`DELETE /api/ekler/{id}`).
   *
   * # Neden var (dal incelemesi)
   *
   * Uç nokta Görev 7'de yazıldı ve test edildi ama arayüzde hiçbir çağrı yeri
   * yoktu: yanlış danışana yüklenen bir onam PDF'i **silinemiyordu**. Bu, bu
   * kod tabanının tekrar eden "kodda var, üründe yok" örüntüsünün HTTP →
   * arayüz yönündeki hâli; `notlar_api.rs::her_http_ucunun_bir_istemci_cagri_
   * yeri_var` artık o yönü de tarıyor.
   *
   * # Geri alınamaz
   *
   * Dosya BLOB'u gider; yedek dışında geri dönüşü yoktur. Çağıran taraf
   * (`DosyaBilgileri`) bu yüzden iki adımlı onay gösterir. Sunucudaki
   * `attachments::sil` ayrıca **sarkan `clients.riza_dosya_id`'yi aynı
   * transaction'da temizler** (`riza_tarihi` korunur) — onay metni bunu
   * söylemek zorunda, çünkü silinen dosya rıza belgesiyse danışanın rıza
   * bölümündeki bağ da kopar.
   */
  ekSil: (ekId: number) =>
    istek<Record<string, never>>(`/api/ekler/${ekId}`, { method: 'DELETE' }),
  /**
   * Saklama süresi dolmuş danışanlar (`GET /api/saklama-suresi-dolanlar`).
   *
   * **SİLME YOK**: uç nokta yalnızca listeler, imha kararı her zaman
   * insanındır (plan global kısıtı). Tasarım §7 bunu "ana ekranda hatırlatma
   * olarak listelenir" diye tanımlıyordu; kart içindeki tekil gösterge o
   * hatırlatmanın yerini tutmaz — bir dosyanın süresinin dolduğunu görmek
   * için o dosyayı açmak gerekiyordu.
   *
   * `bugun` istemcinin **yerel** takvim günü (`YYYY-AA-GG`): karşılaştırma
   * duvar saatine göre yapılıyor ve UTC'den türetmek 00:00–03:00 arasında
   * sınırdaki bir dosyayı listeden düşürürdü (bkz. `AnaEkran::yerelGun` ve
   * sunucudaki `saklama_listesi` gerekçesi).
   *
   * DİKKAT — çağrı sayısı: sunucudaki depo fonksiyonu her çağrıda
   * `LogHacmi::HerCagri` ile **silinemez** bir `goruntuleme` satırı yazar.
   * Bu yüzden ana ekran onu yalnızca ilk yüklemede çağırır, her hafta
   * değişiminde değil.
   */
  saklamaSuresiDolanlar: (bugun: string) =>
    istek<Danisan[]>(`/api/saklama-suresi-dolanlar?bugun=${encodeURIComponent(bugun)}`),
  /**
   * Toplam ek boyutu ve 500 MB uyarı eşiği (`GET /api/depolama-durumu`).
   *
   * Çekirdek de sunucu da **log yazmaz** (bir sayıdan ibaret durum sorgusu,
   * `cakisanlari_bul` ile aynı sınıf), dolayısıyla ekran yenilendikçe
   * çağrılabilir. Engellemez: `uyari` doğruyken yükleme çalışmaya devam eder.
   */
  depolamaDurumu: () => istek<DepolamaDurumu>('/api/depolama-durumu'),
}

/**
 * Sözlükteki tek bir etiket (`GET /api/etiketler` / `.../etiketler` yanıtındaki
 * bir satır; sunucudaki `store::tags::Etiket`).
 *
 * `kullanim`, o etiketin kaç seansa bağlı olduğudur (otomatik tamamlama
 * listesini kullanım sıklığına göre sıralamak için).
 */
export type Etiket = { id: number; ad: string; kullanim: number }

/**
 * Bir etiketi taşıyan tek bir seans (`GET /api/etiketler/{id}/seanslar`
 * yanıtındaki bir satır; sunucudaki `store::tags::EtiketliSeans`).
 */
export type EtiketliSeans = {
  appointment_id: number
  client_id: number
  danisan_adi: string
  /** Randevunun duvar saati başlangıcı — `DanisanSeansi.baslangic` ile aynı biçim. */
  baslangic: string
}

/**
 * Etiket istemcisi (`store::tags`'in HTTP karşılığı, Plan 6 Görev 5).
 *
 * # Etiket adı URL'ye GİRMEZ
 *
 * Ekleme adı **gövdede** gönderir (`etiketEkle`); kaldırma ve arama yalnızca
 * sayısal kimlikle çalışır (`etiketKaldir`, `etiketliSeanslar`). Sunucudaki
 * `routes::tags` modül başlığıyla aynı gerekçe: etiket adı da not içeriği
 * kadar hassas bir sınıflandırmadır, URL'ler sunucu günlüklerine ve
 * tarayıcı geçmişine düşer.
 */
export const etiketApi = {
  /** Sözlükteki tüm etiketler, en çok kullanılandan aza (`GET /api/etiketler`). */
  etiketleriGetir: () => istek<Etiket[]>('/api/etiketler'),
  /** Bir seansın etiketleri (`GET /api/randevular/{id}/etiketler`). */
  seansEtiketleri: (randevuId: number) =>
    istek<Etiket[]>(`/api/randevular/${randevuId}/etiketler`),
  /**
   * Seansa etiket koyar (`POST /api/randevular/{id}/etiketler {ad}`).
   * Aynı ad başka bir yazımla (büyük/küçük harf, baş/son boşluk) zaten
   * varsa sunucu var olan etikete bağlar -- idempotenttir.
   */
  etiketEkle: (randevuId: number, ad: string) =>
    istek<Etiket>(`/api/randevular/${randevuId}/etiketler`, {
      method: 'POST',
      body: JSON.stringify({ ad }),
    }),
  /**
   * Seanstan etiketi kaldırır (`DELETE /api/randevular/{id}/etiketler/{tag_id}`,
   * yanıt 204 -- gövde yok, `takvimApi.odemeGuncelle` ile aynı desen).
   */
  etiketKaldir: (randevuId: number, tagId: number): Promise<void> =>
    istek<unknown>(`/api/randevular/${randevuId}/etiketler/${tagId}`, {
      method: 'DELETE',
    }).then(() => undefined),
  /**
   * Bir etiketi taşıyan seanslar (`GET /api/etiketler/{id}/seanslar`,
   * etiket dosyası ekranı için).
   */
  etiketliSeanslar: (tagId: number) =>
    istek<EtiketliSeans[]>(`/api/etiketler/${tagId}/seanslar`),
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
    istek<AramaYaniti>(`/api/ara?q=${encodeURIComponent(sorgu)}&limit=${ARAMA_SINIRI}`),
}

/** Ay sonu özetinde ödenmemiş seansı olan bir danışan (sunucudaki `Borclu`). */
export type Borclu = {
  client_id: number
  ad_soyad: string
  borc_kurus: number
  seans_sayisi: number
}

/**
 * `GET /api/ay-ozeti?ay=YYYY-AA` yanıtı (sunucudaki `store::ozet::AyOzeti`).
 *
 * Yalnızca `geldi` olarak işaretlenen seanslar sayılır; `gelmedi`, `iptal` ve
 * `planlandi` hiçbir alana girmez. Tutarlar kuruştur.
 */
export type AyOzeti = {
  ay: string
  seans_sayisi: number
  tahsilat_kurus: number
  bekleyen_kurus: number
  borclular: Borclu[]
}

/**
 * Ay sonu özeti istemcisi (Plan 4 Görev 3). Bileşeni Görev 4 yazar.
 *
 * `ay` `YYYY-AA` biçimindedir; geçersizse sunucu `400 {hata}` döner. Sunucu
 * görüntülemeyi ay başına 5 dakikalık pencerede birleştirerek loglar, yani
 * ekran ay değiştirdikçe çağrılabilir.
 */
export const ozetApi = {
  ayOzeti: (ay: string): Promise<AyOzeti> =>
    istek<AyOzeti>(`/api/ay-ozeti?ay=${encodeURIComponent(ay)}`),
}

/** `POST /api/yedekler` yanıtındaki tek yedek (sunucudaki `YedekOzeti`). */
export type YedekOzeti = {
  /**
   * `yedek-YYYY-AA-GG.db`. Geri yükleme isteğinin tanıtıcısı da budur:
   * istemci **hiçbir zaman bir yol göndermez**, yalnızca bu adı geri
   * gönderir ve sunucu onu klasörle kendisi birleştirir.
   */
  dosya_adi: string
  tarih: string
  /** Yalnızca `.db` dosyasının boyutu (bayt). */
  boyut: number
}

/**
 * `POST /api/yedekler` yanıtı.
 *
 * `hedef_dizin` **mutlak** bir klasör yoludur ve bilerek dönüyor: geri
 * yükleme ekranı kullanıcıya "yedekleriniz şu klasörde" diyebilmek zorunda
 * (macOS'ta bu klasör bir harici diskte ya da Finder'ın gizlediği bir yerde
 * olabilir). Aynı karar `/api/durum`'un `veri_dizini` alanında da verildi.
 *
 * Yedeklerin kendi mutlak yolları **dönmez**: `YedekOzeti` yalnızca dosya
 * adı taşır ve sunucudaki `core::backup::YedekBilgisi` artık `Serialize`
 * türetmiyor, yani onu olduğu gibi döndürmek derlenmez.
 */
export type YedekListesi = {
  hedef_dizin: string
  yedekler: YedekOzeti[]
}

/**
 * Yedekleme ve geri yükleme istemcisi.
 *
 * # Otomatik yedek nerede
 *
 * Tasarım §7 "günde bir kez otomatik şifreli yedek" istiyor. Damgayı
 * (`YYYY-AA-GG`) **istemci** üretiyor, sunucu kendi saatinden türetmiyor:
 * kod tabanının duvar saati sözleşmesi bu (`saklama-suresi-dolanlar?bugun=`
 * ile aynı gerekçe). Istanbul UTC+3 iken 00:00–03:00 arasında UTC hâlâ
 * dünkü tarihtedir; sunucudan türetilen bir damga o üç saatte yedeği bir
 * gün geriye yazar ve "bugün yedek alındı mı" sorusu yanlış yanıtlanır.
 *
 * Tetikleyen yer `AnaEkran`: oturum açıldıktan sonra bir kez liste çekilir
 * ve bugünün yedeği yoksa alınır. Zamanlayıcı yok — uygulama açık değilken
 * zaten yedek alınamaz; "açılışta bir kez" bu ürün için "günde bir kez"in
 * gerçekleşebilir hâlidir.
 */
export const yedekApi = {
  /**
   * Yedek alır (`POST /api/yedek`).
   *
   * `hedefDizin` verilirse **önce ayar olarak kaydedilir**, sonra yedek
   * oraya alınır. Ayrı bir "klasörü ayarla" ucu bilerek YOK: klasörünü
   * seçip yedeği almayan bir kullanıcı "yedeğim var" sanırdı.
   */
  al: (damga: string, hedefDizin?: string) =>
    istek<{ tarih: string; boyut: number }>('/api/yedek', {
      method: 'POST',
      body: JSON.stringify({ damga, hedef_dizin: hedefDizin }),
    }),
  /**
   * Klasördeki geri yüklenebilir yedekleri listeler (`POST /api/yedekler`).
   *
   * `POST` ve klasör yolu **gövdede**: yol kullanıcının adını içerebilir
   * (`/Users/ayse/Dropbox/...`) ve URL'ler tarayıcı geçmişine ve genel
   * amaçlı erişim günlüklerine düşer (`ekYukle`'nin dosya adı kararıyla
   * aynı sınıf).
   *
   * Kilit gerektirmez: "hangi yedeklerim var" sorusu tam da kilitliyken,
   * bozuk bir veritabanının ardından sorulur.
   */
  listele: (dizin?: string) =>
    istek<YedekListesi>('/api/yedekler', {
      method: 'POST',
      body: JSON.stringify({ dizin }),
    }),
  /**
   * Bir yedek çiftini geri yükler (`POST /api/geri-yukleme`).
   *
   * Parola **o yedeğin alındığı tarihteki** paroladır: yedek kendi anahtar
   * dosyasıyla birlikte alınır ve geri yüklendiğinde o günün parolası
   * yeniden geçerli olur. Açık oturumun anahtarı kullanılmaz — yeni bir
   * bilgisayarda zaten böyle bir anahtar yoktur.
   */
  geriYukle: (girdi: {
    dizin?: string
    dosya_adi: string
    parola?: string
    kurtarma_kodu?: string
  }) =>
    istek<{ tarih: string }>('/api/geri-yukleme', {
      method: 'POST',
      body: JSON.stringify(girdi),
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
  /**
   * Parolayı değiştirir (`POST /api/parola`).
   *
   * # Mevcut parola ZORUNLU
   *
   * Yalnızca yeni parola göndermek yetmez: oturum açıkken bilgisayarın
   * başına geçen biri parolayı değiştirip terapisti kendi verisinden
   * kilitleyebilirdi. Sunucu mevcut parolayı `unlock_with_password` ile
   * doğruluyor ve yanlışsa `401` dönüyor — bu, "oturum kilitli" 401'inden
   * ayrı bir durum ama aynı mekanizmadan geçer. `App` merkezi 401
   * dinleyicisiyle kilit ekranına döner; çağıran taraf (`AnaEkran`) bu
   * yüzden hatayı `YetkisizHata` olup olmadığına bakmadan kendi
   * bandında gösterir ve kullanıcı yeniden dener.
   *
   * # Parolalar GÖVDEDE
   *
   * Sorgu dizesinde değil: URL'ler tarayıcı geçmişine ve genel amaçlı
   * erişim günlüklerine düşer (`ekYukle`'nin dosya adı ve
   * `yedekApi.listele`'nin klasör yolu kararlarıyla aynı sınıf).
   *
   * # Yanıt boş
   *
   * Ne yeni parola, ne kurtarma kodu, ne de anahtarla ilgili bir alan
   * döner. Kurtarma kodu **değişmez** (aynı veri anahtarını açmaya devam
   * eder), bu yüzden kullanıcıya yeniden gösterilecek bir şey de yoktur.
   */
  parolaDegistir: (mevcutParola: string, yeniParola: string) =>
    istek<Record<string, never>>('/api/parola', {
      method: 'POST',
      body: JSON.stringify({ mevcut_parola: mevcutParola, yeni_parola: yeniParola }),
    }),
}
