import { useEffect, useRef, useState } from 'react'
import type { DanisanSeansi } from '../api'
import { tlMetni } from '../para'
import { zamanMetni } from '../tarih'
import { seansGruplari } from './seansGruplari'

/**
 * Danışan dosyasının Seanslar alt sekmesinde SOL kolon (tasarım B3 — uzun
 * geçmiş düzeni). Düzenin kuralı saf işlevde (`seansGruplari.ts`); bu
 * bileşen yalnızca çizer.
 *
 * # Düzen
 *
 *   - **"Yaklaşan (n)"**: `baslangic > simdi` satırları, en yakın üstte,
 *     varsayılan KATLI. Açıklık seçimden türetilir: seçili seans buradaysa
 *     grup ZORLA açıktır (düğme devre dışı). Kullanıcının açıp kapaması
 *     yalnızca öyle değilken geçerlidir. Katlı grubun satırları DOM'da
 *     YOKTUR: kullanıcının göremediği satıra test de tıklayamaz.
 *   - Gelecekteki satır "Not yazılmamış" YAZMAZ (henüz yaşanmadı). Notsuzluk
 *     yine `data-not="yok"` ile okunur; boş not ("Not açıldı, henüz boş")
 *     ve önizleme aynen görünür.
 *   - Geçmiş seanslar AYLARA göre: "Eylül 2026 · 4 seans" (sayı GÖRÜNEN
 *     `geldi` satırları). Başlıklar kaydırma kabı içinde yapışkandır.
 *   - `geldi` satırında sıra numarası ("#14"): harita çağırandan gelir
 *     (`dosyaOzeti.ts::seansNumaralari`, `kart.randevular`, süzgeçten önce).
 *     Haritada olmayan satırda numara yok.
 *
 * Grup `<div role="group">`, landmark DEĞİL: her ay için bir `region`,
 * "Seans" adlı bölgeyi arayan seçicileri belirsizleştirirdi.
 *
 * # Kontrollü bileşen: seçimi TUTMAZ
 *
 * `secili` dışarıdan gelir, tıklama yalnızca `onSecim` ile bildirilir
 * (sahibi `useDanisanSeanslari`, son inceleme M1: sekme gidip gelince
 * korunsun diye `AnaEkran`'da yaşıyor). `secili === null` iken
 * `seanslar[0]` (sunucunun en yenisi) vurgulanır: sahibi olmayan çağıranlar
 * için sözleşme (bkz. bu dosyanın testleri). Üretimde liste doluyken
 * `null` geçmez (`danisan/seansSecimi.ts` seçimi türetir).
 *
 * # Seçili satır görünür alana gelir (tasarım B2/B3)
 *
 * `scrollIntoView({ block: 'nearest' })`, odak VERMEDEN (A6): açılışta
 * (takvimden, aramadan gelince), seçim değişince ve kullanıcı istediğinde
 * (`kaydirmaIstegi`, B2 bağlantıları: seçim değişmese de). Seçim Yaklaşan'a
 * düşerse grup aynı çizimde açılır, efekt satırı bulur. Bileşen her monte
 * oluşta da çalışır, yani sekmeye dönüşte ve Bilgiler→Seanslar geçişinde
 * de; `nearest` satır zaten görünüyorsa hiçbir şeyi kıpırdatmaz. Aynı
 * seçimle liste tazelemesi (yeni dizi) kaydırmaz.
 *
 * # Satırda etiketler (Plan 6 Görev 6)
 *
 * Etiket adları küçük, TIKLANAMAZ işaretler: satırın tamamı bir düğme ve
 * düğme içinde düğme olamaz. Adlar React metni olarak basılır, HTML olarak
 * değil. Süzme bu bileşende DEĞİL: `DanisanDosyasi` süzülmüş listeyi geçirir.
 */
type Props = {
  seanslar: DanisanSeansi[]
  secili: number | null
  onSecim: (appointmentId: number) => void
  /**
   * `useDanisanSeanslari`nin seçili danışan için yanıtı (başarı ya da hata)
   * ALDIĞINI işaretler. Varsayılan `true`: prop'u atlayan çağıranlar (bu
   * bileşenin kendi testleri, sahte kartlar) sabit bir liste geçiyor. Gerçek
   * akışta (`AnaEkran`) `false` başlar, yanıt gelince `true` olur;
   * `e2e/kabuk.spec.ts` bunu bir SENKRONİZASYON BARİYERİ olarak okur
   * (`data-yuklendi`).
   */
  yuklendi?: boolean
  /** Uygulamadaki TEK "şimdi" (`useDakikalikSimdi`); Yaklaşan/geçmiş sınırı. */
  simdi: string
  /** `appointment_id → n` (yalnızca `geldi`); bkz. modül başlığı. */
  numaralar?: ReadonlyMap<number, number>
  /**
   * Kullanıcının "bu seansı göster" isteği sayacı (tasarım B2 bağlantıları).
   * Seçim DEĞİŞMEDEN de (zaten seçili seansın bağlantısı) satırın yeniden
   * görünür alana getirilmesi için. Varsayılan 0.
   */
  kaydirmaIstegi?: number
}

