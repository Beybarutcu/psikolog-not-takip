import { useRef, useState } from 'react'
import type { OzelNot, SeansNotu } from '../api'
import { EtiketSatiri, type EtiketBaglami } from '../etiket/EtiketSatiri'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { NotEditoru } from './NotEditoru'
import { sablonMetni } from './sablon'

/**
 * Not sayfasının editör alanı (tasarım N4): iki sekmeli not alanı ve resmî
 * sekmede etiketler. Üst satır (danışan, tarih, durum/ödeme, Takvime dön) ve
 * önceki notlar `SeansSayfasi`'nde.
 *
 * # İki sekme = iki ayrı tablo, bir filtre değil
 *
 * "Seans Notu" `progress_notes`'a, "Özel Notlarım" `private_notes`'a gider.
 * Sekme değiştirmek bir listeyi filtrelemek DEĞİLDİR: her sekme kendi uç
 * noktasına (`.../not` ve `.../ozel-not`) bağlı ayrı bir editördür ve iki
 * içerik bu bileşene ayrı prop'lar olarak gelir. Planın bağlayıcı kısıtı
 * bunu şöyle söylüyor: *bir `WHERE gizli = 0` filtresine güvenilmez —
 * unutulan tek bir sorgu koruma sözünü bozar.*
 *
 * Bunun somut sonucu: resmî sekme açıkken özel notun içeriği ekranda
 * **hiçbir yerde** yoktur (gizlenmiş değil, render edilmemiştir) ve resmî
 * nota giden hiçbir istek özel not metnini taşıyamaz.
 *
 * # Özel sekme görsel olarak ayrışır
 *
 * Aynı renkte iki sekme, yanlış yere yazmaya yol açar; ve özel not tam
 * olarak "danışana gösterilmeyecek şey" demektir. Sekme düğmesi SEÇİLİ
 * OLMASA BİLE ayırt edici rengini taşır (kullanıcı tıklamadan önce de
 * ayırt edebilmeli) ve sekmenin içinde kalıcı bir uyarı şeridi durur.
 *
 * # Özel not sekmeye GEÇİLİNCE yüklenir
 *
 * Sayfa açılışında özel not istenmez.
 * Sunucudaki `ozel_not_getir` her çağrıda `goruntuleme | private_note |
 * <randevu>` satırı yazar ve `audit_log` **silinemez**: kullanıcı özel
 * sekmeye hiç girmeden o satırı bastırmak, olmayan bir eylemi kalıcı
 * olarak bildirmek olurdu. Denetim kaydının değeri "yazılanın gerçekten
 * olmuş olması"dır.
 *
 * Hacim kuralı bozulmuyor: sekmeye girildiğinde tek satır yazılır ve aynı
 * seansın tekrar tekrar açılması (`LogHacmi::OturumBasi`) yine tek satır
 * kalır.
 *
 * # `key` zorunlu, `NotEditoru`'nun kendi sıfırlaması yeterli değil
 *
 * Editörün içindeki `anahtar !== taslakAnahtari` sıfırlaması bir İKİNCİ
 * savunma hattıdır ve birincisiyle **eşdeğer değildir**: `key` verilmezse
 * seans geçişinde bileşen yeniden mount edilmez, unmount tahliyesi hiç
 * çalışmaz ve giden seansın bekleyen metni sunucuya **hiç yazılmaz**
 * (yalnızca taslakta kalır; kilit açılmadan kapatılan bir sekmede gider).
 * Bkz. `NotEditoru.test.tsx` içindeki "prop degisimi `key` yolunun yerini
 * TUTMAZ".
 *
 * # Etiketler yalnızca RESMİ sekmede (Plan 6 Görev 6)
 *
 * `EtiketSatiri` "Seans Notu" sekmesinin içinde, editörün altında. Özel
 * notlar etiket ALMAZ: etiket randevuya bağlı ve danışan veri raporuna
 * girer; "Özel Notlarım" sekmesinde görünmesi onu özel notun parçası
 * sandırırdı. Etiket verisi ve yazmaları bu bileşende değil
 * (`etiket` prop'u, `AnaEkran`'ın tek yolu — bkz. `useEtiketler`).
 *
 * # Yükseklik
 *
 * Kök ve sekme gövdesi dikey esnek kutu: `SeansSayfasi` editör alanına
 * yükseklik verdiğinde editör o yüksekliği doldurur (tasarım N4 "sayfanın
 * büyük kısmı"; zincirin sonu `NotEditoru` > `BicimliYuzey`).
 */

