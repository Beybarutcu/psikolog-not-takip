import { useCallback, useEffect, useRef, useState } from 'react'
import { takvimApi, YetkisizHata } from '../../api'
import type { Randevu } from '../../takvim/HaftalikTakvim'
import { haftaGunleri, haftaninBasi, yerelZaman, zamandanDate } from '../../takvim/hafta'
import { simdiYerel } from './yerelGun'
import { randevuSaatiOlustur } from './yazmaSaati'

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
  // Açılış haftası uygulamadaki TEK "şimdi" kaynağından (`yerelGun.ts::
  // simdiYerel`, tasarım A2) — ikinci bir `new Date()` çağrısı bu ekranın
  // "şimdi"sini danışan dosyasınınkinden testlerde sessizce ayrıştırırdı.
  const [haftaBasi, setHaftaBasi] = useState(() => haftaninBasi(zamandanDate(simdiYerel())))
  const [randevular, setRandevular] = useState<Randevu[]>([])
  const [hata, setHata] = useState<string | null>(null)
  const [seciliRandevu, setSeciliRandevu] = useState<Randevu | null>(null)
  const [seciliBosSaat, setSeciliBosSaat] = useState<string | null>(null)

  const yetkisizRef = useRef(onYetkisiz)
  yetkisizRef.current = onYetkisiz

  // # Uçuştaki yazma × liste yüklemesi (Görev 2 inceleme M7)
  //
  // `durumDegis`/`odemeDegis` listeye YEREL yazıyor; yazmadan önce başlayıp
  // sonra dönen bir hafta GET'i yerel değeri ezerdi. Mantıksal saat
  // `yazmaSaati.ts`te (gerekçe ve ölçen testler orada); danışan kartı AYNI
  // mekanizmayı kullanıyor.
  const [yazmaSaati] = useState(randevuSaatiOlustur)

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
    const okumaDamgasi = yazmaSaati.okumaBasladi()
    try {
      const sunucudan = await takvimApi.randevulariGetir(baslangic, bitis)
      // Bu yükleme başladığında henüz bitmemiş yazmalar yanıttan önce gelir
      // (bkz. `yazmaSaati.ts`).
      const gelen = yazmaSaati.uygula(sunucudan, okumaDamgasi)
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
      setSeciliRandevu((secili) => {
        if (secili === null) return null
        return gelen.find((r) => r.id === secili.id) ?? null
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
  }, [haftaBasi, oturumKapandi, yazmaSaati])

  useEffect(() => { void yukle() }, [yukle])

  function haftaDegis(yon: number) {
    setHaftaBasi((onceki) => {
      const yeni = new Date(onceki)
      yeni.setDate(yeni.getDate() + yon * 7)
      return yeni
    })
  }

  // Mutlak gezinme: "Bugün" düğmesi ve gün seçici (tasarım A1). Göreli
  // `haftaDegis(±1)` yanında durur; ikisi de aynı state'i kurar.
  function haftayaGit(tarih: Date) {
    setHaftaBasi(haftaninBasi(tarih))
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
  //
  // # Hata sayfa üstü banda YAZILMAZ (Görev 2 inceleme M6)
  //
  // `durumDegis` ve `odemeDegis` hatayı `setHata` ile takvimin sayfa üstü
  // bandına da yazıyordu; aynı mesaj alt satırın `alert`inde de çıkıyordu ve
  // panel kapansa bile bantta kalıyordu. Bu iki işlemin TEK çağıranı
  // `SeansAltSatiri` ve hatayı kendi `alert`inde gösteriyor; burada yalnızca
  // RED yayılıyor (try/catch yok, ret olduğu gibi çağırana gidiyor). Başarıda
  // `setHata(null)` da yok: bir PATCH'in başarısı haftanın YÜKLENEMEDİĞİNİ
  // söyleyen bandı silmemeli.
  //
  // Reddin çağırana ULAŞMASI yük taşıyor (inceleme M4): yutulsaydı alt satır
  // işlemi başarılı sayar, kullanıcı hiçbir şey duymazdı. Ölçen test:
  // `AnaEkran.test.tsx` > "durum hatasi YALNIZCA alt satirda, TEK KEZ
  // duyurulur" (ve "odeme ..." eşi).
  async function durumDegis(id: number, durum: string) {
    // Görev 3: yanıt "geldi" GERÇEKTEN ileri taşıdıysa `client_id`/
    // `son_temas`/`saklama_bitis` taşır; çağıran (`AnaEkran.durumDegis`)
    // bunlarla kartı ve saklama listesini yerelde yamalar. Bu kanca
    // yanıtı yalnızca YUKARI iletir — dosya/saklama önbelleklerini
    // GÖRMÜYOR (o ikisi başka kancalarda), bu yüzden kararı burada değil
    // çağıranda vermek TEK yazma yolu ilkesiyle tutarlı (bkz. `AnaEkran.tsx`
    // modül başlığı).
    const yanit = await takvimApi.randevuDurumu(id, durum)
    yazmaSaati.yazmaBitti(id, { durum })
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
    return yanit
  }

  // "Ödendi" işareti — `durumDegis` ile AYNI karar ve aynı gerekçe: sonuç
  // yerel olarak kesin biçimde bilinir (tek satır, tek boolean), bu yüzden
  // `yukle()` ÇAĞRILMAZ; çağrılsaydı her işaretleme sunucuda silinemez bir
  // `goruntuleme` satırı daha bırakırdı. Ölçen test: `AnaEkran.test.tsx` >
  // "\"Ödendi\" isaretlemek YALNIZCA tek PATCH /odeme uretir".
  //
  // # İki tazeleme, iki farklı hat (Görev 2 inceleme M3)
  //
  // BİRİNCİL HAT — liste tazelemesi (`setRandevular`). Kutunun değeri
  // `SeansAltSatiri` MOUNT'unda `randevu.odendi`'den okunur; başka bir seansa
  // geçip geri dönülünce panel randevuyu LİSTEDEN alır ve yeniden mount
  // edilir. Bu satır olmasaydı kutu bayat `odendi` ile açılırdı. Ölçen test:
  // `AnaEkran.test.tsx` > "seans degisince Odendi kutusu YENI randevunun
  // degerini gosterir; geri donunce A nin isareti korunur" (satır
  // kaldırılınca kırılıyor — ölçüldü).
  //
  // İKİNCİL HAT — seçili kopyanın tazelemesi (`setSeciliRandevu`). BUGÜN
  // GÖZLEMLENEMİYOR: açık satır `odendi`yi yalnızca mount'ta okuyor ve kendi
  // iyimser kopyasını tutuyor, seçili nesnenin `odendi`sini okuyan başka bir
  // yer yok. Satır kaldırıldığında TÜM web paketi yeşil kalıyor (ölçüldü;
  // `durumDegis`teki eşi ise `aria-pressed` üzerinden yük taşıyor). Duruyor,
  // çünkü seçili nesneyi prop olarak okuyan ilk bileşen (ör. kutuyu
  // `randevu.odendi`'ye bağlayan bir sadeleştirme) onu anında yük taşır hâle
  // getirir ve maliyeti sıfır. Koruma İMA ETMİYOR: yük taşımaya başladığı
  // gün testini de o değişiklik getirmeli.
  async function odemeDegis(id: number, odendi: boolean) {
    await takvimApi.odemeGuncelle(id, odendi)
    yazmaSaati.yazmaBitti(id, { odendi })
    setRandevular((onceki) => onceki.map((r) => (r.id === id ? { ...r, odendi } : r)))
    setSeciliRandevu((secili) => (secili && secili.id === id ? { ...secili, odendi } : secili))
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
    haftayaGit,
    randevuSec,
    bosSaatSec,
    panelKapat,
    kaydet,
    durumDegis,
    odemeDegis,
    sil,
    seriSil,
  }
}
