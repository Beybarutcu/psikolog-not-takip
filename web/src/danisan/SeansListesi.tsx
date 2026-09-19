import type { DanisanSeansi } from '../api'
import { tlMetni } from '../para'
import { zamanMetni } from '../tarih'

/**
 * Danışan dosyasının Seanslar alt sekmesinde SOL kolon: danışanın tüm
 * seansları, en yeniden eskiye (sıralama sunucudan gelir, bkz.
 * `api.ts::danisanApi.seanslar`).
 *
 * # Kontrollü bileşen: seçimi TUTMAZ
 *
 * `Sekmeler` ile aynı ilke (bkz. `kabuk/Sekmeler.tsx` modül başlığı):
 * `secili` dışarıdan gelir, tıklama yalnızca `onSecim` ile bildirilir. Sahip
 * `DanisanDosyasi`'dir — çünkü seçili seansın notunu YÜKLEMEK de onun işi ve
 * "hangi seans açık" bilgisi ikisi arasında paylaşılmak zorunda.
 *
 * # `secili === null` iken en yeni seans GÖRSEL olarak vurgulanır
 *
 * `DanisanDosyasi` `secili`yi RENDER SIRASINDA türetiyor (`seciliManuel`
 * geçerliyse o, değilse en yenisi — bkz. o dosyanın modül başlığı), yani
 * liste doluyken bu bileşene fiilen HİÇBİR ZAMAN `null` geçmiyor —
 * `DanisanDosyasi.test.tsx`'teki testler bu hattı zaten ölçüyor. `secili
 * === null` yedeği burada yine de duruyor çünkü bu bileşen KENDİ BAŞINA
 * (bu dosyanın kendi testlerinde olduğu gibi) `secili={null}` ile
 * çağrılabilir bir SÖZLEŞME taşıyor: sahibi olmayan bir çağıran "hiçbir
 * şey seçmedim" derse bileşen yine de sunucunun sıraladığı en yeniyi
 * (`seanslar[0]`) vurgular, boş bir listeye düşmez.
 */
type Props = {
  seanslar: DanisanSeansi[]
  secili: number | null
  onSecim: (appointmentId: number) => void
  /**
   * `useDanisanSeanslari`nin seçili danışan için yanıtı (başarı ya da hata)
   * ALDIĞINI işaretler. Varsayılan `true`: bu bileşenin KENDİ testleri ve
   * `DanisanDosyasi.test.tsx`'teki sahte kartlar zaten sabit bir liste
   * geçiyor, "yükleniyor" durumuyla ilgilenmiyorlar — prop'u atlayan her
   * çağıran eskisi gibi davranmaya devam eder. Gerçek akışta (`AnaEkran`,
   * Görev 8) `false` başlar, yanıt gelince `true` olur; `e2e/kabuk.spec.ts`
   * bunu bir SENKRONİZASYON BARİYERİ olarak okur (bkz.
   * `useDanisanSeanslari.ts` modül başlığındaki aynı gerekçe).
   */
  yuklendi?: boolean
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
 * ikisi ekranda AYNI görünmemeli (bkz. `api.ts::DanisanSeansi` modül
 * başlığı). `null` iken `tlMetni(0)` BASILMAZ, ayırt edici bir işaret
 * ("—") kullanılır.
 */
function ucretMetni(kurus: number | null): string {
  return kurus === null ? '—' : tlMetni(kurus)
}

/**
 * `not_ilk_satiri`: `null` = "not hiç yazılmamış", `''` = "not açılmış ama
 * boş bırakılmış" — ikisi ekranda AYNI görünmemeli (bkz. `api.ts`
 * modül başlığındaki aynı ayrım). `''` için "Not yazılmamış" metni
 * KULLANILMAZ: kullanıcı notu açıp yazmaya başladığını, hiç açmadığından
 * ayırt edebilmeli.
 */
function notOnizlemesi(satir: string | null) {
  if (satir === null) {
    return <span className="italic text-slate-400">Not yazılmamış</span>
  }
  if (satir === '') {
    return <span className="italic text-slate-400">Not açıldı, henüz boş</span>
  }
  return <span className="truncate text-slate-600">{satir}</span>
}

export function SeansListesi({ seanslar, secili, onSecim, yuklendi = true }: Props) {
  const etkiliSecili = secili ?? seanslar[0]?.appointment_id ?? null
  const yuklendiOzniteligi = yuklendi ? 'evet' : 'hayir'

  if (seanslar.length === 0) {
    return (
      <p data-testid="seans-listesi" data-yuklendi={yuklendiOzniteligi} className="text-sm text-slate-500">
        Bu danışanın kayıtlı bir seansı yok.
      </p>
    )
  }

  return (
    <ul
      data-testid="seans-listesi"
      data-yuklendi={yuklendiOzniteligi}
      className="flex flex-col gap-1 text-sm"
    >
      {seanslar.map((s) => {
        const aktif = s.appointment_id === etkiliSecili
        return (
          <li key={s.appointment_id}>
            <button
              type="button"
              aria-current={aktif ? 'true' : undefined}
              onClick={() => onSecim(s.appointment_id)}
              className={
                'flex w-full flex-col items-start gap-0.5 rounded border px-2 py-1 text-left ' +
                (aktif ? 'border-slate-900 bg-slate-100' : 'border-slate-200 hover:bg-slate-50')
              }
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium">{zamanMetni(s.baslangic)}</span>
                <span className="text-xs text-slate-500">{durumAdi(s.durum)}</span>
              </span>
              <span className="flex w-full items-center justify-between gap-2 text-xs">
                {notOnizlemesi(s.not_ilk_satiri)}
                <span className="shrink-0 text-slate-500">
                  {ucretMetni(s.ucret_kurus)}
                  {s.odendi ? ' · Ödendi' : ''}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