type NotKaydi = { sablon: string; icerik: string }

type Props = {
  randevu: Randevu
  /** `null` = henüz yükleniyor. Editör, içerik gelmeden mount EDİLMEZ. */
  not: SeansNotu | null
  /**
   * `null` = henüz İSTENMEDİ ya da yükleniyor. Özel not, sekmeye
   * geçilmeden yüklenmez (bkz. modül başlığındaki denetim kaydı bölümü),
   * bu yüzden panel açılışında burası her zaman `null`'dır.
   */
  ozelNot: OzelNot | null
  /** Özel notun yüklenmesi başarısız olduysa mesajı. */
  ozelHata?: string | null
  onNotKaydet: (kayit: NotKaydi) => Promise<void>
  onOzelNotKaydet: (icerik: string) => Promise<void>
  /**
   * "Özel Notlarım" sekmesine geçildi — özel notu YÜKLE.
   *
   * Panel açılışında çağrılmaz: sunucudaki `ozel_not_getir` **silinemez**
   * bir `goruntuleme | private_note | <id>` satırı yazar ve o satırı
   * kullanıcı sekmeye hiç girmeden bastırmak, olmayan bir eylemi
   * bildirmek olurdu.
   */
  onOzelSekme: () => void
  /** Özel not yüklenemediyse yeniden dene. */
  onOzelYenidenDene?: () => void
  /**
   * Seansın etiketleri (`AnaEkran.etiketBaglami`). İsteğe bağlı: bu
   * bileşenin kendi testleri etiketsiz kurulur; üretimde `SeansSayfasi`
   * her zaman geçirir.
   */
  etiket?: EtiketBaglami
}

const OZEL_UYARISI = 'Bu notlar dışa aktarımlara ve danışan raporuna dahil edilmez.'

// Özel sekmenin ayırt edici rengi. Resmî sekme bu sınıfların hiçbirini
// taşımaz — ikisi aynı görünseydi kullanıcı hangi nota yazdığını ancak
// metni okuyarak anlardı.
const OZEL_SEKME_SINIFI = 'border-violet-400 bg-violet-100 text-violet-900'
const OZEL_GOVDE_SINIFI = 'border-violet-400 bg-violet-50'
const RESMI_GOVDE_SINIFI = 'border-slate-200 bg-white'

