import { markdownOgeleri } from './markdown'

type Props = {
  kaynak: string
}

/**
 * Notun **biçimli okuma görünümü** — `markdownOgeleri`'nin ürettiği düz React
 * elemanlarını (h3/h4/h5/p/ul/ol/li/blockquote/strong/em/input[checkbox])
 * okunaklı tipografi sınıflarıyla sarar.
 *
 * Tailwind'in `preflight` sıfırlaması başlıkların büyüklüğünü/kalınlığını ve
 * listelerin madde işaretini kaldırır; bu bileşen olmadan `markdownOgeleri`
 * çıktısı görsel olarak düz bir paragraf yığınından ayrışmaz. Yeni npm paketi
 * (ör. `@tailwindcss/typography`) EKLENMİYOR — keyfi değişken seçicilerle
 * (`[&_h3]:...`) elle karşılığı veriliyor; bu proje genelindeki "yeni paket
 * yok" kısıtıyla tutarlı.
 *
 * Salt okunurdur: `NotEditoru`'nun "Önizle" kipinde kullanılır ve
 * `GecmisNotlar`'ın geçmiş not gövdesinde. Hiçbir yerde `onChange` yoktur —
 * biçim yalnızca editördeki araç çubuğu/kısayollar üzerinden, textarea'nın
 * kendi metnine uygulanır.
 */
export function NotGorunumu({ kaynak }: Props) {
  return (
    <div
      className={[
        'space-y-2 text-sm leading-relaxed text-slate-800',
        '[&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3:first-child]:mt-0',
        '[&_h4]:mt-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4:first-child]:mt-0',
        '[&_h5]:mt-2 [&_h5]:text-sm [&_h5]:font-medium [&_h5:first-child]:mt-0',
        '[&_p]:whitespace-pre-wrap',
        '[&_ul]:list-disc [&_ul]:pl-5',
        '[&_ol]:list-decimal [&_ol]:pl-5',
        '[&_li]:mt-0.5',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-2 [&_blockquote]:text-slate-600 [&_blockquote]:italic',
      ].join(' ')}
    >
      {markdownOgeleri(kaynak)}
    </div>
  )
}
