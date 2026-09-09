import { useEffect, useRef, useState } from 'react'
import { YetkisizHata } from '../api'
import { SABLON_ADLARI, SABLON_KODLARI, sablonMetni } from './sablon'
import { taslakOku, taslakTemizle, taslakYaz } from './taslak'

/**
 * Otomatik kayıtlı seans notu editörü.
 *
 * # Kaydet düğmesi yoktur
 *
 * Plan 3'ün bağlayıcı kısıtı. İncelenen ürünlerin en sık şikayeti not
 * kaybıydı ve bunun kaynağı neredeyse her zaman "kullanıcı kaydetmeden
 * kapattı"dır. Editör yazma durduktan `gecikmeMs` (varsayılan 2000 ms) sonra
 * kendiliğinden yazar; her tuş vuruşunda değil (denetim kaydı hacmi bir
 * tasarım kısıtıdır, bkz. `store::audit`).
 *
 * Tek düğme, kayıt BAŞARISIZ olduğunda beliren "Yeniden dene"dir. Bu bir
 * kaydet düğmesi değil, kurtarma yoludur: hata sonrası kullanıcı yazmayı
 * bırakmışsa (ki en olası davranış budur) yeni bir tuş vuruşu olmadan
 * yeniden denemenin başka yolu kalmaz.
 *
 * # 401 kararı: metin kaybolmaz, kilit açılınca kaldığı yerden devam eder
 *
 * Kaydetme sırasında oturum kilitlenirse (`YetkisizHata`) `api.ts` merkezi
 * dinleyicileri tetikler, `App` `AnaEkran`'ı gerçek anlamda unmount eder ve
 * bu bileşenin state'i onunla birlikte gider. Bu yüzden yazılan metin **her
 * değişiklikte** ağacın dışındaki taslak deposuna (`taslak.ts`) yazılır ve
 * yalnızca sunucu kaydı doğrulandığında oradan düşer. Kilit açılıp editör
 * yeniden mount edildiğinde taslak geri yüklenir, kullanıcıya geri
 * yüklendiği SÖYLENİR ve içerik ilk fırsatta sunucuya yazılır.
 *
 * Sessiz düşürme bu yüzden mümkün değil: metin ya sunucuda ya taslakta, ve
 * taslaktan gelen içerik kullanıcıya duyurulur.
 *
 * # Not içeriği hiçbir loga girmez
 *
 * Ne `console`'a, ne sunucu denetim kaydına. Bu dosyada içeriği yazdıran tek
 * yer `textarea`'nın kendisidir.
 */

type Kayit = { sablon: string; icerik: string }

type Props = {
  baslangicIcerik: string
  baslangicSablon: string
  onKaydet: (kayit: Kayit) => Promise<void>
  gecikmeMs?: number
  /**
   * Taslak deposundaki kimlik (`not-12`, `ozel-12`). Zorunludur ve seansa
   * özgüdür: ortak bir varsayılan olsaydı bir seansın kaydedilmemiş metni
   * başka bir seansın editörüne geri yüklenirdi.
   */
  taslakAnahtari: string
}

const VARSAYILAN_GECIKME_MS = 2000

// Kayıt kararı "içerik + şablon" ikilisi üzerinden verilir: yalnızca içeriğe
// bakılsaydı, dolu bir notta şablonu değiştirmek (metin aynı kalır) hiç
// kaydedilmezdi ve seçim ekranda görünüp veritabanında olmazdı.
function imza(kayit: Kayit): string {
  return JSON.stringify([kayit.sablon, kayit.icerik])
}

function saatBicimle(tarih: Date): string {
  const iki = (n: number) => String(n).padStart(2, '0')
  return `${iki(tarih.getHours())}:${iki(tarih.getMinutes())}`
}

type Durum =
  | { tur: 'temiz' }
  | { tur: 'bekliyor' }
  | { tur: 'kaydediliyor' }
  | { tur: 'kaydedildi'; saat: string }
  | { tur: 'hata'; kilit: boolean }

