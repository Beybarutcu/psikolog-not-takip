import { useEffect, useState } from 'react'
import { ozetApi, YetkisizHata, type AyOzeti as AyOzetiVerisi } from '../api'
import { tlMetni } from '../para'
import { AYLAR } from '../takvim/hafta'

/**
 * Özetin kapsam cümlesi (dal incelemesi D2). Sunucunun kuralıyla birebir:
 * TAHSİLAT ayın ödendi işaretli BÜTÜN seansları (iptal edilmiş ama ücreti
 * alınmış dahil); "Gelinen seans" yalnızca `geldi`; BEKLEYEN ve borçlular
 * gelinmiş ve ödenmemiş seanslar. Cümle iki kuralı AYRI söylüyor: tek bir
 * "yalnızca geldi sayılır" cümlesi, iptal edilip ödenmiş bir seansın
 * tahsilatta görünmesini ekranda bir çelişki gibi okuturdu.
 */
export const KAPSAM_CUMLESI =
  "Tahsilat, ödendi olarak işaretlenen bütün seansları içerir. Bekleyen ödemeye yalnızca 'geldi' olarak işaretlenen seanslar girer; 'gelmedi' ve 'iptal' borç sayılmaz."

/**
 * `YYYY-AA` ayını `fark` ay kaydırır; yıl iki yönde de devreder
 * (Aralık + 1 = sonraki yılın Ocak'ı, Ocak - 1 = önceki yılın Aralık'ı).
 * Ay mutlak bir sayıya (yıl*12 + ay) çevrilip geri ayrıştırılıyor: ay
 * sayısına doğrudan ±1 eklemek `2026-13` / `2026-00` üretirdi.
 */
function ayKaydir(ay: string, fark: number): string {
  const [yil, a] = ay.split('-').map(Number)
  const mutlak = yil * 12 + (a - 1) + fark
  const yeniYil = Math.floor(mutlak / 12)
  const yeniAy = mutlak - yeniYil * 12 + 1
  return `${String(yeniYil).padStart(4, '0')}-${String(yeniAy).padStart(2, '0')}`
}

/** `2026-09` -> `Eylül 2026`. */
function ayBasligi(ay: string): string {
  const [yil, a] = ay.split('-')
  return `${AYLAR[Number(a) - 1] ?? a} ${yil}`
}

type Sonuc = { ay: string; veri: AyOzetiVerisi } | { ay: string; hata: string }

/**
 * Ay sonu özeti (Plan 4 Görev 4): gelinen seans sayısı, tahsilat, bekleyen
 * ve borçlular.
 *
 * # Bayat veri: iki ayrı savunma, ikisi de yük taşıyor
 *
 * 1. **Yanıt ait olduğu ayla birlikte saklanır** ve ekrana giden sonuç render
 *    sırasında `sonuc.ay === ay` ile türetilir. Kullanıcı "Sonraki ay"a
 *    bastığı ANDA sayılar "…" olur; önceki ayın rakamlarını temizleyen bir
 *    efekt yok (efekt ilk render'dan SONRA çalışır ve o kare eski ayın
 *    sayılarını yeni ayın başlığı altında gösterirdi).
 * 2. **Sıra dışı yanıt yok sayılır** (`iptal`). Eylül isteği Ekim'den sonra
 *    dönerse (1) tek başına onu ekrana basmaz ama Ekim'in sonucunu EZER ve
 *    ekran Ekim'e dönene kadar "…" kalırdı; hata dalında da Ekim ekranında
 *    Eylül'ün hatası belirirdi.
 *
 * Testleri: `AyOzeti.test.tsx` "ay degisince ONCEKI ayin rakamlari…" (1) ve
 * iki "SIRA DISI" testi (2).
 *
 * # Denetim hacmi
 *
 * Sunucu her özet görüntülemesini loglar. Efektin bağımlılıkları İLKEL: `ay`
 * dizgisi ve iki sayaç (`tazeleme`, `disTazeleme`). Üst bileşenin her
 * render'da geçirdiği yeni `onDanisanAc` ya da `bugun` istek ATTIRMAZ.
 * `bugun` yalnızca açılış ayını belirler.
 *
 * `disTazeleme` ile gelen yanıtın sırası da (2) ile korunuyor: yazmadan
 * ÖNCE başlamış bir istek iptal edilir, ekrana yalnızca yazmadan SONRA
 * başlayan isteğin yanıtı gelir.
 *
 * # Hata sonrası "Yeniden dene" (Görev 4 inceleme M2)
 *
 * Hata dalında bir düğme aynı ayı YENİDEN ister (`tazeleme` sayacı efektin
 * bağımlılığı). Düğme olmadan geçici bir hatadan kurtulmanın tek yolu başka
 * bir aya gidip geri gelmek ya da ekranı kapatıp açmaktı. Basınca sonuç
 * temizlenir: sayılar "…" olur, eski hata metni yeniden deneme sürerken
 * ekranda kalmaz. Yalnızca hata varken görünür — yüklü bir özet üzerinde her
 * basış sunucuda bir görüntüleme kaydı daha demek.
 *
 * # 401
 *
 * `ozetApi` merkezî `istek()` yolundan geçer; 401'de `App` kilit ekranına
 * döner ve bu bileşen unmount olur. Bileşen kendi akışını kurmaz, kendi hata
 * metnini de basmaz — sayılar o kısa arada "…" kalır.
 */
