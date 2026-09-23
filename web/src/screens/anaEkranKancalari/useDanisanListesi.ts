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
  // yapılıyor -- bkz. `saklamaDolandanDus`, tek çağıran `AnaEkran.durumDegis`.
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
   * başlığı) -- tek çağıran `AnaEkran.durumDegis`, yalnızca sunucunun PATCH
   * yanıtı `son_temas`/`saklama_bitis` taşıdığında (yani GERÇEKTEN ileri
   * taşındığında) çağırır.
   */
  function saklamaDolandanDus(clientId: number) {
    dusenlerRef.current.add(clientId)
    setSaklamaDolanlar((onceki) => onceki.filter((d) => d.id !== clientId))
  }

  async function ekle() {
    if (yeniAdSoyad.trim() === '') {
      setHata('Lütfen ad soyad girin.')
      return
    }
    try {
      await takvimApi.danisanEkle(yeniAdSoyad.trim(), yeniTelefon.trim() || undefined)
      setYeniAdSoyad('')
      setYeniTelefon('')
      setFormAcik(false)
      setHata(null)
      // Burada yeniden yükleme KORUNUYOR: liste sunucuda `ad_soyad COLLATE
      // NOCASE` ile sıralanıyor ve yeni kaydı istemcide doğru yere sokmak
      // Türkçe harf sıralamasını burada ikinci kez (farklı) uygulamak
      // demekti. Danışan ekleme seyrek bir işlem; hacim tarafını sunucudaki
      // birleştirme (`clients::listele`) zaten kapatıyor.
      setDanisanlar(await takvimApi.danisanlariGetir())
    } catch (e) {
      // Sunucudan gelen mesaj OLDUĞU GİBİ gösteriliyor: doğrulama hataları
      // hangi alanın (ad mı, telefon mu) neden reddedildiğini söylüyor
      // (bkz. `store::clients` doğrulayıcıları). Burada onu genel bir
      // "Danışan eklenemedi." ile değiştirmek, kullanıcıya neyi
      // düzelteceğini söylememek olurdu — bu kod tabanında tekrar eden
      // "her hata parola hatasıdır" sınıfının ta kendisi.
      setHata(e instanceof Error ? e.message : 'Danışan eklenemedi.')
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
    saklamaDolanlar,
    saklamaDolandanDus,
    ekle,
    arsivle,
  }
}
