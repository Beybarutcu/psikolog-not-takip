import { useRef, useState } from 'react'
import type { OzelNot, SeansNotu } from '../api'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { AYLAR } from '../takvim/hafta'
import { GecmisNotlar } from './GecmisNotlar'
import { NotEditoru } from './NotEditoru'
import { SeansAltSatiri } from './SeansAltSatiri'
import { sablonMetni } from './sablon'

/**
 * Seans paneli: solda geçmiş bağlam, sağda **iki sekmeli** not alanı.
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
 * Panel açılışında iki istek gider (resmî not + geçmiş), üçüncüsü değil.
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
 * # Alt satır: durum, ücret, ödendi (Plan 4 Görev 2)
 *
 * Tasarım §6: ödeme takibi ayrı bir modül değil, seansın alt satırı. Durum
 * düğmeleri buraya `RandevuPaneli`'nden TAŞINDI (iki panel aynı anda açık).
 * Satırın kendisi `SeansAltSatiri`'nda: not yüklenemediğinde de (panel
 * açılmadığında) `AnaEkran` aynı satırı gösteriyor — bkz. o dosyanın
 * başlığı.
 */

type NotKaydi = { sablon: string; icerik: string }

type Props = {
  randevu: Randevu
  /** Danışanın önceki **resmî** notları. Bu seansın kendi notu listede olmaz. */
  gecmisNotlar: SeansNotu[]
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
  onKapat: () => void
  /**
   * Alt satırdaki durum düğmesi (`geldi` / `gelmedi` / `iptal`). Seçili
   * düğme `randevu.durum`'dan okunur, yerel kopyadan DEĞİL: çağıran taraf
   * başarıda seçili randevunun kopyasını aynı kimlikle tazeliyor ve panel
   * yeniden mount edilmiyor.
   */
  onDurumDegis: (durum: string) => Promise<void>
  /**
   * Alt satırdaki "Ödendi" kutusu. Reddedilirse kutu eski hâline döner ve
   * hata `role="alert"` ile duyurulur.
   */
  onOdemeDegis: (odendi: boolean) => Promise<void>
}

const OZEL_UYARISI = 'Bu notlar dışa aktarımlara ve danışan raporuna dahil edilmez.'

// Özel sekmenin ayırt edici rengi. Resmî sekme bu sınıfların hiçbirini
// taşımaz — ikisi aynı görünseydi kullanıcı hangi nota yazdığını ancak
// metni okuyarak anlardı.
const OZEL_SEKME_SINIFI = 'border-violet-400 bg-violet-100 text-violet-900'
const OZEL_GOVDE_SINIFI = 'border-violet-400 bg-violet-50'
const RESMI_GOVDE_SINIFI = 'border-slate-200 bg-white'

/**
 * "2026-09-07T10:00" -> "7 Eylül 2026, 10:00".
 *
 * `baslangic` yerel naive biçimde geliyor; parçalar olduğu gibi doğru.
 * `Date`'e çevirmiyoruz — zaman dilimi çevrimi burada yalnızca kayma riski
 * üretirdi (bkz. `hafta.ts::zamandanDate`).
 */
function seansZamani(zaman: string): string {
  const [tarih, saat] = zaman.split('T')
  const [yil, ay, gun] = (tarih ?? '').split('-')
  const ayAdi = AYLAR[Number(ay) - 1]
  if (!saat || ayAdi === undefined) return zaman
  return `${Number(gun)} ${ayAdi} ${yil}, ${saat.slice(0, 5)}`
}

export function SeansPaneli({
  randevu,
  gecmisNotlar,
  not,
  ozelNot,
  ozelHata = null,
  onNotKaydet,
  onOzelNotKaydet,
  onOzelSekme,
  onOzelYenidenDene,
  onKapat,
  onDurumDegis,
  onOdemeDegis,
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
    <section
      aria-labelledby="seans-paneli-basligi"
      className="mt-4 rounded-lg border border-slate-300 p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="seans-paneli-basligi" className="text-lg font-semibold">
            Seans
          </h2>
          <p className="text-sm text-slate-600">
            {randevu.danisan_adi} — {seansZamani(randevu.baslangic)}
          </p>
        </div>
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onKapat}>
          Seansı kapat
        </button>
      </div>

      {/* Mobilde tek sütun ve geçmiş ÜSTTE (DOM sırası da öyle: ekran
          okuyucu ve klavye kullanıcısı için bağlam önce gelir). Geniş
          ekranda geçmiş sol sütuna geçer. */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="lg:w-72 lg:shrink-0">
          <GecmisNotlar notlar={gecmisNotlar} />
        </div>

        <div className="flex-1">
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
              className={`rounded-b rounded-tr border p-3 ${OZEL_GOVDE_SINIFI}`}
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
              className={`rounded-b rounded-tr border p-3 ${RESMI_GOVDE_SINIFI}`}
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
                  taslakAnahtari={`not-${randevu.id}`}
                  onKaydet={onNotKaydet}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Alt satır (tasarım §6): "geldi/gelmedi/iptal + ücret + ödendi" tek
          satırda. Ödeme takibi ayrı bir modül değil, seansın parçası. `key`
          gerekmiyor: panelin kendisi seans kimliğiyle key'li. */}
      <SeansAltSatiri
        randevu={randevu}
        onDurumDegis={onDurumDegis}
        onOdemeDegis={onOdemeDegis}
      />
    </section>
  )
}
