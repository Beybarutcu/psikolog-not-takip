import { SEKME_ADLARI, SEKME_KODLARI, type SekmeKodu } from './sekme'

/**
 * Sekme şeridi. Seçili sekmeyi TUTMAZ, yalnızca çizer ve bildirir: seçim
 * `AnaEkran`'da, çünkü sekme değişimi başka akışları da (açık danışan
 * dosyası) etkiliyor.
 *
 * `uyaran`: başlığında küçük bir uyarı noktası çıkacak sekme. Tasarım §4:
 * hiç yedek alınmamışsa bu bir sarı kutu olarak ana ekranı işgal etmez,
 * Ayarlar sekmesinde bir nokta olarak durur. Nokta görsel olduğu için
 * erişilebilir ad da uyarıyı kelimeyle taşır.
 */
export function Sekmeler({
  secili,
  onSecim,
  uyaran,
}: {
  secili: SekmeKodu
  onSecim: (sekme: SekmeKodu) => void
  uyaran?: SekmeKodu
}) {
  return (
    <div role="tablist" aria-label="Bölümler" className="flex gap-1">
      {SEKME_KODLARI.map((kod) => {
        const aktif = kod === secili
        const uyari = kod === uyaran
        return (
          <button
            key={kod}
            role="tab"
            type="button"
            id={`sekme-${kod}`}
            aria-selected={aktif}
            aria-controls={`sekme-panel-${kod}`}
            aria-label={
              uyari
                ? `${SEKME_ADLARI[kod]} — ilgilenilmesi gereken bir şey var`
                : undefined
            }
            onClick={() => onSecim(kod)}
            className={`rounded-t border-b-2 px-4 py-2 text-sm ${
              aktif
                ? 'border-slate-900 font-semibold text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {SEKME_ADLARI[kod]}
            {uyari && (
              <span
                aria-hidden="true"
                className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
