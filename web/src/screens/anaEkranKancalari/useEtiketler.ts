import { useCallback, useEffect, useRef, useState } from 'react'
import { etiketApi, IstekHatasi, YetkisizHata, type Etiket, type EtiketliSeans } from '../../api'
import { ayniEtiket, etiketAnahtari, etiketSirasi } from '../../etiket/etiketAdi'

/** Bir seansın etiket listesinin önbellekteki hâli. `liste === null && hata === null` = yükleniyor. */
export type SeansEtiketleri = { liste: Etiket[] | null; hata: string | null }

/** Açık "etiketli seanslar" paneli: hangi etiket, listesi, hatası. */
export type AcikEtiket = { etiket: Etiket; liste: EtiketliSeans[] | null; hata: string | null }

const YUKLENIYOR: SeansEtiketleri = { liste: null, hata: null }

/** Seansın etiketleri — sunucunun sırası (`etiketSirasi`, Türkçe alfabe). */
function adaGoreSirala(liste: Etiket[]): Etiket[] {
  return [...liste].sort((a, b) => etiketSirasi(a.ad, b.ad))
}

/**
 * Etiket akışı (Plan 6 Görev 6): seansların etiketleri, etiket sözlüğü ve
 * açık "etiketli seanslar" paneli.
 *
 * # Seansın etiketleri TEK önbellekte, iki ekran AYNI yere bakar
 *
 * Plan 5'in son incelemesindeki iki Critical (C1/C2) aynı sınıftandı: takvim
 * seans paneli ile danışan dosyası aynı seansa İKİ AYRI önbellekten
 * bakıyordu. Notta bu, iki kancanın (`useSeansNotlari`, `useDosyaNotu`)
 * zaten var olması yüzünden yayılımla çözüldü. Etiketler için sıfırdan
 * kuruluyor, dolayısıyla daha güçlü çözüm seçilebildi: seansın etiket
 * listesi randevu kimliğiyle anahtarlanmış TEK bir haritada (`onbellek`) ve
 * takvim paneli de dosya da `seansDurumu(id)` ile AYNI girdiyi okuyor.
 * "Takvimde eklenen etiket dosyada görünür mü" sorusu burada yapısal olarak
 * yok: iki ayrı kopya yok ki biri bayat kalsın.
 *
 * Yayılım gereken diğer alıcılar (bkz. `AnaEkran.tsx` `etiketEkle` /
 * `etiketKaldir`):
 *
 *   - danışan dosyasının seans listesindeki satır (`useDanisanSeanslari.
 *     yamala`, `{ etiketler }` — uçuştaki liste okumasına karşı o kancanın
 *     `yazmaSaati`'ı),
 *   - sözlük ve açık etiketli seanslar paneli — ikisi de BU kancada
 *     (`eklendi`/`kaldirildi`).
 *
 * # Etiket KİMLİĞİ tek başına kalıcı kimlik sayılmaz (inceleme IMPORTANT-1)
 *
 * Kullanımı sıfıra düşen etiket sunucuda tetikleyiciyle SİLİNİYOR; şema
 * artık `AUTOINCREMENT` ile kimliği yeniden vermiyor (`schema.rs` V5), ama
 * istemci bunu varsaymıyor: iki etiket nesnesi yalnızca kimlik VE Türkçe
 * küçük harfli ad anahtarı aynıysa aynı sayılır (`ayniEtiket`). Aksi hâlde
 * "kriz" paneli açıkken kimliği yeniden alan "öfke" eklendiğinde panel
 * "kriz" başlığının altında bütün danışanların "öfke" seanslarını
 * gösterirdi.
 *
 * # Geciken yanıt yeni seçimi EZMEZ: yanıt İSTENEN kimliğe yazılır
 *
 * `useDanisanSeanslari`'daki "yanıt hangi kimliğe ait olduğuyla tutulur"
 * deseninin harita hâli: seans A'nın geç dönen yanıtı `onbellek[A]`'ya
 * yazılır, o an görünen seans B'ye DEĞİL. Ölçen test:
 * `AnaEkran.yayilim.test.tsx` > "geciken yanıt yeni seçimi EZMEZ".
 *
 * # İstek zamanlaması: terapistin bakmadığı şey için istek YOK
 *
 * Sunucu `seans_etiketleri`ni ve `etiketli_seanslar`'ı silinemez bir
 * `goruntuleme` satırı olarak yazıyor (5 dk birleştirmeli). Bu yüzden:
 *
 *   - Seansın etiketleri YALNIZCA o seans bir panelde GÖRÜNÜRKEN istenir
 *     (`gorunenSeansId`, `AnaEkran` hesaplıyor: Takvim sekmesinde açık
 *     seans paneli, ya da Danışanlar > Seanslar'da seçili seans). Önbellekte
 *     olan bir seans (başarı ya da hata) YENİDEN istenmez — sekme gidip
 *     gelince, panel yeniden monte olunca yeni istek yok; önbelleği tek
 *     yazma yolu taze tutuyor. Hata yalnızca `yenidenDene` ile yeniden
 *     denenir.
 *   - Sözlük (`GET /api/etiketler`) açılışta DEĞİL, etiket kutusuna ilk
 *     ODAKLANILDIĞINDA istenir (`sozlukIste`).
 *   - Etiketli seanslar YALNIZCA bir çipe tıklanınca (`etiketAc`, olay
 *     işleyicisinde — efekt değil, yeniden montaj tekrarlatamaz).
 *
 * # Sözlük yerelde YAMANMAZ, yazmadan sonra yeniden OKUNUR (inceleme M1)
 *
 * İlk sürüm sözlüğü yerelde yamıyor ve uçuştaki okumaya karşı bir işlem
 * kaydı tutuyordu. Kaldırma bir FARK (kullanım −1) olarak kaydedildiği için
 * sunucuda okumadan ÖNCE işlenip yanıtı SONRA dönen bir DELETE iki kez
 * uygulanıyor, etiket öneriden kayboluyordu; kaldırmanın kesin sayısı (204,
 * gövde yok) elde olmadığı için farkı güvenle uygulamanın yolu yok. Sözlük
 * okuması sunucuda DENETİME YAZILMIYOR (`tags::etiketleri_listele`), dolayısıyla
 * doğru ve basit çözüm: sözlük bir kez istendiyse her başarılı yazmadan sonra
 * yeniden okunur ve yalnızca EN SON okumanın yanıtı yazılır. Her yeniden okuma
 * yazma BİTTİKTEN sonra başladığı için o yazmayı içerir; daha eski
 * okumaların yanıtları sıra numarasıyla düşer. Sözlük bu yüzden her zaman
 * sunucunun kendi değeridir — kimlik yeniden kullanımı da sözlükte bir
 * eşleme hatası üretemez.
 *
 * # Açık panel × uçuştaki okuma (inceleme M2)
 *
 * Panel yüklenirken bir seanstan o etiket kaldırılırsa, kaldırmadan önce
 * sunucuda okunmuş yanıt o seansı hâlâ içerir. Panel açıldığından beri bu
 * etiketin kaldırıldığı seanslar (`acikKaldirilanlar`) her yanıttan süzülür;
 * aynı seansa etiket yeniden eklenirse kayıttan çıkar ve panel yeniden
 * okunur.
 *
 * # Takvimin randevu yazmaları paneli tazeler (son inceleme I1)
 *
 * Panelin satırları (danışan adı, saat) etiket bağından değil RANDEVUDAN
 * geliyor: takvimde bir randevunun saati değişir, başka danışana taşınır ya
 * da silinirse (tekil ya da seri) açık panel eski saati / eski danışanı /
 * artık olmayan seansı gösterirdi — ve silinmiş satıra tıklanınca
 * `danisanaGit` o seansı bulamaz, dosyada varsayılan seansı seçerdi. Yazma
 * sonucunun hangi satırları etkilediği yerelde bilinmiyor (seri silme
 * görünen haftanın ötesine uzanır), bu yüzden `AnaEkran` her BAŞARILI
 * randevu yazmasından sonra `randevularDegisti`'yi çağırır:
 *
 *   - panel AÇIKSA tek istekle yeniden okunur (panel ekranda, yani terapistin
 *     baktığı şey — silinemez görüntüleme satırı bir bakışa karşılık gelir),
 *     panel KAPALIYSA hiçbir istek atılmaz;
 *   - sözlük bu oturumda istendiyse yeniden okunur (silinen randevu bir
 *     etiketin son kullanımıysa etiket sunucuda silinmiştir; sözlük hiç
 *     istenmediyse istek yok).
 *
 * Panelin etiketi silinmişse (son seansı silindi) yeniden okuma 404 döner:
 * bu hata değil, "bu etiketi taşıyan seans kalmadı"nın ta kendisi — boş
 * liste olarak gösterilir.
 *
 * # Aynı ADLA yeniden doğan etiket paneli taşır (son inceleme I1 yan durumu)
 *
 * Panelin etiketinin son bağı kaldırılır (sunucu etiketi siler) ve AYNI ad
 * yeniden eklenirse etiket YENİ bir kimlik alır (`AUTOINCREMENT`).
 * `ayniEtiket` kimlik VE ad ister — bu kural kimliğin yeniden kullanıldığı
 * durumda ("kriz"in eski kimliğini alan "öfke") paneli yanlış etikete
 * kaydırmamak içindi ve bozulmadı. Burada durum tersi: kimlik farklı, ad
 * anahtarı AYNI. Ad anahtarı sunucuda benzersiz (`tags.ad_anahtar UNIQUE`),
 * yani aynı anahtarlı iki etiket aynı anda var olamaz; farklı kimlikle
 * gelen aynı anahtar ancak "panelin etiketi silinip yeniden doğdu"
 * demektir ve aynı ad terapist için aynı anlamdır. Panel yeni kimliğe
 * taşınır ve yeniden okunur; yoksa "Bu etiketi taşıyan seans kalmadı"
 * demeye devam ederdi.
 *
 * # Yazma hataları seansa bağlı tutulur (inceleme M6)
 *
 * Enter'dan sonra seans değişir ve POST reddedilirse, hatayı gösterecek
 * `EtiketSatiri` artık monte değildir (seans kimliğiyle `key`li). Hata bu
 * yüzden bileşende değil burada, SEANS KİMLİĞİYLE tutulur
 * (`yazmaHatalari`): terapist o seansa döndüğünde görür; başka bir seansın
 * satırında görünmez (hangi seansa ait olduğu belirsiz bir genel bildirim
 * yerine bu seçildi: "eklenemedi" mesajı ancak ilgili seansın yanında
 * anlamlı). Aynı seansa başarılı bir yazma ya da kutuya yazmaya başlamak onu
 * temizler.
 *
 * # 401: bütün etiket state'i temizlenir (`temizle`)
 *
 * Açık etiketli seanslar paneli BÜTÜN danışanların adlarını taşıyor ve
 * takvim seçiminden bağımsız (`AnaEkran`'da, sekme panellerinin dışında):
 * takvim seçimini kapatmak onu kapatmaz. Bu yüzden her 401 yolu (`AnaEkran`
 * bağlıyor) `temizle`'yi de çağırır; bu kancanın kendi istekleri 401 alınca
 * hem `temizle` hem `onYetkisiz` çalışır. Temizlikten önce başlamış bir
 * isteğin geç yanıtı `nesil` sayacıyla düşürülür — kilitten sonra eski
 * oturumun verisi geri gelmesin.
 */