export function SeansPaneli({
  randevu,
  not,
  ozelNot,
  ozelHata = null,
  onNotKaydet,
  onOzelNotKaydet,
  onOzelSekme,
  onOzelYenidenDene,
  etiket,
}: Props) {
  const [sekme, setSekme] = useState<'resmi' | 'ozel'>('resmi')
  const ozelAcik = sekme === 'ozel'
  const resmiSekmeRef = useRef<HTMLButtonElement>(null)
  const ozelSekmeRef = useRef<HTMLButtonElement>(null)

  function ozelSekmeyeGec() {
    setSekme('ozel')
    // Her geçişte çağrılıyor, yalnızca ilkinde değil: çağıran taraf
    // "istendi" bayrağını SEANSA bağlı tutuyor ve aynı değere yapılan
    // ikinci bir `setState` yeni bir istek üretmiyor. Burada "ilk kez mi"
    // muhasebesi tutmak aynı bilgiyi iki yerde saklamak olurdu.
    onOzelSekme()
  }

  /**
   * Sekmeler arasında ok tuşlarıyla gezinme (WAI-ARIA tab deseni).
   *
   * Otomatik etkinleştirme: ok tuşu hem odağı hem seçimi taşır. İki
   * sekmeli ve içeriği hazır bir yapıda doğru olan budur; "önce odaklan,
   * sonra Enter" gereksiz bir tuş daha isterdi. Odak da taşınıyor —
   * seçili sekme değişip odak eskisinde kalsaydı bir sonraki ok tuşu
   * yanlış yerden hesaplanırdı.
   */
  function sekmeTusu(olay: React.KeyboardEvent<HTMLDivElement>) {
    const yonTusu =
      olay.key === 'ArrowRight' ||
      olay.key === 'ArrowDown' ||
      olay.key === 'ArrowLeft' ||
      olay.key === 'ArrowUp'
    const basa = olay.key === 'Home'
    const sona = olay.key === 'End'
    if (!yonTusu && !basa && !sona) return
    olay.preventDefault()
    // İki sekme var: her yön tuşu ötekine geçer (döngüsel). Home ilkine,
    // End sonuncusuna.
    const ozele = sona || (basa ? false : !ozelAcik)
    if (ozele) {
      ozelSekmeyeGec()
      ozelSekmeRef.current?.focus()
    } else {
      setSekme('resmi')
      resmiSekmeRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Not türü"
        className="flex gap-1"
        onKeyDown={sekmeTusu}
      >
        <button
          ref={resmiSekmeRef}
          type="button"
          role="tab"
          id="sekme-resmi"
          aria-selected={!ozelAcik}
          // `aria-controls` YALNIZCA seçiliyken veriliyor: aynı anda
          // tek bir `tabpanel` render ediliyor, seçili olmayan
          // sekmenin işaret ettiği id ekranda YOK. Var olmayan bir
          // id'yi göstermek ekran okuyucuya kırık bir bağ vermektir.
          aria-controls={ozelAcik ? undefined : 'panel-resmi'}
          // Dönen tabindex (roving): sekme şeridi klavyede TEK durak,
          // içinde ok tuşlarıyla gezilir. İkisi de sekmelenebilir
          // olsaydı Tab kullanıcısı burada iki kez durur, ok tuşları
          // ise hiçbir şey yapmazdı.
          tabIndex={ozelAcik ? -1 : 0}
          className={
            'rounded-t border border-b-0 px-3 py-1 text-sm ' +
            (ozelAcik ? 'border-slate-200 bg-slate-50' : 'border-slate-300 bg-white font-medium')
          }
          onClick={() => setSekme('resmi')}
        >
          Seans Notu
        </button>
        <button
          ref={ozelSekmeRef}
          type="button"
          role="tab"
          id="sekme-ozel"
          aria-selected={ozelAcik}
          aria-controls={ozelAcik ? 'panel-ozel' : undefined}
          tabIndex={ozelAcik ? 0 : -1}
          // Ayırt edici renk SEÇİLİ OLMASA DA taşınıyor.
          className={
            'rounded-t border border-b-0 px-3 py-1 text-sm ' +
            OZEL_SEKME_SINIFI +
            (ozelAcik ? ' font-medium' : '')
          }
          onClick={ozelSekmeyeGec}
        >
          Özel Notlarım
        </button>
      </div>

      {ozelAcik ? (
        <div
          role="tabpanel"
          id="panel-ozel"
          aria-labelledby="sekme-ozel"
          className={`flex flex-1 flex-col rounded-b rounded-tr border p-3 ${OZEL_GOVDE_SINIFI}`}
        >
          {/* Kalıcı şerit: sekme açık olduğu SÜRECE görünür. Yalnızca
              ilk açılışta gösterilen bir uyarı, kullanıcı sekmeler
              arasında gidip geldikçe kaybolurdu. */}
          <p className="mb-2 rounded border border-violet-400 bg-white p-2 text-sm text-violet-900">
            {OZEL_UYARISI}
          </p>
          {ozelHata !== null ? (
            // Yükleme başarısızsa BOŞ EDİTÖR açılmaz: boş bir alan
            // sunucudaki özel notu "yok" diye gösterir ve üstüne
            // yazılan metin var olanı ezerdi.
            <div role="alert" className="rounded border border-red-300 bg-red-50 p-2">
              <p className="text-sm text-red-800">Özel not yüklenemedi. {ozelHata}</p>
              {onOzelYenidenDene !== undefined && (
                <button
                  type="button"
                  className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
                  onClick={onOzelYenidenDene}
                >
                  Yeniden dene
                </button>
              )}
            </div>
          ) : ozelNot === null ? (
            <p className="text-sm text-slate-600">Özel not yükleniyor…</p>
          ) : (
            <NotEditoru
              // `key` ZORUNLU: bkz. modül başlığı. `ozel-` öneki resmî
              // notunkinden farklı olmalı ki aynı seansın iki sekmesi
              // birbirinin taslağını görmesin.
              key={`ozel-${randevu.id}`}
              baslangicIcerik={ozelNot.icerik}
              // Özel notun şablonu yok; seçici de gizli. Değer yalnızca
              // `NotEditoru`'nun imzasını doldurur ve hiçbir yere gitmez
              // (`onOzelNotKaydet` sadece içeriği alıyor).
              baslangicSablon="serbest"
              sablonSecilebilir={false}
              etiket="Özel notum"
              taslakAnahtari={`ozel-${randevu.id}`}
              onKaydet={(kayit) => onOzelNotKaydet(kayit.icerik)}
            />
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          id="panel-resmi"
          aria-labelledby="sekme-resmi"
          className={`flex flex-1 flex-col rounded-b rounded-tr border p-3 ${RESMI_GOVDE_SINIFI}`}
        >
          {not === null ? (
            <p className="text-sm text-slate-600">Seans notu yükleniyor…</p>
          ) : (
            <NotEditoru
              key={`not-${randevu.id}`}
              // Şablon başlıklarını ÇAĞIRAN TARAF geçiriyor: `NotEditoru`
              // mount'ta içerik sentezlemiyor (bilinçli karar — sentezlese
              // kullanıcı tek tuşa basmadan bir kayıt ve silinemez bir
              // denetim satırı üretirdi). Burada geçirildiğinde editörün
              // "sunucudaki hâl" temeli de bu metin olur, dolayısıyla
              // açılış yine hiçbir yazma üretmez — ama yeni not "DAP
              // seçili ama başlıksız" açılmaz.
              //
              // Ölçüt sunucudaki içeriğin BOŞ olması: dolu bir notun
              // başına başlık eklemek yazılmış metni bozardı.
              baslangicIcerik={not.icerik === '' ? sablonMetni(not.sablon) : not.icerik}
              baslangicSablon={not.sablon}
              // Başka bir ekrandan (danışan dosyası) gelen kayıt editör
              // monte olduktan SONRA biterse temiz editör onu benimser
              // (son inceleme C1 — bkz. `NotEditoru::sunucuHali`). Açılış
              // içeriğiyle AYNI dönüşüm: yoksa boş not için başlıklar ile
              // `''` farklı sayılır ve editör başlıkları silerdi.
              sunucuHali={{
                sablon: not.sablon,
                icerik: not.icerik === '' ? sablonMetni(not.sablon) : not.icerik,
              }}
              taslakAnahtari={`not-${randevu.id}`}
              onKaydet={onNotKaydet}
            />
          )}
          {etiket !== undefined && (
            <EtiketSatiri
              // Bu panel değil, üst bileşen `SeansSayfasi` seans kimliğiyle
              // `key`li (`TakvimSekmesi.tsx`: `seans-${seciliRandevu.id}`);
              // yani bu satır zaten seans değişince yeniden monte olur — `key`
              // dosya tarafındaki (orada YÜK TAŞIYAN) kullanımla aynı kalıp,
              // burada ikinci bir savunma hattı.
              key={`etiket-${randevu.id}`}
              kimlik={`takvim-${randevu.id}`}
              {...etiket}
            />
          )}
        </div>
      )}
    </div>
  )
}
