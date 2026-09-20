import { useState } from 'react'
import type { SeansNotu } from '../api'
import { zamanMetni } from '../tarih'
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
 * **seansın tarihi**. Liste bu yüzden GELDİĞİ SIRADA basılıyor;
 * `guncelleme_zamani`'na göre yeniden sıralamak sunucunun bildiği gerçek
 * seans sırasını sessizce bozardı.
 *
 * # Sıralama anahtarı EKRANDA görünür
 *
 * Önceden yanıtta seans tarihi yoktu ve ekrandaki tek tarih
 * `guncelleme_zamani` idi ("Son düzenleme"). İkisi farklı nicelikler
 * olduğu için ekrandaki tarihler sık sık **sırasız görünüyordu** ve
 * panelin var oluş sebebi olan "hangisi son seanstı" sorusu panelden
 * cevaplanamıyordu. Artık başlıkta **seans tarihi** duruyor (sıralamanın
 * dayandığı alan) ve son düzenleme ikincil satırda, ne olduğunu söyleyen
 * etiketiyle kalıyor — ikisinden birini diğerinin yerine sunmak yanlış
 * bilgi olurdu.
 *
 * # Liste gerçekten "önceki" seanslardır
 *
 * Kesme sunucuda: çağıran taraf `?once=<bu seansın başlangıcı>` geçer
 * (bkz. `api.ts::notApi.danisanNotlari`). Bu bileşen kesme yapmaz —
 * yapsaydı, sunucudan gelen `limit` kadar satırın bir kısmını atıp
 * "son üç seans" yerine daha azını gösterirdi.
 */
type Props = {
  notlar: SeansNotu[]
}

/**
 * Son DÜZENLEME zamanı (`guncelleme_zamani`) -> `"05.09.2026"`.
 *
 * Bu bir SEANS zamanı DEĞİL: sunucunun yazdığı UTC damgası
 * (`...T12:00:00Z`), bu yüzden burada `Date` ile YEREL güne çevrilmesi
 * meşru. Adı bilerek `danisan/bicim.ts::tarihBicimle`'den farklı: o,
 * dilimsiz bir takvim gününü (`YYYY-AA-GG`) `Date`'e HİÇ çevirmeden
 * biçimliyor; aynı adı taşısalardı biri diğerinin yerine kullanılıp UTC
 * kaymasını geri getirebilirdi.
 */
function duzenlemeGunuBicimle(iso: string): string {
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
                  className="flex w-full flex-wrap items-center gap-x-2 px-2 py-1 text-left text-sm"
                  aria-expanded={acik}
                  aria-controls={govdeId}
                  onClick={() => degistir(not.appointment_id)}
                >
                  <span aria-hidden="true" className="text-slate-400">
                    {acik ? '−' : '+'}
                  </span>
                  {/* Seans tarihi ÖNCE: listenin sıralandığı alan bu ve
                      kullanıcının sorduğu soru "hangisi son seanstı". */}
                  {/* Seans ZAMANI uygulamanın her yerinde TEK biçimde
                      (`tarih.ts::zamanMetni`, son inceleme M4): eskiden
                      burada "05.09.2026 10:00", danışan dosyasında "5 Eylül
                      2026, 10:00" yazıyordu — aynı seans iki ekranda iki
                      farklı görünüyordu. `zamanMetni` dizgiyi `Date`'e
                      çevirmiyor: sıralama anahtarı saat dilimiyle kaymaz. */}
                  <span className="font-medium">Seans: {zamanMetni(not.seans_zamani)}</span>
                  <span className="text-slate-600">{sablonAdi(not.sablon)}</span>
                  <span className="text-slate-500">
                    Son düzenleme: {duzenlemeGunuBicimle(not.guncelleme_zamani)}
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
