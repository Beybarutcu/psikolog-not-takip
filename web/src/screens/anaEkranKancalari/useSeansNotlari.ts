import { useCallback, useEffect, useRef, useState } from 'react'
import { notApi, ozelNotApi, YetkisizHata, type OzelNot, type SeansNotu } from '../../api'
import type { Randevu } from '../../takvim/HaftalikTakvim'
import { yazmaSaatiOlustur } from './yazmaSaati'

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
  hata: string | null
}

const BOS_SEANS: SeansVerisi = {
  id: null,
  not: null,
  ozelNot: null,
  ozelHata: null,
  hata: null,
}

/**
 * Açık seansın not akışı: resmî not (sayfa açılışında) ve özel not
 * (YALNIZCA sekmeye geçilince). Önceki seansların listesi burada DEĞİL:
 * not sayfasının sağ sütunu (`seans/OncekiNotlar.tsx`, Görev 8) kendisi
 * ister ya da danışan dosyasının önbelleğini kullanır.
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
  notYaz,
}: {
  randevu: Randevu | null
  onYetkisiz: () => void
  /**
   * Resmî notun TEK yazma yolu (`AnaEkran.seansNotuKaydet`): API çağrısı ve
   * sonucun bütün önbelleklere yayılması orada (son inceleme C1). REF'te
   * tutuluyor: çağıran her render'da yeni bir kapanış geçiriyor.
   */
  notYaz: (appointmentId: number, kayit: { sablon: string; icerik: string }) => Promise<void>
}) {
  const notYazRef = useRef(notYaz)
  notYazRef.current = notYaz
  // Uçuştaki yazma × not okuması (bkz. `yazmaSaati.ts`, dördüncü kullanıcı):
  // dosyada yazılan notun kaydı (ya da dosya editörünün unmount tahliyesi)
  // bu seansın not GET'i uçuştayken biterse, geç dönen yanıt eski metni
  // getirmesin.
  const [notSaati] = useState(() =>
    yazmaSaatiOlustur<SeansNotu, SeansNotu>((n) => n.appointment_id),
  )
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
  // Başlangıç da efektin bağımlılığı (tasarım A6: taşımada resmî not bir kez
  // daha okunur, aşağıda). Kimlikler gibi ilkel bir değer olarak türetiliyor
  // (nesneye bağlanmak her yeniden yüklemede bir istek daha demekti — bkz.
  // yukarıdaki gerekçe).
  const seansBaslangici = randevu?.baslangic ?? null

  // Ekrana giden veri RENDER SIRASINDA türetiliyor: state başka bir seansa
  // aitse boş sayılır. Sıfırlamayı efekte bırakmak, seçim değişimiyle
  // efektin çalışması arasındaki karede ÖNCEKİ danışanın notunu yeni
  // seansın panelinde göstermek olurdu.
  const seans = seansVerisi.id === seansId ? seansVerisi : BOS_SEANS

  // Özel not isteği HANGİ seans için geçerli -- seans kimliği DEĞİŞİNCE
  // sıfırlanır (Görev 10b, Bulgu 2). Bu kanca `AnaEkran`'da YAŞIYOR
  // (`SeansPaneli`nin `key`'iyle yeniden monte OLMUYOR), yani A -> özel
  // sekme -> B -> A dönüşünde `ozelNotIstenen` eskiden HAYATTA kalıyordu:
  // panel A için yeniden monte olup varsayılan "Seans Notu" sekmesinde
  // açılır (özel not ekranda görünmez) ama eski `ozelNotIstenen === A`
  // değeri özel not efektini SESSİZCE yeniden tetikliyordu -- terapistin
  // BAKMADIĞI bir not için silinemez bir `Goruntuleme` satırı düşüyordu.
  // Render sırasında karşılaştırılıyor (`seans` ile aynı desen, bkz.
  // yukarısı): bir efekte bırakmak, seçim değişimiyle efektin çalışması
  // arasındaki karede eski `ozelNotIstenen`in hâlâ geçerliymiş gibi
  // okunmasına izin verirdi. AYNI seansın başlangıcı değişince (taşıma,
  // Görev 10 Tasarım A6) bu SIFIRLANMAZ: karşılaştırma yalnızca
  // `seansId`nin KENDİSİYLE, `seansBaslangici` ile değil.
  const oncekiOzelSeansIdRef = useRef(seansId)
  if (oncekiOzelSeansIdRef.current !== seansId) {
    oncekiOzelSeansIdRef.current = seansId
    if (ozelNotIstenen !== null) setOzelNotIstenen(null)
  }

  useEffect(() => {
    if (seansId === null || seansDanisanId === null || seansBaslangici === null) return
    let iptal = false

    const okumaDamgasi = notSaati.okumaBasladi()
    void (async () => {
      try {
        // Özel not burada YOK: o, sekmeye geçilince ayrı bir efektte
        // yükleniyor (bkz. `ozelNotIstenen`).
        const gelenNot = await notApi.notGetir(seansId)
        if (iptal) return
        setSeansVerisi((onceki) => ({
          id: seansId,
          // Okuma başladıktan SONRA biten bir kayıt yanıtın üstüne uygulanır
          // (bkz. `notSaati`).
          //
          // Tasarım A6: taşımada (AYNI seans, yeni başlangıç) resmî not bir
          // kez daha okunur — not okuması sunucuda `OturumBasi(5 dk)` ile
          // birleşir, yeni denetim satırı düşmez. Editör `not-${id}` ile
          // key'li olduğu için yeniden MONTE EDİLMEZ; kirli editör gelen
          // hâli benimsemez (`NotEditoru::sunucuHali`), yazılmamış metin
          // yerinde kalır.
          not: notSaati.uygula([gelenNot], okumaDamgasi)[0] ?? gelenNot,
          // Tasarım A6: AYNI seansın başlangıcı değişince (taşıma) özel not
          // sıfırlanmaz — özel not efekti başlangıca bağlı değil ve yeniden
          // koşmaz; sıfırlansaydı sekme "Özel not yükleniyor…"da kalırdı.
          ozelNot: onceki.id === seansId ? onceki.ozelNot : null,
          ozelHata: onceki.id === seansId ? onceki.ozelHata : null,
          hata: null,
        }))
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
  }, [seansId, seansDanisanId, seansBaslangici, seansTazeleme, notSaati])

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
  //
  // Kaydın KENDİSİ artık burada değil (son inceleme C1): `notYaz` üzerinden
  // `AnaEkran`'ın TEK yazma yoluna gidiyor ve sonuç oradan, hangi ekrandan
  // yazıldığına bakılmaksızın, `notYansit` ile buraya (ve danışan
  // dosyasının not önbelleğine, seans listesine) geri geliyor.
  const notKaydet = useCallback(
    async (kayit: { sablon: string; icerik: string }) => {
      if (seansId === null) return
      await notYazRef.current(seansId, kayit)
    },
    [seansId],
  )

  /**
   * Başarılı bir resmî not kaydını bu önbelleğe yansıtır — kayıt takvimden
   * de, danışan dosyasından da gelmiş olabilir (son inceleme C1: dosyada
   * yazılan not takvime dönünce ESKİ görünüyordu ve bir tuş, eski metni PUT
   * edip yazılanı SİLİYORDU).
   *
   * - Açık seans buysa `not` tazelenir. Geciken bir yanıt, o sırada açılmış
   *   BAŞKA bir seansın notunu ezmez: state başka seansa aitse dokunulmaz.
   * - Yazma her durumda saate işlenir (`yazmaSaati`, dördüncü kullanıcı): bu
   *   seansın not okuması uçuştaysa geç dönen yanıt ESKİ metni getirmez.
   *
   * `useCallback` + sabit bağımlılık: çağıran bunu bir `await`in ARDINDAN,
   * birkaç render eski bir kanca dönüşü üzerinden çağırabilir.
   */
  const notYansit = useCallback(
    (id: number, yeni: SeansNotu) => {
      notSaati.yazmaBitti(id, yeni)
      setSeansVerisi((onceki) => (onceki.id === id ? { ...onceki, not: yeni } : onceki))
    },
    [notSaati],
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

  return {
    seans,
    notKaydet,
    notYansit,
    ozelNotKaydet,
    ozelSekmeAcildi,
    ozelYenidenDene,
    yenidenDene,
  }
}
