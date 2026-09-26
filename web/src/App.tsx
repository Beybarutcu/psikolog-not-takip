import { useCallback, useEffect, useState } from 'react'
import { api, veritabaniBozukOlunca, yedekApi, yetkisizOlunca } from './api'
import { useBostaKalmaKontrolu } from './bostaKalma'
import { okumaKimligi, okumaParametresiVarMi } from './seans/okumaPenceresi'
import { AnaEkran } from './screens/AnaEkran'
import { GeriYuklemeEkrani, type GeriYuklemeSebebi } from './screens/GeriYuklemeEkrani'
import { KeystoreBozukEkrani } from './screens/KeystoreBozukEkrani'
import { KilitEkrani } from './screens/KilitEkrani'
import { KurulumSihirbazi } from './screens/KurulumSihirbazi'
import { OkumaPenceresi } from './screens/OkumaPenceresi'

type Durum = {
  kurulum_gerekli: boolean
  kilitli: boolean
  keystore_bozuk: boolean
  veri_dizini: string
} | null

/** Okuma penceresinin kilit yoklama aralığı (tasarım P4: içerik en geç 5 sn'de kalkar). */
export const OKUMA_YOKLAMA_MS = 5_000

/**
 * Bir adresin bir okuma penceresi olması ile `okumaKimligi`'nin geçerli bir
 * sayı dönmesi AYNI ŞEY DEĞİLDİR (carry-over F15, preflight.md — Rust
 * `pencere.rs::okuma_kimligi` tam i64 aralığını kabul eder, 19 haneye kadar;
 * buradaki TS grameri ≤15 hane). Tauri 16-19 haneli bir kimlikle GERÇEK bir
 * `okuma-*` penceresi açabilir; o adres için `okumaKimligi` `null` döner ama
 * pencere yine de bir okuma penceresidir — ana ekrana (danışan/randevu
 * verisiyle `AnaEkran`) düşmek burada ASLA doğru yedek yol değildir. Ayrım
 * adreste `okuma` anahtarının geçip geçmediğine bakılarak yapılır.
 */
function OkumaAdresiGecersiz() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
        Bu okuma penceresi adresi geçersiz. Pencereyi kapatıp not sayfasını yeniden açın.
      </p>
    </main>
  )
}

