import { useEffect, useRef, useState } from 'react'
import { danisanApi, takvimApi, type Danisan } from '../../api'
import { yerelGun } from './yerelGun'

/**
 * Danışan listesi akışı: liste + ekleme formu + arşivleme (iki adımlı onay)
 * + saklama süresi dolan dosyalar hatırlatması.
 *
 * Form alanları da burada duruyor çünkü `ekle` onları okuyup temizliyor;
 * ayrıştırmak, tek bir işlemin sırasını (kaydet → alanları temizle →
 * listeyi tazele) iki dosyaya bölmek olurdu ve o sıranın kendisi bir karar
 * (bkz. `ekle`).
 *
 * # `ayarlarGorunur` — IMPORTANT-3 düzeltmesi
 *
 * Saklama süresi dolanlar isteği artık yalnızca ÇAĞIRAN TARAFIN (`AnaEkran`)
 * Ayarlar sekmesini GÖSTERİYOR olmasına bağlı. Veri Görev 8'den beri yalnızca
 * Ayarlar sekmesinde gösteriliyor (`AyarlarSekmesi`) ama bu kanca
 * `AnaEkran`'da KOŞULSUZ çağrılıyor (401 temizliği için gerekli, bkz.
 * `AnaEkran.tsx` modül başlığı) — panel montajına güvenilemez, çünkü panel
 * montajı bu kancanın GÖRMEDİĞİ bir şey. Sunucudaki
 * `clients::saklama_suresi_dolanlar` her çağrıda `LogHacmi::HerCagri` ile
 * SİLİNEMEZ bir `goruntuleme` satırı yazıyor: terapist Ayarlar'ı HİÇ
 * açmasa bile eski (koşulsuz mount'ta atan) davranış kalıcı, hiç
 * görülmeyecek bir kayıt bırakırdı.
 */
