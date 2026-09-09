import { useCallback, useEffect, useRef, useState } from 'react'
import {
  aramaApi,
  danisanApi,
  notApi,
  ozelNotApi,
  takvimApi,
  YetkisizHata,
  type DanisanDosyasi,
  type DepolamaDurumu,
  type EkBilgisi,
  type OzelNot,
  type SeansNotu,
} from '../api'
import { HizliArama } from '../arama/HizliArama'
import { boyutBicimle } from '../danisan/bicim'
import { DanisanKarti } from '../danisan/DanisanKarti'
import { SeansPaneli } from '../seans/SeansPaneli'
import { HaftalikTakvim, type Randevu } from '../takvim/HaftalikTakvim'
import { haftaGunleri, haftaninBasi, yerelZaman } from '../takvim/hafta'
import { RandevuPaneli } from '../takvim/RandevuPaneli'
import { useDanisanListesi } from './anaEkranKancalari/useDanisanListesi'
import { useParolaFormu } from './anaEkranKancalari/useParolaFormu'
import { useYedekleme } from './anaEkranKancalari/useYedekleme'
import { yerelGun } from './anaEkranKancalari/yerelGun'

/**
 * Seans panelinde gösterilecek geçmiş not sayısı — ve sunucudan istenen
 * `limit`in ta kendisi.
 *
 * # Eskiden bir FAZLASI isteniyordu; o telafi ÖLÜYDÜ (dal incelemesi M1)
 *
 * Gerekçe şuydu: "aynı dakikaya denk gelen ikinci bir randevunun notu
 * `once` kesmesine takılır, bir fazlası onu telafi eder". **Telafi
 * çalışmıyordu.** Kesme sunucuda uygulanıyor (`a.baslangic < ?`), yani o
 * randevunun notu SQL seviyesinde düşüyor; "bir fazlasını iste" bir
 * fazladan **daha eski** not getirir, düşen notu geri getiremez. Yanında
 * duran `filter(n => n.appointment_id !== seansId)` süzgeci de hiçbir
 * zaman bir şey elemiyordu: kesme kesin küçük olduğu için seansın kendi
 * notu zaten dönmüyor.
 *
 * Davranış her iki hâlde de aynı (fazladan not `slice` ile atılıyordu);
 * kaldırılan şey ölü bir savunma ve **olmayan bir mekanizmayı** tarif eden
 * bir gerekçeydi. `kalanGun`'un `Date.UTC` yorumuyla aynı sınıf (Görev 10).
 *
 * Sunucunun varsayılanı (50) burada kullanılmıyor: "son üç seans" gösteren
 * bir panelin 50 seans notunun tam içeriğini indirmesi için sebep yok.
 */
const GECMIS_SEANS_SAYISI = 3

/**
 * Açık seansın not verisi. `id`, verinin HANGİ randevuya ait olduğunu
 * söyler; `null` alanlar "henüz yüklenmedi" demektir (editör içerik gelmeden
 * mount EDİLMEZ — boş mount, sunucudaki notu ekranda boş göstermek olurdu).
 */
type SeansVerisi = {
  id: number | null
  not: SeansNotu | null
  /**
   * Özel not. Panel açılışında YÜKLENMEZ (bkz. `ozelNotIstenen`), bu
   * yüzden `null` burada "istenmedi ya da yükleniyor" demektir.
   */
  ozelNot: OzelNot | null
  /**
   * Özel notun kendi hatası. Panelin genel `hata`sından AYRI: özel not
   * gelmediği için tüm paneli kapatmak, kullanıcının o an yazdığı resmî
   * notu ekrandan silmek olurdu.
   */
  ozelHata: string | null
  gecmisNotlar: SeansNotu[]
  hata: string | null
}

const BOS_SEANS: SeansVerisi = {
  id: null,
  not: null,
  ozelNot: null,
  ozelHata: null,
  gecmisNotlar: [],
  hata: null,
}

/**
 * Veri raporuna alınacak en fazla resmî not sayısı.
 *
 * Sunucu `?limit=`i `1..=200` aralığına kırpıyor; buradaki değer o üst
 * sınırdır çünkü rapor KVKK md. 11 kapsamında "elimdeki her şey" demektir —
 * "son 50 not" diyen bir rapor, eksik olduğunu söylemeden eksik olurdu.
 * (Daha fazlası olan bir dosyada rapor yine kırpılır; bu Plan 4'ün sunucu
 * tarafında çözeceği bilinen bir sınırdır, bkz. görev raporu.)
 */
const RAPOR_NOT_SINIRI = 200

/**
 * Danışan kartındaki bakiye için randevu penceresi.
 *
 * Bakiye "gelinmiş ama ödenmemiş seansların toplamı"dır ve bu, GÖRÜNEN
 * HAFTAYLA sınırlı hesaplanamaz: o sayı neredeyse her zaman yanlış olurdu ve
 * para söz konusuyken yanlış bir sayı, hiç sayı olmamasından kötüdür. Uç
 * nokta yalnızca tarih aralığıyla süzüyor (danışan süzgeci yok), bu yüzden
 * geniş bir pencere çekilip istemcide `client_id`'ye göre süzülüyor.
 *
 * Denetim kaydı açısından ek yük yok: `appointments::aralik_getir` tek bir
 * `goruntuleme` satırı yazar ve o satır 5 dakikalık pencerede haftalık
 * yüklemeyle **birleşir** (`LogHacmi::OturumBasi`).
 */
const TUM_ZAMAN_BASI = '2000-01-01T00:00'
const TUM_ZAMAN_SONU = '2100-01-01T00:00'

/** Açık danışan kartının verisi. `id`, verinin HANGİ danışana ait olduğunu
 * söyler (aynı gerekçe `SeansVerisi`'nde). */
type KartVerisi = {
  id: number | null
  dosya: DanisanDosyasi | null
  ekler: EkBilgisi[]
  randevular: Randevu[]
  hata: string | null
}

const BOS_KART: KartVerisi = { id: null, dosya: null, ekler: [], randevular: [], hata: null }

