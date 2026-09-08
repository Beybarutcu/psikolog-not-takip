import { useEffect } from 'react'

// Sunucudaki boşta kalma kilidiyle (core::session::VARSAYILAN_KILIT_SURESI_SN
// = 300 sn) uyumlu tutulmalı. Bu değer bilerek `/api/durum`'dan okunmuyor:
// o yanıtın alan kümesi sabit (alan sayısını sayan bir test var) ve bu sayı
// yalnızca "ne zaman soralım" sorusunun cevabı — "kilitli mi" kararını her
// zaman sunucu veriyor.
export const BOSTA_KALMA_MS = 300_000

// Sunucu "hâlâ açık" derse bu aralıkla tekrar sorulur. Kullanıcı hiç
// dokunmadan bekliyorsa oturum en geç bu kadar gecikmeyle ekrandan kalkar.
export const YENIDEN_KONTROL_MS = 15_000

// Kullanıcının "buradayım" demesi sayılan olaylar. Fare hareketi bilerek
// yok: niyet taşımaz ve sunucuya da hiçbir istek üretmez.
const ETKINLIK_OLAYLARI = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

/**
 * Boşta kalma kilidinin arayüze ulaşmasını sağlar.
 *
 * # Neden gerekli
 * `core::session` 300 saniyelik boşta kalma kilidi tanımlıyor ve
 * `server::guard` her istekte `dokun()` çağırıyor; arayüzde ise 401'e
 * tepki veren merkezi bir dinleyici var (`api.ts`). Ama ikisini bağlayan
 * hiçbir şey yoktu: oturum sunucuda kilitlendikten sonra ekranda haftanın
 * tam takvimi ve danışan adları DURMAYA DEVAM EDİYORDU — bir sonraki istek
 * atılana kadar süresiz. Terapist danışanı kapıya kadar geçirirken bir
 * sonraki danışan ekrandakini okuyabilirdi. Görev 9 tepkisel yarıyı (401
 * gelince kilit ekranına dön) çözdü; bu, öngörülü yarı.
 *
 * # Sunucu tek doğruluk kaynağı olarak kalır
 * Bu kanca kendi başına "kilitli" kararı VERMEZ. Yaptığı tek şey,
 * kullanıcı etkinliği olmadan `BOSTA_KALMA_MS` geçtiğinde `kontrolEt`'i
 * çağırmak; `kontrolEt` sunucuya `/api/durum` sorar ve kilitliyse çağıran
 * taraf (App) ekranı kaldırır. `/api/durum` `acik_baglanti`'den GEÇMEZ,
 * dolayısıyla bu yoklama oturumu diri tutmaz (`dokun()` çağrılmaz).
 *
 * Kilit GERÇEK UNMOUNT olmalı, görsel bir perde değil — App'in koşullu
 * render'ı bunu zaten sağlıyor (Görev 9'da doğrulandı).
 *
 * @param etkin Yalnızca oturum açıkken (veri ekranda iken) çalışsın.
 * @param kontrolEt Sunucudan durumu yeniden çeken fonksiyon.
 */
export function useBostaKalmaKontrolu(etkin: boolean, kontrolEt: () => Promise<unknown>) {
  useEffect(() => {
    if (!etkin) return

    let zamanlayici: ReturnType<typeof setTimeout> | undefined
    let kaldirildi = false

    function kur(ms: number) {
      if (kaldirildi) return
      if (zamanlayici !== undefined) clearTimeout(zamanlayici)
      zamanlayici = setTimeout(sor, ms)
    }

    function sor() {
      void kontrolEt()
        // Sunucu hâlâ "açık" diyorsa (ya da soru başarısız olduysa) daha
        // kısa bir aralıkla tekrar sorulur; kullanıcı dokunursa aşağıdaki
        // dinleyici zaten sayacı tam süreye geri alır.
        .catch(() => {})
        .finally(() => kur(YENIDEN_KONTROL_MS))
    }

    function etkinlik() {
      kur(BOSTA_KALMA_MS)
    }

    kur(BOSTA_KALMA_MS)
    for (const olay of ETKINLIK_OLAYLARI) {
      window.addEventListener(olay, etkinlik, { passive: true })
    }

    return () => {
      kaldirildi = true
      if (zamanlayici !== undefined) clearTimeout(zamanlayici)
      for (const olay of ETKINLIK_OLAYLARI) {
        window.removeEventListener(olay, etkinlik)
      }
    }
  }, [etkin, kontrolEt])
}