export function NotEditoru({
  baslangicIcerik,
  baslangicSablon,
  onKaydet,
  gecikmeMs = VARSAYILAN_GECIKME_MS,
  taslakAnahtari,
}: Props) {
  // Mount anında taslak deposuna bakılır: kilit (401) yüzünden unmount olmuş
  // bir editörün yazılmamış metni burada durur ve sunucudan gelen
  // `baslangicIcerik` o metni İÇERMEZ (kaydedilememişti).
  const [ilk] = useState(() => baslangicDurumu(taslakAnahtari, baslangicIcerik, baslangicSablon))
  const [icerik, setIcerik] = useState(ilk.icerik)
  const [sablon, setSablon] = useState(ilk.sablon)
  const [geriYuklendi, setGeriYuklendi] = useState(ilk.geriYuklendi)
  const [durum, setDurum] = useState<Durum>({ tur: 'temiz' })
  const [anahtar, setAnahtar] = useState(taslakAnahtari)

  // Sunucuda olduğu BİLİNEN son hâl — ekrandaki hâl değil. Kayıt kararı buna
  // göre verilir. Taslak geri yüklendiyse ekrandaki içerik bundan farklıdır
  // ve aşağıdaki efekt onu kaydedilmesi gereken bir değişiklik olarak görüp
  // kilit açılır açılmaz sunucuya yazar; taslak yoksa ikisi eşittir ve
  // kullanıcı hiçbir şey yazmadan hiçbir istek atılmaz.
  const sonKaydedilen = useRef(imza({ sablon: baslangicSablon, icerik: baslangicIcerik }))

  // Uçuşta olan kaydın imzası. Zamanlayıcı ateşlendikten sonra bileşen
  // kaldırılırsa aşağıdaki unmount temizliği aynı içeriği İKİNCİ kez
  // göndermesin diye tutuluyor (her yazma silinemez bir denetim satırı
  // maliyeti taşır).
  const ucustaki = useRef<string | null>(null)

  // Seçim değişince (`taslakAnahtari` başka bir seansı gösterince) bileşen
  // yeniden mount EDİLMEYEBİLİR — çağıran taraf `key` vermeyi unutabilir.
  // O durumda bir seansın metni diğerinin editöründe kalır ve oraya
  // kaydedilirdi. Render sırasında state'i sıfırlamak React'in bu iş için
  // önerdiği desen; testleri "her zaman temiz mount" yapan bir bileşen
  // testinin göremeyeceği tek regresyon sınıfı da budur.
  if (anahtar !== taslakAnahtari) {
    const yeni = baslangicDurumu(taslakAnahtari, baslangicIcerik, baslangicSablon)
    setAnahtar(taslakAnahtari)
    setIcerik(yeni.icerik)
    setSablon(yeni.sablon)
    setGeriYuklendi(yeni.geriYuklendi)
    setDurum({ tur: 'temiz' })
    sonKaydedilen.current = imza({ sablon: baslangicSablon, icerik: baslangicIcerik })
    ucustaki.current = null
  }

  const gecerli = useRef(true)
  useEffect(() => () => {
    gecerli.current = false
  }, [])

  // Unmount sırasında (panel kapandı, başka randevu seçildi) elde bekleyen
  // içeriği hemen yazmak için son değerler bir ref'te tutuluyor. Efektin
  // temizliği sırasında state okunamaz.
  const son = useRef({ sablon, icerik, onKaydet, taslakAnahtari })
  son.current = { sablon, icerik, onKaydet, taslakAnahtari }

  async function kaydetDene(kayit: Kayit, anahtarAdi: string) {
    setDurum({ tur: 'kaydediliyor' })
    ucustaki.current = imza(kayit)
    try {
      await onKaydet(kayit)
      // Bu iki satır `gecerli` kontrolünden ÖNCE: kayıt gerçekten olduysa
      // taslak, bileşen bu arada kaldırılmış olsa bile düşmelidir — aksi
      // hâlde bir sonraki mount sunucudakiyle aynı metni "kurtarılmış
      // taslak" diye geri yükler ve gereksiz bir yazma daha üretir.
      sonKaydedilen.current = imza(kayit)
      taslakTemizle(anahtarAdi, kayit)
      ucustaki.current = null
      if (!gecerli.current) return
      setGeriYuklendi(false)
      setDurum({ tur: 'kaydedildi', saat: saatBicimle(new Date()) })
    } catch (e) {
      // Taslak BİLEREK silinmiyor: kaydedilemeyen metnin tek kopyası o.
      ucustaki.current = null
      if (!gecerli.current) return
      setDurum({ tur: 'hata', kilit: e instanceof YetkisizHata })
    }
  }

  useEffect(() => {
    const kayit = { sablon, icerik }
    if (imza(kayit) === sonKaydedilen.current) return

    // Taslak GECİKMESİZ yazılır. Gecikmeli yazılsaydı, kilit tam o gecikme
    // içinde devreye girdiğinde son yazılanlar hiçbir yerde olmazdı.
    taslakYaz(taslakAnahtari, kayit)
    setDurum({ tur: 'bekliyor' })

    const zamanlayici = setTimeout(() => {
      void kaydetDene(kayit, taslakAnahtari)
    }, gecikmeMs)
    return () => clearTimeout(zamanlayici)
    // `onKaydet` bilerek bağımlılık listesinde değil: çağıran taraf her
    // render'da yeni bir kapanış (closure) üretirse zamanlayıcı sürekli
    // sıfırlanır ve otomatik kayıt hiç ateşlenmezdi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icerik, sablon, gecikmeMs, taslakAnahtari])

  // Unmount: bekleyen içerik varsa zamanlayıcıyı beklemeden gönderilir.
  // Kilit (401) senaryosunda bu istek de 401 alır ve reddedilir — sorun
  // değil, taslak yerinde kalır ve kilit açılınca geri yüklenir.
  useEffect(() => () => {
    const { sablon: s, icerik: i, onKaydet: k, taslakAnahtari: a } = son.current
    const kayit = { sablon: s, icerik: i }
    if (imza(kayit) === sonKaydedilen.current || imza(kayit) === ucustaki.current) return
    void k(kayit)
      .then(() => taslakTemizle(a, kayit))
      .catch(() => {
        // Yutuluyor: bileşen artık ekranda değil, gösterilecek bir yer yok.
        // İçerik taslakta duruyor; hata mesajı yerine metnin kendisi korunur.
      })
  }, [])

  function sablonDegis(yeni: string) {
    setSablon(yeni)
    // Dolu editörde şablon değişimi yazılmış metni EZMEZ. Bu, not kaybının
    // ikinci gerçek yolu: kullanıcı yanlış şablonu seçtiğini fark edip
    // düzeltmek istediğinde yazdığı her şeyin silinmesi.
    if (icerik.trim() === '') setIcerik(sablonMetni(yeni))
  }

  const alanId = `not-alani-${taslakAnahtari}`
  const sablonId = `not-sablonu-${taslakAnahtari}`

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <label className="text-sm" htmlFor={sablonId}>
          Şablon
        </label>
        {/* Kapalı küme: seçenekler `sablon.ts`'teki kayıttan türetiliyor ve
            "yeni şablon ekle" yolu YOK — `templates.kod` UNIQUE ve kapalı bir
            CHECK taşıdığı için o tablo yapısal olarak en fazla üç satır
            tutabilir. Kullanıcı şablonun başlıklarını düzenler, türünü değil. */}
        <select
          id={sablonId}
          className="rounded border p-1 text-sm"
          value={sablon}
          onChange={(e) => sablonDegis(e.target.value)}
        >
          {SABLON_KODLARI.map((kod) => (
            <option key={kod} value={kod}>
              {SABLON_ADLARI[kod]}
            </option>
          ))}
        </select>

        <span className="ml-auto text-sm text-slate-500" role="status">
          {durumMetni(durum)}
        </span>
      </div>

      {geriYuklendi && (
        <p role="status" className="mb-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
          Kaydedilmemiş not içeriğiniz geri yüklendi. Oturum kilitlendiğinde henüz
          kaydedilmemişti; kaldığınız yerden devam edebilirsiniz.
        </p>
      )}

      <label className="text-sm" htmlFor={alanId}>
        Seans notu
      </label>
      <textarea
        id={alanId}
        className="mt-1 min-h-64 flex-1 rounded border p-2 font-mono text-sm"
        value={icerik}
        onChange={(e) => setIcerik(e.target.value)}
      />

      {durum.tur === 'hata' && (
        <div className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800">
          <p>
            Kaydedilemedi.{' '}
            {durum.kilit
              ? 'Oturum kilitlendi. Yazdıklarınız korunuyor: kilidi açıp bu seansı ' +
                'yeniden açtığınızda metin geri yüklenir.'
              : 'Yazdıklarınız ekranda duruyor ve silinmedi; yazmaya devam ederseniz ' +
                'ya da yeniden denerseniz kayıt tekrar denenir.'}
          </p>
          <button
            type="button"
            className="mt-2 rounded border border-red-300 px-2 py-1"
            onClick={() => void kaydetDene({ sablon, icerik }, taslakAnahtari)}
          >
            Yeniden dene
          </button>
        </div>
      )}
    </div>
  )
}

function baslangicDurumu(anahtar: string, sunucuIcerik: string, sunucuSablon: string) {
  const taslak = taslakOku(anahtar)
  if (taslak === undefined) {
    return { icerik: sunucuIcerik, sablon: sunucuSablon, geriYuklendi: false }
  }
  const farkli = taslak.icerik !== sunucuIcerik || taslak.sablon !== sunucuSablon
  if (!farkli) {
    // Taslak sunucudakiyle aynı: kurtarılacak bir şey yok. Depodan düşürülür
    // ve "geri yüklendi" DENMEZ — kaybolmayan bir şeyin kurtarıldığını
    // söylemek uyarıyı gürültüye çevirir ve gerçekten kurtarıldığı gün
    // fark edilmez.
    taslakTemizle(anahtar, taslak)
  }
  return { icerik: taslak.icerik, sablon: taslak.sablon, geriYuklendi: farkli }
}

function durumMetni(durum: Durum): string {
  switch (durum.tur) {
    case 'temiz':
      return ''
    case 'bekliyor':
      return 'Kaydedilmemiş değişiklikler var…'
    case 'kaydediliyor':
      return 'Yazılıyor…'
    case 'kaydedildi':
      return `Kaydedildi ${durum.saat}`
    case 'hata':
      return ''
  }
}
