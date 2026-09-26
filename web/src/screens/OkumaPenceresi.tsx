import { useEffect, useState } from 'react'
import { IstekHatasi, notApi, YetkisizHata, type SeansNotu } from '../api'
import { NotOkuma } from '../not/NotOkuma'
import { zamanMetni } from '../tarih'

/**
 * Okuma penceresi (tasarım §8 P1): tek bir seansın RESMÎ notu, salt okunur.
 * Düzenleme, özel not, etiket, ödeme, durum ve seansa geçiş YOK; pencereler
 * arası mesaj yolu kurulmaz — pencere yalnızca bakmak için.
 *
 * - Not `notApi.notGetir` ile okunur: bir notun okunmasının bugün yazdığı
 *   `Goruntuleme | progress_note | <id>` satırı (P6), fazlası değil. Danışan
 *   adı yanıttan (`SeansNotu.danisan_adi`, S5b): ayrı danışan isteği yok.
 * - Başlık sayfanın İÇİNDE. `document.title` ve Tauri pencere başlığı
 *   danışan adı TAŞIMAZ (pencere listelerinde, ekran paylaşımında görünür).
 * - Kilit (P4): `App` durumu 5 sn'de bir sorar; kilitliyse bu bileşeni
 *   gerçekten kaldırır. Bir 401 de merkezi dinleyiciyle aynı yere gider.
 */
type Durum = { tur: 'yukleniyor' } | { tur: 'hazir'; not: SeansNotu } | { tur: 'hata'; mesaj: string }

export function OkumaPenceresi({ randevuId }: { randevuId: number }) {
  const [durum, setDurum] = useState<Durum>({ tur: 'yukleniyor' })

  useEffect(() => {
    let iptal = false
    notApi.notGetir(randevuId).then(
      (not) => {
        if (!iptal) setDurum({ tur: 'hazir', not })
      },
      (e: unknown) => {
        if (iptal || e instanceof YetkisizHata) return
        setDurum({
          tur: 'hata',
          mesaj:
            e instanceof IstekHatasi && e.durum === 404
              ? 'Bu seans bulunamadı; silinmiş olabilir.'
              : e instanceof Error
                ? e.message
                : 'Not yüklenemedi.',
        })
      },
    )
    return () => {
      iptal = true
    }
  }, [randevuId])

  return (
    <main className="mx-auto max-w-3xl p-6">
      {durum.tur === 'yukleniyor' && <p className="text-slate-500">Not yükleniyor…</p>}
      {durum.tur === 'hata' && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
          {durum.mesaj}
        </p>
      )}
      {durum.tur === 'hazir' && (
        <article aria-labelledby="okuma-basligi">
          <h1 id="okuma-basligi" className="text-xl font-semibold text-slate-900">
            {durum.not.danisan_adi}{' '}
            <span className="font-normal text-slate-600">· {zamanMetni(durum.not.seans_zamani)}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">Salt okunur</p>
          <div className="mt-4 rounded border border-slate-200">
            {durum.not.icerik === '' ? (
              <p className="p-3 text-slate-600">Bu seans için not yazılmamış.</p>
            ) : (
              <NotOkuma html={durum.not.icerik} />
            )}
          </div>
        </article>
      )}
    </main>
  )
}
