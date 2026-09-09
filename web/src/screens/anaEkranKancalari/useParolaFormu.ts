import { useState } from 'react'
import { api } from '../../api'

/**
 * PAROLA DEĞİŞTİRME. `keystore::change_password` Plan 1'den beri yazılı ve
 * testliydi ama hiçbir çağrı yeri yoktu: kullanıcı parolasını
 * DEĞİŞTİREMİYORDU (`seriyi_sil`, `clients::arsivle`, `depolama_durumu`
 * ile aynı "kodda var, üründe yok" sınıfı).
 *
 * Alanlar form kapanınca temizleniyor: bir parola, hiç görünmeyen bir
 * panelin state'inde oturmamalı.
 */
export function useParolaFormu() {
  const [acik, setAcik] = useState(false)
  const [mevcutParola, setMevcutParola] = useState('')
  const [yeniParola, setYeniParola] = useState('')
  const [yeniParolaTekrar, setYeniParolaTekrar] = useState('')
  const [hata, setHata] = useState<string | null>(null)
  const [bilgi, setBilgi] = useState<string | null>(null)
  const [suruyor, setSuruyor] = useState(false)

  /** Parola formunu kapatır ve **girilen parolaları state'ten siler.** */
  function kapat() {
    setAcik(false)
    setMevcutParola('')
    setYeniParola('')
    setYeniParolaTekrar('')
    setHata(null)
  }

  /** Bölüm başlığındaki düğme: açıkken kapatır (ve temizler), kapalıyken açar. */
  function acKapa() {
    setBilgi(null)
    if (acik) kapat()
    else setAcik(true)
  }

  /**
   * Parolayı değiştirir.
   *
   * # "Yeni parola tekrar" YALNIZCA burada kontrol edilir
   *
   * Sunucu iki alanı karşılaştıramaz (ikincisi ona hiç gönderilmiyor) —
   * yazım hatası yapan bir kullanıcı, yeni parolasını bilmeden
   * değiştirmiş olurdu. Uzunluk kuralı ise **kopyalanmıyor**: sunucunun
   * mesajı ("en az 8 karakter olmalı") olduğu gibi gösteriliyor, iki
   * kopya sessizce ayrışmasın (`AZAMI_EK_BOYUTU`'nun aksine — o, isteği
   * hiç atmadan reddedebilmek için istemcide de duruyor).
   *
   * # Hata mesajı OLDUĞU GİBİ gösterilir
   *
   * "Mevcut parolanız hatalı" ile "yeni parola çok kısa" farklı sorunlar
   * ve kullanıcı hangisini düzelteceğini bilmeli — bu kod tabanında dört
   * katmanda bulunan "her hata parola hatasıdır" sınıfının tam karşılığı.
   */
  async function degistir() {
    if (yeniParola !== yeniParolaTekrar) {
      setHata('Yeni parola ile tekrarı aynı değil. Parolanız değişmedi.')
      return
    }
    setSuruyor(true)
    try {
      await api.parolaDegistir(mevcutParola, yeniParola)
      kapat()
      // Kullanıcı "başka ne değişti" sorusunu sormadan yanıtı görmeli:
      // kurtarma kodu ve eski yedekler hakkındaki iki gerçek burada.
      setBilgi(
        'Parolanız değişti. Kurtarma kodunuz aynı kaldı ve çalışmaya devam ediyor. ' +
          'Bugünden önce alınmış yedekler ESKİ parolanızla açılır.',
      )
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Parola değiştirilemedi.')
    } finally {
      setSuruyor(false)
    }
  }

  return {
    acik,
    mevcutParola,
    setMevcutParola,
    yeniParola,
    setYeniParola,
    yeniParolaTekrar,
    setYeniParolaTekrar,
    hata,
    bilgi,
    suruyor,
    acKapa,
    degistir,
  }
}