const DURUM_ADLARI: Record<string, string> = {
  planlandi: 'Planlandı',
  geldi: 'Geldi',
  gelmedi: 'Gelmedi',
  iptal: 'İptal',
}

// Sunucu bu bileşenin bilmediği bir durum gönderirse ham kodu olduğu gibi
// göster — uydurulmuş bir Türkçe etiket, ham değeri göstermekten kötüdür
// (bkz. `danisan/bicim.ts::tarihBicimle`'deki aynı ilke).
function durumAdi(durum: string): string {
  return DURUM_ADLARI[durum] ?? durum
}

/**
 * `ucret_kurus`: `null` = "ücret hiç girilmemiş", `0` = "ücretsiz seans" —
 * ikisi ekranda AYNI görünmemeli (bkz. `api.ts::DanisanSeansi`). `null`
 * iken `tlMetni(0)` BASILMAZ, ayırt edici bir işaret ("—") kullanılır.
 */
function ucretMetni(kurus: number | null): string {
  return kurus === null ? '—' : tlMetni(kurus)
}

/**
 * `not_ilk_satiri`: `null` = "not hiç yazılmamış", `''` = "not açılmış ama
 * boş bırakılmış" — ikisi ekranda AYNI görünmemeli: kullanıcı notu açıp
 * yazmaya başladığını, hiç açmadığından ayırt edebilmeli. Gelecekteki
 * satırda `null` HİÇBİR ŞEY yazmaz (tasarım B3).
 */
function notOnizlemesi(satir: string | null, gelecek: boolean) {
  if (satir === null) {
    return gelecek ? null : <span className="italic text-slate-400">Not yazılmamış</span>
  }
  if (satir === '') {
    return <span className="italic text-slate-400">Not açıldı, henüz boş</span>
  }
  // Tek satır tasarım: uzun satır üç noktayla kısalır, tamamı `title`'da
  // (sunucu önizlemeyi zaten 120 karakterde kırpar).
  return (
    <span className="min-w-0 truncate text-slate-600" title={satir}>
      {satir}
    </span>
  )
}

const BOS_NUMARALAR: ReadonlyMap<number, number> = new Map()

