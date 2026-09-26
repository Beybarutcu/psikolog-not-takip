import { useCallback, useEffect, useRef, useState } from 'react'
import { takvimApi, YetkisizHata, type GuncellemeYaniti } from '../../api'
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
  // Kaydırma isteği (tasarım A6): KULLANICI bir randevu seçtiğinde seçilen
  // randevunun kimliği; seans bölümü onu uygulayınca `kaydirmaTamam` ile
  // temizlenir. Bileşende değil burada, çünkü `TakvimSekmesi` sekme dönüşünde
  // yeniden monte oluyor — bileşenin kendi durumu olsaydı ya hiç kaydırmaz ya
  // her montajda yeniden kaydırırdı. Liste tazelemesi, hafta değişimi ve
  // taşıma sonrası tazeleme bu isteği KURMAZ.
  const [kaydirmaIstegi, setKaydirmaIstegi] = useState<number | null>(null)
  // "Bu seansa git" (tasarım N8): hedef başka haftadaysa seçim o haftanın
  // yüklemesi dönünce yapılır. Kimlik REF'te (yukle'nin bağımlılığı olmasın);
  // `gecisBekliyor` ızgaranın yerine "Seans açılıyor…" gösterilsin diye.
  //
  // `ilkYukleme`: bekleyen seçimi tüketebilecek İLK yüklemenin sıra numarası
  // (`yuklemeSirasiRef`). Geçişten ÖNCE başlamış bir yükleme — hafta
  // korumasından geçen AYNI haftanın uçuştaki GET'i — bayat listesiyle
  // seçimi tüketip geçişi sessizce bitiremez (düzeltme turu 1; ölçen test:
  // `useTakvimAkisi.test.ts` > "7.4g").
  const bekleyenSecimRef = useRef<{ id: number; ilkYukleme: number } | null>(null)
  const yuklemeSirasiRef = useRef(0)
  const [gecisBekliyor, setGecisBekliyor] = useState(false)

  const yetkisizRef = useRef(onYetkisiz)
  yetkisizRef.current = onYetkisiz

  // Hafta koruması (tasarım A6): yanıt, istek anındaki hafta HÂLÂ görünen
  // haftaysa yazılır. Ref render'da tazelenir; efekt yeni hafta için
  // `yukle`'yi çağırmadan önce ref zaten yenidir. Kapattığı yarış: hızlı hafta
  // gezinmesinde (ya da taşımada) önce istenip SONRA dönen eski haftanın
  // listesi, görünen haftanın ızgarasını eziyordu (ölçen test:
  // `AnaEkran.test.tsx` > "10.3 hafta korumasi").
  const gorunenHafta = useRef(haftaBasi.getTime())
  gorunenHafta.current = haftaBasi.getTime()

  // Seçimin ŞU ANKİ kimliği (düzeltme turu 1, kontrolör R11). `kaydet`in PUT
  // dalı `await`ten SONRA "A hâlâ seçili mi?" diye sormalı ve o soru eski
  // kapanıştaki `seciliRandevu`ya sorulamaz: ızgara PUT uçuştayken
  // tıklanabilir. Ref seçimi değiştiren HER yerde, `setSeciliRandevu`nun
  // yanında güncelleniyor (render'ı beklemeden); kimliği koruyan tazelemeler
  // (`durumDegis`/`odemeDegis`) ona dokunmaz.
  const seciliIdRef = useRef<number | null>(null)

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
    seciliIdRef.current = null
    setSeciliRandevu(null)
    setSeciliBosSaat(null)
    // Bekleyen "Bu seansa git" de düşer: kilit anında yolda olan hedef hafta
    // yanıtı (App `AnaEkran`'ı sökene kadarki gidiş-dönüşte) seansı açıp
    // danışan adını ekrana geri getirmesin (ölçen test:
    // `useTakvimAkisi.test.ts` > "7.4e").
    bekleyenSecimRef.current = null
    setGecisBekliyor(false)
  }, [])

  const yukle = useCallback(async () => {
    const istenen = haftaBasi.getTime()
    yuklemeSirasiRef.current += 1
    const buYukleme = yuklemeSirasiRef.current
    const gunler = haftaGunleri(haftaBasi)
    const baslangic = yerelZaman(gunler[0])
    const sonGun = gunler[6]
    const bitis = yerelZaman(new Date(
      sonGun.getFullYear(), sonGun.getMonth(), sonGun.getDate(), 23, 59,
    ))
    const okumaDamgasi = yazmaSaati.okumaBasladi()
    try {
      const sunucudan = await takvimApi.randevulariGetir(baslangic, bitis)
      // Hafta koruması (bkz. `gorunenHafta`): bu arada başka bir haftaya
      // geçildiyse yanıt ATILIR — liste de seçim de o haftanın yüklemesine ait.
      if (gorunenHafta.current !== istenen) return
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
      //
      // Ref aşağıdaki güncelleyiciyle AYNI kararı verir (seçim, ref'in
      // taşıdığı kimlikle aynı; listede yoksa kapanır).
      if (seciliIdRef.current !== null && !gelen.some((r) => r.id === seciliIdRef.current)) {
        seciliIdRef.current = null
      }
      setSeciliRandevu((secili) => {
        if (secili === null) return null
        return gelen.find((r) => r.id === secili.id) ?? null
      })
      // Bekleyen "Bu seansa git" (tasarım N8) BU haftanın yanıtıyla, hafta
      // korumasının ARKASINDA tüketilir: seçim beklerken dönen ESKİ bir
      // haftanın yanıtı hedefi orada bulamayıp geçişi bitirirdi (ölçen test:
      // `useTakvimAkisi.test.ts` > "7.4h") ve yalnızca geçişten SONRA başlamış
      // bir yüklemeyle ("7.4g", bkz. `ilkYukleme`). Seçim tazeleme
      // güncelleyicisinden SONRA — son yazan kazanır.
      const bekleyen = bekleyenSecimRef.current
      if (bekleyen !== null && buYukleme >= bekleyen.ilkYukleme) {
        bekleyenSecimRef.current = null
        setGecisBekliyor(false)
        const hedef = gelen.find((r) => r.id === bekleyen.id)
        // Listede yoksa (silinmiş) geçiş sessizce biter; ızgara görünür.
        if (hedef !== undefined) {
          seciliIdRef.current = hedef.id
          setSeciliBosSaat(null)
          setSeciliRandevu(hedef)
          setKaydirmaIstegi(hedef.id)
        }
      }
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
        //
        // Hafta korumasından ÖNCE ve koşulsuz: kilit hangi haftanın isteğinde
        // gelirse gelsin ekran boşalmalı.
        yetkisizRef.current()
      }
      // Eski bir haftanın hatası, görünen haftanın bandına yazılmaz.
      if (gorunenHafta.current !== istenen) return
      // Hedef haftanın KENDİ hatası bekleyen geçişi bitirir ("Seans
      // açılıyor…" sonsuza kadar kalmasın). Hafta korumasının ARKASINDA:
      // eski haftanın hatası, yolda olan hedef haftanın seçimini iptal
      // etmemeli (ölçen testler: `useTakvimAkisi.test.ts` > "7.4c", "7.4d").
      // Başarı dalıyla aynı sıra kuralı: geçişten önce başlamış bir yüklemenin
      // hatası da geçişi bitirmez.
      const bekleyen = bekleyenSecimRef.current
      if (bekleyen !== null && buYukleme >= bekleyen.ilkYukleme) {
        bekleyenSecimRef.current = null
        setGecisBekliyor(false)
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
  //
  // Son inceleme M8: hedef hafta görünen haftaysa state DEĞİŞMEZ (aynı nesne
  // döner, React render'ı atlar). Yeni bir `Date` — aynı an da olsa — `yukle`
  // kimliğini değiştirir ve efekt görünen haftayı boşuna yeniden isterdi
  // (ölçen test: `AnaEkran.test.tsx` > "R14 M8").
  function haftayaGit(tarih: Date) {
    const hedef = haftaninBasi(tarih)
    setHaftaBasi((onceki) => (onceki.getTime() === hedef.getTime() ? onceki : hedef))
  }

  /**
   * Bekleyen "Bu seansa git"i bırakır. Seçimi değiştiren HER kullanıcı eylemi
   * (`randevuSec`, `bosSaatSec`, `panelKapat`) çağırır: yolda olan hafta
   * yüklemesi kullanıcının daha YENİ seçimini hedefle ezmesin (düzeltme turu
   * 1; ölçen test: `useTakvimAkisi.test.ts` > "7.4f").
   */
  function bekleyeniBirak() {
    bekleyenSecimRef.current = null
    setGecisBekliyor(false)
  }

  function randevuSec(randevu: Randevu, secenek?: { kaydir?: boolean }) {
    bekleyeniBirak()
    setSeciliBosSaat(null)
    seciliIdRef.current = randevu.id
    setSeciliRandevu(randevu)
    // Kaydırma YALNIZCA kullanıcı seçiminde (tasarım A6); istek burada, sekme
    // yeniden monte olunca tekrar çalışmasın diye bileşenin DIŞINDA tutulur.
    if (secenek?.kaydir) setKaydirmaIstegi(randevu.id)
  }

  /**
   * "Bu seansa git" / önceki notlarda açık satıra ikinci tık (tasarım N8).
   * Önce açık seans KAPANIR: editörler unmount tahliyesiyle bekleyen
   * metni YAZAR (bugünkü seans değişimi kuralı) ve eski seansın notu yeni
   * seansın sayfasına bir kare bile sızmaz.
   *
   * Hedef görünen haftada ve listedeyse hemen seçilir (yeni istek yok);
   * değilse hedef hafta açılır ve seçim o haftanın yüklemesi dönünce yapılır
   * (bkz. `yukle`'deki bekleyen seçim bloğu). Aynı haftada ama listede
   * değilse görünen hafta yeniden yüklenir; hedef orada da yoksa geçiş
   * sessizce biter.
   */
  function randevuyaGit(id: number, baslangic: string) {
    const hedefHafta = haftaninBasi(zamandanDate(baslangic))
    const ayniHafta = hedefHafta.getTime() === haftaBasi.getTime()
    const listede = randevular.find((r) => r.id === id)
    if (ayniHafta && listede !== undefined) {
      randevuSec(listede, { kaydir: true })
      return
    }
    // Sıra ÖNEMLİ: `panelKapat` bekleyeni bırakır; bu geçişin bekleyeni
    // ONDAN SONRA kurulur. Onu tüketebilecek ilk yükleme bir sonraki
    // (aşağıdaki `yukle` ya da yeni haftanın efekti).
    panelKapat()
    bekleyenSecimRef.current = { id, ilkYukleme: yuklemeSirasiRef.current + 1 }
    setGecisBekliyor(true)
    if (ayniHafta) void yukle()
    else setHaftaBasi(hedefHafta)
  }

  /** Seans bölümü kaydırmayı uyguladı: istek tüketildi (bkz. `kaydirmaIstegi`). */
  function kaydirmaTamam() {
    setKaydirmaIstegi(null)
  }

  function bosSaatSec(zaman: string) {
    bekleyeniBirak()
    seciliIdRef.current = null
    setSeciliRandevu(null)
    setSeciliBosSaat(zaman)
  }

  function panelKapat() {
    bekleyeniBirak()
    seciliIdRef.current = null
    setSeciliRandevu(null)
    setSeciliBosSaat(null)
  }

  /**
   * Paneldeki kaydı yazar. Dönüş: düzenlemede (PUT) sunucunun yanıtı, yeni
   * kayıtta (POST) `null`.
   *
   * Plan A Görev 9 (tasarım A4): taşınan "geldi" seansı son temasını
   * ilerlettiyse PUT yanıtı `son_temas`/`saklama_bitis` taşır. `durumDegis`
   * ile AYNI karar: bu kanca yanıtı yalnızca YUKARI iletir; kartı ve saklama
   * listesini `AnaEkran.randevuKaydet` yamar (o iki önbellek bu kancada
   * değil).
   *
   * Plan A Görev 10 (tasarım A6): "Güncelle" seans bölümünü KAPATMAZ; yeni
   * randevunun "Kaydet"i bugünkü gibi kapatır.
   */
  async function kaydet(kayit: {
    client_id: number
    baslangic: string
    bitis: string
    ucret: number | null
    tekrar_sayisi?: number
  }): Promise<GuncellemeYaniti | null> {
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
        const yanit = await takvimApi.randevuGuncelle(seciliRandevu.id, {
          client_id: kayit.client_id,
          baslangic: kayit.baslangic,
          bitis: kayit.bitis,
          ucret: kayit.ucret,
        })
        setHata(null)
        // Tasarım A6: Güncelle seans bölümünü KAPATMAZ. Seçim yanıttaki taze
        // kayıtla yamanır (kimlik aynı: not/özel not efektleri yeniden
        // koşmaz, editör yeniden monte edilmez). Kayıt AÇIKÇA kuruluyor:
        // yanıtın `son_temas`/`saklama_bitis`i randevunun alanı değil (onları
        // `AnaEkran.randevuKaydet` tüketiyor).
        const randevu: Randevu = {
          id: yanit.id,
          client_id: yanit.client_id,
          danisan_adi: yanit.danisan_adi,
          baslangic: yanit.baslangic,
          bitis: yanit.bitis,
          durum: yanit.durum,
          ucret: yanit.ucret,
          odendi: yanit.odendi,
          seri_id: yanit.seri_id,
        }
        // Düzeltme turu 1 (kontrolör R11): ızgara PUT uçuştayken
        // tıklanabilir. Kullanıcı bu arada boş bir saate, başka bir randevuya
        // ya da "Takvime dön"e bastıysa yanıt O SEÇİMİ EZMEZ. Koşulsuz
        // yamada A geri seçiliyor, boş saat seçimi de yerinde kalıyordu: iki
        // form birden açılıyor ve "Yeni randevu"nun Kaydet'i A'yı yeni
        // saatin danışanına PUT ediyordu (A ve notu sessizce başka danışana).
        // Yama bu yüzden işlevsel ve kimlik koşullu; karar ÖNCEKİ render'ın
        // kapanışına değil, şu anki seçimi taşıyan `seciliIdRef`e soruluyor.
        const halaSecili = seciliIdRef.current === randevu.id
        setSeciliRandevu((secili) => (secili?.id === randevu.id ? randevu : secili))
        const yeniHafta = haftaninBasi(zamandanDate(randevu.baslangic))
        if (halaSecili && yeniHafta.getTime() !== haftaBasi.getTime()) {
          // Başka haftaya taşındı: eski kapanıştaki `yukle` ÇAĞRILMAZ (eski
          // haftayı yükler, taşınan randevuyu orada bulamaz ve seçimi
          // KAPATIRDI); yeni haftayı efekt yükler, seçim listede bulunduğu
          // için korunur. Seçim artık A değilse hafta ATLAMAZ: kullanıcı
          // başka bir şeye bakıyor.
          setHaftaBasi(yeniHafta)
        } else {
          // Aynı hafta ya da A artık seçili değil: görünen hafta tazelenir
          // (taşınan blok eski yerinde kalmasın); seçimi yalnızca listeyle
          // eşitler, A'yı geri SEÇMEZ.
          await yukle()
        }
        return yanit
      }
      await takvimApi.randevuOlustur(kayit)
      setHata(null)
      panelKapat()
      // Son inceleme I3: formda Tarih başka bir haftaya çekilmiş olabilir.
      // Eski kapanıştaki `yukle` GÖRÜNEN haftayı yükler; yeni kayıt orada
      // yok ve ekranda hiçbir yerde görünmüyordu. PUT dalıyla AYNI mekanizma:
      // o haftaya geçilir, `yukle` ÇAĞRILMAZ, yeni haftayı efekt yükler
      // (hafta koruması `gorunenHafta` render'da tazelenir). Serinin ilk
      // üyesi isteğin `baslangic`ı; sonraki üyeler zaten sonraki haftalarda.
      const yeniHafta = haftaninBasi(zamandanDate(kayit.baslangic))
      if (yeniHafta.getTime() !== haftaBasi.getTime()) {
        setHaftaBasi(yeniHafta)
      } else {
        await yukle()
      }
      return null
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
    // ayrışır. Plan 4 Görev 2'den beri bu satır YÜK TAŞIYOR: alt satır artık
    // `SeansSayfasi`'nin üst satırında yaşıyor (`SeansAltSatiri gomulu`) ve
    // seçili düğmeyi (`aria-pressed`) `randevu.durum`'dan okuyor; `key`
    // değişmediği için remount olmuyor — bu tazeleme olmasaydı "Geldi"ye
    // basınca vurgu eski düğmede kalırdı.
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
    oturumKapandi,
    haftaDegis,
    haftayaGit,
    randevuSec,
    randevuyaGit,
    gecisBekliyor,
    kaydirmaIstegi,
    kaydirmaTamam,
    bosSaatSec,
    panelKapat,
    kaydet,
    durumDegis,
    odemeDegis,
    sil,
    seriSil,
  }
}
