import { useEffect, useRef, useState } from 'react'
import { ARAMA_SINIRI, type AramaSonucu } from '../api'

/**
 * Hızlı arama (Ctrl+K / Cmd+K): danışan adı ve **resmî** seans notu içeriği.
 *
 * # Ekranda not içeriği var — bu yüzden kapanınca hiçbir şey kalmaz
 *
 * Sonuçlar not içeriğinden parça (`parca`) taşıyor ve bu ekran tam da seans
 * sırasında, danışanın karşısında kullanılır. Kapatma (Escape ya da düğme)
 * yalnızca katmanı gizlemez: sorgu ve sonuç listesi **state'ten silinir**.
 * Gizlenmiş ama duran bir liste, katman bir sonraki açılışta eski danışanın
 * notunu yeni danışanın önünde gösterirdi.
 *
 * Özel notların buraya hiç gelmemesi arayüzün kararı değil: sunucudaki
 * `store::search` `private_notes` tablosunu hiç tanımıyor (ne `JOIN`, ne
 * `UNION`, ne dışlayıcı `WHERE`). Bu bileşenin de `ara` prop'undan başka
 * veri kaynağı yoktur.
 *
 * # Arama terimi hiçbir yere yazılmaz
 *
 * Sunucu tarafında sorgu metni, sonuç sayısı ve eşleşen danışan kimlikleri
 * `audit_log`'a **yazılmıyor** (satırlar silinemez olduğu için oraya düşen
 * bir terim kalıcı olurdu). Arayüz de aynı kurala uyar: sorgu ve sonuç
 * parçaları `console`'a düşmez.
 *
 * # "Daha fazla sonuç var" işareti sunucuda YOK — sayıyı arayüz ölçer
 *
 * `GET /api/ara` kırpılma bilgisi döndürmüyor (Görev 6'nın bilinen boşluğu:
 * bütçe paylaştırması sessiz kaybı hafifletti, kaldırmadı — 61 danışan
 * eşleşirse 12'si hâlâ düşüyor). Sonuç sayısı sınıra (`ARAMA_SINIRI`)
 * eşitse liste büyük olasılıkla kırpılmıştır; bunu söylemeyen bir arayüzde
 * terapist "bu kadarmış" sanar ve var olan bir notu bulamadığını fark
 * etmez. Sayı ekranda yazılır, hiçbir loga yazılmaz.
 */
type Props = {
  ara: (sorgu: string) => Promise<AramaSonucu[]>
  onDanisanSec: (clientId: number) => void
  /** `tarih` randevunun `baslangic`'i (`YYYY-AA-GGTSS:DD`) — çağıran taraf
   * hangi haftaya gideceğini ondan bilir. */
  onSeansSec: (appointmentId: number, tarih: string) => void
  /** Testlerde kısaltılır (`NotEditoru`'nun `gecikmeMs` deseni). */
  gecikmeMs?: number
}

/** Yazma durduktan sonra istek atılana kadar beklenen süre. */
export const GECIKME_MS = 250

/**
 * Aramanın çalışması için gereken en az karakter — sunucudaki
 * `ASGARI_SORGU` ile aynı. İstemcide de duruyor çünkü sunucu bu durumda
 * **boş liste** dönüyor (hata değil): kontrol yalnızca sunucuda olsaydı her
 * tek harfte gereksiz bir istek gider ve kullanıcı "sonuç yok" görürdü,
 * "yazmaya devam edin" değil.
 */
const ASGARI_SORGU = 2

/** `2026-09-07T10:00` -> `07.09.2026 10:00`. Parçalar olduğu gibi doğru;
 * `Date`'e çevrilmiyor (bkz. `hafta.ts::zamandanDate`). */
function zamanBicimle(zaman: string): string {
  const [tarih, saat] = zaman.split('T')
  const [yil, ay, gun] = (tarih ?? '').split('-')
  if (!yil || !ay || !gun) return zaman
  return saat ? `${gun}.${ay}.${yil} ${saat.slice(0, 5)}` : `${gun}.${ay}.${yil}`
}

