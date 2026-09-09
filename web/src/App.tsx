import { useCallback, useEffect, useState } from 'react'
import { api, veritabaniBozukOlunca, yedekApi, yetkisizOlunca } from './api'
import { useBostaKalmaKontrolu } from './bostaKalma'
import { AnaEkran } from './screens/AnaEkran'
import { GeriYuklemeEkrani, type GeriYuklemeSebebi } from './screens/GeriYuklemeEkrani'
import { KeystoreBozukEkrani } from './screens/KeystoreBozukEkrani'
import { KilitEkrani } from './screens/KilitEkrani'
import { KurulumSihirbazi } from './screens/KurulumSihirbazi'

type Durum = {
  kurulum_gerekli: boolean
  kilitli: boolean
  keystore_bozuk: boolean
  veri_dizini: string
} | null

export default function App() {
  const [durum, setDurum] = useState<Durum>(null)
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
        : 'kurulum'
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
  return <AnaEkran kilitle={async () => { await api.kilitle(); await yenile() }} />
}
