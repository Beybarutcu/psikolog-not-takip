/**
 * Yerel takvim günü (`YYYY-AA-GG`). Sunucunun `saklama-suresi-dolanlar`
 * uç noktası da `bugun`'ü istemciden alıyor: karşılaştırma duvar saatine
 * göre yapılıyor ve UTC'den türetmek sınırdaki bir dosyayı bir gün
 * kaydırırdı.
 *
 * Somut: Istanbul UTC+3, yani 00:00–03:00 arasında UTC hâlâ dünkü tarihte.
 * `toISOString().slice(0, 10)` kullanan bir sürüm o üç saat boyunca
 * `bugun`'ü bir gün geriye alır; sonuç iki yerde birden görünür — saklama
 * süresi tam dolan bir dosyada ekran "1 gün kaldı" yazar ve veri raporunun
 * dosya adındaki tarih yanlış olur.
 *
 * Üç ayrı akış bunu kullanıyor (danışan kartının `bugun`'ü, saklama
 * hatırlatması, günlük yedeğin damgası); kancalara ayrılırken burada
 * TEK KOPYA olarak duruyor — ikinci bir kopya, iki tarihin sessizce
 * ayrışabileceği yer demekti.
 *
 * Testli: `AnaEkran.test.tsx` > "yerel gün: gece yarısı ile 03:00 arası".
 * Diğer testler `setSystemTime(… 12:00)` kullanıyor ve o saatte yerel gün
 * ile UTC günü aynı — bu ayrımı yalnızca o blok görebilir.
 */
export function yerelGun(tarih: Date): string {
  const iki = (n: number) => String(n).padStart(2, '0')
  return `${tarih.getFullYear()}-${iki(tarih.getMonth() + 1)}-${iki(tarih.getDate())}`
}
