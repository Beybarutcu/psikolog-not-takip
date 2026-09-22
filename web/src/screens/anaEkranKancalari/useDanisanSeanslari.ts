import { useCallback, useEffect, useRef, useState } from 'react'
import { danisanApi, YetkisizHata, type DanisanSeansi } from '../../api'
import { varsayilanSeans } from '../../danisan/seansSecimi'
import { yerelZaman } from '../../takvim/hafta'
import { yazmaSaatiOlustur } from './yazmaSaati'

/**
 * Seans listesine yerelde yamanabilen alanlar: durum ve ödeme (alt satırdan),
 * not önizlemesi (not kaydından sonra) ve etiket adları (etiket
 * ekleme/kaldırmadan sonra — Plan 6 Görev 6; değer seansın TAM, sıralı yeni
 * listesi, fark değil: uçuştaki okumanın bayat listesinin üstüne aynen
 * uygulanabilsin diye). Hepsinin sonucu yazma başarılı olunca KESİN
 * biliniyor — listeyi yeniden çekmek silinemez bir `goruntuleme` satırı daha
 * demek olurdu.
 */
export type SeansYamasi = Partial<
  Pick<DanisanSeansi, 'durum' | 'odendi' | 'not_ilk_satiri' | 'etiketler'>
>

/**
 * Bir isteğin yanıtı, HANGİ danışana ait olduğuyla birlikte. `varsayilan`
 * yanıt GELDİĞİ ANDA hesaplanır (bkz. `seciliSeansId`).
 */
type SeansDurumu = {
  id: number
  liste: DanisanSeansi[]
  hata: string | null
  varsayilan: number | null
  /** Bu yanıtı getiren okumanın `saat` damgası (bkz. "Bayatlık"). */
  damga: number
}

/** Elle (ya da takvimden gelirken) seçilen seans, HANGİ danışan için seçildiğiyle. */
type Secim = { clientId: number; seansId: number }