export function HizliArama({ ara, onDanisanSec, onSeansSec, gecikmeMs = GECIKME_MS }: Props) {
  const [acik, setAcik] = useState(false)
  const [sorgu, setSorgu] = useState('')
  // Yanıt HANGİ SORGUYA ait olduğuyla birlikte tutuluyor ve ekrana giden
  // liste render sırasında türetiliyor (aşağıda). Çıplak bir `sonuclar`
  // dizisi, kullanıcı sorguyu değiştirdiği an ile yeni yanıt geldiği an
  // arasında ÖNCEKİ sorgunun not parçalarını gösterirdi — bu ekran seans
  // sırasında, danışanın karşısında açılıyor.
  const [yanit, setYanit] = useState<{ sorgu: string; sonuclar: AramaSonucu[] } | null>(null)
  const [hataKaydi, setHataKaydi] = useState<{ sorgu: string; mesaj: string } | null>(null)
  const kutuRef = useRef<HTMLInputElement>(null)

  // Kapanış TEK yerde: sorgu ve yanıtlar birlikte silinir. İki ayrı çağrı
  // yeri olsaydı biri sonuçları temizlemeyi unutabilirdi.
  function kapat() {
    setAcik(false)
    setSorgu('')
    setYanit(null)
    setHataKaydi(null)
  }

  useEffect(() => {
    function tus(olay: KeyboardEvent) {
      if ((olay.ctrlKey || olay.metaKey) && olay.key.toLowerCase() === 'k') {
        // Tarayıcının kendi kısayolunu (adres çubuğu araması) engelle.
        olay.preventDefault()
        setAcik(true)
        return
      }
      if (olay.key === 'Escape') kapat()
    }
    document.addEventListener('keydown', tus)
    return () => document.removeEventListener('keydown', tus)
  }, [])

  useEffect(() => {
    if (acik) kutuRef.current?.focus()
  }, [acik])

  const kirpilmis = sorgu.trim()

  // Ekrana giden liste ve hata, YALNIZCA o anki sorguya ait olduklarında
  // gösterilir. Sorgu kısaldığında (ya da tümüyle silindiğinde) eski
  // sonuçlar bir kare bile görünmez ve bunun için bir efektin çalışmasını
  // beklemek gerekmez.
  const sonuclar = yanit !== null && yanit.sorgu === kirpilmis ? yanit.sonuclar : []
  const hata = hataKaydi !== null && hataKaydi.sorgu === kirpilmis ? hataKaydi.mesaj : null
  // Sorgu yeterince uzun ama bu sorgu için henüz ne yanıt ne hata var.
  const bekleniyor =
    kirpilmis.length >= ASGARI_SORGU && yanit?.sorgu !== kirpilmis && hataKaydi?.sorgu !== kirpilmis

  useEffect(() => {
    // Kısa sorguda hiç istek ATILMAZ: sunucu da bu durumda boş liste
    // döndürüyor (hata değil), yani kontrol yalnızca orada olsaydı her tek
    // harf gereksiz bir gidiş-dönüş olurdu.
    if (!acik || kirpilmis.length < ASGARI_SORGU) return
    let iptal = false
    const zamanlayici = setTimeout(() => {
      void ara(kirpilmis)
        .then((gelen) => {
          if (iptal) return
          setYanit({ sorgu: kirpilmis, sonuclar: gelen })
        })
        .catch((e: unknown) => {
          if (iptal) return
          // Bayat sonuçlar gösterilmez: türetme zaten sorguya bağlı, hata
          // kaydı da aynı sorguya bağlanıyor.
          setHataKaydi({
            sorgu: kirpilmis,
            mesaj: e instanceof Error ? e.message : 'Arama yapılamadı.',
          })
        })
    }, gecikmeMs)
    return () => {
      iptal = true
      clearTimeout(zamanlayici)
    }
  }, [acik, kirpilmis, ara, gecikmeMs])

  if (!acik) {
    return (
      <button
        type="button"
        className="rounded border px-3 py-1 text-sm"
        onClick={() => setAcik(true)}
      >
        Hızlı arama (Ctrl+K)
      </button>
    )
  }

  const kirpilmisOlabilir = sonuclar.length >= ARAMA_SINIRI

  return (
    <div
      role="dialog"
      // `aria-modal` BİLEREK yok. Bu satır içi bir `div`: odak tuzağı yok,
      // arkada backdrop yok, sayfanın geri kalanı `inert` değil ve Tab ile
      // gerçekten dışarı çıkılabiliyor. `aria-modal="true"` yazmak ekran
      // okuyucu kullanıcısına "arkadaki her şey atıl" demektir; yanlış
      // olduğu için o kullanıcı, gören bir kullanıcının kolayca fark ettiği
      // içeriği hiç bulamaz hâle gelirdi — erişilebilirlik etiketinin
      // gerçeği yanlış anlatması, etiketin hiç olmamasından kötüdür.
      // Gerçek bir modal yapmak (odak tuzağı + `inert`) ayrı bir iştir;
      // yapılana kadar burada dürüst olan, modal olmayan bir `dialog`.
      aria-label="Hızlı arama"
      className="rounded-lg border border-slate-300 bg-white p-3"
    >
      <div className="flex items-center gap-2">
        <input
          ref={kutuRef}
          type="search"
          aria-label="Danışan adı veya not içeriği"
          placeholder="Danışan adı veya not içeriği…"
          className="flex-1 rounded border p-2 text-sm"
          value={sorgu}
          onChange={(e) => setSorgu(e.target.value)}
        />
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={kapat}>
          Aramayı kapat
        </button>
      </div>

      {kirpilmis.length > 0 && kirpilmis.length < ASGARI_SORGU && (
        <p className="mt-2 text-sm text-slate-600">Aramak için en az 2 karakter yazın.</p>
      )}

      {hata && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {hata}
        </p>
      )}

      {kirpilmisOlabilir && (
        <p className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
          {ARAMA_SINIRI} sonuç gösteriliyor; daha fazlası olabilir. Eşleşmeyi kaçırmamak için
          aramayı daraltın.
        </p>
      )}

      {/* Yanıt beklenirken "Sonuç bulunamadı." YAZILMAZ: türetilen liste
          yanıt gelene kadar boş ve o metin, henüz sorulmamış bir sorunun
          cevabı gibi görünürdü. */}
      {bekleniyor && <p className="mt-2 text-sm text-slate-600">Aranıyor…</p>}

      {!bekleniyor && kirpilmis.length >= ASGARI_SORGU && hata === null && sonuclar.length === 0 && (
        <p className="mt-2 text-sm text-slate-600">Sonuç bulunamadı.</p>
      )}

      {sonuclar.length > 0 && (
        <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto">
          {sonuclar.map((s) =>
            s.tur === 'not' && s.appointment_id !== null && s.tarih !== null ? (
              <li key={`not-${s.appointment_id}`}>
                <button
                  type="button"
                  className="w-full rounded border border-slate-200 p-2 text-left text-sm hover:bg-slate-50"
                  aria-label={`${s.danisan_adi} — ${zamanBicimle(s.tarih)} seansına git`}
                  onClick={() => {
                    // Önce kapat: sonuçlar (not parçaları) ekranda kalmasın.
                    const id = s.appointment_id as number
                    const tarih = s.tarih as string
                    kapat()
                    onSeansSec(id, tarih)
                  }}
                >
                  <span className="font-medium">{s.danisan_adi}</span>{' '}
                  <span className="text-slate-500">· {zamanBicimle(s.tarih)}</span>
                  <span className="block text-slate-600">{s.parca}</span>
                </button>
              </li>
            ) : (
              <li key={`danisan-${s.client_id}`}>
                <button
                  type="button"
                  className="w-full rounded border border-slate-200 p-2 text-left text-sm hover:bg-slate-50"
                  aria-label={`${s.danisan_adi} — danışan dosyasını aç`}
                  onClick={() => {
                    const id = s.client_id
                    kapat()
                    onDanisanSec(id)
                  }}
                >
                  <span className="font-medium">{s.danisan_adi}</span>{' '}
                  <span className="text-slate-500">· danışan dosyası</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}
