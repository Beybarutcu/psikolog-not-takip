import { useState } from 'react'
import { ekIndir, ekIndirmeYolu, type EkBilgisi } from '../api'
import { tarihBicimle } from './bicim'

/**
 * Onam: açık rıza durumu ve imzalı onam belgesi.
 *
 * # Ton neden değişti (Plan 5 Görev 7)
 *
 * Rıza zaten terapiye başlarken kâğıt üzerinde imzalanıyor; bu bölümün işi
 * o süreci DENETLEMEK değil, imzalı kâğıdı (tarih + dosya) SAKLAYABİLMEK.
 * Eskiden rıza kaydı yoksa burada "Rıza alınmadan işlenen bir danışan
 * dosyası, bu uygulamadaki en somut KVKK uyumsuzluğudur." diyen suçlayıcı
 * bir cümle duruyordu — sanki uygulamanın amacı rızayı denetlemekmiş gibi.
 * O cümle kaldırıldı, yerine ne yapılacağını söyleyen bilgilendirici bir
 * cümle geldi ("İmzalı onam formunu buraya ekleyebilirsiniz.").
 *
 * # Alarm DEĞİL, bilgi (Görev 7 düzeltmesi)
 *
 * İlk sürümde metin değişmişti ama `role="alert"` ve amber renk kalmıştı —
 * incelemede bu, ürün amacıyla çelişen bir yarı-adım olarak işaretlendi:
 * terapist kendi danışan dosyasında, imzalanmış bir onam için sarı bir
 * alarm kutusu ve ekran okuyucuda KESİNTİLİ (assertive) bir duyuru
 * görmeye devam ediyordu — tam olarak kullanıcının şikâyet ettiği "laf
 * gibi duran KVKK uyarısı" hissi. Bölüm zaten `DanisanDosyasi`nin
 * "Bilgiler" alt sekmesinin ARKASINDA (Görev 6, kullanıcı bilerek oraya
 * gidiyor) — bir de kesintili duyuru yapmasına gerek yok. Bu yüzden
 * `role="alert"` ve amber KALDIRILDI: eksik onam artık düz bir bilgi
 * cümlesi, `rizaVar` dalındaki "Açık rıza alındı: …" ile AYNI nötr
 * biçimde basılıyor (bkz. `AyarlarSekmesi.tsx`'teki Yedekleme bölümünün
 * "artık sarı kutu DEĞİL" kararıyla aynı emsal). Bilgi kaybolmuyor —
 * yalnızca göze çarpma biçimi "alarm"dan "metin"e indi.
 *
 * # Bilgi düzeltilebilir olmalı
 *
 * Yalnızca durumu gösteren, ama rızayı kaydetmenin yolunu vermeyen bir
 * bölüm birkaç gün sonra görülmez olur ("her dosyada var, geçerim"). Bu
 * yüzden hemen altında tarih ve imzalı belge seçimi duruyor: sunucudaki
 * `PATCH /api/danisanlar/{id}` (Plan 4 Görev 7'de yazıldı) buradan başka
 * hiçbir yerden çağrılmıyor.
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
    <section aria-label="Onam" className="rounded border border-slate-200 p-3">
      <h3 className="text-sm font-semibold">Onam</h3>

      {rizaVar ? (
        <p className="mt-1 text-sm text-slate-700">
          Açık rıza alındı: {tarihBicimle((rizaTarihi ?? '').trim())}
        </p>
      ) : (
        // ALARM DEĞİL, BİLGİ (Görev 7 düzeltmesi): `role="alert"` yok, amber
        // yok — `rizaVar` dalındaki "Açık rıza alındı: …" ile AYNI nötr
        // biçim. Gerekçe modül başlığında.
        <p className="mt-1 text-sm text-slate-700">
          Bu danışan için onam kaydı yok. İmzalı onam formunu buraya ekleyebilirsiniz.
        </p>
      )}

      {rizaDosyaId !== null &&
        (bagliEk ? (
          <p className="mt-1 text-sm [overflow-wrap:anywhere]">
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
        {/* Seçimin doğal genişliği EN UZUN seçeneğinki: boşluksuz uzun bir
            dosya adı seçimi ve belgeyi yatay taşırıyordu (ölçüldü: 1024 px
            pencerede belge 1553 px). `max-w-full` seçimi bölüme sığdırır,
            seçili ad kutuda kırpılır; tam ad açılan listede ve bağlı belge
            bağlantısında (`e2e/uzun-metin.spec.ts`). */}
        <div className="min-w-0 max-w-full">
          <label className="block text-sm" htmlFor="riza-dosyasi">
            İmzalı onam dosyası
          </label>
          <select
            id="riza-dosyasi"
            className="mt-1 max-w-full rounded border p-1 text-sm"
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