export function AnaEkran({
  kilitle,
  onGeriYukle,
}: {
  kilitle: () => void
  /**
   * Geri yükleme ekranını açar (tasarım §7: "uygulama içinden geri yükle
   * ekranı"). Ekranın üç felaket yolu (bozuk veritabanı, okunamayan anahtar
   * dosyası, yeni bilgisayar) `App` tarafından yönetiliyor; bu, her şey
   * çalışırken kullanılan dördüncü yol.
   */
  onGeriYukle: () => void
}) {
  const [haftaBasi, setHaftaBasi] = useState(() => haftaninBasi(new Date()))
  const [randevular, setRandevular] = useState<Randevu[]>([])
  const [hata, setHata] = useState<string | null>(null)
  const [seciliRandevu, setSeciliRandevu] = useState<Randevu | null>(null)
  const [seciliBosSaat, setSeciliBosSaat] = useState<string | null>(null)
  // Danışan listesi, ekleme formu, arşivleme ve saklama hatırlatması kendi
  // kancasında: bu ekranın en bağımsız akışı, hiçbir 401 temizliği ona
  // dokunmuyor.
  const liste = useDanisanListesi()
  // Yedekleme (otomatik günlük yedek + elle yedek + KALICI uyarı) ve parola
  // değiştirme de kendi kancalarında; ikisi de bu ekranın başka hiçbir
  // state'ini okumuyor.
  const yedekleme = useYedekleme()
  const parola = useParolaFormu()
  // Seans paneli verisi, HANGİ SEANSA ait olduğuyla birlikte. `id` alanı
  // tek başına bir kolaylık değil: seçim değiştiği anda önceki danışanın
  // notu ekranda kalmamalı ve bunun için bir efektin çalışmasını beklemek
  // (bir kare boyunca yanlış içerik göstermek) kabul edilebilir değil.
  // Aşağıda `seansId` ile karşılaştırılarak RENDER SIRASINDA türetiliyor.
  const [seansVerisi, setSeansVerisi] = useState<SeansVerisi>(BOS_SEANS)
  const [seansTazeleme, setSeansTazeleme] = useState(0)
  // Özel notu HANGİ seans için istedik. Panel açılışında özel not
  // yüklenmiyor: sunucudaki `ozel_not_getir` her çağrıda SİLİNEMEZ bir
  // `goruntuleme | private_note | <id>` satırı yazar ve kullanıcı özel
  // sekmeye hiç girmemişken o satırı bastırmak, olmayan bir eylemi kalıcı
  // olarak bildirmek olur (bkz. `SeansPaneli` modül başlığı).
  //
  // Değer bir bayrak değil SEANS KİMLİĞİ: başka bir seansa geçildiğinde
  // eski kimlik yeni seansla eşleşmez, dolayısıyla "önceki seansta özel
  // sekmeye girmiştim" hâli yeni seansa sızıp orada istenmemiş bir
  // görüntüleme satırı yazdırmaz.
  const [ozelNotIstenen, setOzelNotIstenen] = useState<number | null>(null)
  const [ozelTazeleme, setOzelTazeleme] = useState(0)
  // Açık danışan kartı. Seans panelindeki desenle aynı: state HANGİ danışana
  // ait olduğunu taşır ve ekrana giden veri render sırasında türetilir.
  const [seciliDanisanId, setSeciliDanisanId] = useState<number | null>(null)
  const [kartVerisi, setKartVerisi] = useState<KartVerisi>(BOS_KART)
  const [kartTazeleme, setKartTazeleme] = useState(0)
  // Depolama durumu. `null` = henüz gelmedi ya da alınamadı; ikisi de aynı
  // şeyi gerektirir (hiçbir şey gösterme). Bu uç nokta sunucuda LOG YAZMAZ,
  // bu yüzden ek yükleme/silme sonrasında tazelenebiliyor.
  const [depolama, setDepolama] = useState<DepolamaDurumu | null>(null)
  // Aramadan gelen "şu seansa git" isteği. Hedef randevu başka bir haftada
  // olabilir; hafta değiştirilir, randevu listesi yeniden yüklenir ve seçim
  // ANCAK O LİSTEDEN yapılır — ekranda görünmeyen bir randevuya bağlı bir
  // not editörü açmak, kaydı belirsiz bir kimliğe göndermek olurdu.
  // `ref`: `yukle`'nin bağımlılıklarını (dolayısıyla kimliğini) değiştirmesin.
  //
  // Kimlikle birlikte HEDEF HAFTA da tutuluyor. Önceden yalnızca kimlik
  // vardı ve `yukle` onu KOŞULSUZ tüketiyordu: "seansa git" sırasında
  // uçuşta bir yükleme varsa (ilk mount, hafta oku, kayıt sonrası tazeleme)
  // o ESKİ yükleme bekleyen kimliği tüketir, kendi haftasının listesinde
  // hedefi bulamaz ve `null` seçerdi; ardından gelen doğru haftanın
  // yüklemesi için tüketilecek bir şey kalmaz, gezinme SESSİZCE düşerdi.
  // Kullanıcı arama sonucuna tıklar, hafta değişir, panel açılmaz.
  //
  // Hafta damgası bunu kapatıyor: bekleyen istek yalnızca HEDEF HAFTANIN
  // yüklemesinde tüketilir. Damgayı `haftaBasi.getTime()` taşıyor —
  // `haftaninBasi` saati sıfırladığı için hafta başına tek bir değer.
  const bekleyenSeans = useRef<{ id: number; hafta: number } | null>(null)

  const yukle = useCallback(async () => {
    const gunler = haftaGunleri(haftaBasi)
    const baslangic = yerelZaman(gunler[0])
    const sonGun = gunler[6]
    const bitis = yerelZaman(new Date(
      sonGun.getFullYear(), sonGun.getMonth(), sonGun.getDate(), 23, 59,
    ))
    try {
      const gelen = await takvimApi.randevulariGetir(baslangic, bitis)
      setRandevular(gelen)
      // Seçili randevu TAZE nesneyle değiştirilir. Panelin `key`'i
      // `randevu-${id}` olduğu için kimlik aynı kaldığında bileşen yeniden
      // mount EDİLMEZ; `seciliRandevu` burada tazelenmezse panel, yeniden
      // yüklemeden önceki nesneyi tutmaya devam eder. Plan 2'de görünür bir
      // etkisi yoktu (panel `durum` basmıyor); Plan 3'te seans notu editörü
      // bu nesneye bağlanacak ve yazdığı `appointment_id` ile `client_id`
      // buradan gelecek — bayat bir nesneden gelen kimlik, notu yanlış (ya
      // da artık var olmayan) bir randevuya yazmak demektir.
      //
      // Listede yoksa seçim KAPATILIR: randevu silinmiş olabilir (ör. seri
      // iptali bu randevuyu da kapsadı) ya da başka bir haftaya bakılıyordur.
      // Her iki durumda da ekranda görünmeyen bir randevuya bağlı bir not
      // editörü açık tutmak, kaydı belirsiz bir kimliğe göndermek olurdu.
      //
      // Aramadan bir seans istendiyse hedef O'dur: `bekleyenSeans`
      // tüketilir ve seçim yeni listeden kurulur.
      //
      // AMA yalnızca HEDEF HAFTANIN yüklemesi tüketebilir. Bu closure
      // uçuşta kalmış eski bir haftaya ait olabilir; koşulsuz tüketmek
      // gezinmeyi sessizce düşürürdü (bkz. `bekleyenSeans`).
      const bekleyen =
        bekleyenSeans.current !== null && bekleyenSeans.current.hafta === haftaBasi.getTime()
          ? bekleyenSeans.current.id
          : null
      if (bekleyen !== null) bekleyenSeans.current = null
      setSeciliRandevu((secili) => {
        const hedefId = bekleyen ?? secili?.id ?? null
        if (hedefId === null) return null
        return gelen.find((r) => r.id === hedefId) ?? null
      })
      setHata(null)
    } catch (e) {
      if (e instanceof YetkisizHata) {
        // Oturum kilitlendi. Kilit ekranına geçiş App.tsx'teki merkezi 401
        // dinleyicisi tarafından (durum yeniden çekilerek) tetiklenecek —
        // ama bu, sunucuya bir gidiş-dönüş sürer. O kısa süre boyunca bile
        // ekranda danışan adları kalmasın diye randevu listesi burada
        // hemen temizleniyor.
        setRandevular([])
        // Panel de kapatılıyor: açık panel seçili danışanın adını (açılır
        // menüde) ve saatini taşıyor, yani listeyi temizlemek tek başına
        // ekranı boşaltmıyordu. Panelde açık bir not editörünün yazılmamış
        // metni bu yüzden kaybolmaz — o metin `seans/taslak.ts`'te, bileşen
        // ağacının dışında duruyor ve kilit açılıp seans yeniden açıldığında
        // geri yükleniyor (bkz. `NotEditoru`'nun 401 kararı).
        setSeciliRandevu(null)
        setSeciliBosSaat(null)
        // Danışan kartı da kapatılıyor: kart danışanın adını, telefonunu,
        // başvuru nedenini ve risk notunu taşıyor — randevu listesini
        // temizlemek tek başına ekranı boşaltmıyordu.
        setSeciliDanisanId(null)
        setKartVerisi(BOS_KART)
      }
      setHata(e instanceof Error ? e.message : 'Randevular yüklenemedi.')
    }
  }, [haftaBasi])

  useEffect(() => { void yukle() }, [yukle])

  // Depolama durumu: ilk yüklemede ve kart her tazelendiğinde (ek yükleme /
  // ek silme) yeniden çekilir. Bu uç nokta denetim kaydına HİÇBİR ŞEY
  // yazmıyor (`depolama_durumu` bir sayı sorgusudur), yani hacim kaygısı
  // yok — `useDanisanListesi`'ndeki saklama listesinden farkı tam olarak
  // budur.
  useEffect(() => {
    void danisanApi.depolamaDurumu().then(setDepolama).catch(() => {})
  }, [kartTazeleme])

  // Seans notu verisi RANDEVU KİMLİĞİNE bağlı yükleniyor, `seciliRandevu`
  // NESNESİNE değil. `yukle()` her çağrıldığında seçili randevu taze bir
  // nesneyle değiştiriliyor; efekt nesneye bağlı olsaydı her yeniden
  // yüklemede (hafta değişimi, kayıt, seri silme) üç not isteği daha giderdi
  // ve her biri sunucuda SİLİNEMEZ bir `goruntuleme` satırı bırakırdı
  // (bkz. `store::audit` ve aşağıdaki `durumDegis` gerekçesi).
  const seansId = seciliRandevu?.id ?? null
  const seansDanisanId = seciliRandevu?.client_id ?? null
  // Geçmiş listesinin kesmesi: "bu seans BAŞLAMADAN önce". Efektin
  // bağımlılığı olduğu için kimlikler gibi ilkel bir değer olarak
  // türetiliyor (nesneye bağlanmak her yeniden yüklemede üç istek daha
  // demekti — bkz. yukarıdaki gerekçe).
  const seansBaslangici = seciliRandevu?.baslangic ?? null

  // Ekrana giden veri RENDER SIRASINDA türetiliyor: state başka bir seansa
  // aitse boş sayılır. Sıfırlamayı efekte bırakmak, seçim değişimiyle
  // efektin çalışması arasındaki karede ÖNCEKİ danışanın notunu yeni
  // seansın panelinde göstermek olurdu.
  const seans = seansVerisi.id === seansId ? seansVerisi : BOS_SEANS

  // Yerel değişkene alınıyor: onay metni ile "Evet, arşivle" düğmesinin AYNI
  // danışanı görmesini bu satır garanti eder (kancadaki alan üzerinden daralan
  // tür bir callback'in içine taşınmaz).
  const { arsivOnayi } = liste

  useEffect(() => {
    if (seansId === null || seansDanisanId === null || seansBaslangici === null) return
    let iptal = false

    void (async () => {
      try {
        // İkisi birlikte: geçmiş notların isteği ayrı yakalanıp yutulsaydı,
        // başarısızlık "bu danışanın önceki notu yok" diye görünürdü —
        // notu olan bir danışan için sessiz bir yalan.
        //
        // Özel not burada YOK: o, sekmeye geçilince ayrı bir efektte
        // yükleniyor (bkz. `ozelNotIstenen`).
        const [gelenNot, gelenGecmis] = await Promise.all([
          notApi.notGetir(seansId),
          // `once` ZORUNLU: bu panelin başlığı "Önceki seans notları" ve
          // kesme olmadan liste, açık seanstan SONRAKİ seansların notlarını
          // da içeriyordu. Terapist takvimde hafta hafta geriye gidip eski
          // bir seansı açtığında (olağan bir işlem) sol sütun henüz
          // yaşanmamış seansların içeriğini "geçen seansta konuşulan" diye
          // gösteriyordu.
          notApi.danisanNotlari(seansDanisanId, GECMIS_SEANS_SAYISI, seansBaslangici),
        ])
        if (iptal) return
        setSeansVerisi({
          id: seansId,
          not: gelenNot,
          ozelNot: null,
          ozelHata: null,
          // Bu seansın KENDİ notu geçmiş listesine girmez: üstte düzenlenen
          // metnin bayat bir kopyası, "geçen seansta ne konuşulmuştu"
          // sorusuna cevap değil. Bunu sağlayan tek şey sunucudaki `once`
          // kesmesidir ve o KESİN küçüktür. İstemcide ikinci bir süzgeç
          // YOK: vardı, hiçbir zaman bir şey elemiyordu ve gerekçesi
          // olmayan bir mekanizmayı tarif ediyordu (bkz.
          // `GECMIS_SEANS_SAYISI`).
          gecmisNotlar: gelenGecmis,
          hata: null,
        })
      } catch (e) {
        if (iptal) return
        if (e instanceof YetkisizHata) {
          // Kilit: ekranda danışan adı kalmasın (aynı gerekçe `yukle`'de).
          // Yazılmamış not metni kaybolmaz — o, bileşen ağacının dışındaki
          // taslak deposunda.
          setRandevular([])
          setSeciliRandevu(null)
          setSeciliBosSaat(null)
        }
        setSeansVerisi({
          ...BOS_SEANS,
          id: seansId,
          hata: e instanceof Error ? e.message : 'Seans notu yüklenemedi.',
        })
      }
    })()

    return () => {
      iptal = true
    }
  }, [seansId, seansDanisanId, seansBaslangici, seansTazeleme])

  // Özel not: YALNIZCA sekmeye geçilince. Efektin bağımlılığı
  // `ozelNotIstenen` olduğu için sekme değişimi dışında hiçbir şey
  // (hafta değişimi, "Geldi", kayıt) bu isteği tetikleyemez.
  useEffect(() => {
    if (seansId === null || ozelNotIstenen !== seansId) return
    let iptal = false

    void (async () => {
      try {
        const gelen = await ozelNotApi.getir(seansId)
        if (iptal) return
        // Geciken bir yanıt başka bir seansın panelini doldurmasın.
        setSeansVerisi((onceki) =>
          onceki.id === seansId ? { ...onceki, ozelNot: gelen, ozelHata: null } : onceki,
        )
      } catch (e) {
        if (iptal) return
        if (e instanceof YetkisizHata) {
          // Kilit: ekranda danışan adı kalmasın (aynı gerekçe `yukle`'de).
          setRandevular([])
          setSeciliRandevu(null)
          setSeciliBosSaat(null)
          return
        }
        setSeansVerisi((onceki) =>
          onceki.id === seansId
            ? {
                ...onceki,
                ozelHata: e instanceof Error ? e.message : 'Özel not yüklenemedi.',
              }
            : onceki,
        )
      }
    })()

    return () => {
      iptal = true
    }
  }, [seansId, ozelNotIstenen, ozelTazeleme])

  // Kayıt, editörün BAĞLI OLDUĞU randevunun kimliğine gider; `seciliRandevu`
  // okunmuyor. Unmount tahliyesi (seans değişiminde) bu fonksiyonu çağırdığı
  // an seçim çoktan başka bir randevuya geçmiş olabilir — o durumda giden
  // seansın metni YENİ randevunun notuna yazılırdı: yanlış danışanın
  // dosyasına not.
  const notKaydet = useCallback(
    async (kayit: { sablon: string; icerik: string }) => {
      if (seansId === null) return
      const yeni = await notApi.notKaydet(seansId, kayit.sablon, kayit.icerik)
      // Geciken bir yanıt, o sırada açılmış BAŞKA bir seansın notunu
      // ezmemeli: state hâlâ bu seansa aitse tazelenir, değilse dokunulmaz.
      setSeansVerisi((onceki) => (onceki.id === seansId ? { ...onceki, not: yeni } : onceki))
    },
    [seansId],
  )

  // Danışan kartı verisi. Seans verisiyle aynı desen: `id` ile eşleşmeyen
  // state boş sayılır (render sırasında), böylece bir danışandan diğerine
  // geçerken ÖNCEKİNİN dosyası bir kare bile görünmez.
  const kart = kartVerisi.id === seciliDanisanId ? kartVerisi : BOS_KART

  useEffect(() => {
    if (seciliDanisanId === null) return
    let iptal = false

    void (async () => {
      try {
        // Üçü birlikte: ek listesi ayrı yakalanıp yutulsaydı, başarısızlık
        // "bu danışanın dosyası yok" diye görünürdü — dosyası olan bir
        // danışan için sessiz bir yalan (`seansVerisi` ile aynı gerekçe).
        const [dosya, ekler, tumRandevular] = await Promise.all([
          danisanApi.dosyaGetir(seciliDanisanId),
          danisanApi.ekleriGetir(seciliDanisanId),
          takvimApi.randevulariGetir(TUM_ZAMAN_BASI, TUM_ZAMAN_SONU),
        ])
        if (iptal) return
        setKartVerisi({
          id: seciliDanisanId,
          dosya,
          ekler,
          randevular: tumRandevular.filter((r) => r.client_id === seciliDanisanId),
          hata: null,
        })
      } catch (e) {
        if (iptal) return
        if (e instanceof YetkisizHata) {
          setRandevular([])
          setSeciliRandevu(null)
          setSeciliBosSaat(null)
          setSeciliDanisanId(null)
          setKartVerisi(BOS_KART)
          return
        }
        setKartVerisi({
          ...BOS_KART,
          id: seciliDanisanId,
          hata: e instanceof Error ? e.message : 'Danışan dosyası yüklenemedi.',
        })
      }
    })()

    return () => {
      iptal = true
    }
  }, [seciliDanisanId, kartTazeleme])

  const ozelNotKaydet = useCallback(
    async (icerik: string) => {
      if (seansId === null) return
      const yeni = await ozelNotApi.kaydet(seansId, icerik)
      setSeansVerisi((onceki) => (onceki.id === seansId ? { ...onceki, ozelNot: yeni } : onceki))
    },
    [seansId],
  )

  function haftaDegis(yon: number) {
    setHaftaBasi((onceki) => {
      const yeni = new Date(onceki)
      yeni.setDate(yeni.getDate() + yon * 7)
      return yeni
    })
  }

  function randevuSec(randevu: Randevu) {
    setSeciliBosSaat(null)
    setSeciliRandevu(randevu)
  }

  function bosSaatSec(zaman: string) {
    setSeciliRandevu(null)
    setSeciliBosSaat(zaman)
  }

  function panelKapat() {
    setSeciliRandevu(null)
    setSeciliBosSaat(null)
  }

  function danisanKartiAc(clientId: number) {
    liste.setArsivBilgisi(null)
    setSeciliDanisanId(clientId)
  }

  function danisanKartiKapat() {
    setSeciliDanisanId(null)
    // Veri de siliniyor, yalnızca panel gizlenmiyor: kart risk notu ve rıza
    // bilgisi taşıyor ve kapalı bir bileşenin state'inde duran veri, bir
    // sonraki açılışta yanlış danışanın kartında görünebilirdi.
    setKartVerisi(BOS_KART)
  }

  /**
   * Aramadan seçilen seansa gider.
   *
   * Randevu başka bir haftada olabilir; hafta değiştirilir ve seçim
   * `yukle` içinde, SUNUCUDAN GELEN listeden yapılır (bkz.
   * `bekleyenSeans`). `haftaninBasi` her çağrıda yeni bir `Date`
   * döndürdüğü için hedef hafta zaten görünen haftaysa bile efekt yeniden
   * çalışır ve bekleyen seçim tüketilir.
   *
   * Bekleyen istek HEDEF HAFTAYLA damgalanıyor: o sırada uçuşta olan
   * (başka bir haftaya ait) bir yükleme onu tüketip gezinmeyi sessizce
   * düşüremesin.
   */
  function seansaGit(appointmentId: number, tarih: string) {
    const [yil, ay, gun] = tarih.slice(0, 10).split('-').map(Number)
    const hedefHafta = haftaninBasi(new Date(yil, (ay ?? 1) - 1, gun ?? 1))
    bekleyenSeans.current = { id: appointmentId, hafta: hedefHafta.getTime() }
    setSeciliBosSaat(null)
    danisanKartiKapat()
    setHaftaBasi(hedefHafta)
  }

  // Rıza kaydı ve ek yükleme başarılı olunca kart YENİDEN ÇEKİLİYOR.
  // `durumDegis`/`sil`'deki "sonucu yerel olarak uygula" kararı burada
  // GEÇERSİZ: `PATCH` sunucudan dönen dosyayı verse bile, ek yükleme
  // `saklama_bitis` gibi türetilmiş alanları etkilemez ve iki kaynağın
  // (ekler + dosya) tutarlılığı yalnızca birlikte çekilerek korunur.
  // Denetim kaydı hacmi burada sorun değil: ikisi de seyrek, kullanıcı
  // tarafından başlatılan işlemler.
  async function rizaKaydet(alan: { riza_tarihi: string; riza_dosya_id: number | null }) {
    if (seciliDanisanId === null) return
    await danisanApi.rizaKaydet(seciliDanisanId, alan)
    setKartTazeleme((n) => n + 1)
  }

  async function ekYukle(dosya: File, tur: string) {
    if (seciliDanisanId === null) return
    await danisanApi.ekYukle(seciliDanisanId, dosya, tur)
    setKartTazeleme((n) => n + 1)
  }

  // Silme sonrası kart YENİDEN ÇEKİLİYOR, sonuç yerel olarak uygulanmıyor.
  // `durumDegis`/`sil`'deki "sonucu yerel olarak uygula" kararı burada
  // GEÇERSİZ, `ekYukle` ile aynı gerekçe ve bir fazlasıyla: sunucudaki
  // `attachments::sil` aynı transaction'da `clients.riza_dosya_id`'yi de
  // temizliyor. Ek listesini yerel olarak süzmek dosyayı listeden düşürür
  // ama rıza bölümü hâlâ silinmiş dosyaya bağlı görünürdü — ekranda sessiz
  // bir yalan. İki kaynağın (dosya + ekler) tutarlılığı yalnızca birlikte
  // çekilerek korunur.
  async function ekSil(ekId: number) {
    await danisanApi.ekSil(ekId)
    setKartTazeleme((n) => n + 1)
  }

  // Rapor için not çekmenin TEK yolu `notApi` — yani yalnızca resmî notlar.
  // `ozelNotApi` bu bileşende de ayrı bir nesnedir ve karta hiç geçmez.
  //
  // BURASI KAVŞAK. `veriRaporu.ts` ve `DanisanKarti.tsx` `ozelNotApi`'yi
  // içe aktarmıyor ve aktarmalarına gerek de yok; raporun NOT KAYNAĞINI
  // seçen tek yer bu fonksiyondur. Dolayısıyla "özel not rapora giremez"
  // güvencesi burada ölçülüyor, orada değil (`veriRaporu.test.ts`'teki
  // kaynak taraması riskin olmadığı dosyalara bakıyordu):
  //   - davranışsal: `AnaEkran.test.tsx` "uretilen rapor METNI ozel not
  //     kanaryasini TASIMAZ, resmi notu TASIR" — üretilen Blob'un metnini
  //     okur;
  //   - yapısal: aynı dosyadaki "rapor not kaynağı: `raporNotlariGetir`
  //     gövdesi" bloğu bu fonksiyonun GÖVDESİNİ tarar (dosyanın tamamı
  //     taranamaz — `ozelNotApi` seans panelinde meşru olarak kullanılıyor).
  async function raporNotlariGetir(): Promise<SeansNotu[]> {
    if (seciliDanisanId === null) return []
    return notApi.danisanNotlari(seciliDanisanId, RAPOR_NOT_SINIRI)
  }

  // Dışa aktarımın DENETİM KAYDI — kart bunu notları çekmeden ÖNCE çağırır
  // (bkz. `DanisanKarti` modül başlığı "Dışa aktarım önce KAYDEDİLİR").
  //
  // Bu fonksiyon BİLEREK `raporNotlariGetir`'in dışında duruyor: o gövde
  // raporun NOT KAYNAĞINI seçen kavşaktır ve `AnaEkran.test.tsx` onu
  // satır satır tarıyor ("gövdede özel nota giden hiçbir yol YOKTUR").
  // İkinci bir sorumluluğu oraya taşımak o taramanın ölçtüğü şeyi
  // bulanıklaştırırdı.
  //
  // Danışan seçili değilse fırlatır, sessizce başarılı olmaz: kartın
  // fail-closed sırası ancak "kayıt gerçekten yazıldı" güvencesi varsa
  // anlamlıdır — burada `return` etmek, kayıtsız bir raporu üretilebilir
  // kılardı. (Kart yalnızca `seciliDanisanId !== null` iken render
  // edildiği için bu dal bugün ulaşılamaz; ikincil hat.)
  async function raporKaydiOlustur(): Promise<void> {
    if (seciliDanisanId === null) throw new Error('Danışan seçili değil; rapor kaydı yazılamadı.')
    await danisanApi.raporKaydiOlustur(seciliDanisanId)
  }

  async function kaydet(kayit: {
    client_id: number
    baslangic: string
    bitis: string
    ucret: number | null
    tekrar_sayisi?: number
  }) {
    try {
      // İki kip: panel mevcut bir randevuyla açıldıysa DÜZENLEME (PUT),
      // yalnızca boş bir saatle açıldıysa YENİ KAYIT (POST). Bu ayrım
      // yokken düzenleme kipinde de POST atılıyordu ve sunucu randevunun
      // KOPYASINI yaratıyordu — orijinal kayıt değişmemiş hâlde kalıyor,
      // aynı saatte ikinci bir blok beliriyordu (bkz. dal incelemesi C1).
      if (seciliRandevu) {
        // `tekrar_sayisi` bilerek geçirilmiyor: düzenleme kipinde panel o
        // alanı zaten göstermiyor ve mevcut bir randevuyu "8 hafta
        // tekrarla" ile kaydetmek anlamsız olurdu.
        await takvimApi.randevuGuncelle(seciliRandevu.id, {
          client_id: kayit.client_id,
          baslangic: kayit.baslangic,
          bitis: kayit.bitis,
          ucret: kayit.ucret,
        })
      } else {
        await takvimApi.randevuOlustur(kayit)
      }
      setHata(null)
      panelKapat()
      await yukle()
    } catch (e) {
      // Üstteki bant dar bir sayfada gözden kaçabilir (bkz. Görev 10 inceleme
      // bulgusu) — burada set edilip yeniden fırlatılıyor ki panel de kendi
      // içinde aynı hatayı gösterebilsin (RandevuPaneli'nin onKaydet'i
      // bekleyen islemCalistir'i bu reddi yakalayıp yerel hata state'ine
      // yazıyor). Merkezi 401 dinleyicisi zaten api.ts içindeki `istek`
      // fonksiyonunda, bu reddin fırlatılmasından önce tetiklenmiş oluyor —
      // burada yeniden fırlatmak o mekanizmayı etkilemez.
      setHata(e instanceof Error ? e.message : 'Randevu kaydedilemedi.')
      throw e
    }
  }

  // Durum değişikliği ve silme, sunucudan YENİDEN YÜKLEMEDEN yerel listeye
  // uygulanır. Gerekçe hız değil, denetim kaydı hacmi (bkz. Plan 3 Görev 2
  // ve `store::audit` modül başlığı): `yukle()` her çağrıldığında sunucuda
  // bir `goruntuleme` satırı üretiyordu ve `audit_log` satırları SİLİNEMEZ.
  // "Geldi" işaretlemek tek bir kullanıcı eylemi olduğu hâlde iki satır
  // bırakıyordu. Sunucu tarafında da birleştirme var (aynı görev) — bu iki
  // önlem birbirinin yedeği: burada gereksiz isteği hiç atmıyoruz, orada
  // atılırsa bile satır birikmiyor.
  //
  // Bu iki işlemin sonucu yerel olarak KESİN BİÇİMDE bilinebilir: durum
  // sunucuda doğrulanmış sabit bir değer, silinen kayıt da tek bir id.
  // `kaydet` ve `seriSil` için AYNI ŞEY YAPILMADI — orada sonuç birden çok
  // satırı (ve görünen haftanın dışını) etkileyebilir, dolayısıyla yeniden
  // yükleme doğru olanı.
  async function durumDegis(id: number, durum: string) {
    try {
      await takvimApi.randevuDurumu(id, durum)
      setHata(null)
      setRandevular((onceki) => onceki.map((r) => (r.id === id ? { ...r, durum } : r)))
      // Panel açık kalır ve elindeki `randevu` nesnesi bu state'tir; o kopya
      // güncellenmezse `seciliRandevu.durum` sunucudaki gerçekten sessizce
      // ayrışır. Bugün görünür bir etkisi YOK — `RandevuPaneli` `durum`
      // alanını hiçbir yerde render etmiyor ve `key` değişmediği için remount
      // da olmuyor (bu satırın eski gerekçesi "kullanıcı işaretlediği durumu
      // panelde göremez" idi; yanlıştı, silindi). Satır yine de duruyor çünkü
      // paneldeki kopyanın listedeki satırdan ayrışması, panel ileride
      // `durum`'u okuduğu anda bayat veri gösterirdi.
      setSeciliRandevu((secili) => (secili && secili.id === id ? { ...secili, durum } : secili))
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Randevu güncellenemedi.')
      throw e
    }
  }

  async function sil(id: number) {
    try {
      await takvimApi.randevuSil(id)
      setHata(null)
      panelKapat()
      setRandevular((onceki) => onceki.filter((r) => r.id !== id))
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Randevu silinemedi.')
      throw e
    }
  }

  // Seriyi bu randevudan İTİBAREN iptal eder; geçmiş randevular sunucuda
  // korunuyor (bkz. `seriyi_sil`). `seriyi_sil` Görev 6'da yazılmış ve test
  // edilmişti ama hiçbir çağrı yeri yoktu — 52 haftalık bir seri iki tıkla
  // kuruluyor, iptal edilemiyordu (bkz. dal incelemesi I4a).
  async function seriSil(seriId: string, buTarihtenItibaren: string) {
    try {
      await takvimApi.seriSil(seriId, buTarihtenItibaren)
      setHata(null)
      panelKapat()
      await yukle()
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Seri silinemedi.')
      throw e
    }
  }

  const panelAcik = seciliRandevu !== null || seciliBosSaat !== null

  return (
    <div className="p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Terapi Notları</h1>
        <div className="flex items-center gap-2">
          {/* Hızlı arama her zaman monte: Ctrl+K dinleyicisi bileşenin
              kendi içinde. Kapalıyken yalnızca kısayolu duyuran bir düğme
              basar; hiçbir istek atmaz. */}
          <HizliArama
            ara={aramaApi.ara}
            onDanisanSec={danisanKartiAc}
            onSeansSec={seansaGit}
          />
          <button className="rounded-lg border px-4 py-2" onClick={kilitle}>
            Kilitle
          </button>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Danışanlar</span>
          <button
            className="rounded border px-3 py-1 text-sm"
            onClick={() => liste.setFormAcik((acik) => !acik)}
          >
            Danışan ekle
          </button>
        </div>

        {liste.formAcik && (
          <div className="mt-2 flex items-end gap-2">
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-ad-soyad">
                Ad soyad
              </label>
              <input
                id="yeni-danisan-ad-soyad"
                className="mt-1 rounded border p-2"
                value={liste.yeniAdSoyad}
                onChange={(e) => liste.setYeniAdSoyad(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-telefon">
                Telefon
              </label>
              <input
                id="yeni-danisan-telefon"
                className="mt-1 rounded border p-2"
                value={liste.yeniTelefon}
                onChange={(e) => liste.setYeniTelefon(e.target.value)}
              />
            </div>
            <button
              className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
              onClick={() => void liste.ekle()}
            >
              Ekle
            </button>
          </div>
        )}

        {liste.hata && <p className="mt-1 text-sm text-red-600">{liste.hata}</p>}
        {/* `role="status"`: arşivleme sonucu ekranda sessizce beliriyordu.
            Ekran okuyucu kullanıcısı düğmeye bastıktan sonra hiçbir şey
            duymuyor, danışanın listeden düşmesini de göremiyordu. Kibar
            (`polite`) duyuru, kullanıcının o an yazdığı şeyi kesmeden işlemin
            olduğunu söyler. */}
        {liste.arsivBilgisi && (
          <p role="status" className="mt-1 text-sm text-slate-600">
            {liste.arsivBilgisi}
          </p>
        )}

        {liste.danisanlar.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm text-slate-700">
            {liste.danisanlar.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1"
              >
                {/* Erişilebilir ad "Ayşe Yılmaz dosyasını aç": takvimdeki
                    randevu bloğunun adı düz "Ayşe Yılmaz" ve iki özdeş adlı
                    düğme hem ekran okuyucu kullanıcısını hem de ada göre
                    arayan testleri belirsiz bırakırdı (aynı gerekçe
                    yanındaki "Arşivle" düğmesinde). */}
                <button
                  type="button"
                  className="underline"
                  aria-label={`${d.ad_soyad} dosyasını aç`}
                  onClick={() => danisanKartiAc(d.id)}
                >
                  {d.ad_soyad}
                </button>
                {/* Erişilebilir ad danışanın ADINI taşır. Önceki hâlinde her
                    satırdaki düğmenin adı yalnızca "Arşivle" idi: listede on
                    danışan varken ekran okuyucu kullanıcısı on özdeş düğme
                    duyuyor, hangisinin kime ait olduğunu yalnızca GÖRSEL
                    bağlamdan (yanındaki isim) çıkarabiliyordu -- bu, yıkıcı
                    bir işlemde kabul edilemez.
                    Eski gerekçe (takvimdeki randevu düğmesiyle ad çakışması)
                    burada geçerli değil: randevu bloğunun erişilebilir adı
                    düz "Ayşe Yılmaz", buranınki "Ayşe Yılmaz adlı danışanı
                    arşivle" -- ad ile arama yapan testler ve kullanıcı ikisini
                    ayırt eder. Görünen metin kısa kalıyor (`Arşivle`); değişen
                    yalnızca erişilebilir ad. */}
                <button
                  type="button"
                  className="text-slate-500 underline disabled:opacity-50"
                  aria-label={`${d.ad_soyad} adlı danışanı arşivle`}
                  title="Danışanı arşivle"
                  disabled={liste.arsivSuruyor}
                  onClick={() => {
                    liste.setArsivBilgisi(null)
                    liste.setArsivOnayi(d)
                  }}
                >
                  Arşivle
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* İki adımlı onay. Metin ne olduğunu ve ne OLMADIĞINI birlikte
            söylüyor: kullanıcı ne "sildim, gitti" ne de "hiçbir şey olmadı"
            sanmalı. */}
        {arsivOnayi && (
          <div className="mt-2 rounded bg-amber-50 p-2">
            <p className="text-sm text-amber-900">
              {arsivOnayi.ad_soyad} arşivlensin mi? Danışan listeden ve randevu seçiminden
              kaldırılır. Geçmiş randevuları, notları ve dosyaları silinmez — kayıtlar
              durmaya devam eder, yalnızca listede görünmez.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded bg-amber-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                disabled={liste.arsivSuruyor}
                onClick={() => void liste.arsivle(arsivOnayi)}
              >
                Evet, arşivle
              </button>
              <button
                className="rounded border px-3 py-1 text-sm"
                disabled={liste.arsivSuruyor}
                onClick={() => liste.setArsivOnayi(null)}
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SAKLAMA HATIRLATMASI — tasarım §7: "süresi dolan dosyalar ana
          ekranda hatırlatma olarak listelenir".

          SİLME DÜĞMESİ YOK ve olmayacak: plan global kısıtı imha kararını
          her zaman insana bırakıyor. Ekran bunu açıkça yazıyor ki
          "uygulama halleder" beklentisi oluşmasın (danışan kartındaki aynı
          cümlenin eşi).

          Adlar burada görünüyor — zaten üstteki danışan listesinde de
          görünüyorlar; bu bölüm yeni bir hassas alan (risk notu, tanı, not
          içeriği) basmıyor. */}
      {liste.saklamaDolanlar.length > 0 && (
        <section
          aria-label="Saklama süresi dolan dosyalar"
          className="mb-4 rounded border border-amber-400 bg-amber-50 p-3"
        >
          <h2 className="text-sm font-semibold text-amber-900">
            Saklama süresi dolan dosyalar ({liste.saklamaDolanlar.length})
          </h2>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">
            {liste.saklamaDolanlar.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="underline"
                  aria-label={`${d.ad_soyad} dosyasını aç (saklama süresi doldu)`}
                  onClick={() => danisanKartiAc(d.id)}
                >
                  {d.ad_soyad}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-amber-900">
            Bu dosyalar kendiliğinden silinmez; imha kararı her zaman sizindir.
          </p>
        </section>
      )}

      {/* DEPOLAMA UYARISI — plan global kısıtındaki 500 MB eşiği.
          `depolama_durumu` Görev 7'de HTTP'ye bağlanmıştı ama arayüzde
          çağrı yeri yoktu: ekler 20 MB'a kadar BLOB tutuyor ve terapist
          veritabanı şişerken hiçbir uyarı almıyordu.

          Yalnızca eşik AŞILINCA görünür ve hiçbir şeyi ENGELLEMEZ — sunucu
          da engellemiyor (`uyari === true` iken yükleme çalışmaya devam
          eder). Eşik metni sunucudan gelen `esik` alanından basılıyor;
          istemcide ikinci bir kopya tutmak iki sayının sessizce ayrışması
          demekti. */}
      {depolama?.uyari && (
        <p
          role="status"
          className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Ekli dosyalar {boyutBicimle(depolama.toplam_boyut)} yer kaplıyor ve{' '}
          {boyutBicimle(depolama.esik)} uyarı eşiğini aştı. Yükleme engellenmiyor; yedeklerinizi
          ve eski dosyalarınızı gözden geçirmek isteyebilirsiniz.
        </p>
      )}

      {/* YEDEKLEME — tasarım §7.
          "Yedek alınamazsa (disk dolu, klasör erişilemez) ana ekranda KALICI
          uyarı çıkar; sessiz geçilmez." Uyarı kendi kendine kaybolmaz;
          yalnızca başarılı bir yedek onu temizler.

          Bölüm HER ZAMAN görünür (uyarı olmasa da): "yedeğim alınıyor mu"
          sorusunun ekranda bir cevabı olmalı. Bu ürünün üçüncü başarı
          ölçütü "bilgisayar bozulursa veri kaybolmasın" ve o ölçüt, ancak
          kullanıcı yedeğinin durumunu görebiliyorsa karşılanır. */}
      <section
        aria-label="Yedekleme"
        className={`mb-4 rounded border p-3 text-sm ${
          yedekleme.uyari
            ? 'border-amber-400 bg-amber-50 text-amber-900'
            : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Yedekleme</span>
          {yedekleme.yedek !== null && yedekleme.yedek.yedekler.length > 0 ? (
            <span>
              Son yedek: <strong>{yedekleme.yedek.yedekler[0].tarih}</strong> (
              {boyutBicimle(yedekleme.yedek.yedekler[0].boyut)}) · saklanan yedek:{' '}
              {yedekleme.yedek.yedekler.length}
            </span>
          ) : (
            <span>Henüz alınmış bir yedek yok.</span>
          )}
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs disabled:opacity-50"
            disabled={yedekleme.suruyor}
            onClick={() => void yedekleme.al()}
          >
            {yedekleme.suruyor ? 'Yedek alınıyor…' : 'Şimdi yedek al'}
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={() => {
              yedekleme.setKlasorGirdisi(yedekleme.yedek?.hedef_dizin ?? '')
              yedekleme.setKlasorFormuAcik((acik) => !acik)
            }}
          >
            Yedek klasörünü değiştir
          </button>
          {/* Tasarim §7: "Uygulama icinden 'geri yukle' ekrani; her yedegin
              tarihi ve boyutu listelenir." Ekran uc felaket yolundan da
              (bozuk veritabani, okunamayan anahtar, yeni bilgisayar)
              acilabiliyor; AMA her sey CALISIRKEN de bir yol olmali:
              yanlislikla silinen bir danisan ya da bozulan bir not, ancak
              eski bir yedekten geri gelir ve o an ortada hicbir "felaket"
              yoktur. Ekranin kendisi iki adimli: burada yalnizca aciliyor,
              geri yukleme orada onaylaniyor. */}
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={onGeriYukle}
          >
            Yedekten geri yükle
          </button>
        </div>

        {yedekleme.yedek !== null && (
          <p className="mt-1 break-all font-mono text-xs">{yedekleme.yedek.hedef_dizin}</p>
        )}

        {/* KALICI UYARI. `role="status"` degil `role="alert"`: bu, gozden
            kacmamasi gereken bir durum -- kullanicinin verisi su an
            yedeklenmiyor. */}
        {yedekleme.uyari && (
          <p role="alert" className="mt-2">
            {yedekleme.uyari}
          </p>
        )}

        {yedekleme.klasorFormuAcik && (
          <div className="mt-2">
            <label className="block text-xs" htmlFor="yedek-klasoru-girdisi">
              Yedeklerin yazılacağı klasörün yolu
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="yedek-klasoru-girdisi"
                className="w-full rounded border p-2 font-mono text-xs"
                placeholder="/Volumes/YEDEK/terapi-yedek"
                value={yedekleme.klasorGirdisi}
                onChange={(e) => yedekleme.setKlasorGirdisi(e.target.value)}
              />
              <button
                type="button"
                className="shrink-0 rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50"
                disabled={yedekleme.suruyor || yedekleme.klasorGirdisi.trim() === ''}
                onClick={() => void yedekleme.al(yedekleme.klasorGirdisi.trim())}
              >
                Kaydet ve yedek al
              </button>
            </div>
            {/* Klasoru secmek ile ilk yedegi almak TEK islem: ayri bir
                "ayarla" adimi olsaydi, klasorunu secip yedegi almayan bir
                kullanici "yedegim var" sanirdi. Metin bunu soyluyor. */}
            <p className="mt-1 text-xs">
              Harici disk ya da bulut klasörü seçebilirsiniz; yedek dosyaları zaten
              şifrelidir. Kaydedince ilk yedek hemen alınır. Finder'da klasöre sağ tıklayıp{' '}
              <kbd>⌥</kbd> tuşuna basılıyken “… Yol Adı Olarak Kopyala” deyince yol panoya
              kopyalanır.
            </p>
          </div>
        )}
      </section>

      {/* PAROLA — `keystore::change_password` Plan 1'den beri yazılı ve
          testliydi ama hiçbir çağrı yeri yoktu: parola DEĞİŞTİRİLEMİYORDU.
          Bölüm her zaman görünür (yalnızca form katlanıyor): "parolamı nasıl
          değiştiririm" sorusunun ekranda bir cevabı olmalı. */}
      <section
        aria-label="Parola"
        className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Parola</span>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={parola.acKapa}
          >
            {parola.acik ? 'Vazgeç' : 'Parolayı değiştir'}
          </button>
        </div>

        {/* `role="status"`: değişiklik ekranda sessizce olup bitiyordu.
            Metin ne olduğunu VE ne OLMADIĞINI birlikte söylüyor (arşivleme
            onayıyla aynı ilke). */}
        {parola.bilgi && (
          <p role="status" className="mt-2 text-slate-700">
            {parola.bilgi}
          </p>
        )}

        {parola.acik && (
          <div className="mt-2 max-w-md">
            <div>
              <label className="block text-xs" htmlFor="mevcut-parola">
                Mevcut parolanız
              </label>
              <input
                id="mevcut-parola"
                type="password"
                autoComplete="current-password"
                className="mt-1 w-full rounded border p-2"
                value={parola.mevcutParola}
                onChange={(e) => parola.setMevcutParola(e.target.value)}
              />
            </div>
            <div className="mt-2">
              <label className="block text-xs" htmlFor="yeni-parola">
                Yeni parola
              </label>
              <input
                id="yeni-parola"
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded border p-2"
                value={parola.yeniParola}
                onChange={(e) => parola.setYeniParola(e.target.value)}
              />
            </div>
            <div className="mt-2">
              <label className="block text-xs" htmlFor="yeni-parola-tekrar">
                Yeni parola (tekrar)
              </label>
              <input
                id="yeni-parola-tekrar"
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded border p-2"
                value={parola.yeniParolaTekrar}
                onChange={(e) => parola.setYeniParolaTekrar(e.target.value)}
              />
            </div>

            {parola.hata && (
              <p role="alert" className="mt-2 text-red-600">
                {parola.hata}
              </p>
            )}

            <button
              type="button"
              className="mt-2 rounded bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50"
              disabled={parola.suruyor}
              onClick={() => void parola.degistir()}
            >
              {parola.suruyor ? 'Değiştiriliyor…' : 'Parolayı değiştir'}
            </button>

            {/* İKİ GERÇEĞİ ÖNCEDEN söyler; kullanıcı bunları ancak
                parolasını unuttuğunda ya da eski bir yedeği geri yüklemeye
                çalıştığında -- yani çok geç -- öğrenmemeli.

                1. Kurtarma kodu DEĞİŞMEZ: veri anahtarı hem parolayla hem
                   kurtarma koduyla ayrı ayrı sarmalanıyor ve sunucudaki
                   `change_password` yalnızca parola sarmalamasını
                   yeniliyor.
                2. Eski yedekler ESKİ parolayla açılır: her yedek kendi
                   anahtar dosyasıyla birlikte alınır ve geçmişteki o
                   dosyaya dokunulmaz. */}
            <div className="mt-2 text-xs">
              <p>Kurtarma kodunuz değişmez; aynı kod çalışmaya devam eder.</p>
              <p className="mt-1">
                Bugünden önce alınmış yedekler <strong>eski</strong> parolanızla açılır — her
                yedek kendi anahtar dosyasıyla birlikte alınır. Eski parolanızı unutmayın.
              </p>
              <p className="mt-1">Oturumunuz açık kalır; yeniden giriş yapmanız gerekmez.</p>
            </div>
          </div>
        )}
      </section>

      {hata && <p className="mb-4 text-sm text-red-600">{hata}</p>}

      <div className="flex items-start gap-4">
        <div className="flex-1">
          <HaftalikTakvim
            randevular={randevular}
            haftaBasi={haftaBasi}
            onHaftaDegis={haftaDegis}
            onRandevuSec={randevuSec}
            onBosSaatSec={bosSaatSec}
          />
        </div>

        {panelAcik && (
          <RandevuPaneli
            // Seçim değişince (başka bir randevu ya da boş saat) bileşen
            // yeniden mount edilmeli — aksi hâlde panelin iç state'i (silme
            // onayı, doldurulmuş form alanları) önceki seçimden yeni seçime
            // sızar (bkz. Görev 10 inceleme Bulgu 1). `key` kimliği seçili
            // randevunun ya da seçili boş saatin kimliğine bağlanıyor.
            key={seciliRandevu ? `randevu-${seciliRandevu.id}` : `bos-${seciliBosSaat}`}
            zaman={seciliBosSaat ?? seciliRandevu?.baslangic ?? ''}
            randevu={seciliRandevu}
            danisanlar={liste.danisanlar}
            onKaydet={kaydet}
            onDurumDegis={durumDegis}
            onSil={sil}
            onSeriSil={seriSil}
            seriSayisiAl={takvimApi.seriSayisi}
            silinecekNotSayisiAl={takvimApi.silinecekNotSayisi}
            onKapat={panelKapat}
            cakismaKontrol={takvimApi.cakismaKontrol}
          />
        )}
      </div>

      {seciliDanisanId !== null &&
        (kart.hata !== null ? (
          // Yükleme başarısızsa kart AÇILMAZ: yarı dolu bir danışan kartı
          // (rıza alanı boş görünen) "rıza alınmamış" diye okunurdu.
          <div role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3">
            <p className="text-sm text-red-800">Danışan dosyası yüklenemedi. {kart.hata}</p>
            <button
              type="button"
              className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
              onClick={() => {
                setKartVerisi(BOS_KART)
                setKartTazeleme((n) => n + 1)
              }}
            >
              Yeniden dene
            </button>
          </div>
        ) : (
          kart.dosya !== null && (
            <DanisanKarti
              // İKİNCİL HAT — bugün ULAŞILAMAZ, bilerek duruyor.
              //
              // Birincil hat yukarıdaki `kart` türetmesi + bu koşullu
              // render: danışan değişince `kart.dosya` `null` olur ve kart
              // zaten UNMOUNT edilir, yani bu `key` hiçbir zaman değişerek
              // bir remount tetiklemez (kaldırıldığında hiçbir test
              // kırılmaz — ölçülmüş). Birincil hattın ölçüldüğü yer:
              // `AnaEkran.test.tsx` > "baska danisana gecince onceki kartin
              // verisi EKRANDA KALMAZ".
              //
              // Satır yine de duruyor: türetme bir gün "kartı monte tut,
              // yalnızca içeriği değiştir" biçiminde gevşetilirse `key` o
              // anda yük taşımaya başlar ve maliyeti sıfır. Sentetik
              // `rerender` testleri (`DanisanKarti.test.tsx` > "ikincil
              // hat") tam olarak o senaryoyu ölçüyor.
              key={`danisan-${kart.dosya.id}`}
              danisan={kart.dosya}
              ekler={kart.ekler}
              randevular={kart.randevular}
              bugun={yerelGun(new Date())}
              notlariGetir={raporNotlariGetir}
              notSiniri={RAPOR_NOT_SINIRI}
              raporKaydiOlustur={raporKaydiOlustur}
              ekYukle={ekYukle}
              ekSil={ekSil}
              onRizaKaydet={rizaKaydet}
              onKapat={danisanKartiKapat}
            />
          )
        ))}

      {/* Seans paneli YALNIZCA mevcut bir randevu seçiliyken açılır: boş bir
          saatte henüz bir `appointment_id` yok ve not ona bağlanır. */}
      {seciliRandevu !== null &&
        (seans.hata === null ? (
          <SeansPaneli
            // Seans değişince panel yeniden mount edilmeli: sekme seçimi
            // (özellikle "Özel Notlarım") bir seanstan diğerine sızmamalı.
            key={`seans-${seciliRandevu.id}`}
            randevu={seciliRandevu}
            gecmisNotlar={seans.gecmisNotlar}
            not={seans.not}
            ozelNot={seans.ozelNot}
            ozelHata={seans.ozelHata}
            onNotKaydet={notKaydet}
            onOzelNotKaydet={ozelNotKaydet}
            onOzelSekme={() => setOzelNotIstenen(seciliRandevu.id)}
            onOzelYenidenDene={() => {
              setSeansVerisi((onceki) => ({ ...onceki, ozelHata: null }))
              setOzelTazeleme((n) => n + 1)
            }}
            onKapat={panelKapat}
          />
        ) : (
          // Yükleme başarısızsa panel AÇILMAZ: "yükleniyor…" yazan bir panel
          // sonsuza kadar öyle kalır ve kullanıcı notunun neden gelmediğini
          // bilemez.
          <div role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3">
            <p className="text-sm text-red-800">Seans notu yüklenemedi. {seans.hata}</p>
            <button
              type="button"
              className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
              onClick={() => {
                // Hata state'i de temizleniyor: aksi hâlde yeniden deneme
                // sürerken ekranda hâlâ eski hata durur.
                setSeansVerisi(BOS_SEANS)
                setSeansTazeleme((n) => n + 1)
              }}
            >
              Yeniden dene
            </button>
          </div>
        ))}
    </div>
  )
}
