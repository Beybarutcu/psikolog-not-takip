import type { BlokKonumu, Sutun } from './blokYerlesimi'
import { DurumSimgeleri } from './DurumSimgeleri'
import { durumSimgeMetni } from './durumSimgesi'
import type { Randevu } from './HaftalikTakvim'

const DURUM_BICIMI: Record<string, string> = {
  planlandi: 'bg-slate-800 text-white',
  geldi: 'bg-emerald-700 text-white',
  gelmedi: 'bg-amber-600 text-white',
  iptal: 'bg-slate-200 text-slate-500 line-through',
}

// Sunucu, bu bileşenin bilmediği yeni bir durum değeri gönderirse (örn.
// ileride eklenen bir durum burada güncellenmeyi unutulursa) sessizce
// "planlandi" stiline düşmek yanlış bilgilendirmeye yol açar — kullanıcı
// iptal edilmiş bir randevuyu planlanmış sanabilir. Bunun yerine, normal
// durumların hiçbirine benzemeyen, dikkat çekici/uyarı hissi veren ayrı bir
// stil kullanılır.
const BILINMEYEN_DURUM_BICIMI =
  'bg-white text-slate-900 border-2 border-dashed border-red-400'

type Props = {
  randevu: Randevu
  onSec: () => void
  /**
   * Izgaradaki yeri: üst kenar ve yükseklik (px, `blokYerlesimi.ts`) ile
   * çakışan randevular arasındaki sütunu. Blok, başladığı saatin hücresine
   * mutlak konumla oturur ve süresi kadar aşağı uzar.
   */
  konum: BlokKonumu & Sutun
}

export function RandevuBloku({ randevu, onSec, konum }: Props) {
  const stil = DURUM_BICIMI[randevu.durum] ?? BILINMEYEN_DURUM_BICIMI
  const { ust, yukseklik, sutun, sutunSayisi } = konum
  const saat = randevu.baslangic.slice(11, 16)
  return (
    <button
      onClick={onSec}
      // Erişilebilir ad tasarım T3: simgelerin anlamı sona eklenir; durumsuz
      // blokta ad metinle birebir aynı.
      aria-label={`${saat} ${randevu.danisan_adi}${durumSimgeMetni(randevu)}`}
      style={{
        top: ust,
        height: yukseklik,
        // Kenarlarda 2 px pay: yan yana iki blok ve hücre çizgisi birbirine
        // yapışmasın.
        left: `calc(${(sutun / sutunSayisi) * 100}% + 2px)`,
        width: `calc(${100 / sutunSayisi}% - 4px)`,
      }}
      // data-durum: testlerin (ve olasi baska tuketicilerin) gorsel
      // sinif adina/renge degil, semantik duruma bagli kalabilmesi icin.
      // Renk ya da sinif adi degisirse bu oznitelik degismez.
      data-durum={randevu.durum}
      // data-ucret (kuruş): bir randevu GÜNCELLENDİĞİNDE ızgarada hiçbir şey
      // değişmiyordu — blok yalnızca saati ve danışan adını gösteriyor, React de aynı
      // `key` ile aynı DOM'u üretiyor. Yani "güncelleme ekrana yansıdı"
      // diyebilecek gözlemlenebilir bir işaret yoktu ve e2e'deki
      // "kopya oluşmadı" sayımı, işlem BİTMEDEN, önceki durumu ölçüp geçiyordu
      // (bkz. e2e/takvim.spec.ts). Bu öznitelik o senkronizasyon bariyerini
      // sağlar. `data-durum` ile aynı gerekçe: görsele değil, semantik veriye
      // bağlı kalınsın. Ücret yoksa öznitelik hiç basılmaz.
      data-ucret={randevu.ucret ?? undefined}
      // `z-[5]`: blok bir sonraki saatin hücresine taştığında o hücrenin
      // "boş saat" düğmesinin ÜSTÜNDE kalsın (yoksa bloğun alt yarısına
      // tıklamak yeni randevu açardı); şimdi çizgisi (`z-10`) yine de üstte.
      className={`absolute z-[5] flex items-start gap-0.5 overflow-hidden rounded px-1 py-0.5 text-left text-xs leading-4 ${stil}`}
    >
      {/* Başlangıç saati HER blokta, tam saatte başlayanlarda da. Saat ile isim
          arasında GERÇEK bir metin boşluğu (`{' '}`) var: yalnızca CSS margin
          kullanılsaydı erişilebilir ad "10:50Ayşe Yılmaz" çıkardı —
          erişilebilir ad hesaplaması CSS'i değil metni okur. */}
      <span data-testid="blok-adi" className="min-w-0 flex-1 break-words">
        <span className="tabular-nums">{saat}</span>{' '}
        {randevu.danisan_adi}
      </span>
      <DurumSimgeleri randevu={randevu} />
    </button>
  )
}