export default function App() {
  const [durum, setDurum] = useState<Durum>(null)
  // Tasarım P2: adres bir kez okunur; okuma penceresi ana ekranı HİÇ çizmez.
  const [okumaId] = useState(() => okumaKimligi(window.location.search))
  // F15: `okumaId === null` iken de bu bir okuma penceresi olabilir (bkz.
  // yukarıdaki `OkumaAdresiGecersiz` başlığı) — anahtar var ama değeri bu
  // grameri sağlamıyor.
  const [okumaAdresiGecersiz] = useState(
    () => okumaId === null && okumaParametresiVarMi(window.location.search),
  )
  // Sunucu "veritabanı bozuk" dedi mi (tasarım §8: "bozuksa geri yükleme
  // ekranına düşer"). Bu bir `durum` alanı DEĞİL ve olamaz: bütünlük
  // kontrolü veritabanını açmayı, o da veri anahtarını gerektirir —
  // `/api/durum` kilitliyken de yanıt veriyor ve elinde anahtar yok. Bilgi
  // bu yüzden kilit açma denemesinin yanıtından geliyor.
  const [veritabaniBozuk, setVeritabaniBozuk] = useState(false)
  // Kullanıcının KENDİ isteğiyle açtığı geri yükleme ekranı (bozuk anahtar
  // ekranından ya da kurulum sihirbazından). Ayrı bir bayrak: "sunucu bozuk
  // dedi" ile "kullanıcı geri yüklemek istiyor" farklı durumlar ve ekranın
  // giriş metni buna göre değişiyor.
  const [geriYuklemeIstendi, setGeriYuklemeIstendi] = useState(false)

  const yenile = useCallback(async () => setDurum(await api.durumAl()), [])
  useEffect(() => { void yenile() }, [yenile])

  // Herhangi bir API çağrısı 401 (oturum kilitli) döndürdüğünde merkezi
  // olarak haberdar olunur: durum yeniden çekilir (kilitli: true dönecektir)
  // ve aşağıdaki render mantığı otomatik olarak kilit ekranına döner —
  // hangi ekranın hangi isteği yaptığını App'in bilmesine gerek kalmaz.
  useEffect(() => yetkisizOlunca(() => { void yenile() }), [yenile])

  // Aynı mekanizmanın "veritabanı bozuk" hâli. `KilitEkrani`'nin kendi
  // `catch`'ine bırakılmadı: bozuk veritabanı hangi ekranda olunduğundan
  // bağımsız bir durumdur ve gidilecek yer her zaman aynıdır.
  useEffect(() => veritabaniBozukOlunca(() => setVeritabaniBozuk(true)), [])

  // Yukarıdaki mekanizma TEPKİSEL: bir istek 401 alana kadar ekranda ne
  // varsa durur. Boşta kalma kilidi ise istek olmadan devreye girer —
  // oturum sunucuda kilitlendikten sonra takvim ve danışan adları ekranda
  // süresiz kalıyordu (bkz. dal incelemesi I3). Aşağıdaki kanca ÖNGÖRÜLÜ
  // yarıyı ekliyor: kullanıcı etkinliği olmadan süre dolunca sunucuya
  // sorulur ve kilitliyse aşağıdaki koşullu render AnaEkran'ı gerçekten
  // kaldırır (görsel perde değil, unmount).
  const geriYuklemeAcik = veritabaniBozuk || geriYuklemeIstendi
  const oturumAcik =
    durum !== null &&
    !durum.kurulum_gerekli &&
    !durum.keystore_bozuk &&
    !durum.kilitli &&
    !geriYuklemeAcik
  useBostaKalmaKontrolu(oturumAcik, yenile)

  // Tasarım P4: okuma penceresi hiç istek atmadan açık kalabilir; ana
  // pencerede "Kilitle" ya da boşta kalma sonrası kilidi buraya ancak bir
  // 401 ile ulaşırdı. `/api/durum` 5 sn'de bir sorulur (oturuma DOKUNMAZ,
  // denetim satırı yazmaz); kilitliyse aşağıdaki koşullu render içeriği
  // unmount eder. Ana pencere yoklamaz: orada her istek zaten 401 yoluyla
  // kilide götürür. F15: gramer dışı ama yine de bir okuma penceresi olan
  // adres (`okumaAdresiGecersiz`) de yoklar — o pencerede de kilit ekranı
  // gerekir, yalnızca hata mesajı gösteriyor olması onu ayrıcalıklı kılmaz.
  useEffect(() => {
    if ((okumaId === null && !okumaAdresiGecersiz) || !oturumAcik) return
    const zamanlayici = setInterval(() => {
      // Sunucuya ulaşılamazsa (uygulama kapanıyor, ağ yığını hatası) ret
      // yutulur: bir sonraki yoklama yeniden sorar (`bostaKalma.ts` ile aynı).
      yenile().catch(() => {})
    }, OKUMA_YOKLAMA_MS)
    return () => clearInterval(zamanlayici)
  }, [okumaId, okumaAdresiGecersiz, oturumAcik, yenile])

  if (!durum) return <p className="p-8 text-slate-500">Yükleniyor…</p>

  // Geri yükleme ekranı her şeyin ÖNÜNDE: bu ekranın üç açılış sebebinin
  // (bozuk veritabanı, okunamayan anahtar dosyası, yeni bilgisayar) ikisinde
  // arkasındaki ekran kurulum sihirbazıdır ve kurulum yapmak tam da
  // yapılmaması gereken şeydir.
  if (geriYuklemeAcik) {
    const sebep: GeriYuklemeSebebi = veritabaniBozuk
      ? 'veritabani-bozuk'
      : durum.keystore_bozuk
        ? 'anahtar-bozuk'
        : durum.kurulum_gerekli
          ? 'kurulum'
          : 'elle'
    const kapat = () => {
      setVeritabaniBozuk(false)
      setGeriYuklemeIstendi(false)
    }
    return (
      <GeriYuklemeEkrani
        veriDizini={durum.veri_dizini}
        sebep={sebep}
        yedekleriGetir={yedekApi.listele}
        geriYukle={yedekApi.geriYukle}
        oncekileriKaldir={yedekApi.oncekiDosyalariKaldir}
        onTamamlandi={() => {
          kapat()
          void yenile()
        }}
        onVazgec={kapat}
      />
    )
  }

  // keystore_bozuk her zaman önce kontrol edilir: anahtar dosyası okunamıyorsa
  // kurulum sihirbazı asla gösterilmemeli, çünkü kurulum mevcut anahtarı ezer
  // ve şifreli veriyi kalıcı olarak erişilemez kılar.
  if (durum.keystore_bozuk) {
    return (
      <KeystoreBozukEkrani
        veriDizini={durum.veri_dizini}
        onGeriYukle={() => setGeriYuklemeIstendi(true)}
        oncekileriKaldir={yedekApi.oncekiDosyalariKaldir}
      />
    )
  }
  if (durum.kurulum_gerekli) {
    return (
      <KurulumSihirbazi
        kurulumYap={api.kurulumYap}
        onTamam={yenile}
        onGeriYukle={() => setGeriYuklemeIstendi(true)}
      />
    )
  }
  if (durum.kilitli) return <KilitEkrani kilitAc={api.kilitAc} onAcildi={yenile} />
  if (okumaId !== null) return <OkumaPenceresi randevuId={okumaId} />
  // F15: adreste `okuma` anahtarı var ama gramer dışı — AnaEkran'a düşmek
  // YASAK (bkz. `OkumaAdresiGecersiz` başlığı); parametresiz gerçek ana
  // pencere adresi bu daldan hiç geçmez.
  if (okumaAdresiGecersiz) return <OkumaAdresiGecersiz />
  return (
    <AnaEkran
      kilitle={async () => {
        await api.kilitle()
        await yenile()
      }}
      onGeriYukle={() => setGeriYuklemeIstendi(true)}
    />
  )
}
