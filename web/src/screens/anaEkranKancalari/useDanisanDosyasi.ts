import { useCallback, useEffect, useRef, useState } from 'react'
import {
  danisanApi,
  takvimApi,
  YetkisizHata,
  type DanisanDosyasi,
  type DepolamaDurumu,
  type EkBilgisi,
} from '../../api'
import type { Randevu } from '../../takvim/HaftalikTakvim'
import {
  dosyaSaatiOlustur,
  randevuSaatiOlustur,
  type DosyaSaklamaYamasi,
  type RandevuYamasi,
} from './yazmaSaati'

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
export type KartVerisi = {
  id: number | null
  dosya: DanisanDosyasi | null
  ekler: EkBilgisi[]
  randevular: Randevu[]
  hata: string | null
  /**
   * `randevular`ı üreten okumanın `yazmaSaati` damgası (Görev 2 inceleme
   * CRITICAL). İki BAĞIMSIZ yol aynı randevu penceresini okuyabiliyor —
   * kartın mount efekti (`dosya+ekler+randevular` üçlüsü) ve
   * `randevularTazele` (yalnızca randevular) — ve ikisi aynı anda
   * uçuşta olabilir. Yalnızca `id`/`iptal` kontrolü yeterli DEĞİL: ikisi de
   * AYNI danışan için, İKİSİ de "iptal edilmemiş" sayılır, yalnızca biri
   * DAHA ÖNCE başlayıp DAHA SONRA dönebilir. `useDanisanSeanslari.
   * yanitiYaz` ile AYNI desen — DAHA YENİ başlamış (damgası büyük) bir
   * okuma zaten uygulandıysa, daha ESKİ başlamış bir okumanın geç gelen
   * yanıtı `randevular`ı YAZMAZ.
   */
  randevularDamgasi: number
}

const BOS_KART: KartVerisi = {
  id: null,
  dosya: null,
  ekler: [],
  randevular: [],
  hata: null,
  randevularDamgasi: 0,
}

/**
 * Açık danışan kartının akışı: dosya + ekler + (bakiye için) tüm randevular,
 * ve bu üçlünün birlikte tazelendiği yazma işlemleri (rıza, ek yükleme, ek
 * silme).
 *
 * Depolama durumu da burada: uç nokta kartın her tazelenmesinde (ek yükleme /
 * ek silme) yeniden çekiliyor, yani sayacı bu kancanın dışına çıkarmak
 * bağımlılığı görünmez kılardı.
 *
 * `onYetkisiz`: 401'de takvim seçimini kapatan geri çağrı; REF'te tutuluyor ki
 * efekt bağımlılıkları ilkel kalsın (`useTakvimAkisi` ile aynı gerekçe).
 */
