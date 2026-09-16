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
}

const BOS_KART: KartVerisi = { id: null, dosya: null, ekler: [], randevular: [], hata: null }

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
  }, [seciliDanisanId, kartTazeleme])

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
   * Kart başka bir danışana aitse ya da o randevuyu içermiyorsa hiçbir şey
   * değişmez. Ölçen test: `AnaEkran.test.tsx` > "kart ACIKKEN odeme ve durum
   * isaretlenince kart bakiyesi YERELDE tazelenir".
   */
  const randevuYamala = useCallback(
    (id: number, yama: Partial<Pick<Randevu, 'durum' | 'odendi'>>) => {
      setKartVerisi((onceki) =>
        onceki.randevular.some((r) => r.id === id)
          ? { ...onceki, randevular: onceki.randevular.map((r) => (r.id === id ? { ...r, ...yama } : r)) }
          : onceki,
      )
    },
    [],
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
  }
}
