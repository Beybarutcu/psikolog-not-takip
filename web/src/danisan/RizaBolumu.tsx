import { useState } from 'react'
import { ekIndir, ekIndirmeYolu, type EkBilgisi } from '../api'
import { tarihBicimle } from './bicim'

/**
 * Aydınlatma metni / açık rıza durumu ve imzalı onam belgesi.
 *
 * # Neden sarı bir uyarı şeridi
 *
 * Rızasız işlenen bir danışan dosyası, bu uygulamanın üretebileceği en somut
 * KVKK uyumsuzluğudur — şifreleme, denetim kaydı ve saklama süresi hepsi
 * "veriyi hukuka uygun işliyorum" varsayımının üstüne kurulu. Rıza yoksa o
 * varsayım yok demektir. Bu yüzden durum bir alan değeri gibi sessizce
 * gösterilmez; kartın içinde ayrışan, `role="alert"` taşıyan bir şerittir.
 *
 * # Uyarı düzeltilebilir olmalı
 *
 * Yalnızca uyaran, ama rızayı kaydetmenin yolunu vermeyen bir şerit birkaç
 * gün sonra görülmez olur ("her dosyada var, geçerim"). Bu yüzden şeridin
 * hemen altında tarih ve imzalı belge seçimi duruyor: sunucudaki
 * `PATCH /api/danisanlar/{id}` (Görev 7'de yazıldı) buradan başka hiçbir
 * yerden çağrılmıyor.
 *
 * # Yalnızca `onam` türündeki ekler bağlanabilir
 *
 * Ek türü kapalı bir küme (`onam`/`test`/`diger`). Bir test kitapçığını
 * "imzalı onam" diye bağlamak dosyayı yanlış gösterirdi; seçici bu yüzden
 * türe göre süzülüyor. Süzgeç bir gizlilik önlemi değil, doğruluk önlemi —
 * bu ayrım kod tabanında karışabildiği için yazılıyor.
 */
type Props = {
  /** `null` ya da yalnızca boşluk: rıza **alınmamış** sayılır. */
  rizaTarihi: string | null
  rizaDosyaId: number | null
  /** Danışanın TÜM ekleri; seçici içeride `onam` türüne süzer. */
  ekler: EkBilgisi[]
  onKaydet: (alan: { riza_tarihi: string; riza_dosya_id: number | null }) => Promise<void>
}

export function RizaBolumu({ rizaTarihi, rizaDosyaId, ekler, onKaydet }: Props) {
  const rizaVar = (rizaTarihi ?? '').trim() !== ''
  const onamEkleri = ekler.filter((e) => e.tur === 'onam')
  const bagliEk = rizaDosyaId === null ? null : (ekler.find((e) => e.id === rizaDosyaId) ?? null)

  const [tarih, setTarih] = useState(rizaTarihi ?? '')
  const [dosyaSecimi, setDosyaSecimi] = useState(rizaDosyaId === null ? '' : String(rizaDosyaId))
  const [hata, setHata] = useState<string | null>(null)
  const [suruyor, setSuruyor] = useState(false)

  async function kaydet() {
    if (tarih.trim() === '') {
      setHata('Önce açık rıza tarihini seçin.')
      return
    }
    setSuruyor(true)
    try {
      await onKaydet({
        riza_tarihi: tarih,
        // Boş seçim AÇIKÇA `null` gider: sunucu "alan yok" ile "alan null"u
        // ayırt ediyor ve alanı hiç göndermemek bağı koparmayı imkânsız
        // kılardı (bkz. `danisanApi.rizaKaydet`).
        riza_dosya_id: dosyaSecimi === '' ? null : Number(dosyaSecimi),
      })
      setHata(null)
    } catch (e) {
      // Sunucudan gelen mesaj OLDUĞU GİBİ: hangi alanın neden reddedildiğini
      // yalnızca o söylüyor (bkz. AnaEkran'daki danışan ekleme kararı).
      setHata(e instanceof Error ? e.message : 'Rıza bilgisi kaydedilemedi.')
    } finally {
      setSuruyor(false)
    }
  }

  return (
    <section aria-label="Aydınlatma ve açık rıza" className="rounded border border-slate-200 p-3">
      <h3 className="text-sm font-semibold">Aydınlatma ve açık rıza</h3>

      {rizaVar ? (
        <p className="mt-1 text-sm text-slate-700">
          Açık rıza alındı: {tarihBicimle((rizaTarihi ?? '').trim())}
        </p>
      ) : (
        <p
          role="alert"
          className="mt-1 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900"
        >
          Bu danışan için aydınlatma metni / açık rıza kaydı yok. Rıza alınmadan işlenen bir
          danışan dosyası, bu uygulamadaki en somut KVKK uyumsuzluğudur.
        </p>
      )}

      {rizaDosyaId !== null &&
        (bagliEk ? (
          <p className="mt-1 text-sm">
            {/* `href` duruyor (bağlam menüsü gerçek bir adres görsün) ama
                tıklama `ekIndir`'den geçiyor: kilitli oturumda düz gezinme
                SPA'yı yıkıyor ve yazılmamış not taslağını götürüyordu
                (bkz. `api.ekIndir`, dal incelemesi I3). */}
            <a
              className="text-slate-700 underline"
              href={ekIndirmeYolu(bagliEk.id)}
              onClick={(e) => {
                e.preventDefault()
                setHata(null)
                void ekIndir(bagliEk).catch((x) =>
                  setHata(x instanceof Error ? x.message : 'Dosya indirilemedi.'),
                )
              }}
            >
              İmzalı onam belgesi: {bagliEk.dosya_adi}
            </a>
          </p>
        ) : (
          // Ölü bir "indir" bağlantısı, tıklayınca 404 veren bir söz olurdu.
          <p className="mt-1 text-sm text-slate-600">
            Bağlı onam dosyası bulunamadı (silinmiş olabilir).
          </p>
        ))}

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-sm" htmlFor="riza-tarihi">
            Açık rıza tarihi
          </label>
          <input
            id="riza-tarihi"
            type="date"
            className="mt-1 rounded border p-1 text-sm"
            value={tarih}
            onChange={(e) => setTarih(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm" htmlFor="riza-dosyasi">
            İmzalı onam dosyası
          </label>
          <select
            id="riza-dosyasi"
            className="mt-1 rounded border p-1 text-sm"
            value={dosyaSecimi}
            onChange={(e) => setDosyaSecimi(e.target.value)}
          >
            <option value="">— seçilmedi —</option>
            {onamEkleri.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.dosya_adi}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={suruyor}
          onClick={() => void kaydet()}
        >
          Rızayı kaydet
        </button>
      </div>

      {hata && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {hata}
        </p>
      )}
    </section>
  )
}
