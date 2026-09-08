import { useCallback, useEffect, useState } from 'react'
import { api, yetkisizOlunca } from './api'
import { useBostaKalmaKontrolu } from './bostaKalma'
import { AnaEkran } from './screens/AnaEkran'
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

  const yenile = useCallback(async () => setDurum(await api.durumAl()), [])
  useEffect(() => { void yenile() }, [yenile])

  // Herhangi bir API çağrısı 401 (oturum kilitli) döndürdüğünde merkezi
  // olarak haberdar olunur: durum yeniden çekilir (kilitli: true dönecektir)
  // ve aşağıdaki render mantığı otomatik olarak kilit ekranına döner —
  // hangi ekranın hangi isteği yaptığını App'in bilmesine gerek kalmaz.
  useEffect(() => yetkisizOlunca(() => { void yenile() }), [yenile])

  // Yukarıdaki mekanizma TEPKİSEL: bir istek 401 alana kadar ekranda ne
  // varsa durur. Boşta kalma kilidi ise istek olmadan devreye girer —
  // oturum sunucuda kilitlendikten sonra takvim ve danışan adları ekranda
  // süresiz kalıyordu (bkz. dal incelemesi I3). Aşağıdaki kanca ÖNGÖRÜLÜ
  // yarıyı ekliyor: kullanıcı etkinliği olmadan süre dolunca sunucuya
  // sorulur ve kilitliyse aşağıdaki koşullu render AnaEkran'ı gerçekten
  // kaldırır (görsel perde değil, unmount).
  const oturumAcik =
    durum !== null && !durum.kurulum_gerekli && !durum.keystore_bozuk && !durum.kilitli
  useBostaKalmaKontrolu(oturumAcik, yenile)

  if (!durum) return <p className="p-8 text-slate-500">Yükleniyor…</p>

  // keystore_bozuk her zaman önce kontrol edilir: anahtar dosyası okunamıyorsa
  // kurulum sihirbazı asla gösterilmemeli, çünkü kurulum mevcut anahtarı ezer
  // ve şifreli veriyi kalıcı olarak erişilemez kılar.
  if (durum.keystore_bozuk) return <KeystoreBozukEkrani veriDizini={durum.veri_dizini} />
  if (durum.kurulum_gerekli) {
    return <KurulumSihirbazi kurulumYap={api.kurulumYap} onTamam={yenile} />
  }
  if (durum.kilitli) return <KilitEkrani kilitAc={api.kilitAc} onAcildi={yenile} />
  return <AnaEkran kilitle={async () => { await api.kilitle(); await yenile() }} />
}