export function AyOzeti({
  bugun,
  disTazeleme = 0,
  onDanisanAc,
}: {
  /** `YYYY-AA-GG`; açılışta gösterilecek ayı belirler. */
  bugun: string
  /**
   * Üst bileşenin tazeleme sayacı (dal incelemesi I1): özet açıkken bir
   * seansın durumu ya da ödemesi BAŞARIYLA yazılınca artar ve görünen ay
   * TEK istekle yeniden istenir. Değeri önemsiz, yalnızca DEĞİŞMESİ.
   * Eski sayılar yeni yanıt gelene kadar ekranda kalır (aynı ay; yazma
   * öncesi hâl) — "…"ya düşürmek her işaretlemede özeti titretirdi.
   */
  disTazeleme?: number
  onDanisanAc: (id: number) => void
}) {
  const [ay, setAy] = useState(() => bugun.slice(0, 7))
  const [sonuc, setSonuc] = useState<Sonuc | null>(null)
  const [tazeleme, setTazeleme] = useState(0)

  useEffect(() => {
    let iptal = false
    ozetApi.ayOzeti(ay).then(
      (veri) => {
        if (!iptal) setSonuc({ ay, veri })
      },
      (e: unknown) => {
        if (iptal || e instanceof YetkisizHata) return
        setSonuc({ ay, hata: e instanceof Error ? e.message : 'Beklenmeyen bir hata oluştu.' })
      },
    )
    return () => {
      iptal = true
    }
  }, [ay, tazeleme, disTazeleme])

  const guncel = sonuc !== null && sonuc.ay === ay ? sonuc : null
  const veri = guncel !== null && 'veri' in guncel ? guncel.veri : null
  const hata = guncel !== null && 'hata' in guncel ? guncel.hata : null
  const yerTutucu = hata !== null ? '—' : '…'

  const sayilar: [string, string][] = [
    ['Gelinen seans', veri ? String(veri.seans_sayisi) : yerTutucu],
    ['Tahsilat', veri ? tlMetni(veri.tahsilat_kurus) : yerTutucu],
    ['Bekleyen', veri ? tlMetni(veri.bekleyen_kurus) : yerTutucu],
  ]

  return (
    // Görev 3 ürün kararı: KUTU değil PANEL. Eskiden ayrı, kendi başına
    // duran bir kart gibiydi (`rounded border ... bg-white`) — artık
    // `TakvimSekmesi`nin üst satırının ALTINDA açılan bir panel olduğu için
    // kendi kutu çerçevesini taşımıyor; üstteki satırdan yalnızca ince bir
    // ayraçla (`border-t`) ayrılıyor. Kapsam cümlesi (`KAPSAM_CUMLESI`)
    // panelin İÇİNDE, en altta ve küçük puntoda kalmaya devam ediyor: kural
    // doğru ama panelin başlığı değil.
    <section
      aria-label="Ay sonu özeti"
      className="mb-4 border-t border-slate-200 pt-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs"
          onClick={() => setAy((a) => ayKaydir(a, -1))}
        >
          Önceki ay
        </button>
        <h2 className="min-w-32 text-center font-semibold">{ayBasligi(ay)}</h2>
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs"
          onClick={() => setAy((a) => ayKaydir(a, 1))}
        >
          Sonraki ay
        </button>
      </div>

      <dl className="mt-2 flex gap-6">
        {sayilar.map(([etiket, deger]) => (
          <div key={etiket}>
            <dt className="text-xs text-slate-500">{etiket}</dt>
            <dd className="text-lg font-medium">{deger}</dd>
          </div>
        ))}
      </dl>

      {hata !== null && (
        <div role="alert" className="mt-2">
          <p className="text-red-600">Özet yüklenemedi. {hata}</p>
          <button
            type="button"
            className="mt-1 rounded border border-red-300 px-2 py-1 text-xs"
            onClick={() => {
              setSonuc(null)
              setTazeleme((n) => n + 1)
            }}
          >
            Yeniden dene
          </button>
        </div>
      )}

      {veri !== null &&
        (veri.borclular.length === 0 ? (
          <p className="mt-2 text-slate-600">Bu ay bekleyen ödeme yok.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {veri.borclular.map((b) => (
              <li key={b.client_id}>
                <button
                  type="button"
                  className="underline"
                  onClick={() => onDanisanAc(b.client_id)}
                >
                  {b.ad_soyad} — {tlMetni(b.borc_kurus)} ({b.seans_sayisi} seans)
                </button>
              </li>
            ))}
          </ul>
        ))}

      <p className="mt-2 text-xs text-slate-500">{KAPSAM_CUMLESI}</p>
    </section>
  )
}
