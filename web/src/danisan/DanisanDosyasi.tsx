import { useState } from 'react'
import type { DanisanSeansi, SeansNotu } from '../api'
import { EtiketSatiri, type EtiketBaglami } from '../etiket/EtiketSatiri'
import { etiketSirasi } from '../etiket/etiketAdi'
import type { KartVerisi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { NotEditoru } from '../seans/NotEditoru'
import { sablonMetni } from '../seans/sablon'
import { SeansAltSatiri } from '../seans/SeansAltSatiri'
import { DosyaBilgileri } from './DosyaBilgileri'
import { DosyaOzetiSatiri } from './DosyaOzetiSatiri'
import { SeansListesi } from './SeansListesi'

/** Danışan dosyasının iki alt sekmesi. */
export type DosyaAltSekme = 'seanslar' | 'bilgiler'

type NotKaydi = { sablon: string; icerik: string }

/**
 * Danışanın dosyası: başlık (danışanın adı) + Seanslar / Bilgiler alt
 * sekmeleri (Plan 5 Görev 6-7; son inceleme C1, C2, I2, I4, M1).
 *
 * # Ürün amacı
 *
 * Bugüne kadar geçmiş seansları ve notları görmenin tek yolu takvimden bir
 * randevuya tıklamaktı. Bu bileşen danışana tıklandığında AÇILAN dosyanın
 * içine "Seanslar" alt sekmesini kurar: solda `SeansListesi`, sağda seçili
 * seansın notu (`NotEditoru`) ve alt satırı (`SeansAltSatiri`, durum +
 * ücret + ödendi). Not düzenlemek için takvime dönmek GEREKMEZ.
 *
 * # DURUMSUZ: veri ve yazmalar YUKARIDA (son inceleme C1/C2/M1)
 *
 * Eskiden bu bileşen seçili seansın notunu kendisi çekiyor, notu doğrudan
 * `notApi.notKaydet` ile, durum/ödemeyi doğrudan `takvimApi` ile yazıyor ve
 * sonucu yalnızca KENDİ state'ine (`yamalar`) işliyordu. Takvim aynı seansa
 * ayrı bir önbellekten bakıyordu: dosyada yazılan not takvime dönünce ESKİ
 * görünüyor (bir tuş = eski metnin PUT'u = klinik not kaybı), dosyada
 * işaretlenen ödeme sekme gidip gelince kayboluyor, Bilgiler'deki bakiye
 * hiç tazelenmiyordu. Artık:
 *
 *   - seans listesi, seçim ve yamalar `useDanisanSeanslari`'nda,
 *   - seçili seansın notu `useDosyaNotu`'nda,
 *   - alt sekme `AnaEkran`'da,
 *   - bütün yazmalar `AnaEkran`'ın TEK yolunda (`seansNotuKaydet`,
 *     `durumDegis`, `odemeDegis`) — sonuç takvime, karta, ay özetine ve bu
 *     listeye AYNI çağrıdan yayılıyor.
 *
 * Bu bileşen yalnızca gösteriyor ve hangi seans kimliğine uygulanacağını
 * bağlıyor. Kancalar `AnaEkran`'da yaşadığı için Danışanlar sekmesinden
 * çıkıp geri girince (bu bileşen yeniden monte olur) seçim, alt sekme ve
 * not KAYBOLMAZ ve not YENİDEN İSTENMEZ (M1).
 *
 * # Başlıkta danışanın ADI — iki alt sekmede de (son inceleme I2)
 *
 * Ad eskiden yalnızca Bilgiler'deydi; Seanslar'da açık dosyanın kime ait
 * olduğu hiçbir yerde yazmıyordu ve terapist yanlış danışanın seansına not
 * yazabilirdi. Başlık artık şeridin ÜSTÜNDE, iki alt sekmede de görünür;
 * `DosyaBilgileri` kendi ad başlığını bu yüzden taşımıyor.
 *
 * # Başlık özeti (tasarım B2)
 *
 * Adın altında tek, soluk satır (`DosyaOzetiSatiri`, tanımlar
 * `dosyaOzeti.ts`'te): TEK kaynağı `kart.randevular` ve `simdi`
 * (`DanisanlarSekmesi`'nin `useDakikalikSimdi`'si). İki alt sekmede de
 * görünür. "Ödenmemiş" Bilgiler'deki bakiyeyle AYNI işlevden
 * (`borcToplami`) gelir. Bağlantıları (`ozettenSec`) Seanslar alt sekmesine
 * geçer ve o seansı seçer. Seans etiket süzgecinde gizliyse süzgeç
 * "Tüm seanslar"a çekilir. Satır, `kaydirmaIstegi` ile seçim değişmese de
 * görünür alana getirilir.
 *
 * # Kendi küçük sekme şeridi — `kabuk/Sekmeler` DEĞİL
 *
 * `kabuk/Sekmeler.tsx` uygulamanın ÜST kabuğunun şeridi (Takvim/Danışanlar/
 * Ayarlar). Burada AYRI ve daha küçük bir şerit var (Seanslar/Bilgiler) —
 * aynı bileşeni burada da kullanmak iki `tablist`in `id`/`aria-controls`
 * uzayını karıştırırdı.
 *
 * `tabIndex` bilerek DOKUNULMUYOR (ikisi de varsayılan, yani Tab ile
 * ulaşılabilir) — tıpkı `kabuk/Sekmeler.tsx` gibi. Roving tabindex yarım
 * yazılırsa yalnızca seçili sekme Tab durağı alır ve ok tuşu olmadan
 * diğerine hiç ULAŞILAMAZ — klavye kullanan bir terapist "Bilgiler"e (rıza,
 * ekler, saklama süresi, KVKK veri raporu) hiç geçemezdi.
 *
 * # Mount'ta okuyan çocuklar `key`li
 *
 * `NotEditoru` açılış içeriğini, `SeansAltSatiri` "Ödendi" kutusunu yalnızca
 * MOUNT'ta okur; seçili seans değişince ikisi de seans kimliğiyle yeniden
 * monte edilir (takvim tarafındaki emsalle aynı desen). `EtiketSatiri` de
 * (kutudaki yazılmış ama gönderilmemiş ad ve son hata yerel state'i —
 * `key`siz, önceki seansa yazılan ad yeni seansın kutusunda kalır ve Enter
 * onu YANLIŞ seansa ekler).
 *
 * # Etikete göre süzme (Plan 6 Görev 6)
 *
 * Listenin üstündeki seçim yalnızca BU danışanın seanslarında kullanılan
 * etiketleri sunar (`DanisanSeansi.etiketler`'den türetilir — ayrı bir istek
 * yok). Süzgeç bu bileşenin yerel state'i: danışan değişince bileşen
 * (`key={danisan-<id>}`) yeniden monte olur ve süzgeç sıfırlanır — bir
 * danışanda seçilen etiket başka danışanın dosyasına taşınmaz. Seçili etiket
 * son seanstan da kaldırılırsa seçenek listeden düşer ve süzgeç kendiliğinden
 * "Tüm seanslar"a döner (render'da türetiliyor, efekt yok).
 *
 * Süzgeç SEÇİMİ değiştirmez: süzülmüş listede görünmeyen seçili seansın
 * notu sağda açık kalır. Süzgeci değiştirmek terapistin elinin altındaki
 * editörü değiştirmemeli. İstisna: B2 bağlantısı gizli bir seansı seçerse
 * süzgeç "Tüm seanslar"a çekilir (`ozettenSec`).
 */
type Props = {
  kart: KartVerisi
  /** Yamalı seans listesi (`useDanisanSeanslari`). */
  seanslar: DanisanSeansi[]
  /** Bkz. `SeansListesi.tsx` — burada yalnızca DEVRALINIP iletiliyor. */
  yuklendi?: boolean
  /** Seans listesi yüklenemediyse mesajı (son inceleme I4). */
  seansHata?: string | null
  onSeansYenidenDene?: () => void
  /** Seçili seans (`useDanisanSeanslari.seciliSeansId`). */
  seciliSeansId: number | null
  onSeansSec: (appointmentId: number) => void
  /** Seçili seansın notu (`useDosyaNotu`); `null` = yükleniyor. */
  not: SeansNotu | null
  notHata: string | null
  onNotYenidenDene: () => void
  onNotKaydet: (appointmentId: number, kayit: NotKaydi) => Promise<void>
  onDurumDegis: (appointmentId: number, durum: string) => Promise<void>
  onOdemeDegis: (appointmentId: number, odendi: boolean) => Promise<void>
  altSekme: DosyaAltSekme
  onAltSekme: (sekme: DosyaAltSekme) => void
  bugun: string
  /**
   * Uygulamadaki TEK "şimdi" (`yerelGun.ts::useDakikalikSimdi`, çağıran
   * `DanisanlarSekmesi`): başlık özeti (B2) ve liste düzeni (B3).
   */
  simdi: string
  veriRaporuIndir: (danisanId: number, parola: string) => Promise<void>
  ekYukle: (dosya: File, tur: string) => Promise<void>
  ekSil: (ekId: number) => Promise<void>
  onRizaKaydet: (alan: { riza_tarihi: string; riza_dosya_id: number | null }) => Promise<void>
  onKapat: () => void
  /**
   * Seçili seansın etiketleri (`AnaEkran.etiketBaglami`). İsteğe bağlı: bu
   * bileşenin kendi testlerinin çoğu etiketsiz kurulur; üretimde
   * `DanisanlarSekmesi` her zaman geçirir.
   */
  etiketBaglami?: (appointmentId: number) => EtiketBaglami
}

export function DanisanDosyasi({
  kart,
  seanslar,
  yuklendi,
  seansHata = null,
  onSeansYenidenDene,
  seciliSeansId,
  onSeansSec,
  not,
  notHata,
  onNotYenidenDene,
  onNotKaydet,
  onDurumDegis,
  onOdemeDegis,
  altSekme,
  onAltSekme,
  bugun,
  simdi,
  veriRaporuIndir,
  ekYukle,
  ekSil,
  onRizaKaydet,
  onKapat,
  etiketBaglami,
}: Props) {
  const [suzgec, setSuzgec] = useState('')
  const [kaydirmaIstegi, setKaydirmaIstegi] = useState(0)
  const kullanilanEtiketler = [...new Set(seanslar.flatMap((s) => s.etiketler))].sort(etiketSirasi)
  const etkinSuzgec = kullanilanEtiketler.includes(suzgec) ? suzgec : ''

  // B2 bağlantısı: Seanslar'a geç, seç, gizleyen süzgeci kaldır, göster.
  // Hedef yüklü listede YOKSA (bayat liste, `seansSec` yeniden çektirir)
  // süzgecin onu gizleyip gizlemeyeceği bilinemez: süzgeç yine sıfırlanır.
  function ozettenSec(appointmentId: number) {
    const hedef = seanslar.find((s) => s.appointment_id === appointmentId)
    if (etkinSuzgec !== '' && !(hedef?.etiketler.includes(etkinSuzgec) ?? false)) setSuzgec('')
    onAltSekme('seanslar')
    onSeansSec(appointmentId)
    setKaydirmaIstegi((n) => n + 1)
  }

  const gorunenSeanslar =
    etkinSuzgec === '' ? seanslar : seanslar.filter((s) => s.etiketler.includes(etkinSuzgec))
  const seciliSeans = seanslar.find((s) => s.appointment_id === seciliSeansId) ?? null
  // Not seçili seansa ait değilse (seçim değişti, yenisi yükleniyor)
  // gösterilmez — bir seansın notu başka seansın editöründe bir kare bile
  // görünmesin.
  const notGorunen = not !== null && not.appointment_id === seciliSeansId ? not : null

  // `SeansAltSatiri` yalnızca `durum`/`ucret`/`odendi` istiyor (`Pick`,
  // bkz. o dosyadaki gerekçe).
  const seciliRandevuOzeti: Pick<Randevu, 'durum' | 'ucret' | 'odendi'> | null =
    seciliSeans === null
      ? null
      : { durum: seciliSeans.durum, ucret: seciliSeans.ucret_kurus, odendi: seciliSeans.odendi }

  const seanslarSekmesiSecili = altSekme === 'seanslar'
  const adSoyad = kart.dosya?.ad_soyad ?? ''

  return (
    <div>
      <h2 id="danisan-dosyasi-basligi" className="mb-2 text-lg font-semibold">
        {adSoyad}
      </h2>
      <DosyaOzetiSatiri randevular={kart.randevular} simdi={simdi} onSec={ozettenSec} />
      <div role="tablist" aria-label="Danışan dosyası bölümleri" className="flex gap-1">
        <button
          type="button"
          role="tab"
          id="danisan-dosyasi-sekme-seanslar"
          aria-selected={seanslarSekmesiSecili}
          aria-controls={seanslarSekmesiSecili ? 'danisan-dosyasi-panel-seanslar' : undefined}
          onClick={() => onAltSekme('seanslar')}
          className={
            'rounded-t border-b-2 px-3 py-1 text-sm ' +
            (seanslarSekmesiSecili
              ? 'border-slate-900 font-medium text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800')
          }
        >
          Seanslar
        </button>
        <button
          type="button"
          role="tab"
          id="danisan-dosyasi-sekme-bilgiler"
          aria-selected={!seanslarSekmesiSecili}
          aria-controls={!seanslarSekmesiSecili ? 'danisan-dosyasi-panel-bilgiler' : undefined}
          onClick={() => onAltSekme('bilgiler')}
          className={
            'rounded-t border-b-2 px-3 py-1 text-sm ' +
            (!seanslarSekmesiSecili
              ? 'border-slate-900 font-medium text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800')
          }
        >
          Bilgiler
        </button>
      </div>

      {seanslarSekmesiSecili ? (
        <div
          role="tabpanel"
          id="danisan-dosyasi-panel-seanslar"
          aria-labelledby="danisan-dosyasi-sekme-seanslar"
          className="mt-3 grid grid-cols-[16rem_1fr] gap-4"
        >
          {seansHata !== null ? (
            // Son inceleme I4: yüklenemeyen liste "seans yok" DEĞİLDİR.
            // Liste de sağ kolon da gösterilmez — boş bir liste ile
            // "seansı yok" metni, seansı olan bir danışan için sessiz bir
            // yalan olurdu.
            <div role="alert" className="col-span-2 rounded border border-red-300 bg-red-50 p-3">
              <p className="text-sm text-red-800">Seanslar yüklenemedi. {seansHata}</p>
              {onSeansYenidenDene !== undefined && (
                <button
                  type="button"
                  className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
                  onClick={onSeansYenidenDene}
                >
                  Yeniden dene
                </button>
              )}
            </div>
          ) : (
            <>
              <div>
                {kullanilanEtiketler.length > 0 && (
                  <div className="mb-2">
                    <label htmlFor="etikete-gore-suz" className="block text-xs text-slate-600">
                      Etikete göre süz
                    </label>
                    <select
                      id="etikete-gore-suz"
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      value={etkinSuzgec}
                      onChange={(olay) => setSuzgec(olay.target.value)}
                    >
                      <option value="">Tüm seanslar</option>
                      {kullanilanEtiketler.map((ad) => (
                        <option key={ad} value={ad}>
                          {ad}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <SeansListesi
                  seanslar={gorunenSeanslar}
                  secili={seciliSeansId}
                  onSecim={onSeansSec}
                  yuklendi={yuklendi}
                  kaydirmaIstegi={kaydirmaIstegi}
                />
              </div>

              <div>
                {seciliSeans === null ? (
                  <p className="text-sm text-slate-500">Bu danışanın kayıtlı bir seansı yok.</p>
                ) : (
                  <>
                    {notHata !== null ? (
                      <div role="alert" className="rounded border border-red-300 bg-red-50 p-3">
                        <p className="text-sm text-red-800">Not yüklenemedi. {notHata}</p>
                        <button
                          type="button"
                          className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
                          onClick={onNotYenidenDene}
                        >
                          Yeniden dene
                        </button>
                      </div>
                    ) : notGorunen === null ? (
                      <p className="text-sm text-slate-600">Seans notu yükleniyor…</p>
                    ) : (
                      <NotEditoru
                        key={`dosya-not-${seciliSeans.appointment_id}`}
                        // Boş içerik şablon başlıklarıyla açılır -- takvimdeki
                        // `SeansPaneli` ile AYNI dönüşüm, AYNI ölçüt (Görev
                        // 6e). Eskiden burası ham (`''`) açıyordu: aynı seans
                        // takvimde şablon başlıklarıyla, dosyada bomboş
                        // görünüyordu ve bu "iki ekran aynı seansı aynı
                        // gösterir" kuralının dışındaydı. Veri kaybı yok
                        // (imza kontrolü boş şablonla yazma üretmez, bkz.
                        // `NotEditoru`), yalnızca İLK GÖRÜNÜM tutarlı hâle
                        // geldi.
                        baslangicIcerik={notGorunen.icerik === '' ? sablonMetni(notGorunen.sablon) : notGorunen.icerik}
                        baslangicSablon={notGorunen.sablon}
                        // Başka bir yoldan (takvim editörünün unmount
                        // tahliyesi) gelen kayıt bu editör monte olduktan
                        // SONRA biterse, editör temizse onu benimser (son
                        // inceleme C1 — bkz. `NotEditoru::sunucuHali`). Açılış
                        // içeriğiyle AYNI dönüşüm uygulanır (yoksa boş not
                        // için başlıklar ile `''` farklı sayılır ve editör
                        // başlıkları silerdi -- `SeansPaneli` ile aynı gerekçe).
                        sunucuHali={{
                          sablon: notGorunen.sablon,
                          icerik: notGorunen.icerik === '' ? sablonMetni(notGorunen.sablon) : notGorunen.icerik,
                        }}
                        // Taslak anahtarı takvimdekiyle AYNI (`not-<id>`):
                        // aynı resmî not, aynı taslak. Ayrı anahtarlar (eski
                        // `danisan-not-<id>`) iki ekranda iki ayrı taslak
                        // demekti — kilitten sonra birinde kurtarılan metin
                        // diğerinde yazılmış olanın üstüne PUT edilebilirdi.
                        taslakAnahtari={`not-${seciliSeans.appointment_id}`}
                        onKaydet={(kayit) => onNotKaydet(seciliSeans.appointment_id, kayit)}
                      />
                    )}

                    {etiketBaglami !== undefined && (
                      <EtiketSatiri
                        // ZORUNLU (bkz. modül başlığı): bu bileşen seçim
                        // değişince yeniden monte OLMUYOR; kutudaki yazı ve
                        // hata önceki seanstan kalırdı.
                        key={`dosya-etiket-${seciliSeans.appointment_id}`}
                        kimlik={`dosya-${seciliSeans.appointment_id}`}
                        {...etiketBaglami(seciliSeans.appointment_id)}
                      />
                    )}

                    {seciliRandevuOzeti !== null && (
                      <SeansAltSatiri
                        // ZORUNLU: "Ödendi" kutusu yalnızca MOUNT'ta okunur;
                        // `key`siz bir seansın iyimser kutu değeri bir
                        // SONRAKİ seçilen seansta ekranda kalırdı.
                        key={`seans-alt-${seciliSeans.appointment_id}`}
                        randevu={seciliRandevuOzeti}
                        onDurumDegis={(durum) => onDurumDegis(seciliSeans.appointment_id, durum)}
                        onOdemeDegis={(odendi) => onOdemeDegis(seciliSeans.appointment_id, odendi)}
                      />
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          id="danisan-dosyasi-panel-bilgiler"
          aria-labelledby="danisan-dosyasi-sekme-bilgiler"
          className="mt-3"
        >
          {kart.dosya !== null && (
            <DosyaBilgileri
              danisan={kart.dosya}
              ekler={kart.ekler}
              randevular={kart.randevular}
              bugun={bugun}
              veriRaporuIndir={veriRaporuIndir}
              ekYukle={ekYukle}
              ekSil={ekSil}
              onRizaKaydet={onRizaKaydet}
              onKapat={onKapat}
            />
          )}
        </div>
      )}
    </div>
  )
}
