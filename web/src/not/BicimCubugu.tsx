import type { BicimTuru } from './bicim'

type Props = {
  onUygula: (tur: BicimTuru) => void
}

type Dugme = { tur: BicimTuru; etiket: string; kisayol?: string }

// Sıra ekranda görünen sıradır. Kısayolu OLMAYAN düğmelerde (`numara`,
// `alinti`, `onay`) `kisayol` alanı bilerek yok — görev brief'i yalnızca
// Ctrl+B, Ctrl+I, Ctrl+1/2/3 ve Ctrl+Shift+8'i tanımlıyor; uydurma bir
// kısayol yazmak kullanıcıyı çalışmayan bir tuşa güvendirirdi.
const DUGMELER: Dugme[] = [
  { tur: 'kalin', etiket: 'Kalın', kisayol: 'Ctrl+B' },
  { tur: 'italik', etiket: 'İtalik', kisayol: 'Ctrl+I' },
  { tur: 'baslik1', etiket: 'Başlık 1', kisayol: 'Ctrl+1' },
  { tur: 'baslik2', etiket: 'Başlık 2', kisayol: 'Ctrl+2' },
  { tur: 'baslik3', etiket: 'Başlık 3', kisayol: 'Ctrl+3' },
  { tur: 'madde', etiket: 'Madde listesi', kisayol: 'Ctrl+Shift+8' },
  { tur: 'numara', etiket: 'Numaralı liste' },
  { tur: 'alinti', etiket: 'Alıntı' },
  { tur: 'onay', etiket: 'Onay kutusu' },
]

/**
 * Not editörünün biçim araç çubuğu. Saf gösterim: seçilen türü
 * `onUygula`'ya bildirir, metne KENDİSİ dokunmaz — `NotEditoru` sonucu
 * kendi `onChange` yolundan (`bicimUygula` → `setIcerik`) yazar.
 *
 * Düğmenin erişilebilir adı kısayolu da söyler (ör. "Kalın (Ctrl+B)"):
 * ekran okuyucu kullanıcısı düğmeyi bulduğunda kısayolu da öğrenir, ikinci
 * bir kaynağa bakmasına gerek kalmaz.
 */
export function BicimCubugu({ onUygula }: Props) {
  return (
    <div role="toolbar" aria-label="Biçim" className="mb-1 flex flex-wrap gap-1">
      {DUGMELER.map((d) => (
        <button
          key={d.tur}
          type="button"
          className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
          // Fare ile tıklamada odağın textarea'dan düğmeye kayması
          // ENGELLENİR: aksi hâlde tarayıcı tıklama sırasında önce
          // textarea'yı bulanıklaştırır (blur) ve biçim, kullanıcının SEÇİP
          // bıraktığı metin yerine yanlış (ör. imlecin son bulunduğu)
          // konumda uygulanma riskiyle karşılaşabilirdi.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onUygula(d.tur)}
        >
          {d.kisayol ? `${d.etiket} (${d.kisayol})` : d.etiket}
        </button>
      ))}
    </div>
  )
}