export function useDanisanListesi({ ayarlarGorunur }: { ayarlarGorunur: boolean }) {
  const [danisanlar, setDanisanlar] = useState<Danisan[]>([])
  const [formAcik, setFormAcik] = useState(false)
  const [yeniAdSoyad, setYeniAdSoyad] = useState('')
  const [yeniTelefon, setYeniTelefon] = useState('')
  const [hata, setHata] = useState<string | null>(null)
  // Arşivleme geri alınamaz SANILAN bir işlemdir (aslında değil — kayıtlar
  // duruyor), bu yüzden randevu silmedeki iki adımlı onay deseni burada da
  // uygulanıyor. Onay state'i ONAYLANAN DANIŞANIN KENDİSİDİR: Görev 10
  // inceleme Bulgu 1'de panelin iç state'i bir seçimden diğerine sızıyordu ve
  // çözüm state'i seçime bağlamaktı (`key` prop'u). Burada aynı ilke, bu kez
  // state'in kendisi seçimi taşıyacak biçimde: başka bir danışanın
  // "Arşivle"sine basmak onayı devretmez, tümüyle değiştirir; onay metni de
  // her zaman state'teki danışanın adını gösterir.
  const [arsivOnayi, setArsivOnayi] = useState<Danisan | null>(null)
  const [arsivBilgisi, setArsivBilgisi] = useState<string | null>(null)
  const [arsivSuruyor, setArsivSuruyor] = useState(false)
  // Ekleme uçuşta mı (inceleme M1). Danışan silinemez ve adda benzersizlik
  // yok: POST sürerken ikinci bir Enter ya da tıklama KALICI bir kopya kayıt
  // yaratırdı. Asıl kilit `ekleniyorRef`: aynı çizimden gelen iki çağrı
  // durumu henüz güncellenmemiş görür. `ekleniyor` durumu arayüz içindir
  // ("Ekle" düğmesi devre dışı, dolayısıyla Enter'la örtük gönderim de yok).
  const [ekleniyor, setEkleniyor] = useState(false)
  const ekleniyorRef = useRef(false)
  // Saklama süresi dolmuş danışanlar — tasarım §7'nin ana ekran
  // hatırlatması. Kart içindeki tekil gösterge bunun yerini tutmuyordu: bir
  // dosyanın süresinin dolduğunu görmek için o dosyayı AÇMAK gerekiyordu,
  // yani "hangi dosyaların süresi doldu" sorusunun ekranda hiçbir cevabı
  // yoktu (dal incelemesi, HTTP → arayüz yönü).
  const [saklamaDolanlar, setSaklamaDolanlar] = useState<Danisan[]>([])

  useEffect(() => {
    void takvimApi.danisanlariGetir().then(setDanisanlar).catch(() => {
      // Danışan listesi yüklenemezse panel yine açılabilir; danışan seçme
      // adımı boş listeyle gelir ve kullanıcı "danışan seçin" hatasını
      // görür — sayfanın tamamını kilitlemeye gerek yok.
    })
  }, [])

  // Saklama hatırlatması YALNIZCA Ayarlar sekmesi İLK KEZ görünür olduğunda
  // çekiliyor — ne bileşen mount'unda (IMPORTANT-3, bkz. modül başlığı), ne
  // hafta değişiminde, ne her Ayarlar'a dönüşte DEĞİL: sunucudaki
  // `clients::saklama_suresi_dolanlar` her çağrıda `LogHacmi::HerCagri` ile
  // SİLİNEMEZ bir `goruntuleme` satırı yazıyor. `cekildiRef`: `ayarlarGorunur`
  // sekmeler arasında gidip gelirken tekrar `true` olabilir, ikinci (ve
  // sonraki) her geçiş NO-OP kalmalı.
  //
  // DÜZELTME (Görev 3): "liste gün içinde değişmez" eskiden burada
  // yazıyordu -- bu YANLIŞ: "geldi" işaretlemek `son_temas`/`saklama_bitis`i
  // ileri taşıyabilir (`appointments::son_temasi_isaretle`) ve bu, GÜN
  // İÇİNDE bir danışanı bu listeden düşürebilir (süresi dolmuş bir danışan
  // terapiye döner, seansı "Geldi" işaretlenir). Yeniden ÇEKMEK yine de
  // YASAK (yukarıdaki `HerCagri` maliyeti); bunun yerine düşürme YERELDE
  // yapılıyor -- bkz. `saklamaDolandanDus` (çağıranlar orada). Plan A Görev 9:
  // taşınan "geldi" seansı da aynı yoldan düşürebilir.
  //
  // Hata YUTULUYOR: hatırlatma ikincil bir bilgi; alınamadığında ana ekranı
  // hata bandıyla kaplamak, terapistin takvimini görmesini engellerdi.
  // (Kilit hâli zaten `api.ts`'in merkezî 401 dinleyicisiyle ele alınıyor.)
  const cekildiRef = useRef(false)
  // `saklamaDolandanDus` ile YEREL olarak düşürülmüş danışan kimlikleri.
  // KALICI bir kayıt (yalnızca `setSaklamaDolanlar` değil): aşağıdaki fetch
  // bu düşürmeden ÖNCE başlayıp SONRA dönebilir (terapist Ayarlar'ı açar,
  // istek yola çıkar, sekme değiştirip bir seansı "Geldi" işaretler, sonra
  // Ayarlar'a döner) -- geç gelen yanıt TÜM listeyi yazar ve az önce yapılan
  // düşürmeyi KALICI olarak geri getirir (`yazmaSaati.ts`teki sınıfın aynısı,
  // ama tek okuma olduğu için sayısal damga yerine bir kimlik kümesi yeterli).
  const dusenlerRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (!ayarlarGorunur || cekildiRef.current) return
    cekildiRef.current = true
    void danisanApi
      .saklamaSuresiDolanlar(yerelGun(new Date()))
      .then((liste) => setSaklamaDolanlar(liste.filter((d) => !dusenlerRef.current.has(d.id))))
      .catch(() => {})
  }, [ayarlarGorunur])

  /**
   * "Geldi" işaretlemesi bir danışanın saklama süresini ileri taşıdığında
   * (Görev 3) o danışanı Ayarlar > "Saklama süresi dolan dosyalar"
   * listesinden YERELDE düşürür. Liste YENİDEN ÇEKİLMEZ (yukarıdaki modül
   * başlığı) -- iki çağıran var: `AnaEkran.durumDegis` (PATCH yanıtı) ve
   * `AnaEkran.randevuKaydet` (taşınan "geldi" seansının PUT yanıtı, Plan A
   * Görev 9); ikisi de yalnızca yanıt `son_temas`/`saklama_bitis` taşıdığında
   * (yani GERÇEKTEN ileri taşındığında) çağırır.
   *
   * # İNCELEME DÜZELTMESİ (IMPORTANT-1) — koşulsuz düşürme YANLIŞTI
   * İlk sürüm `saklamaBitis`e hiç bakmadan düşürüyordu. Kenar durum: zaten
   * süresi dolmuş, ÇOK ESKİ bir danışanın ÇOK ESKİ bir randevusu geriye
   * dönük "Geldi" işaretlenirse (`son_temasi_isaretle` yalnızca İLERİ
   * taşır, ama "ileri" ile "bugünden ileri" AYNI ŞEY DEĞİL) yeni
   * `saklama_bitis` hâlâ BUGÜNDEN ÖNCE olabilir -- danışan GERÇEKTE hâlâ
   * süresi dolmuşken hatırlatma listesinden düşüyordu ve `dusenlerRef`
   * KALICI olduğu için oturum boyunca geri gelmiyordu. Tam olarak bu
   * görevin önlemeye çalıştığı hatanın TERSİ (bayat bir "süresi doldu"
   * yerine bayat bir "süresi dolmadı"). Düzeltme: yalnızca sunucunun
   * döndürdüğü `saklamaBitis` bugünün YEREL gününden GERÇEKTEN sonraysa
   * düş -- karşılaştırma sunucudaki `saklama_suresi_dolanlar`la AYNI
   * sözlüksel kural (`YYYY-AA-GG` biçimi sıralı olduğu için `<=` güvenli,
   * bkz. o fonksiyonun dokümantasyonu). `new Date()` doğrudan
   * karşılaştırmaya SOKULMUYOR, `yerelGun` üzerinden geçiyor -- projenin
   * her yerindeki duvar saati kuralı (bkz. `yerelGun.ts`); testte
   * `vi.setSystemTime` ile enjekte edilebiliyor (diğer tüm `yerelGun`
   * çağrıları da aynı yoldan test ediliyor).
   */
  function saklamaDolandanDus(clientId: number, saklamaBitis: string) {
    if (saklamaBitis <= yerelGun(new Date())) return
    dusenlerRef.current.add(clientId)
    setSaklamaDolanlar((onceki) => onceki.filter((d) => d.id !== clientId))
  }

  /**
   * Yeni danışanı kaydeder ve POST yanıtındaki `Danisan`'ı döndürür
   * (tasarım B1: çağıran dosyayı BU kimlikle açar). Başarısızlıkta `null`.
   *
   * Listenin yeniden çekilmesi AYRI bir `try`'da: çekme başarısız olsa bile
   * ekleme sunucuda yapılmıştır ve kullanıcıya "eklenemedi" GÖSTERİLMEZ.
   * O durumda yeni kayıt listeye yerelde eklenir; doğru sıra bir sonraki
   * çekimde gelir. Yeniden çekmenin gerekçesi aynen geçerli: liste sunucuda
   * `ad_soyad COLLATE NOCASE` ile sıralanıyor ve yeni kaydı istemcide doğru
   * yere sokmak Türkçe sıralamayı burada ikinci kez (farklı) uygulamak
   * demekti. Ekleme seyrek; hacmi sunucudaki birleştirme (`clients::listele`)
   * kapatıyor.
   *
   * Uçuştayken (POST ya da ardındaki yeniden çekme sürerken) ikinci çağrı
   * istek atmaz ve `null` döner (bkz. `ekleniyorRef`). Kilit her çıkışta,
   * başarısızlıkta da, `finally` ile açılır.
   */
  async function ekle(): Promise<Danisan | null> {
    if (ekleniyorRef.current) return null
    if (yeniAdSoyad.trim() === '') {
      setHata('Lütfen ad soyad girin.')
      return null
    }
    ekleniyorRef.current = true
    setEkleniyor(true)
    try {
      let yeni: Danisan
      try {
        yeni = await takvimApi.danisanEkle(yeniAdSoyad.trim(), yeniTelefon.trim() || undefined)
      } catch (e) {
        // Sunucudan gelen mesaj OLDUĞU GİBİ gösteriliyor: doğrulama hataları
        // hangi alanın (ad mı, telefon mu) neden reddedildiğini söylüyor
        // (bkz. `store::clients` doğrulayıcıları). Genel bir "Danışan
        // eklenemedi." kullanıcıya neyi düzelteceğini söylemezdi.
        setHata(e instanceof Error ? e.message : 'Danışan eklenemedi.')
        return null
      }
      setYeniAdSoyad('')
      setYeniTelefon('')
      setFormAcik(false)
      setHata(null)
      try {
        setDanisanlar(await takvimApi.danisanlariGetir())
      } catch {
        setDanisanlar((onceki) => (onceki.some((d) => d.id === yeni.id) ? onceki : [...onceki, yeni]))
      }
      return yeni
    } finally {
      ekleniyorRef.current = false
      setEkleniyor(false)
    }
  }

  // Arşivleme SİLME DEĞİLDİR. `clients::arsivle` Plan 2 Görev 3'te yazılmış
  // ama hiçbir yerden çağrılmıyordu: danışan eklenebiliyor, arşivlenemiyordu
  // ve hem bu liste hem de randevu panelindeki açılır menü sınırsız
  // büyüyordu (`seriyi_sil` ile aynı bulgu sınıfı, bkz. dal incelemesi I4a).
  async function arsivle(danisan: Danisan) {
    setArsivSuruyor(true)
    try {
      await takvimApi.danisanArsivle(danisan.id)
      setHata(null)
      setArsivOnayi(null)
      // Sunucudan YENİDEN ÇEKİLMİYOR: sonuç yerel olarak kesin biçimde
      // bilinebilir (tek bir id listeden düşer) ve her `danisanlariGetir`
      // çağrısı sunucuda kalıcı bir `goruntuleme` satırı üretme riski taşır
      // (bkz. Plan 3 Görev 2 ve `durumDegis`/`sil` için aynı gerekçe).
      setDanisanlar((onceki) => onceki.filter((d) => d.id !== danisan.id))
      // Kullanıcı "hiçbir şey olmadı" da sanmamalı: ad listeden düşüyor VE
      // ne olduğu açıkça yazılıyor.
      setArsivBilgisi(
        `${danisan.ad_soyad} arşivlendi. Kayıtları silinmedi; yalnızca listede görünmüyor.`,
      )
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Danışan arşivlenemedi.')
    } finally {
      setArsivSuruyor(false)
    }
  }

  return {
    danisanlar,
    formAcik,
    setFormAcik,
    yeniAdSoyad,
    setYeniAdSoyad,
    yeniTelefon,
    setYeniTelefon,
    hata,
    arsivOnayi,
    setArsivOnayi,
    arsivBilgisi,
    setArsivBilgisi,
    arsivSuruyor,
    ekleniyor,
    saklamaDolanlar,
    saklamaDolandanDus,
    ekle,
    arsivle,
  }
}