/**
 * Seçili danışanın seans listesi akışı (Plan 5 Görev 5; son inceleme C2, I3,
 * I4, M1).
 *
 * # Yanıt HANGİ danışana ait olduğuyla tutulur
 *
 * Desen `useDanisanDosyasi` ile BİREBİR AYNI: yanıt `SeansDurumu.id` ile
 * tutulur ve ekrana giden liste RENDER SIRASINDA türetilir — `durum.id ===
 * clientId` değilse boş dizi. Bu satır kancanın "geciken yanıt" savunması:
 * `.then` yanıtı koşulsuz yazar, stale bir yanıt state'e girse bile ekrana
 * asla sızmaz çünkü o anda `clientId` zaten değişmiş olur. Plan 3'te AYNI
 * SINIF hata gerçekten oldu (bir danışanın notu başka danışanın dosyasında).
 * Ölçen test: `DanisanlarSekmesi.test.tsx` > "geciken yanıt yeni seçimin
 * listesini ezmez".
 *
 * # Yamalar BURADA (son inceleme C2)
 *
 * Eskiden durum/ödeme yaması `DanisanDosyasi`'nin yerel `yamalar` state'inde
 * yaşıyordu: bileşen unmount olunca (Takvim'e gidip gelince) kayboluyor,
 * takvimden yapılan yazmalar ise bu listeye hiç ulaşmıyordu — takvimde
 * yazılan not dosya listesinde "Not yazılmamış" kalıyordu. Şimdi yama
 * `yamala(id, yama)` ile dışa açık ve `AnaEkran`'ın TEK yazma yolu
 * (`durumDegis`/`odemeDegis`/`seansNotuKaydet`) onu çağırıyor; hangi ekrandan
 * yazılırsa yazılsın liste aynı çağrıdan besleniyor. Yazma liste okuması
 * uçuştayken biterse geç dönen yanıt onu ezmesin diye `yazmaSaati` (üçüncü
 * kullanıcı, bkz. o dosya).
 *
 * # Hata "seans yok" DEĞİLDİR (son inceleme I4)
 *
 * Eskiden 401 dışındaki her hata boş listeye çevriliyordu. 404 gerekçesi bu
 * yolda fiilen işlemiyordu (bilinmeyen danışanda kartın `dosyaGetir`'i de 404
 * alıyor ve dosya hiç çizilmiyor); geriye kalan tek etki geçici bir 500/ağ
 * hatasında Seanslar'ın "Bu danışanın kayıtlı bir seansı yok." demesiydi —
 * seansı olan bir danışan için `useDanisanDosyasi`'nin açıkça reddettiği
 * "sessiz yalan". Artık hata tutulur ve arayüz "Seanslar yüklenemedi —
 * Yeniden dene" gösterir (`yenidenDene`).
 *
 * # Seçim BURADA (son inceleme I3 + M1)
 *
 * Seçili seans eskiden `DanisanDosyasi`'nin state'iydi ve Danışanlar
 * sekmesine her girişte (bileşen yeniden monte olunca) sıfırlanıyordu. Artık
 * seçim bu kancada, sekme gidip gelince korunuyor. İki katman:
 *
 *   - `secim` — kullanıcının elle seçtiği ya da takvimden "… dosyasını aç"
 *     ile gelirken `AnaEkran`'ın kurduğu seans; HANGİ danışan için
 *     seçildiğiyle tutulur, başka danışanın dosyasına sızmaz.
 *   - `varsayilan` — seçim yoksa: bugünden önceki en yeni seans, yoksa en
 *     yakın gelecek (`danisan/seansSecimi.ts`). Yanıt GELDİĞİ ANDA bir kez
 *     hesaplanır, render'da DEĞİL: render'da hesaplansaydı saat bir sonraki
 *     randevunun başlangıcını geçtiği anki ilk render seçimi (ve açık not
 *     editörünü) terapistin elinin altından değiştirirdi.
 *
 * `simdi` enjekte edilebilir (varsayılanı yerel duvar saati, `yerelZaman`):
 * testler "şimdi"yi kendileri seçebilsin.
 *
 * # Bayatlık: yamanamayan yazmalar listeyi YENİDEN ÇEKTİRİR
 *
 * Takvimdeki dört yazma listeye yamanamaz: randevu oluşturma (satır ekler),
 * silme ve seri iptali (satır çıkarır), düzenleme (başka danışana taşır ya da
 * tarihi değiştirir — sıralama ve varsayılan seçim değişir). Eskiden hiçbiri
 * buraya ulaşmıyordu: takvimde oluşturulan randevunun panelinden "… dosyasını
 * aç"a basılınca liste o seansı içermiyor, seçim varsayılana (BAŞKA bir
 * seansa) düşüyor ve terapist başka seansın not editörünü görüyordu;
 * taşınan/silinen randevu eski dosyada düzenlenebilir kalıyordu.
 *
 * Şimdi `useTakvimAkisi` bu yazmaların etkilediği danışanları bildiriyor
 * (`yapiDegisti`); açık danışan aralarındaysa `saat.yapiDegisti()` bir damga
 * verir ve damgası ondan KÜÇÜK olan liste bayattır. Damga aynı `yazmaSaati`
 * sayacından: yazmadan önce başlayıp sonra dönen okuma da bayat sayılır ve
 * bir kez daha çekilir (`uygula`nın kapattığı yarışla aynı sınıf).
 *
 * Bayat liste EKRANA GİTMEZ (yükleniyor gibi davranılır): gösterilseydi seçim
 * varsayılana düşer, `useDosyaNotu` o YANLIŞ seansın notunu çekerdi — hem
 * hatanın kendisi hem de silinemez bir görüntüleme kaydı.
 *
 * Yeniden çekme YALNIZCA `gorunur` iken: terapistin bakmadığı bir liste için
 * silinemez görüntüleme kaydı düşmez (takvimde randevu oluşturmak dosya
 * listesini çekmez; dosyaya dönüldüğünde tek istek gider). Sunucu seans
 * listesini `LogHacmi::OturumBasi` ile birleştiriyor, yani pencere içindeki
 * yeniden çekme yeni satır da üretmez — ama görünmeyen istek kuralı ondan
 * bağımsız.
 *
 * İkinci savunma `seansSec`te: takvimden seçilerek gelinen seans yüklü
 * listede YOKSA liste bayat sayılır — bildirimi atlayan gelecekteki bir yazma
 * yolu da terapisti yanlış seansın editörüne düşürmesin.
 *
 * Ölçen testler: `AnaEkran.yayilim.test.tsx` > "Bayatlık" bloğu;
 * `DanisanlarSekmesi.test.tsx` > "listede olmayan seans seçilince".
 *
 * # 401: `onYetkisiz` — takvim seçimi de kapanır
 *
 * `useDanisanDosyasi` ile AYNI yön (bkz. `AnaEkran.tsx` modül başlığı "401
 * temizliği İKİ YÖNLÜ"). Geri çağrı bir `ref`te: efekt bağımlılıkları ilkel
 * kalsın, her render yeni bir istek atmasın (silinemez `goruntuleme`).
 */
