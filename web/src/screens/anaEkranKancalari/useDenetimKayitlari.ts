import { useCallback, useEffect, useRef, useState } from 'react'
import { denetimApi, type DenetimKaydi } from '../../api'

/**
 * Denetim kaydı (audit log) OKUMA akışı — Ayarlar sekmesindeki salt okunur
 * liste (Plan 7 Görev 7, KVKK 2018/10).
 *
 * # `ayarlarGorunur` + `cekildiRef` — `useDanisanListesi`teki saklama
 * hatırlatmasıyla AYNI iskelet, FARKLI gerekçe
 *
 * `store::audit::son_kayitlar_sayfali` salt okur ve KENDİSİ yeni bir
 * denetim satırı YAZMAZ (bkz. `routes::audit` modül başlığı) -- yani bu
 * kancanın istek atması "bir denetim satırı daha yazılsın, log kendini
 * beslesin" riski TAŞIMIYOR (o risk `useDanisanListesi`'nin saklama
 * hatırlatmasında vardı ve asıl gerekçe oydu). Burada risk yalnızca
 * "terapistin hiç bakmadığı bir şey için sunucuya/veritabanına gereksiz
 * sorgu atmak" -- proje kısıtı bunu da açıkça yasaklıyor ("Terapistin
 * bakmadığı şey için istek atılmaz"). Bu yüzden ilk çekim yine
 * `ayarlarGorunur` + `cekildiRef` ile korunuyor: panel hiç görünmediyse
 * hiçbir istek atılmaz.
 *
 * Sayfa çevirmek ya da süzgeç uygulamak `cekildiRef`e TAKILMAZ: o an
 * kullanıcı zaten AÇIKÇA bir eylemde bulunmuş oluyor (bir düğmeye bastı).
 * `cekildiRef` yalnızca panelin GÖRÜNÜR OLMASINDAN kaynaklanan OTOMATİK ilk
 * çekimi korur -- ikinci ve sonraki `ayarlarGorunur` geçişlerinde de NO-OP
 * kalır (sekmeler arası gidip gelmek yeniden çekmez).
 */
export function useDenetimKayitlari({ ayarlarGorunur }: { ayarlarGorunur: boolean }) {
  const [kayitlar, setKayitlar] = useState<DenetimKaydi[]>([])
  const [sayfa, setSayfa] = useState(0)
  const [sonrakiSayfaVar, setSonrakiSayfaVar] = useState(false)
  const [baslangic, setBaslangic] = useState('')
  const [bitis, setBitis] = useState('')
  const [varlik, setVarlik] = useState('')
  const [yukleniyor, setYukleniyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const cekildiRef = useRef(false)

  const getir = useCallback(
    (hedefSayfa: number) => {
      setYukleniyor(true)
      denetimApi
        .kayitlar({
          sayfa: hedefSayfa,
          baslangic: baslangic || undefined,
          bitis: bitis || undefined,
          varlik: varlik || undefined,
        })
        .then((sonuc) => {
          setKayitlar(sonuc.kayitlar)
          setSonrakiSayfaVar(sonuc.sonraki_sayfa_var)
          setSayfa(sonuc.sayfa)
          setHata(null)
        })
        .catch((e: unknown) => {
          // Kilit (401) merkezî dinleyici (`yetkisizOlunca`) tarafından zaten
          // ele alınıyor -- burada yalnızca bu panelin kendi hata satırı
          // gösteriliyor, sayfanın tamamı kilitlenmiyor.
          setHata(e instanceof Error ? e.message : 'Denetim kaydı yüklenemedi.')
        })
        .finally(() => setYukleniyor(false))
    },
    [baslangic, bitis, varlik],
  )

  useEffect(() => {
    if (!ayarlarGorunur || cekildiRef.current) return
    cekildiRef.current = true
    getir(0)
    // `getir` yalnizca ilk otomatik cekimde kullaniliyor; sayfa/suzgec
    // degisiklikleri kullanicinin acikca cagirdigi `suzgecUygula`/
    // `sonrakiSayfa`/`oncekiSayfa` uzerinden gecer (bkz. modul basligi).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ayarlarGorunur])

  function suzgecUygula() {
    getir(0)
  }

  function sonrakiSayfa() {
    if (sonrakiSayfaVar) getir(sayfa + 1)
  }

  function oncekiSayfa() {
    if (sayfa > 0) getir(sayfa - 1)
  }

  return {
    kayitlar,
    sayfa,
    sonrakiSayfaVar,
    baslangic,
    setBaslangic,
    bitis,
    setBitis,
    varlik,
    setVarlik,
    yukleniyor,
    hata,
    suzgecUygula,
    sonrakiSayfa,
    oncekiSayfa,
  }
}