export function useEtiketler({
  gorunenSeansId,
  onYetkisiz,
}: {
  gorunenSeansId: number | null
  onYetkisiz: () => void
}) {
  const [onbellek, setOnbellek] = useState<ReadonlyMap<number, SeansEtiketleri>>(() => new Map())
  const [sozluk, setSozluk] = useState<Etiket[] | null>(null)
  const [acik, setAcik] = useState<AcikEtiket | null>(null)
  const [yazmaHatalari, setYazmaHatalari] = useState<ReadonlyMap<number, string>>(
    () => new Map(),
  )
  const [tazeleme, setTazeleme] = useState(0)

  // Ref aynaları: yazma sonucu bir `await`in ARDINDAN işleniyor ve o an
  // elimizdeki render birkaç kare eski olabilir (`useDanisanSeanslari.
  // yamala` ile aynı gerekçe). Her güncelleme ref'i ve state'i BİRLİKTE
  // değiştirir; render state'i okur, hesaplama ref'i.
  const onbellekRef = useRef(onbellek)
  const acikRef = useRef(acik)
  const yetkisizRef = useRef(onYetkisiz)
  yetkisizRef.current = onYetkisiz

  // 401 temizliği her seferinde artırır; eski nesilden dönen yanıtlar
  // düşürülür (bkz. modül başlığı).
  const nesilRef = useRef(0)
  // Sözlük bu oturumda istendi mi (odak her seferinde `sozlukIste`
  // çağırıyor; yeniden okuma yalnızca yazmadan sonra).
  const sozlukIstendiRef = useRef(false)
  // Sözlükte yalnızca SON okuma yazar (bkz. modül başlığı "M1").
  const sozlukIstekRef = useRef(0)
  // Etiketli seanslar panelinde yalnızca SON istek yazar.
  const acikIstekRef = useRef(0)
  // Panel açıldığından beri bu etiketin kaldırıldığı seanslar (bkz. "M2").
  const acikKaldirilanlarRef = useRef(new Set<number>())

  const onbellekYaz = useCallback((guncelle: (m: Map<number, SeansEtiketleri>) => void) => {
    const yeni = new Map(onbellekRef.current)
    guncelle(yeni)
    onbellekRef.current = yeni
    setOnbellek(yeni)
  }, [])

  const acikYaz = useCallback((yeni: AcikEtiket | null) => {
    acikRef.current = yeni
    setAcik(yeni)
  }, [])

  const temizle = useCallback(() => {
    nesilRef.current += 1
    sozlukIstendiRef.current = false
    onbellekRef.current = new Map()
    setOnbellek(onbellekRef.current)
    setSozluk(null)
    setYazmaHatalari(new Map())
    acikKaldirilanlarRef.current = new Set()
    acikYaz(null)
  }, [acikYaz])

  /** Bu kancanın kendi isteklerinde 401: temizle + takvim seçimini kapat. */
  const yetkisiz = useCallback(() => {
    temizle()
    yetkisizRef.current()
  }, [temizle])

  // Seansın etiketleri: YALNIZCA görünürken ve önbellekte yoksa.
  useEffect(() => {
    if (gorunenSeansId === null) return
    if (onbellekRef.current.has(gorunenSeansId)) return
    // Yanıt İSTENEN kimliğe yazılır — o an görünen seansa değil (bkz.
    // modül başlığı "Geciken yanıt").
    const buId = gorunenSeansId
    const nesil = nesilRef.current
    onbellekYaz((m) => m.set(buId, YUKLENIYOR))
    etiketApi.seansEtiketleri(buId).then(
      (liste) => {
        if (nesil !== nesilRef.current) return
        onbellekYaz((m) => m.set(buId, { liste, hata: null }))
      },
      (e: unknown) => {
        if (nesil !== nesilRef.current) return
        if (e instanceof YetkisizHata) {
          yetkisiz()
          return
        }
        onbellekYaz((m) =>
          m.set(buId, {
            liste: null,
            hata: e instanceof Error ? e.message : 'Etiketler yüklenemedi.',
          }),
        )
      },
    )
  }, [gorunenSeansId, tazeleme, onbellekYaz, yetkisiz])

  /** Sözlüğü okur; yalnızca EN SON okumanın yanıtı yazılır. */
  const sozlukYukle = useCallback(() => {
    const istek = ++sozlukIstekRef.current
    const nesil = nesilRef.current
    etiketApi.etiketleriGetir().then(
      (gelen) => {
        if (nesil !== nesilRef.current || istek !== sozlukIstekRef.current) return
        setSozluk(gelen)
      },
      (e: unknown) => {
        if (nesil !== nesilRef.current || istek !== sozlukIstekRef.current) return
        if (e instanceof YetkisizHata) {
          yetkisiz()
          return
        }
        // Öneri listesi bir kolaylık: hata ekranda gösterilmez (kutu
        // önerisiz çalışmaya devam eder), bir SONRAKİ odakta yeniden denenir.
        sozlukIstendiRef.current = false
      },
    )
  }, [yetkisiz])

  /** Etiket kutusuna odaklanıldı: sözlüğü (henüz istenmediyse) iste. */
  const sozlukIste = useCallback(() => {
    if (sozlukIstendiRef.current) return
    sozlukIstendiRef.current = true
    sozlukYukle()
  }, [sozlukYukle])

  /** Başarılı bir yazmadan sonra: sözlük istendiyse sunucudan yeniden oku. */
  const sozlukTazele = useCallback(() => {
    if (sozlukIstendiRef.current) sozlukYukle()
  }, [sozlukYukle])

  const acikYukle = useCallback(
    (etiket: Etiket) => {
      const istek = ++acikIstekRef.current
      const nesil = nesilRef.current
      const ayniPanel = () => {
        const simdiki = acikRef.current
        return nesil === nesilRef.current &&
          istek === acikIstekRef.current &&
          simdiki !== null &&
          ayniEtiket(simdiki.etiket, etiket)
          ? simdiki
          : null
      }
      const listeYaz = (liste: EtiketliSeans[]) => {
        const simdiki = ayniPanel()
        if (simdiki === null) return
        // M2: okuma sunucuda kaldırmadan ÖNCE yapılmış olabilir.
        const kaldirilanlar = acikKaldirilanlarRef.current
        acikYaz({
          ...simdiki,
          liste: liste.filter((s) => !kaldirilanlar.has(s.appointment_id)),
          hata: null,
        })
      }
      etiketApi.etiketliSeanslar(etiket.id).then(listeYaz, (e: unknown) => {
          if (nesil !== nesilRef.current || istek !== acikIstekRef.current) return
          if (e instanceof YetkisizHata) {
            yetkisiz()
            return
          }
          // 404: etiket sunucuda yok — son seansı silindi (bkz. modül
          // başlığı "Takvimin randevu yazmaları"). Seans kalmadı demektir.
          if (e instanceof IstekHatasi && e.durum === 404) {
            listeYaz([])
            return
          }
          const simdiki = ayniPanel()
          if (simdiki === null) return
          acikYaz({
            ...simdiki,
            hata: e instanceof Error ? e.message : 'Seanslar yüklenemedi.',
          })
        })
    },
    [acikYaz, yetkisiz],
  )

  /** Bir çipe tıklandı: o etiketi taşıyan seansları göster (TEK istek). */
  const etiketAc = useCallback(
    (etiket: Etiket) => {
      acikKaldirilanlarRef.current = new Set()
      acikYaz({ etiket, liste: null, hata: null })
      acikYukle(etiket)
    },
    [acikYaz, acikYukle],
  )

  const etiketKapat = useCallback(() => {
    acikIstekRef.current += 1
    acikKaldirilanlarRef.current = new Set()
    acikYaz(null)
  }, [acikYaz])

  const acikYenidenDene = useCallback(() => {
    const simdiki = acikRef.current
    if (simdiki === null) return
    acikYaz({ ...simdiki, liste: null, hata: null })
    acikYukle(simdiki.etiket)
  }, [acikYaz, acikYukle])

  /**
   * Takvimde bir randevu yazması (kaydet, sil, seri sil) BAŞARILI oldu (bkz.
   * modül başlığı "Takvimin randevu yazmaları"): açık panel tek istekle
   * yeniden okunur — liste boşaltılmadan, eski satırlar yanıt gelene kadar
   * durur; panel kapalıysa istek YOK. Sözlük istendiyse tazelenir.
   */
  const randevularDegisti = useCallback(() => {
    sozlukTazele()
    const simdiki = acikRef.current
    if (simdiki === null) return
    acikYukle(simdiki.etiket)
  }, [sozlukTazele, acikYukle])

  const yazmaHatasiKaydet = useCallback((appointmentId: number, mesaj: string | null) => {
    setYazmaHatalari((onceki) => {
      if (mesaj === null && !onceki.has(appointmentId)) return onceki
      const yeni = new Map(onceki)
      if (mesaj === null) yeni.delete(appointmentId)
      else yeni.set(appointmentId, mesaj)
      return yeni
    })
  }, [])

  /**
   * Başarılı bir eklemenin sonucunu bu kancanın alıcılarına işler ve
   * seansın YENİ ad listesini döndürür (çağıran onu dosya listesine yayar).
   * Seansın listesi önbellekte yüklü değilse `null` — pratikte ulaşılamaz:
   * ekleme kutusu yalnızca liste yüklüyken çizilir (`EtiketSatiri`).
   *
   * Aynı etiket zaten bağlıysa (sunucu idempotent, aynı etiketi döner) seansın
   * listesi değişmez.
   */
  const eklendi = useCallback(
    (appointmentId: number, etiket: Etiket): string[] | null => {
      yazmaHatasiKaydet(appointmentId, null)
      sozlukTazele()
      const girdi = onbellekRef.current.get(appointmentId)
      if (girdi?.liste == null) return null
      const yeniListe = girdi.liste.some((e) => ayniEtiket(e, etiket))
        ? girdi.liste
        : adaGoreSirala([...girdi.liste.filter((e) => e.id !== etiket.id), etiket])
      onbellekYaz((m) => m.set(appointmentId, { liste: yeniListe, hata: null }))
      // Açık panel BU etiketinse yeni seans listeye girmeli; satırın
      // alanları (danışan adı, saat) elde değil, panel tek istekle tazelenir
      // (panel ekranda: terapistin baktığı şey). Karşılaştırma kimlik + ad
      // anahtarı (bkz. modül başlığı IMPORTANT-1).
      const simdiki = acikRef.current
      if (simdiki !== null && ayniEtiket(simdiki.etiket, etiket)) {
        acikKaldirilanlarRef.current.delete(appointmentId)
        acikYukle(simdiki.etiket)
      } else if (
        simdiki !== null &&
        simdiki.etiket.id !== etiket.id &&
        etiketAnahtari(simdiki.etiket.ad) === etiketAnahtari(etiket.ad)
      ) {
        // Panelin etiketi silinip AYNI adla yeniden doğdu (bkz. modül
        // başlığı): kimlik yeni kimliğe taşınır. Eski kimliğin kaldırma
        // kaydı yeni etikete ait değil — yeni etiketin bağları ancak
        // doğduktan sonra kuruldu.
        acikKaldirilanlarRef.current = new Set()
        acikYaz({ ...simdiki, etiket })
        acikYukle(etiket)
      }
      return yeniListe.map((e) => e.ad)
    },
    [onbellekYaz, sozlukTazele, acikYukle, yazmaHatasiKaydet],
  )

  /** Başarılı bir kaldırmanın sonucu; dönüş `eklendi` ile aynı sözleşme. */
  const kaldirildi = useCallback(
    (appointmentId: number, etiket: Etiket): string[] | null => {
      yazmaHatasiKaydet(appointmentId, null)
      sozlukTazele()
      const simdiki = acikRef.current
      if (simdiki !== null && ayniEtiket(simdiki.etiket, etiket)) {
        acikKaldirilanlarRef.current.add(appointmentId)
        if (simdiki.liste !== null) {
          acikYaz({
            ...simdiki,
            liste: simdiki.liste.filter((s) => s.appointment_id !== appointmentId),
          })
        }
      }
      const girdi = onbellekRef.current.get(appointmentId)
      if (girdi?.liste == null) return null
      const yeniListe = girdi.liste.filter((e) => !ayniEtiket(e, etiket))
      onbellekYaz((m) => m.set(appointmentId, { liste: yeniListe, hata: null }))
      return yeniListe.map((e) => e.ad)
    },
    [onbellekYaz, sozlukTazele, acikYaz, yazmaHatasiKaydet],
  )

  const seansDurumu = useCallback(
    (appointmentId: number): SeansEtiketleri => onbellek.get(appointmentId) ?? YUKLENIYOR,
    [onbellek],
  )

  const yazmaHatasi = useCallback(
    (appointmentId: number): string | null => yazmaHatalari.get(appointmentId) ?? null,
    [yazmaHatalari],
  )

  /** Yüklenemeyen bir seansın etiketlerini yeniden dene. */
  const yenidenDene = useCallback(
    (appointmentId: number) => {
      onbellekYaz((m) => m.delete(appointmentId))
      setTazeleme((n) => n + 1)
    },
    [onbellekYaz],
  )

  return {
    seansDurumu,
    yenidenDene,
    sozluk,
    sozlukIste,
    acik,
    etiketAc,
    etiketKapat,
    acikYenidenDene,
    randevularDegisti,
    eklendi,
    kaldirildi,
    yazmaHatasi,
    yazmaHatasiKaydet,
    temizle,
    yetkisiz,
  }
}
