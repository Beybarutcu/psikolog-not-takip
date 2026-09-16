/**
 * Kuruş -> `"3.150,00 TL"` — uygulamadaki BÜTÜN para metinlerinin TEK
 * kaynağı: seans panelinin ücret satırı, danışan kartının bakiyesi ve ay
 * sonu özeti.
 *
 * # Neden tek kaynak (Plan 4 Görev 4 inceleme I2)
 *
 * Önceden iki biçim vardı: kartta `danisan/bicim.ts::tlBicimle`
 * (`"1800,00 ₺"`), özette ve panelde bu dosya (`"1.800,00 TL"`). Özetteki
 * borçluya tıklayınca AYNI borç kartta başka bir biçimde görünüyordu ve iki
 * ekran karşılaştırılamıyordu. `tlBicimle` kaldırıldı.
 *
 * # Neden `Intl.NumberFormat` DEĞİL (inceleme M1)
 *
 * Bu dosyanın eski yorumu `Intl` çıktısının "başka bir ortamda sessizce
 * kayamayacağını" çünkü testlerin metni tam eşitlikle ölçtüğünü söylüyordu.
 * **Yanlıştı:** Vitest, Node'un ICU'suyla koşuyor; uygulamanın gerçekten
 * çalıştığı macOS webview'inin ICU'su hiçbir testte ölçülmüyor. `tr-TR`
 * gruplama kuralı (ör. `minimumGroupingDigits`) ya da ayraç karakteri iki
 * ICU arasında farklıysa testler yeşil kalır, ekran farklı basar.
 *
 * Biçimleyici bu yüzden elle yazıldı: tam sayı kuruştan lira ve kuruş
 * ayrılıyor, liraya üçlü gruplarla `.` ekleniyor, kuruş iki haneye
 * tamamlanıyor. Çıktı çalışma ortamının yerel ayar verisine BAĞLI DEĞİL;
 * `para.test.ts` tam eşitlikle ölçtüğü şey, webview'in basacağı şeyin
 * aynısıdır.
 */
export function tlMetni(kurus: number): string {
  // Kuruş sunucudan tam sayı gelir; yine de tam sayıya yuvarlanıyor ki
  // beklenmedik bir ondalık "450,5" gibi bozuk bir metin üretmesin.
  const tam = Math.round(kurus)
  const isaret = tam < 0 ? '-' : ''
  const mutlak = Math.abs(tam)
  const lira = Math.floor(mutlak / 100)
  const kurusKismi = mutlak % 100
  const liraMetni = String(lira).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${isaret}${liraMetni},${String(kurusKismi).padStart(2, '0')} TL`
}
