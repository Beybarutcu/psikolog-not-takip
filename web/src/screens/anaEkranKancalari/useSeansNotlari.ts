import { useCallback, useEffect, useRef, useState } from 'react'
import { notApi, ozelNotApi, YetkisizHata, type OzelNot, type SeansNotu } from '../../api'
import type { Randevu } from '../../takvim/HaftalikTakvim'

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
export type SeansVerisi = {
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
 * Açık seansın not akışı: resmî not + geçmiş notlar (panel açılışında) ve
 * özel not (YALNIZCA sekmeye geçilince).
 *
 * Kanca `Randevu` NESNESİNİ alıyor ama efektlerin bağımlılığı içeride
 * türetilen İLKEL kimlikler (`seansId`, `seansDanisanId`, `seansBaslangici`).
 * Bu ayrımın bedeli somut: `yukle()` her çağrıldığında (hafta değişimi,
 * kayıt, "Geldi", seri silme) seçili randevu TAZE bir nesneyle değiştiriliyor
 * ve efekt nesneye bağlı olsaydı her seferinde üç not isteği daha giderdi —
 * her biri sunucuda SİLİNEMEZ bir `goruntuleme` satırı (bkz. `store::audit`).
 *
 * `onYetkisiz`: 401'de takvim seçimini kapatan geri çağrı. REF'te tutuluyor
 * ki efekt bağımlılıkları ilkel kimliklerle sınırlı kalsın (`useTakvimAkisi`
 * ile aynı gerekçe).
 */
export function useSeansNotlari({
  randevu,
  onYetkisiz,
}: {
  randevu: Randevu | null
  onYetkisiz: () => void
}) {
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

  const yetkisizRef = useRef(onYetkisiz)
  yetkisizRef.current = onYetkisiz

  // Seans notu verisi RANDEVU KİMLİĞİNE bağlı yükleniyor, `randevu`
  // NESNESİNE değil (bkz. kanca başlığı).
  const seansId = randevu?.id ?? null
  const seansDanisanId = randevu?.client_id ?? null
  // Geçmiş listesinin kesmesi: "bu seans BAŞLAMADAN önce". Efektin
  // bağımlılığı olduğu için kimlikler gibi ilkel bir değer olarak
  // türetiliyor (nesneye bağlanmak her yeniden yüklemede üç istek daha
  // demekti — bkz. yukarıdaki gerekçe).
  const seansBaslangici = randevu?.baslangic ?? null

  // Ekrana giden veri RENDER SIRASINDA türetiliyor: state başka bir seansa
  // aitse boş sayılır. Sıfırlamayı efekte bırakmak, seçim değişimiyle
  // efektin çalışması arasındaki karede ÖNCEKİ danışanın notunu yeni
  // seansın panelinde göstermek olurdu.
  const seans = seansVerisi.id === seansId ? seansVerisi : BOS_SEANS

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
          yetkisizRef.current()
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
          yetkisizRef.current()
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

  // Kayıt, editörün BAĞLI OLDUĞU randevunun kimliğine gider; seçim nesnesi
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

  const ozelNotKaydet = useCallback(
    async (icerik: string) => {
      if (seansId === null) return
      const yeni = await ozelNotApi.kaydet(seansId, icerik)
      setSeansVerisi((onceki) => (onceki.id === seansId ? { ...onceki, ozelNot: yeni } : onceki))
    },
    [seansId],
  )

  /** Özel sekmeye GEÇİLDİ: özel notu bu seans için iste (ve yalnızca bunun için). */
  function ozelSekmeAcildi() {
    setOzelNotIstenen(seansId)
  }

  function ozelYenidenDene() {
    setSeansVerisi((onceki) => ({ ...onceki, ozelHata: null }))
    setOzelTazeleme((n) => n + 1)
  }

  function yenidenDene() {
    // Hata state'i de temizleniyor: aksi hâlde yeniden deneme sürerken
    // ekranda hâlâ eski hata durur.
    setSeansVerisi(BOS_SEANS)
    setSeansTazeleme((n) => n + 1)
  }

  return { seans, notKaydet, ozelNotKaydet, ozelSekmeAcildi, ozelYenidenDene, yenidenDene }
}
