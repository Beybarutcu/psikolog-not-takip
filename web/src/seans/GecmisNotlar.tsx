import { useState } from 'react'
import type { SeansNotu } from '../api'
import { SABLON_ADLARI, sablonKodMu } from './sablon'

/**
 * Danışanın **geçmiş resmî** seans notları — katlanmış liste.
 *
 * # Yalnızca resmî not
 *
 * Bu bileşenin tek veri kaynağı `notApi.danisanNotlari`'dır ve o da
 * sunucudaki `routes::notes::danisan_listesi`'ne gider — özel not tablosuna
 * hiç bakmayan bir handler. Buraya ikinci bir kaynak eklenmemelidir: özel
 * notun korunmasının tek mekanizması ayrı tablo/ayrı uç nokta olmasıdır, bir
 * filtre değil.
 *
 * # Neden katlanmış
 *
 * Not içeriği sağlık verisidir ve panel danışanın adının yanında duruyor.
 * Üç seansın tam metnini kendiliğinden ekrana basmak, terapistin ekranını
 * omzunun üstünden görülebilir hâle getirir. Başlık ve tarih görünür kalır
 * (bağlam bu), içerik ancak istenince açılır.
 *
 * # Sıralama SUNUCUDAN gelir, burada yeniden sıralanmaz
 *
 * Sunucu `ORDER BY a.baslangic DESC` uyguluyor — yani sıralama anahtarı
 * **seansın tarihi**. Ama yanıtta o alan YOK: `SeansNotu` yalnızca notun
 * `guncelleme_zamani`'nı taşıyor. İkisi aynı şey değildir (geçen ayki bir
 * seansın notu bugün düzeltilmiş olabilir). Burada `guncelleme_zamani`'na
 * göre yeniden sıralamak, sunucunun bildiği gerçek seans sırasını sessizce
 * bozardı; liste bu yüzden GELDİĞİ SIRADA basılıyor ve gösterilen tarih
 * ne olduğunu söyleyen bir etiketle ("Son düzenleme") veriliyor — "seans
 * tarihi" diye sunulsaydı yanlış bilgi olurdu.
 */
type Props = {
  notlar: SeansNotu[]
}

function tarihBicimle(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const iki = (n: number) => String(n).padStart(2, '0')
  return `${iki(d.getDate())}.${iki(d.getMonth() + 1)}.${d.getFullYear()}`
}

function sablonAdi(kod: string): string {
  return sablonKodMu(kod) ? SABLON_ADLARI[kod] : kod
}

export function GecmisNotlar({ notlar }: Props) {
  // Açık olanların kimlikleri. Tek bir "açık olan" tutulsaydı iki seansın
  // notu karşılaştırılamazdı — bu listenin var oluş sebebi tam olarak
  // karşılaştırma (geçen seansta ne konuşulmuştu).
  const [acikOlanlar, setAcikOlanlar] = useState<number[]>([])

  function degistir(id: number) {
    setAcikOlanlar((onceki) =>
      onceki.includes(id) ? onceki.filter((x) => x !== id) : [...onceki, id],
    )
  }

  return (
    <section aria-labelledby="gecmis-notlar-basligi">
      <h3 id="gecmis-notlar-basligi" className="text-sm font-semibold text-slate-700">
        Önceki seans notları
      </h3>

      {notlar.length === 0 ? (
        // Boş durum bilgilendirici: "hiçbir şey yok" ile "ilk seans" farklı
        // şeyler ve kullanıcı hangisinde olduğunu bilmeli.
        <p className="mt-2 rounded bg-slate-50 p-2 text-sm text-slate-600">
          Bu danışanın önceki seanslarından kayıtlı not yok. İlk seans ise
          beklenen durum budur; değilse önceki seanslarda not tutulmamış demektir.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {notlar.map((not) => {
            const acik = acikOlanlar.includes(not.appointment_id)
            const govdeId = `gecmis-not-govde-${not.appointment_id}`
            return (
              <li key={not.appointment_id} className="rounded border border-slate-200">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm"
                  aria-expanded={acik}
                  aria-controls={govdeId}
                  onClick={() => degistir(not.appointment_id)}
                >
                  <span aria-hidden="true" className="text-slate-400">
                    {acik ? '−' : '+'}
                  </span>
                  <span className="font-medium">{sablonAdi(not.sablon)}</span>
                  <span className="text-slate-500">
                    Son düzenleme: {tarihBicimle(not.guncelleme_zamani)}
                  </span>
                </button>
                {acik && (
                  <p
                    id={govdeId}
                    className="whitespace-pre-wrap border-t border-slate-200 px-2 py-1 text-sm"
                  >
                    {not.icerik}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