export function useDanisanSeanslari({
  clientId,
  gorunur,
  onYetkisiz,
  simdi = () => yerelZaman(new Date()),
}: {
  clientId: number | null
  /** Liste ekranda mı — bayat listenin yeniden çekilmesi buna bağlı. */
  gorunur: boolean
  onYetkisiz: () => void
  simdi?: () => string
}) {
  const [durum, setDurum] = useState<SeansDurumu | null>(null)
  const [secim, setSecim] = useState<Secim | null>(null)
  const [tazeleme, setTazeleme] = useState(0)
  const [saat] = useState(() =>
    yazmaSaatiOlustur<DanisanSeansi, SeansYamasi>((s) => s.appointment_id),
  )
  // Son yamanamayan yazmanın damgası; `durum.damga` bundan küçükse bayat.
  const [yapiDamgasi, setYapiDamgasi] = useState(0)
  // Hangi bayatlık için yeniden çekme İSTENDİ: sekme gidip gelince aynı
  // bayatlık için ikinci bir istek atılmasın.
  const istenenDamgaRef = useRef(0)
  const clientIdRef = useRef(clientId)
  clientIdRef.current = clientId
  const durumRef = useRef(durum)
  durumRef.current = durum
  const yetkisizRef = useRef(onYetkisiz)
  yetkisizRef.current = onYetkisiz
  const simdiRef = useRef(simdi)
  simdiRef.current = simdi
  // Bileşen GERÇEKTEN unmount olduğunda `setState` çağırmamak için — id
  // türetmesinden AYRI bir kaygı (o, "yanlış danışan"ı gizler; bu, "artık
  // kimse dinlemiyor"u gizler).
  const unmountedRef = useRef(false)
  useEffect(
    () => () => {
      unmountedRef.current = true
    },
    [],
  )

  const buDanisanin = durum !== null && durum.id === clientId ? durum : null
  const bayat = buDanisanin !== null && buDanisanin.damga < yapiDamgasi
  const bu = bayat ? null : buDanisanin
  const seanslar = bu?.liste ?? []
  // `yuklendi`: seçili danışan için yanıt (başarı YA DA hata) geldi mi. e2e
  // bunu bir SENKRONİZASYON BARİYERİ olarak okuyor (`data-yuklendi`, bkz.
  // `SeansListesi.tsx`): "danışana tıklayınca notu görünür" iddiası listenin
  // gerçekten gelmesini beklemeden de "geçebilirdi" (6. biçim).
  const yuklendi = bu !== null
  const hata = bu?.hata ?? null

  const listede = (id: number | null | undefined) =>
    id != null && seanslar.some((s) => s.appointment_id === id)
  const manuelId =
    secim !== null && secim.clientId === clientId && listede(secim.seansId) ? secim.seansId : null
  const varsayilanId = bu !== null && listede(bu.varsayilan) ? bu.varsayilan : null
  const seciliSeansId = manuelId ?? varsayilanId

  /**
   * Yanıtı yazar — AYNI danışan için daha yeni bir okumanın yanıtı zaten
   * yazıldıysa yazmaz. Bayatlık yeniden çekmesi uçuştaki eski okumayla
   * yarışabilir; eski yanıt sonra gelip yeniyi ezseydi liste yeniden bayat
   * olur ve (o bayatlık için istek zaten atıldığından) öyle kalırdı.
   */
  function yanitiYaz(yeni: SeansDurumu) {
    setDurum((onceki) =>
      onceki !== null && onceki.id === yeni.id && onceki.damga > yeni.damga ? onceki : yeni,
    )
  }

  useEffect(() => {
    if (clientId === null) return
    const buId = clientId
    const okumaDamgasi = saat.okumaBasladi()

    danisanApi.seanslar(buId).then(
      (gelen) => {
        if (unmountedRef.current) return
        const liste = saat.uygula(gelen, okumaDamgasi)
        yanitiYaz({
          id: buId,
          liste,
          hata: null,
          varsayilan: varsayilanSeans(liste, simdiRef.current()),
          damga: okumaDamgasi,
        })
      },
      (e: unknown) => {
        if (unmountedRef.current) return
        if (e instanceof YetkisizHata) {
          yetkisizRef.current()
          setDurum(null)
          return
        }
        // 404 dahil TÜM diğer hatalar: hata DURUMU, boş liste DEĞİL (bkz.
        // modül başlığı "Hata seans yok DEĞİLDİR").
        yanitiYaz({
          id: buId,
          liste: [],
          hata: e instanceof Error ? e.message : 'Seanslar yüklenemedi.',
          varsayilan: null,
          damga: okumaDamgasi,
        })
      },
    )
  }, [clientId, tazeleme, saat])

  // Bayat ve görünür: TEK yeniden çekme (bkz. modül başlığı "Bayatlık").
  useEffect(() => {
    if (!bayat || !gorunur || istenenDamgaRef.current >= yapiDamgasi) return
    istenenDamgaRef.current = yapiDamgasi
    setTazeleme((n) => n + 1)
  }, [bayat, gorunur, yapiDamgasi])

  /**
   * Açık danışanın listesini etkileyen yamanamayan bir yazma bitti (bkz.
   * modül başlığı "Bayatlık"). `null`: etkilenen danışan bilinmiyor — liste
   * yine bayat sayılır (yanlış seansın editörü, fazladan bir okumadan pahalı).
   * Açık danışan etkilenmediyse hiçbir şey olmaz: onun listesi doğru.
   */
  const yapiDegisti = useCallback(
    (etkilenenler: readonly (number | null)[]) => {
      const acik = clientIdRef.current
      if (acik === null || !etkilenenler.some((id) => id === null || id === acik)) return
      setYapiDamgasi(saat.yapiDegisti())
    },
    [saat],
  )

  /**
   * Listeyi YERELDE yamar ve yazmayı saate işler (bkz. modül başlığı).
   * Liste başka bir danışana aitse ya da o seansı içermiyorsa ekrandaki
   * hiçbir şey değişmez — ama saat yine kaydeder: liste o an yükleniyorsa
   * geç dönen yanıt bu yamayı alır.
   *
   * `useCallback` + sabit bağımlılık: `AnaEkran` bunu bir `await`in ARDINDAN
   * çağırıyor, yani o sırada elindeki kanca dönüşü birkaç render eskimiş
   * olabilir — kimliğin ve davranışın render'dan bağımsız olması gerekiyor.
   */
  const yamala = useCallback(
    (id: number, yama: SeansYamasi) => {
      saat.yazmaBitti(id, yama)
      setDurum((onceki) =>
        onceki === null || !onceki.liste.some((s) => s.appointment_id === id)
          ? onceki
          : {
              ...onceki,
              liste: onceki.liste.map((s) => (s.appointment_id === id ? { ...s, ...yama } : s)),
            },
      )
    },
    [saat],
  )

  /**
   * Seansı seçer. `seansId === null`: seçimi bırak, varsayılana dön.
   *
   * O danışanın yüklü listesi bu seansı İÇERMİYORSA liste bayattır (bkz.
   * modül başlığı "Bayatlık", ikinci savunma). Yükleme sürüyorsa, liste hata
   * taşıyorsa ya da başka danışanınsa dokunulmaz: gelecek yanıt zaten taze.
   */
  const seansSec = useCallback(
    (hangiDanisan: number, seansId: number | null) => {
      setSecim(seansId === null ? null : { clientId: hangiDanisan, seansId })
      const d = durumRef.current
      if (
        seansId !== null &&
        d !== null &&
        d.id === hangiDanisan &&
        d.hata === null &&
        !d.liste.some((s) => s.appointment_id === seansId)
      ) {
        setYapiDamgasi(saat.yapiDegisti())
      }
    },
    [saat],
  )

  function yenidenDene() {
    setDurum(null)
    setTazeleme((n) => n + 1)
  }

  return {
    seanslar,
    yuklendi,
    hata,
    yenidenDene,
    seciliSeansId,
    seansSec,
    yamala,
    yapiDegisti,
  }
}
