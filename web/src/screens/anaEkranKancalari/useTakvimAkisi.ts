import { useCallback, useEffect, useRef, useState } from 'react'
import { takvimApi, YetkisizHata } from '../../api'
import type { Randevu } from '../../takvim/HaftalikTakvim'
import { haftaGunleri, haftaninBasi, yerelZaman } from '../../takvim/hafta'

/**
 * Görünen haftanın randevuları ve o listeye bağlı SEÇİM.
 *
 * Bu kanca ana ekranın omurgası: hangi hafta görünüyor, hangi randevu ya da
 * boş saat seçili, ve o seçim sunucudan gelen listeyle nasıl senkron
 * tutuluyor. Seans notu (`useSeansNotlari`) ve danışan kartı
 * (`useDanisanDosyasi`) akışları buradan çıkan `seciliRandevu`'ya bağlanıyor.
 *
 * # `onYetkisiz` neden bir REF'te tutuluyor
 *
 * 401 temizliği kancalar arasında İKİ YÖNLÜ: buradaki yükleme 401 alırsa
 * açık danışan kartı da kapanmalı, danışan/seans akışları 401 alırsa buradaki
 * seçim kapanmalı. Çağıran bu bağı her renderda taze bir closure ile kuruyor;
 * o closure `yukle`nin bağımlılığı olsaydı `yukle`nin kimliği her renderda
 * değişir, `useEffect(…, [yukle])` her renderda yeniden koşar ve HER RENDER
 * bir takvim isteği atılırdı — sunucuda silinemez `goruntuleme` satırları
 * (bkz. `store::audit` hacim politikası). Ref, bağımlılıkları ilkel
 * kimliklerle sınırlı tutmanın bedeli sıfır olan yoludur.
 */
export function useTakvimAkisi({ onYetkisiz }: { onYetkisiz: () => void }) {
  const [haftaBasi, setHaftaBasi] = useState(() => haftaninBasi(new Date()))
  const [randevular, setRandevular] = useState<Randevu[]>([])
  const [hata, setHata] = useState<string | null>(null)
  const [seciliRandevu, setSeciliRandevu] = useState<Randevu | null>(null)
  const [seciliBosSaat, setSeciliBosSaat] = useState<string | null>(null)

  const yetkisizRef = useRef(onYetkisiz)
  yetkisizRef.current = onYetkisiz

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

  /**
   * Oturum kilitlendiğinde takvim tarafının bırakması gerekenler.
   *
   * Seans ve danışan akışları da 401 aldıklarında bunu çağırıyor: açık panel
   * seçili danışanın adını (açılır menüde) ve saatini taşıyor, yani listeyi
   * temizlemek tek başına ekranı boşaltmıyordu.
   *
   * Panelde açık bir not editörünün yazılmamış metni bu yüzden kaybolmaz —
   * o metin `seans/taslak.ts`'te, bileşen ağacının dışında duruyor ve kilit
   * açılıp seans yeniden açıldığında geri yükleniyor (bkz. `NotEditoru`'nun
   * 401 kararı).
   */
  const oturumKapandi = useCallback(() => {
    setRandevular([])
    setSeciliRandevu(null)
    setSeciliBosSaat(null)
  }, [])

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
      // bu nesneye bağlandı ve yazdığı `appointment_id` ile `client_id`
      // buradan geliyor — bayat bir nesneden gelen kimlik, notu yanlış (ya
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
        // ekranda danışan adları kalmasın diye randevu listesi ve panel
        // burada hemen temizleniyor.
        oturumKapandi()
        // Danışan kartı da kapatılıyor: kart danışanın adını, telefonunu,
        // başvuru nedenini ve risk notunu taşıyor — randevu listesini
        // temizlemek tek başına ekranı boşaltmıyordu. Kartın state'i
        // `useDanisanDosyasi`'nde, bu yüzden çağıranın verdiği geri çağrı
        // üzerinden kapatılıyor.
        yetkisizRef.current()
      }
      setHata(e instanceof Error ? e.message : 'Randevular yüklenemedi.')
    }
  }, [haftaBasi, oturumKapandi])

  useEffect(() => { void yukle() }, [yukle])

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
   *
   * Açık danışan kartının kapatılması ÇAĞIRANDA: kart state'i başka bir
   * kancada ve bu kanca onu görmüyor.
   */
  function seansaGit(appointmentId: number, tarih: string) {
    const [yil, ay, gun] = tarih.slice(0, 10).split('-').map(Number)
    const hedefHafta = haftaninBasi(new Date(yil, (ay ?? 1) - 1, gun ?? 1))
    bekleyenSeans.current = { id: appointmentId, hafta: hedefHafta.getTime() }
    setSeciliBosSaat(null)
    setHaftaBasi(hedefHafta)
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
      // ayrışır. Plan 4 Görev 2'den beri bu satır YÜK TAŞIYOR: `SeansPaneli`
      // alt satırı seçili düğmeyi (`aria-pressed`) `randevu.durum`'dan okuyor
      // ve `key` değişmediği için remount olmuyor — bu tazeleme olmasaydı
      // "Geldi"ye basınca vurgu eski düğmede kalırdı.
      //
      // Nesne tazeleniyor ama KİMLİK aynı kalıyor: seans notu efektleri
      // `seansId`/`seansDanisanId`/`seansBaslangici` ilkel değerlerine bağlı,
      // dolayısıyla bu tazeleme yeni bir not isteği ATMAZ (ölçen test:
      // "Geldi isaretlemek not isteklerini YENIDEN ATMAZ").
      setSeciliRandevu((secili) => (secili && secili.id === id ? { ...secili, durum } : secili))
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Randevu güncellenemedi.')
      throw e
    }
  }

  // "Ödendi" işareti — `durumDegis` ile AYNI karar ve aynı gerekçe: sonuç
  // yerel olarak kesin biçimde bilinir (tek satır, tek boolean), bu yüzden
  // `yukle()` ÇAĞRILMAZ; çağrılsaydı her işaretleme sunucuda silinemez bir
  // `goruntuleme` satırı daha bırakırdı. Seçili randevunun kopyası AYNI
  // kimlikle tazelenir: not efektleri ilkel kimliklere bağlı, yeni istek
  // atılmaz. Ölçen test: `AnaEkran.test.tsx` > "\"Ödendi\" isaretlemek
  // YALNIZCA tek PATCH /odeme uretir".
  //
  // Liste de tazeleniyor, yalnızca seçili kopya değil: kullanıcı başka bir
  // seansa geçip geri döndüğünde panel randevuyu LİSTEDEN alır ve bayat
  // `odendi` ile açılırdı.
  async function odemeDegis(id: number, odendi: boolean) {
    try {
      await takvimApi.odemeGuncelle(id, odendi)
      setHata(null)
      setRandevular((onceki) => onceki.map((r) => (r.id === id ? { ...r, odendi } : r)))
      setSeciliRandevu((secili) => (secili && secili.id === id ? { ...secili, odendi } : secili))
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Ödeme kaydedilemedi.')
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

  return {
    haftaBasi,
    randevular,
    hata,
    seciliRandevu,
    seciliBosSaat,
    panelAcik: seciliRandevu !== null || seciliBosSaat !== null,
    oturumKapandi,
    haftaDegis,
    randevuSec,
    bosSaatSec,
    panelKapat,
    seansaGit,
    kaydet,
    durumDegis,
    odemeDegis,
    sil,
    seriSil,
  }
}