export function useDanisanDosyasi({ onYetkisiz }: { onYetkisiz: () => void }) {
  // Açık danışan kartı. Seans panelindeki desenle aynı: state HANGİ danışana
  // ait olduğunu taşır ve ekrana giden veri render sırasında türetilir.
  const [seciliDanisanId, setSeciliDanisanId] = useState<number | null>(null)
  const [kartVerisi, setKartVerisi] = useState<KartVerisi>(BOS_KART)
  const [kartTazeleme, setKartTazeleme] = useState(0)
  // Depolama durumu. `null` = henüz gelmedi ya da alınamadı; ikisi de aynı
  // şeyi gerektirir (hiçbir şey gösterme). Bu uç nokta sunucuda LOG YAZMAZ,
  // bu yüzden ek yükleme/silme sonrasında tazelenebiliyor.
  const [depolama, setDepolama] = useState<DepolamaDurumu | null>(null)

  const yetkisizRef = useRef(onYetkisiz)
  yetkisizRef.current = onYetkisiz
  // `randevularTazele` bir `await`in ARDINDAN (AnaEkran'ın randevu
  // yazmalarından) çağrılıyor; o an elindeki kanca dönüşü birkaç render
  // eskimiş olabilir, bu yüzden AÇIK danışanı REF'ten okuyor (`seansSec`/
  // `yapiDegisti` ile aynı gerekçe, bkz. `useDanisanSeanslari`).
  const seciliDanisanIdRef = useRef(seciliDanisanId)
  seciliDanisanIdRef.current = seciliDanisanId

  // Kart yüklenirken (istek uçuştayken) işaretlenen ödeme/durum, geç dönen
  // kart yanıtında ESKİ değere dönmesin: takvim listesiyle AYNI mantıksal
  // saat (bkz. `yazmaSaati.ts`). Okuma damgası isteklerden hemen önce,
  // yazma damgası `randevuYamala`da (çağıran onu yalnızca başarıda çağırır).
  const [yazmaSaati] = useState(randevuSaatiOlustur)
  // Kartın `dosya` alanındaki saklama bilgileri (son_temas/saklama_bitis)
  // için AYRI bir saat (Görev 3) — `yazmaSaati` randevu kimliğiyle
  // anahtarlanıyor, danışan kimliğiyle KARIŞTIRILAMAZ (bkz.
  // `dosyaSaatiOlustur` gerekçesi).
  const [dosyaSaati] = useState(dosyaSaatiOlustur)

  // Danışan kartı verisi. Seans verisiyle aynı desen: `id` ile eşleşmeyen
  // state boş sayılır (render sırasında), böylece bir danışandan diğerine
  // geçerken ÖNCEKİNİN dosyası bir kare bile görünmez.
  const kart = kartVerisi.id === seciliDanisanId ? kartVerisi : BOS_KART

  // Depolama durumu: ilk yüklemede ve kart her tazelendiğinde (ek yükleme /
  // ek silme) yeniden çekilir. Bu uç nokta denetim kaydına HİÇBİR ŞEY
  // yazmıyor (`depolama_durumu` bir sayı sorgusudur), yani hacim kaygısı
  // yok — saklama hatırlatması listesinden farkı tam olarak budur.
  useEffect(() => {
    void danisanApi.depolamaDurumu().then(setDepolama).catch(() => {})
  }, [kartTazeleme])

  useEffect(() => {
    if (seciliDanisanId === null) return
    let iptal = false

    void (async () => {
      const okumaDamgasi = yazmaSaati.okumaBasladi()
      // Görev 3: `dosya`nın saklama alanları için AYRI damga — bu okuma
      // (`dosyaGetir`) `dosyaAlanlariniYama` ile YARIŞABİLİR: kart yeni
      // açılmışken (bu istek uçuştayken) bir randevu "geldi" işaretlenirse
      // ikisi de aynı anda sürüyor olabilir. Aşağıdaki `dosyaSaati.uygula`
      // bu okumadan SONRA biten (daha büyük damgalı) bir yamayı yanıtın
      // üstüne uygular — desen `randevularDamgasi`/`yanitiYaz` ile AYNI.
      const dosyaOkumaDamgasi = dosyaSaati.okumaBasladi()
      try {
        // Üçü birlikte: ek listesi ayrı yakalanıp yutulsaydı, başarısızlık
        // "bu danışanın dosyası yok" diye görünürdü — dosyası olan bir
        // danışan için sessiz bir yalan (`seansVerisi` ile aynı gerekçe).
        const [dosyaHam, ekler, tumRandevular] = await Promise.all([
          danisanApi.dosyaGetir(seciliDanisanId),
          danisanApi.ekleriGetir(seciliDanisanId),
          takvimApi.randevulariGetir(TUM_ZAMAN_BASI, TUM_ZAMAN_SONU),
        ])
        if (iptal) return
        const okunanRandevular = yazmaSaati.uygula(
          tumRandevular.filter((r) => r.client_id === seciliDanisanId),
          okumaDamgasi,
        )
        const dosya = dosyaSaati.uygula([dosyaHam], dosyaOkumaDamgasi)[0]
        setKartVerisi((onceki) => {
          // CRITICAL düzeltmesi (bkz. `KartVerisi.randevularDamgasi`):
          // `randevularTazele` bu okuma UÇUŞTAYKEN DAHA YENİ bir okuma
          // başlatıp ondan ÖNCE dönmüş olabilir — o zaman kartta zaten
          // BU okumadan DAHA TAZE bir randevu listesi var demektir; bu
          // okumanın (geç gelen, eski) randevu listesini YAZMAK bakiyeyi
          // KALICI olarak eskiye döndürür. `dosya`/`ekler` bu yarışa dahil
          // DEĞİL (tek okuyucuları bu efekt, `iptal` onları zaten koruyor).
          const dahaYeniRandevuVarMi =
            onceki.id === seciliDanisanId && onceki.randevularDamgasi > okumaDamgasi
          return {
            id: seciliDanisanId,
            dosya,
            ekler,
            randevular: dahaYeniRandevuVarMi ? onceki.randevular : okunanRandevular,
            randevularDamgasi: dahaYeniRandevuVarMi ? onceki.randevularDamgasi : okumaDamgasi,
            hata: null,
          }
        })
      } catch (e) {
        if (iptal) return
        if (e instanceof YetkisizHata) {
          yetkisizRef.current()
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
  }, [seciliDanisanId, kartTazeleme, yazmaSaati, dosyaSaati])

  function ac(clientId: number) {
    setSeciliDanisanId(clientId)
  }

  /**
   * Kartı kapatır.
   *
   * Veri de siliniyor, yalnızca panel gizlenmiyor: kart risk notu ve rıza
   * bilgisi taşıyor ve kapalı bir bileşenin state'inde duran veri, bir
   * sonraki açılışta yanlış danışanın kartında görünebilirdi.
   *
   * `useCallback`: `useTakvimAkisi`'nin 401 dalı bunu çağırıyor ve o bağ her
   * renderda taze bir closure ile kuruluyor — kimliğin sabit olması, bağın
   * kancaların bildirim SIRASINDAN bağımsız kurulabilmesini sağlıyor.
   */
  const kapat = useCallback(() => {
    setSeciliDanisanId(null)
    setKartVerisi(BOS_KART)
  }, [])

  function yenidenDene() {
    setKartVerisi(BOS_KART)
    setKartTazeleme((n) => n + 1)
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
  /**
   * Kartın randevu listesini YERELDE yamar (Görev 2 inceleme M5).
   *
   * Kart ve seans paneli aynı anda açık olabiliyor. Panelin alt satırından
   * bir seans "ödendi" ya da "gelmedi" işaretlenince kartın bakiyesi bayat
   * kalıyordu. Kart YENİDEN ÇEKİLMİYOR: `dosyaGetir` her çağrıda sunucuda
   * silinemez bir `goruntuleme` satırı daha yazar ve sonuç (tek satırın tek
   * alanı) zaten kesin olarak biliniyor — `useTakvimAkisi.durumDegis` ile
   * aynı gerekçe.
   *
   * Kart başka bir danışana aitse ya da o randevuyu içermiyorsa ekrandaki
   * hiçbir şey değişmez — ama yazma yine de SAATE işlenir: kart o an
   * yükleniyorsa (liste henüz boş) geç dönen yanıt bu yamayı alır. Ölçen
   * testler: `AnaEkran.test.tsx` > "kart ACIKKEN odeme ve durum
   * isaretlenince kart bakiyesi YERELDE tazelenir" ve "kart YUKLENIRKEN odeme
   * isaretlenirse gec donen kart yaniti ESKI bakiyeyi gostermez".
   */
  const randevuYamala = useCallback(
    (id: number, yama: RandevuYamasi) => {
      yazmaSaati.yazmaBitti(id, yama)
      setKartVerisi((onceki) =>
        onceki.randevular.some((r) => r.id === id)
          ? { ...onceki, randevular: onceki.randevular.map((r) => (r.id === id ? { ...r, ...yama } : r)) }
          : onceki,
      )
    },
    [yazmaSaati],
  )

  /**
   * Kartın DOSYASINDAKİ saklama alanlarını (`son_temas`/`saklama_bitis`)
   * YERELDE yamar (Görev 3 — "saklama süresi doldu" bayatlığı).
   *
   * "Geldi" işaretlemek sunucuda bu iki alanı ileri taşıyabilir
   * (`appointments::son_temasi_isaretle`); süresi dolmuş bir danışan
   * terapiye dönüp bir seansı "Geldi" işaretlendiğinde Bilgiler sekmesindeki
   * amber uyarı kutusu ESKİ tarihi göstermeye devam ediyordu — kart
   * YENİDEN ÇEKİLMİYORDU (`danisanApi.dosyaGetir` = `clients::getir`,
   * `LogHacmi::HerCagri`: her çağrı silinemez bir satır, bkz. modül başlığı
   * ve `randevularTazele`nin gerekçesi). `randevuYamala` ile aynı karar:
   * sonuç (iki alan) sunucunun PATCH yanıtından zaten KESİN biliniyor.
   *
   * Kart BAŞKA bir danışana aitse (ya da henüz `dosya` yüklenmediyse)
   * ekranda hiçbir şey değişmez — ama yazma yine de `dosyaSaati`ye işlenir:
   * kart o an YÜKLENİYORSA (mount efekti uçuştaysa) geç dönen yanıt bu
   * yamayı görür (bkz. `dosyaSaati` ve mount efektindeki `uygula` çağrısı).
   */
  const dosyaAlanlariniYama = useCallback(
    (clientId: number, yama: DosyaSaklamaYamasi) => {
      dosyaSaati.yazmaBitti(clientId, yama)
      setKartVerisi((onceki) =>
        onceki.id === clientId && onceki.dosya !== null
          ? { ...onceki, dosya: { ...onceki.dosya, ...yama } }
          : onceki,
      )
    },
    [dosyaSaati],
  )

  /**
   * Kartın randevu penceresini YENİDEN ÇEKER (Görev 2 inceleme IMPORTANT-2).
   *
   * `randevuYamala` yalnızca durum/ödeme gibi TEK ALANI kesin bilinen
   * yazmalar için yeterli. Randevu oluşturma, silme ve seri iptali satır
   * ekler/çıkarır — YAMANAMAZ; ücret değişimi (ve danışan/saat taşıması) da
   * BURADAN geçiyor: tek bir alanı ayrı yamalamak yerine `useDanisanSeanslari.
   * yapiDegisti` ile AYNI sınıf bayatlık kullanılıyor (bkz. o dosya
   * "Bayatlık") — farkla ki kartın kendi `gorunur` kısıtı YOK: kanca
   * `AnaEkran`da yaşadığı için sekme değişince UNMOUNT OLMUYOR (bkz.
   * `AnaEkran.tsx` modül başlığı), dolayısıyla "görünür olunca TEK istekle
   * tazele" ertelemesine gerek yok — yazma başarılı olur olmaz hemen
   * tazelenir.
   *
   * Yalnızca `takvimApi.randevulariGetir` çağrılır — kartın TAMAMI DEĞİL:
   * `clients::getir` (`dosyaGetir`) `LogHacmi::HerCagri` ile silinemez bir
   * satır yazıyor (bkz. modül başlığı ve `useDanisanDosyasi` üstteki
   * yorum), bu yüzden `kartTazeleme` BİLEREK artırılmıyor. Randevu penceresi
   * `LogHacmi::OturumBasi` ile birleşiyor (bkz. yukarıdaki modül başlığı
   * "Denetim kaydı açısından ek yük yok") — ek maliyet yok.
   *
   * `etkilenenler`: `null` de dahil (silinen/taşınan randevunun eski
   * danışanı bilinmiyorsa) — açık kart o durumda da bayat sayılır, bir
   * fazladan pencere isteği yanlış bakiyeden ucuzdur (`useDanisanSeanslari.
   * yapiDegisti` ile aynı temkinli karar).
   *
   * # Mount efektiyle YARIŞ (inceleme CRITICAL, düzeltildi)
   *
   * Bu fonksiyon AYNI randevu penceresini kartın kendi mount efektiyle
   * (yukarıdaki `useEffect`) PAYLAŞIYOR — kart YENİ açılmışken (ilk okuma
   * hâlâ uçuştayken) bir yazma olursa ikisi de aynı anda uçuşta olabilir.
   * Yalnızca "hangi danışan" kontrolü YETERSİZDİ: ikisi de AYNI danışana
   * ait, ikisi de "iptal edilmemiş" sayılıyordu, ama DAHA ÖNCE başlayan
   * mount okuması DAHA SONRA dönüp bu fonksiyonun (daha yeni, doğru)
   * sonucunu KALICI olarak eskiye döndürebiliyordu. Çözüm
   * `KartVerisi.randevularDamgasi` — desen `useDanisanSeanslari.yanitiYaz`
   * ile AYNI: DAHA YENİ başlamış bir okuma zaten uygulandıysa, DAHA ESKİ
   * başlamış bir okumanın geç gelen yanıtı `randevular`ı YAZMAZ.
   *
   * `hedefDanisan` yanıt DÖNDÜĞÜNDE de (`seciliDanisanIdRef.current` ile)
   * yeniden okunuyor: kullanıcı bu yanıt beklenirken BAŞKA bir danışana
   * geçmiş olabilir, o zaman yanıt hiçbir şeye uygulanmaz.
   *
   * `onceki.id !== hedefDanisan` durumunda (mount kendi İLK okumasını HENÜZ
   * bitirmemiş — `kartVerisi` hâlâ `BOS_KART` ya da önceki danışana ait)
   * `dosya`/`ekler`/`hata` KOŞULSUZ `onceki`den KOPYALANMAZ: bu üçü henüz
   * bilinmiyor (`null`/`[]`), yalnızca `randevular` bu yanıttan geliyor —
   * aksi hâlde (`...onceki` ile kopyalansaydı) id BU danışana ait ama
   * dosya BAŞKA danışana ait bir "Frankenstein" durum üretilirdi. Mount
   * sonunda döndüğünde `id`/`dosya`/`ekler`/`hata`yı KOŞULSUZ yazar (tek
   * yazarı o); `randevularDamgasi` karşılaştırması az önce yazılan (daha
   * büyük damgalı) bu yanıtı korur.
   */
  const randevularTazele = useCallback(
    (etkilenenler: readonly (number | null)[]) => {
      const hedefDanisan = seciliDanisanIdRef.current
      if (
        hedefDanisan === null ||
        !etkilenenler.some((id) => id === null || id === hedefDanisan)
      ) {
        return
      }
      const okumaDamgasi = yazmaSaati.okumaBasladi()
      void takvimApi.randevulariGetir(TUM_ZAMAN_BASI, TUM_ZAMAN_SONU).then(
        (tumRandevular) => {
          // Kullanıcı bu yanıt dönene kadar BAŞKA bir danışana geçmiş
          // olabilir (`ac`/`kapat`) — o zaman yanıt hiçbir şeye uygulanmaz.
          if (seciliDanisanIdRef.current !== hedefDanisan) return
          setKartVerisi((onceki) => {
            const zatenBuDanisanin = onceki.id === hedefDanisan
            // CRITICAL düzeltmesi (bkz. modül/fonksiyon başlığı ve
            // `KartVerisi.randevularDamgasi`): bu danışan için ZATEN DAHA
            // YENİ bir randevu okuması uygulandıysa, bu (daha eski
            // başlamış) yanıtı YAZMA.
            if (zatenBuDanisanin && onceki.randevularDamgasi > okumaDamgasi) return onceki
            return {
              id: hedefDanisan,
              dosya: zatenBuDanisanin ? onceki.dosya : null,
              ekler: zatenBuDanisanin ? onceki.ekler : [],
              hata: zatenBuDanisanin ? onceki.hata : null,
              randevular: yazmaSaati.uygula(
                tumRandevular.filter((r) => r.client_id === hedefDanisan),
                okumaDamgasi,
              ),
              randevularDamgasi: okumaDamgasi,
            }
          })
        },
        (e: unknown) => {
          if (e instanceof YetkisizHata) {
            yetkisizRef.current()
            setSeciliDanisanId(null)
            setKartVerisi(BOS_KART)
            return
          }
          // Diğer hatalar sessizce yutuluyor: bakiyenin bir sonraki
          // başarılı yazmaya kadar bayat kalması, kartı bütünüyle hata
          // durumuna düşürmekten iyi — terapist zaten dosyayı görüyor,
          // yalnızca bakiye bir adım geride kalır.
        },
      )
    },
    [yazmaSaati],
  )

  async function ekSil(ekId: number) {
    await danisanApi.ekSil(ekId)
    setKartTazeleme((n) => n + 1)
  }

  return {
    seciliDanisanId,
    kart,
    depolama,
    ac,
    kapat,
    yenidenDene,
    rizaKaydet,
    ekYukle,
    ekSil,
    randevuYamala,
    randevularTazele,
    dosyaAlanlariniYama,
  }
}