export function SeansListesi({
  seanslar,
  secili,
  onSecim,
  yuklendi = true,
  simdi,
  numaralar = BOS_NUMARALAR,
  kaydirmaIstegi = 0,
}: Props) {
  const etkiliSecili = secili ?? seanslar[0]?.appointment_id ?? null
  const yuklendiOzniteligi = yuklendi ? 'evet' : 'hayir'
  // Kullanıcının Yaklaşan grubu için tercihi; seçim onu ZORLA ezebilir.
  const [yaklasanIstegi, setYaklasanIstegi] = useState(false)

  // Seçili satır görünür alana gelir (bkz. modül başlığı). Aynı seçimle
  // liste tazelemesi kaydırmaz: bağımlılıklar değişmez. Odak verilmez (A6).
  const seciliSatirRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    seciliSatirRef.current?.scrollIntoView({ block: 'nearest' })
  }, [etkiliSecili, kaydirmaIstegi])

  if (seanslar.length === 0) {
    return (
      <p data-testid="seans-listesi" data-yuklendi={yuklendiOzniteligi} className="text-sm text-slate-500">
        Bu danışanın kayıtlı bir seansı yok.
      </p>
    )
  }

  const { yaklasan, aylar } = seansGruplari(seanslar, simdi)
  const zorlaAcik = yaklasan.some((s) => s.appointment_id === etkiliSecili)
  const yaklasanAcik = zorlaAcik || yaklasanIstegi

  function satir(s: DanisanSeansi, gelecek: boolean) {
    const aktif = s.appointment_id === etkiliSecili
    const numara = numaralar.get(s.appointment_id)
    return (
      <li key={s.appointment_id}>
        <button
          ref={aktif ? seciliSatirRef : undefined}
          type="button"
          aria-current={aktif ? 'true' : undefined}
          data-not={s.not_ilk_satiri === null ? 'yok' : s.not_ilk_satiri === '' ? 'bos' : 'dolu'}
          onClick={() => onSecim(s.appointment_id)}
          // `scroll-mt-7` (28 px): `block: 'nearest'` yukarı kaydırmada
          // satırın üstünü kabın üstüne koyar ve ayın opak yapışkan başlığı
          // (text-xs 16 + py-0.5 4 = 20 px; Yaklaşan'ınki text-sm satırıyla
          // ≈24 px) tarih, #n ve durumun üstüne binerdi. Pay SATIRDA, sütunda
          // (`scroll-pt`) değil: başlığın boyu da bu dosyada, `DanisanDosyasi`
          // onu bilmek zorunda kalmaz. Başlık büyürse pay da büyümeli.
          // Odak halkası İÇTE (`ring-inset`, yerel çerçeve gizli): liste
          // sütununun `overflow-y-auto`'su dışa çizilen çerçeveyi kırpardı
          // (B1'deki `ring-inset` ile aynı gerekçe).
          className={
            'flex w-full scroll-mt-7 flex-col items-start gap-0.5 rounded border px-2 py-1 text-left ' +
            'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ' +
            (aktif ? 'border-slate-900 bg-slate-100' : 'border-slate-200 hover:bg-slate-50')
          }
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className="font-medium">{zamanMetni(s.baslangic)}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
              {numara !== undefined && (
                <span data-testid="seans-numarasi" className="text-slate-400">
                  #{numara}
                </span>
              )}
              <span>{durumAdi(s.durum)}</span>
            </span>
          </span>
          <span className="flex w-full items-center justify-between gap-2 text-xs">
            {notOnizlemesi(s.not_ilk_satiri, gelecek)}
            <span className="ml-auto shrink-0 text-slate-500">
              {ucretMetni(s.ucret_kurus)}
              {s.odendi ? ' · Ödendi' : ''}
            </span>
          </span>
          {s.etiketler.length > 0 && (
            // Çip tek satır: uzun etiket (en çok 40 karakter) satırın
            // genişliğinde üç noktayla kısalır, tamamı `title`'da. `max-w-full`
            // kapta da gerekli: satır `items-start`, kap içeriğinin asgarisi
            // (boşluksuz en uzun çip) kadar genişleyip satırı taşırırdı.
            <span className="flex max-w-full flex-wrap gap-1" data-testid="satir-etiketleri">
              {s.etiketler.map((ad) => (
                <span key={ad} title={ad} className="max-w-full truncate rounded-full bg-sky-50 px-1.5 text-[11px] text-sky-800">
                  {ad}
                </span>
              ))}
            </span>
          )}
        </button>
      </li>
    )
  }

  return (
    <div data-testid="seans-listesi" data-yuklendi={yuklendiOzniteligi} className="flex flex-col gap-3 text-sm">
      {yaklasan.length > 0 && (
        <div role="group" aria-labelledby="seans-grubu-yaklasan">
          <h3 id="seans-grubu-yaklasan" className="sticky top-0 z-10 bg-white py-0.5">
            <button
              type="button"
              aria-expanded={yaklasanAcik}
              aria-controls={yaklasanAcik ? 'yaklasan-seanslar' : undefined}
              disabled={zorlaAcik}
              title={zorlaAcik ? 'Seçili seans bu grupta; grup açık kalır.' : undefined}
              onClick={() => setYaklasanIstegi(!yaklasanAcik)}
              // Odak halkası İÇTE: düğme sütunun sol üst köşesinde, dışa
              // çizilen çerçeve `overflow-y-auto` ile kırpılırdı.
              className="rounded px-1 text-xs font-medium text-slate-600 underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 disabled:no-underline"
            >
              {`Yaklaşan (${yaklasan.length})`}
            </button>
          </h3>
          {yaklasanAcik && (
            <ul id="yaklasan-seanslar" className="mt-1 flex flex-col gap-1">
              {yaklasan.map((s) => satir(s, true))}
            </ul>
          )}
        </div>
      )}
      {aylar.map((g) => (
        <div key={g.anahtar} role="group" aria-labelledby={`seans-ayi-${g.anahtar}`}>
          <h3
            id={`seans-ayi-${g.anahtar}`}
            className="sticky top-0 z-10 bg-white py-0.5 text-xs font-medium text-slate-600"
          >
            {g.baslik}
          </h3>
          <ul className="mt-1 flex flex-col gap-1">{g.seanslar.map((s) => satir(s, false))}</ul>
        </div>
      ))}
    </div>
  )
}
