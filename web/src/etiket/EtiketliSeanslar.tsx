import type { EtiketliSeans } from '../api'
import type { AcikEtiket } from '../screens/anaEkranKancalari/useEtiketler'
import { zamanMetni } from '../tarih'

/**
 * Bir etiketi taşıyan BÜTÜN seanslar, bütün danışanlarda (Plan 6 Görev 6).
 * Terapist bir çipe (`EtiketSatiri`) tıklayınca açılır.
 *
 * # Durumsuz: veri `useEtiketler`'de, geçiş `danisanaGit`'te
 *
 * Liste `useEtiketler.acik`'ta yaşıyor ve bu bileşen yalnızca gösteriyor —
 * mount'ta hiçbir şey okumuyor, istek atmıyor. İstek, çipe TIKLANDIĞI anda
 * olay işleyicisinde atılır (sunucu `etiketli_seanslar`'ı silinemez bir
 * `goruntuleme` satırı olarak yazıyor; efekte bağlı bir istek her yeniden
 * montajda tekrarlanırdı).
 *
 * Bir satıra tıklamak `onSeansAc(clientId, appointmentId)` çağırır ve
 * `AnaEkran` bunu `danisanaGit`'e bağlar — danışana giden TEK giriş noktası
 * (sekme Danışanlar olur, dosya O seans seçili açılır). Burada ayrı bir
 * "yalnızca dosyayı aç" yolu YOK (bkz. `AnaEkran.tsx` modül başlığı).
 *
 * # Neden sekme panellerinin DIŞINDA
 *
 * Panel bir danışana ait değil; takvimden de dosyadan da açılabiliyor ve bir
 * satıra tıklayınca sekme değişiyor. `AnaEkran` onu sekme panellerinin
 * üstünde çiziyor: satırdan dosyaya geçildiğinde panel açık kalır, terapist
 * aynı etiketin diğer seanslarına da sırayla bakabilir. Bu yüzden 401'de
 * AYRICA kapanması gerekiyor (bkz. `useEtiketler.temizle`) — takvim
 * seçimini kapatmak onu kapatmaz.
 *
 * `role="region"` + erişilebilir ad ("kaygı etiketli seanslar"): ekran
 * okuyucu kullanıcısı panele bölge listesinden ulaşabilir.
 */
export function EtiketliSeanslar({
  acik,
  onSeansAc,
  onKapat,
  onYenidenDene,
}: {
  acik: AcikEtiket
  onSeansAc: (clientId: number, appointmentId: number) => void
  onKapat: () => void
  onYenidenDene: () => void
}) {
  const { etiket, liste, hata } = acik
  const baslikId = `etiketli-seanslar-basligi-${etiket.id}`

  return (
    <section
      role="region"
      aria-labelledby={baslikId}
      className="mb-4 rounded-lg border border-sky-300 bg-sky-50/40 p-4"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id={baslikId} className="text-base font-semibold">
          {etiket.ad} etiketli seanslar
        </h2>
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onKapat}>
          Kapat
        </button>
      </div>
      {hata !== null ? (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-2">
          <p className="text-sm text-red-800">Seanslar yüklenemedi. {hata}</p>
          <button
            type="button"
            className="mt-1 rounded border border-red-300 px-2 py-1 text-sm"
            onClick={onYenidenDene}
          >
            Yeniden dene
          </button>
        </div>
      ) : liste === null ? (
        <p className="text-sm text-slate-600">Seanslar yükleniyor…</p>
      ) : liste.length === 0 ? (
        <p className="text-sm text-slate-600">Bu etiketi taşıyan seans kalmadı.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {liste.map((s: EtiketliSeans) => (
            <li key={s.appointment_id}>
              <button
                type="button"
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-left hover:bg-slate-50"
                onClick={() => onSeansAc(s.client_id, s.appointment_id)}
              >
                <span className="font-medium">{s.danisan_adi}</span>
                {' — '}
                {zamanMetni(s.baslangic)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
