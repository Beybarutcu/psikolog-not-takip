import { useCallback, useEffect, useRef, useState } from 'react'
import { etiketApi, YetkisizHata, type Etiket, type EtiketliSeans } from '../../api'
import { etiketSirasi } from '../../etiket/etiketAdi'

/** Bir seansın etiket listesinin önbellekteki hâli. `liste === null && hata === null` = yükleniyor. */
export type SeansEtiketleri = { liste: Etiket[] | null; hata: string | null }

/** Açık "etiketli seanslar" paneli: hangi etiket, listesi, hatası. */
export type AcikEtiket = { etiket: Etiket; liste: EtiketliSeans[] | null; hata: string | null }

const YUKLENIYOR: SeansEtiketleri = { liste: null, hata: null }

/** Sözlük sırası — sunucunun `ORDER BY kullanim DESC, t.ad_anahtar ASC`'ı. */
function sozlukSirala(liste: Etiket[]): Etiket[] {
  return [...liste].sort((a, b) => b.kullanim - a.kullanim || etiketSirasi(a.ad, b.ad))
}

/** Seansın etiketleri — sunucunun `ORDER BY t.ad_anahtar ASC`'ı. */
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
 * Yayılım gereken iki alıcı başka önbelleklerde yaşıyor ve `AnaEkran`'ın
 * TEK yazma yolu onları besliyor (bkz. `AnaEkran.tsx` `etiketEkle` /
 * `etiketKaldir`):
 *
 *   - danışan dosyasının seans listesindeki satır (`useDanisanSeanslari.
 *     yamala`, `{ etiketler }` — uçuştaki liste okumasına karşı o kancanın
 *     `yazmaSaati`'ı),
 *   - sözlük ve açık etiketli seanslar paneli — ikisi de BU kancada
 *     (`eklendi`/`kaldirildi`).
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
 *     ODAKLANILDIĞINDA bir kez istenir (`sozlukIste`). Sunucu bu okumayı
 *     loglamıyor, ama öneri listesi terapist yazmaya başlamadan gerekmez ve
 *     "açılışta istek yok" kuralını tek istisnasız tutmak, hangi isteğin
 *     loglandığını hatırlamaktan daha az kırılgan.
 *   - Etiketli seanslar YALNIZCA bir çipe tıklanınca (`etiketAc`, olay
 *     işleyicisinde — efekt değil, yeniden montaj tekrarlatamaz).
 *
 * # Uçuştaki yazma × sözlük okuması
 *
 * Sözlük kutuya odaklanınca istenir ve terapist hemen yazıp Enter'a basarsa
 * ekleme, sözlük okumasından ÖNCE bitebilir; okuma sunucuda yazmadan önce
 * yapıldıysa yanıt yeni etiketi içermez. `yazmaSaati`'ndeki mantıksal saatin
 * aynısı, ama satır YAMALAMAK yetmediği için (ekleme yeni satır doğurur,
 * kaldırma satır siler) yazmanın kendisi bir İŞLEM olarak tutuluyor: yanıt
 * geldiğinde okuma başladıktan SONRA biten işlemler yanıtın üstüne yeniden
 * uygulanır.
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
  // Sözlük okuması uçuşta mı (odak her seferinde `sozlukIste` çağırıyor;
  // aynı okuma ikinci kez başlamasın).
  const sozlukIstendiRef = useRef(false)
  // Mantıksal saat + okuma başladıktan sonra biten işlemler (bkz. modül
  // başlığı "Uçuştaki yazma × sözlük okuması").
  const saatRef = useRef(0)
  const sozlukIslemleriRef = useRef<{ damga: number; uygula: (l: Etiket[]) => Etiket[] }[]>([])
  // Etiketli seanslar panelinde yalnızca SON istek yazar.
  const acikIstekRef = useRef(0)

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
    sozlukIslemleriRef.current = []
    onbellekRef.current = new Map()
    setOnbellek(onbellekRef.current)
    setSozluk(null)
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

  /** Etiket kutusuna odaklanıldı: sözlüğü (henüz yoksa) BİR KEZ iste. */
  const sozlukIste = useCallback(() => {
    if (sozlukIstendiRef.current) return
    sozlukIstendiRef.current = true
    const nesil = nesilRef.current
    const okumaDamgasi = ++saatRef.current
    etiketApi.etiketleriGetir().then(
      (gelen) => {
        if (nesil !== nesilRef.current) return
        const sonrakiler = sozlukIslemleriRef.current.filter((i) => i.damga > okumaDamgasi)
        // Tek okuma yapılıyor (`sozlukIstendiRef`); yanıt işlendikten sonra
        // bekleyen işlemlere gerek kalmadı — sonraki yazmalar doğrudan
        // yüklü sözlüğe uygulanır.
        sozlukIslemleriRef.current = []
        setSozluk(sozlukSirala(sonrakiler.reduce((l, i) => i.uygula(l), gelen)))
      },
      (e: unknown) => {
        if (nesil !== nesilRef.current) return
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

  /** Sözlüğe bir yazma işlemi uygular ve uçuştaki okuma için saate işler. */
  const sozlukIslemi = useCallback((uygula: (l: Etiket[]) => Etiket[]) => {
    sozlukIslemleriRef.current.push({ damga: ++saatRef.current, uygula })
    setSozluk((onceki) => (onceki === null ? null : sozlukSirala(uygula(onceki))))
  }, [])

  const acikYukle = useCallback(
    (etiket: Etiket) => {
      const istek = ++acikIstekRef.current
      const nesil = nesilRef.current
      etiketApi.etiketliSeanslar(etiket.id).then(
        (liste) => {
          if (nesil !== nesilRef.current || istek !== acikIstekRef.current) return
          const simdiki = acikRef.current
          if (simdiki === null || simdiki.etiket.id !== etiket.id) return
          acikYaz({ ...simdiki, liste, hata: null })
        },
        (e: unknown) => {
          if (nesil !== nesilRef.current || istek !== acikIstekRef.current) return
          if (e instanceof YetkisizHata) {
            yetkisiz()
            return
          }
          const simdiki = acikRef.current
          if (simdiki === null || simdiki.etiket.id !== etiket.id) return
          acikYaz({
            ...simdiki,
            hata: e instanceof Error ? e.message : 'Seanslar yüklenemedi.',
          })
        },
      )
    },
    [acikYaz, yetkisiz],
  )

  /** Bir çipe tıklandı: o etiketi taşıyan seansları göster (TEK istek). */
  const etiketAc = useCallback(
    (etiket: Etiket) => {
      acikYaz({ etiket, liste: null, hata: null })
      acikYukle(etiket)
    },
    [acikYaz, acikYukle],
  )

  const etiketKapat = useCallback(() => {
    acikIstekRef.current += 1
    acikYaz(null)
  }, [acikYaz])

  const acikYenidenDene = useCallback(() => {
    const simdiki = acikRef.current
    if (simdiki === null) return
    acikYaz({ ...simdiki, liste: null, hata: null })
    acikYukle(simdiki.etiket)
  }, [acikYaz, acikYukle])

  /**
   * Başarılı bir eklemenin sonucunu bu kancanın üç alıcısına işler ve
   * seansın YENİ ad listesini döndürür (çağıran onu dosya listesine yayar).
   * Seansın listesi önbellekte yüklü değilse `null` — pratikte ulaşılamaz:
   * ekleme kutusu yalnızca liste yüklüyken çizilir (`EtiketSatiri`).
   *
   * Aynı etiket zaten bağlıysa (sunucu idempotent, aynı kimliği döner)
   * hiçbir şey değişmez — sözlüğün kullanım sayısı da.
   */
  const eklendi = useCallback(
    (appointmentId: number, etiket: Etiket): string[] | null => {
      const girdi = onbellekRef.current.get(appointmentId)
      if (girdi?.liste == null) return null
      if (girdi.liste.some((e) => e.id === etiket.id)) return girdi.liste.map((e) => e.ad)
      const yeniListe = adaGoreSirala([...girdi.liste, etiket])
      onbellekYaz((m) => m.set(appointmentId, { liste: yeniListe, hata: null }))
      // Sözlük: sunucunun döndürdüğü `kullanim` yazmadan SONRAKİ kesin
      // değer; yeni etiketse satır eklenir.
      sozlukIslemi((l) =>
        l.some((e) => e.id === etiket.id)
          ? l.map((e) => (e.id === etiket.id ? { ...e, kullanim: etiket.kullanim } : e))
          : [...l, etiket],
      )
      // Açık panel BU etiketinse yeni seans listeye girmeli; satırın
      // alanları (danışan adı, saat) elde değil, panel tek istekle tazelenir
      // (panel ekranda: terapistin baktığı şey).
      if (acikRef.current?.etiket.id === etiket.id) acikYukle(acikRef.current.etiket)
      return yeniListe.map((e) => e.ad)
    },
    [onbellekYaz, sozlukIslemi, acikYukle],
  )

  /** Başarılı bir kaldırmanın sonucu; dönüş `eklendi` ile aynı sözleşme. */
  const kaldirildi = useCallback(
    (appointmentId: number, etiket: Etiket): string[] | null => {
      const girdi = onbellekRef.current.get(appointmentId)
      if (girdi?.liste == null) return null
      const yeniListe = girdi.liste.filter((e) => e.id !== etiket.id)
      onbellekYaz((m) => m.set(appointmentId, { liste: yeniListe, hata: null }))
      // Sözlük: kullanım bir azalır; sıfıra düşen etiketi sunucudaki
      // tetikleyici (`progress_note_tags_temizle_kullanilmayan`) sildi,
      // burada da düşer.
      sozlukIslemi((l) =>
        l
          .map((e) => (e.id === etiket.id ? { ...e, kullanim: e.kullanim - 1 } : e))
          .filter((e) => e.kullanim > 0),
      )
      const simdiki = acikRef.current
      if (simdiki !== null && simdiki.etiket.id === etiket.id && simdiki.liste !== null) {
        acikYaz({
          ...simdiki,
          liste: simdiki.liste.filter((s) => s.appointment_id !== appointmentId),
        })
      }
      return yeniListe.map((e) => e.ad)
    },
    [onbellekYaz, sozlukIslemi, acikYaz],
  )

  const seansDurumu = useCallback(
    (appointmentId: number): SeansEtiketleri => onbellek.get(appointmentId) ?? YUKLENIYOR,
    [onbellek],
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
    eklendi,
    kaldirildi,
    temizle,
    yetkisiz,
  }
}
