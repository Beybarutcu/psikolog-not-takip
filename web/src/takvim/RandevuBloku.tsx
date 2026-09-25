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

export function RandevuBloku({ randevu, onSec }: { randevu: Randevu; onSec: () => void }) {
  const stil = DURUM_BICIMI[randevu.durum] ?? BILINMEYEN_DURUM_BICIMI
  return (
    <button
      onClick={onSec}
      // data-durum: testlerin (ve olasi baska tuketicilerin) gorsel
      // sinif adina/renge degil, semantik duruma bagli kalabilmesi icin.
      // Renk ya da sinif adi degisirse bu oznitelik degismez.
      data-durum={randevu.durum}
      // data-ucret (kuruş): bir randevu GÜNCELLENDİĞİNDE ızgarada hiçbir şey
      // değişmiyordu — blok yalnızca danışan adını gösteriyor, React de aynı
      // `key` ile aynı DOM'u üretiyor. Yani "güncelleme ekrana yansıdı"
      // diyebilecek gözlemlenebilir bir işaret yoktu ve e2e'deki
      // "kopya oluşmadı" sayımı, işlem BİTMEDEN, önceki durumu ölçüp geçiyordu
      // (bkz. e2e/takvim.spec.ts). Bu öznitelik o senkronizasyon bariyerini
      // sağlar. `data-durum` ile aynı gerekçe: görsele değil, semantik veriye
      // bağlı kalınsın. Ücret yoksa öznitelik hiç basılmaz.
      data-ucret={randevu.ucret ?? undefined}
      className={`w-full truncate rounded px-1 py-0.5 text-left text-xs ${stil}`}
    >
      {/* Görev 8 (R2): saat yalnızca TAM OLMAYAN (off-hour) randevularda
          gösterilir — tam saatteki bloklar var olan e2e seçicilerinin
          dayandığı "yalnızca isim" adını korur. Saat ile isim arasında
          GERÇEK bir metin boşluğu (`{' '}`) var: yalnızca CSS margin
          (`mr-1`) kullanılsaydı erişilebilir ad "10:50Ayşe Yılmaz" çıkardı
          — erişilebilir ad hesaplaması CSS'i değil metni okur. */}
      {randevu.baslangic.slice(14, 16) !== '00' && (
        <>
          <span className="tabular-nums">{randevu.baslangic.slice(11, 16)}</span>{' '}
        </>
      )}
      {randevu.danisan_adi}
    </button>
  )
}
