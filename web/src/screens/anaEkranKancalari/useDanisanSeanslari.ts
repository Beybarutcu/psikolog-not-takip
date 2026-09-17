import { useEffect, useRef, useState } from 'react'
import { danisanApi, YetkisizHata, type DanisanSeansi } from '../../api'

/** Bir isteğin yanıtı, HANGİ danışana ait olduğuyla birlikte. */
type SeansDurumu = { id: number; liste: DanisanSeansi[] }

/**
 * Seçili danışanın seans listesi akışı (Plan 5 Görev 5).
 *
 * Desen `useDanisanDosyasi` ile BİREBİR AYNI: yanıt HANGİ danışana ait
 * olduğuyla birlikte tutulur (`SeansDurumu.id`) ve ekrana giden liste
 * RENDER SIRASINDA türetilir — `durum.id === clientId` değilse boş dizi.
 * Bu TEK satır bu kancanın tek savunma hattı, bilerek: `.then` yanıtı
 * HANGİ `clientId` için istendiğini bilmeden koşulsuz yazar (aşağıya
 * bkz.), stale bir yanıt state'e girse bile ekrana asla sızmaz çünkü o
 * anda `clientId` zaten değişmiş olur ve türetme onu eler.
 *
 * # Neden önemli: Plan 3'te AYNI SINIF hata gerçekten oldu
 *
 * Çıplak bir `useState<DanisanSeansi[]>([])` + koşulsuz `.then(setListe)`
 * kullanılsaydı: 1 numaralı danışan açılır (istek atılır), terapist HEMEN
 * 2 numaralıya geçer (yeni istek atılır), 1 numaralının yanıtı GEÇ gelirse
 * 2 numaralının ekranında 1 numaralının seansları görünürdü — Plan 3'te bir
 * danışanın notu başka danışanın dosyasında görünen hatayla aynı sınıf.
 * Ölçen test: `DanisanlarSekmesi.test.tsx` > "geciken yanıt yeni seçimin
 * listesini ezmez".
 *
 * # Bilinmeyen/silinmiş danışan: BOŞ DOSYA, çökmüş ekran DEĞİL
 *
 * Sunucu bilinmeyen `id` için 404 döner (`DepoHatasi::Bulunamadi`), boş
 * liste DEĞİL. `istek()` (`api.ts`) 401 ve "veritabanı bozuk" dışındaki her
 * hatayı aynı sıradan `Error` sınıfıyla fırlatır — 404'ü ayrı bir sınıftan
 * ayırt etmenin yolu yok. Bu yüzden 401 DIŞINDAKİ HER hata burada aynı
 * şekilde ele alınır: liste boşalır, hata ekrana YAZILMAZ. Danışan
 * arşivlenmiş/silinmişken (ya da geçici bir sunucu hatasında) sağ kolon
 * "seçin" ya da boş bir liste gösterir; terapist çökmüş bir ekranla
 * karşılaşmaz. Kartın kendisi (`useDanisanDosyasi`) zaten kendi hata
 * banner'ını gösteriyor — aynı hatayı burada ikinci kez göstermek gerekmez.
 *
 * # 401: `onYetkisiz` — takvim seçimi de kapanır
 *
 * `AnaEkran`'da `takvim.oturumKapandi` ile bağlanacak, `useDanisanDosyasi`
 * ile AYNI yön (bkz. `AnaEkran.tsx` modül başlığı "401 temizliği İKİ
 * YÖNLÜ"). `useDanisanDosyasi`'ndeki gibi bir `ref`te tutuluyor ki efekt
 * bağımlılığı `clientId`den ibaret kalsın — her render'da yeni bir kapatma
 * fonksiyonu geçirilse bile istek tekrarlanmaz.
 */
export function useDanisanSeanslari({
  clientId,
  onYetkisiz,
}: {
  clientId: number | null
  onYetkisiz: () => void
}) {
  const [durum, setDurum] = useState<SeansDurumu | null>(null)
  const yetkisizRef = useRef(onYetkisiz)
  yetkisizRef.current = onYetkisiz
  // Bileşen GERÇEKTEN unmount olduğunda `setState` çağırmamak için — bu,
  // yukarıdaki id türetmesinden AYRI bir kaygı (o, "yanlış danışan"ı
  // gizler; bu, "artık kimse dinlemiyor"u gizler) ve mutasyon turunun
  // hedefi DEĞİL.
  const unmountedRef = useRef(false)
  useEffect(
    () => () => {
      unmountedRef.current = true
    },
    [],
  )

  // Bkz. modül başlığı: ekrana giden liste burada türetilir.
  const seanslar = durum !== null && durum.id === clientId ? durum.liste : []

  useEffect(() => {
    if (clientId === null) return
    const buId = clientId

    danisanApi.seanslar(buId).then(
      (liste) => {
        if (unmountedRef.current) return
        setDurum({ id: buId, liste })
      },
      (e: unknown) => {
        if (unmountedRef.current) return
        if (e instanceof YetkisizHata) {
          yetkisizRef.current()
          setDurum(null)
          return
        }
        // 404 dahil TÜM diğer hatalar: boş dosya, hata ekranı DEĞİL (bkz.
        // modül başlığı).
        setDurum({ id: buId, liste: [] })
      },
    )
  }, [clientId])

  return { seanslar }
}
