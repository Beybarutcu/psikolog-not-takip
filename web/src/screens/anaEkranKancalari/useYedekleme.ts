import { useCallback, useEffect, useState } from 'react'
import { yedekApi, YetkisizHata, type YedekListesi } from '../../api'
import { yerelDamga, yerelGun } from './yerelGun'

/**
 * Yedekleme akışı: açılıştaki otomatik günlük yedek, elle yedek alma,
 * klasör seçimi ve KALICI uyarı.
 */
export function useYedekleme() {
  // Yedekleme durumu. `null` = henüz gelmedi ya da klasör seçilmemiş.
  const [yedek, setYedek] = useState<YedekListesi | null>(null)
  // Tasarım §7: "Yedek alınamazsa (disk dolu, klasör erişilemez) ana ekranda
  // KALICI uyarı çıkar; sessiz geçilmez." Bu state o uyarıdır ve kendi
  // kendine kaybolmaz — yalnızca başarılı bir yedekle temizlenir.
  const [uyari, setUyari] = useState<string | null>(null)
  const [klasorFormuAcik, setKlasorFormuAcik] = useState(false)
  const [klasorGirdisi, setKlasorGirdisi] = useState('')
  const [suruyor, setSuruyor] = useState(false)
  // `.onceki` kenara kaldirma eyleminin sonucu -- `uyari`dan AYRI (bkz.
  // `oncekileriKaldir`).
  const [temizlikBilgisi, setTemizlikBilgisi] = useState<string | null>(null)

  /**
   * Bugünün yedeğini alır ve listeyi tazeler.
   *
   * `hedefDizin` verilirse sunucu onu önce **ayar olarak kaydeder**, sonra
   * yedeği oraya alır (bkz. `yedekApi.al`). Klasör seçmekle ilk yedeği
   * almak tek işlem: ayrı bir "ayarla" adımı olsaydı klasörünü seçip
   * yedeği almayan bir kullanıcı "yedeğim var" sanırdı.
   */
  const al = useCallback(async (hedefDizin?: string) => {
    setSuruyor(true)
    try {
      await yedekApi.al(yerelGun(new Date()), hedefDizin)
      setYedek(await yedekApi.listele())
      setUyari(null)
      setKlasorFormuAcik(false)
      return true
    } catch (e) {
      if (e instanceof YetkisizHata) return false
      // Sunucudan gelen mesaj OLDUĞU GİBİ gösteriliyor: "klasör bulunamadı",
      // "bu klasöre yazılamıyor" ve "anahtar dosyası bulunamadı" birbirinden
      // ayrı sorunlar ve kullanıcı hangisini düzelteceğini bilmeli
      // (`danisanEkle` ile aynı gerekçe).
      setUyari(e instanceof Error ? e.message : 'Yedek alınamadı.')
      return false
    } finally {
      setSuruyor(false)
    }
  }, [])

  /**
   * Veri klasöründeki `.onceki` kalıntılarını damgalı bir ada **taşır**
   * (inceleme IMPORTANT-A). Hiçbir şey silmez.
   *
   * Geri yükleme `.onceki` kapısına takıldığında (sunucu: "Ayarlar >
   * Yedekleme bölümündeki 'Eski dosyaları kenara kaldır' eylemini
   * çalıştırın") kullanıcının uygulama İÇİNDEKİ çıkış yolu budur. Sonuç
   * `uyari` alanına DEĞİL, kendi `temizlikBilgisi` alanına yazılıyor:
   * `uyari` "yedek alınamıyor" KALICI uyarısıdır ve onu buradan
   * temizlemek/doldurmak iki ayrı sorunu tek kutuda birleştirirdi.
   */
  const oncekileriKaldir = useCallback(async () => {
    setSuruyor(true)
    setTemizlikBilgisi(null)
    try {
      const { tasinan, damga } = await yedekApi.oncekiDosyalariKaldir(yerelDamga(new Date()))
      setTemizlikBilgisi(
        tasinan === 0
          ? 'Kenara kaldırılacak eski dosya bulunamadı.'
          : `${tasinan} eski dosya "…onceki-${damga}" ile biten adlara taşındı; hiçbiri silinmedi.`,
      )
      return true
    } catch (e) {
      if (e instanceof YetkisizHata) return false
      // Sunucudan gelen mesaj OLDUĞU GİBİ gösteriliyor (`al` ile aynı
      // gerekçe): "dosyalar taşınamadı" ile "geçersiz zaman damgası"
      // birbirinden ayrı sorunlar.
      setTemizlikBilgisi(e instanceof Error ? e.message : 'Eski dosyalar taşınamadı.')
      return false
    } finally {
      setSuruyor(false)
    }
  }, [])

  // OTOMATİK GÜNLÜK YEDEK — tasarım §7 ("günde bir kez otomatik şifreli
  // yedek", 7 gün dönüşümlü; dönüşümü çekirdek yapıyor).
  //
  // Zamanlayıcı YOK ve olmayacak: uygulama kapalıyken zaten yedek
  // alınamaz, açıkken de "oturum başına bir kez" bu ürün için "günde bir
  // kez"in gerçekleşebilir hâlidir. Etki bir kez çalışır (bağımlılığı sabit
  // kimlikli `al`): hafta değişimi, kayıt ya da kart tazelemesi bunu
  // tetiklemez.
  //
  // Damga İSTEMCİNİN yerel takvim günü (`yerelGun`) — duvar saati
  // sözleşmesi. Sunucudan türetilseydi Istanbul'da 00:00–03:00 arasında
  // yedek bir gün geriye yazılır ve "bugün alındı mı" yanlış yanıtlanırdı.
  //
  // Klasör seçilmemişse sunucu `400` döner ve mesajı kalıcı uyarı olur:
  // kullanıcı klasörünü seçene kadar hiçbir yedek alınamaz ve bunu ana
  // ekranda görür. Sessiz geçilmiyor.
  useEffect(() => {
    let iptal = false
    void (async () => {
      const bugun = yerelGun(new Date())
      try {
        const liste = await yedekApi.listele()
        if (iptal) return
        setYedek(liste)
        // Bugünün yedeği zaten varsa ikinci kez alınmaz: her çağrı sunucuda
        // SİLİNEMEZ bir `disa_aktarma` satırı yazar (bkz. `store::audit`
        // hacim politikası) ve aynı gün için ikinci satır gürültüdür.
        if (liste.yedekler.some((y) => y.tarih === bugun)) return
        await al()
      } catch (e) {
        if (iptal || e instanceof YetkisizHata) return
        setUyari(e instanceof Error ? e.message : 'Yedek durumu okunamadı.')
      }
    })()
    return () => {
      iptal = true
    }
  }, [al])

  return {
    yedek,
    uyari,
    klasorFormuAcik,
    setKlasorFormuAcik,
    klasorGirdisi,
    setKlasorGirdisi,
    suruyor,
    al,
    temizlikBilgisi,
    oncekileriKaldir,
  }
}
