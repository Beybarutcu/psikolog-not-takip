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
 *
 * # Okuma da burada (tasarım A5)
 *
 * Yazmanın tek kaynağı olduğu gibi, okumanın da tek kaynağı burada:
 * `ucretOku`. Önceden `RandevuPaneli.tsx::tldenKurusa` kullanıcı yazısını
 * doğrudan `Number()`'a veriyordu — `Number('1.250')` JavaScript'te **1.25**
 * çıkar (nokta ondalık ayracı sayılır), yani terapist "1.250 TL" yazınca
 * randevu sessizce "1,25 TL" olarak kaydediliyordu. Türkçe yazımda nokta
 * binlik, virgül ondalık ayracıdır; `Number()` bunu hiç bilmez. `ucretOku`
 * metni kendi dilbilgisiyle ayrıştırır, `Number()`'ı yalnızca ayrıştırma
 * SONRASI temiz basamak dizileri üzerinde çağırır.
 */
export function tlSayisi(kurus: number): string {
  // Kuruş sunucudan tam sayı gelir; yine de tam sayıya yuvarlanıyor ki
  // beklenmedik bir ondalık "450,5" gibi bozuk bir metin üretmesin.
  const tam = Math.round(kurus)
  const isaret = tam < 0 ? '-' : ''
  const mutlak = Math.abs(tam)
  const lira = Math.floor(mutlak / 100)
  const kurusKismi = mutlak % 100
  const liraMetni = String(lira).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${isaret}${liraMetni},${String(kurusKismi).padStart(2, '0')}`
}

export function tlMetni(kurus: number): string {
  return `${tlSayisi(kurus)} TL`
}

/** Sunucudaki `appointments::AZAMI_UCRET` ile aynı düz sayı (kuruş). */
export const AZAMI_UCRET_KURUS = 100_000_000
export const UCRET_BICIM_HATASI = 'Ücreti ör. 1.250 ya da 450,50 biçiminde yazın.'
export const UCRET_SINIR_HATASI = 'Ücret en fazla 1.000.000 TL olabilir.'

export type UcretOkuma = { kurus: number | null } | { hata: string }

// Tasarım A5 dilbilgisi: metin bu üç kalıptan birine TAM uymalı.
const BINLIKLI = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/
const DUZ = /^\d+(,\d{1,2})?$/
const NOKTA_ONDALIK = /^\d+\.\d{1,2}$/

export function ucretOku(metin: string): UcretOkuma {
  let t = metin.trim()
  if (t === '') return { kurus: null }
  // "TL", "tl" ya da "₺" yalnızca başta YA DA sonda, en fazla bir kez.
  const bastaki = /^(?:TL|tl|₺)\s*(.*)$/.exec(t)
  if (bastaki) t = bastaki[1]
  else {
    const sondaki = /^(.*?)\s*(?:TL|tl|₺)$/.exec(t)
    if (sondaki) t = sondaki[1]
  }
  let lira: string
  let kurus: string
  if (BINLIKLI.test(t) || DUZ.test(t)) {
    const [tam, ondalik = ''] = t.split(',')
    lira = tam.replace(/\./g, '')
    kurus = ondalik
  } else if (NOKTA_ONDALIK.test(t)) {
    const [tam, ondalik] = t.split('.')
    lira = tam
    kurus = ondalik
  } else {
    return { hata: UCRET_BICIM_HATASI }
  }
  // 7 anlamlı haneden uzun lira Number'a çevrilmeden reddedilir.
  if (lira.replace(/^0+/, '').length > 7) return { hata: UCRET_SINIR_HATASI }
  const deger = Number(lira) * 100 + Number(kurus.padEnd(2, '0'))
  if (deger > AZAMI_UCRET_KURUS) return { hata: UCRET_SINIR_HATASI }
  return { kurus: deger }
}
