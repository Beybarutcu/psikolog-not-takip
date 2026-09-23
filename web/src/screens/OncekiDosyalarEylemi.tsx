import { useState } from 'react'
import { yerelDamga } from './anaEkranKancalari/yerelGun'

/**
 * "Eski dosyaları kenara kaldır" eylemi — **kurtarma ekranlarının** ortak
 * parçası (inceleme, ikinci tur).
 *
 * # Neden bu ekranlarda
 *
 * `core::backup::Yerlestirme::kenara_al` veri klasöründe bir `.onceki`
 * kalıntısı varken geri yüklemeyi **başlatmaz**: o dosya kullanıcının tek
 * kopyası olabilir ve POSIX'te `rename` onu sessizce üzerine yazardı.
 * Kalıntı hem yarım kalmış bir geri almadan hem de **başarılı** bir geri
 * yüklemenin temizlik adımı patladığında kalabilir.
 *
 * Kritik nokta şu: o anda oturum çoğu zaman **açılamaz** (canlı çift
 * eşleşmiyor). Eylem yalnızca Ayarlar'da dursaydı kullanıcı ona hiç
 * ulaşamaz, geri yükleme de `409` ile reddedilirdi — geriye tek çıkış
 * olarak Finder'da elle dosya taşımak kalırdı ve oradaki ilk refleks
 * **silmek** olurdu. Uç bu yüzden kilit kapısının dışında ve eylem geri
 * yükleme ekranlarının içinde.
 *
 * # Metin "sil" demiyor
 *
 * Eylem hiçbir şeyi silmez; yalnızca damgalı bir ada taşır. Düğme metni ne
 * **yapmadığını** da söylüyor ki kullanıcı "temizlik = silme" diye
 * okumasın.
 */
export function OncekiDosyalarEylemi({
  kaldir,
}: {
  /** `yedekApi.oncekiDosyalariKaldir` — damgayı alır, taşınan sayısını döner. */
  kaldir: (damga: string) => Promise<{ tasinan: number; damga: string }>
}) {
  const [bilgi, setBilgi] = useState<string | null>(null)
  const [suruyor, setSuruyor] = useState(false)

  async function calistir() {
    setSuruyor(true)
    setBilgi(null)
    try {
      // Damga İSTEMCİNİN yerel saati (duvar saati sözleşmesi): kullanıcı bu
      // adı dosya listesinde okuyup "hangisi dünkü" diye soracak.
      const { tasinan, damga } = await kaldir(yerelDamga(new Date()))
      // Yeni adın SONEKİ söyleniyor (yol değil): bu dosyaları başka
      // hiçbir şey temizlemiyor ve kullanıcı onları sonradan kendisi
      // bulmak zorunda (inceleme M-2).
      setBilgi(
        tasinan === 0
          ? 'Kenara kaldırılacak eski dosya bulunamadı.'
          : `${tasinan} eski dosya "…onceki-${damga}" ile biten adlara taşındı; hiçbiri silinmedi.`,
      )
    } catch (e) {
      // Sunucunun mesajı OLDUĞU GİBİ: "dosyalar taşınamadı" ile "geçersiz
      // zaman damgası" ayrı sorunlar ve kullanıcı hangisini düzelteceğini
      // bilmeli.
      setBilgi(e instanceof Error ? e.message : 'Eski dosyalar taşınamadı.')
    } finally {
      setSuruyor(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-300 p-3">
      <p className="text-sm text-slate-600">
        Geri yükleme “<code>.onceki</code> uzantılı dosyalar duruyor” diyerek durduysa, bu
        dosyalar önceki bir geri yüklemeden kalmıştır ve <strong>sizin eski verileriniz
        olabilir</strong>. Aşağıdaki eylem onları silmez; tarih damgalı yeni bir ada taşır,
        böylece hem yerlerinde kalırlar hem de geri yükleme yeniden çalışabilir.
      </p>
      <button
        type="button"
        className="mt-2 rounded border px-3 py-1 text-sm disabled:opacity-50"
        disabled={suruyor}
        onClick={() => void calistir()}
      >
        Eski dosyaları kenara kaldır (silmez, yeniden adlandırır)
      </button>
      {bilgi && (
        <p role="status" className="mt-2 text-sm text-slate-700">
          {bilgi}
        </p>
      )}
    </div>
  )
}
