/**
 * Kuruş -> `"3.150,00 TL"` — seans panelinin ücret satırı (Plan 4 Görev 2)
 * ve ay sonu özeti (Görev 4) için TEK kaynak.
 *
 * İki ekran aynı tutarı farklı basarsa ("3150,00 TL" / "3.150,00 TL")
 * kullanıcı aynı parayı iki kez görür ve karşılaştıramaz; bu yüzden biçim
 * burada, bir kez duruyor.
 *
 * `danisan/bicim.ts::tlBicimle` (`"450,00 ₺"`) AYRI ve daha eski bir
 * biçimdir; o dosya `Intl`'i ICU farkları yüzünden bilerek kullanmıyor.
 * Burada `Intl` kullanılıyor çünkü binlik ayracı gerekiyor; `tr-TR` için
 * `minimumGroupingDigits` 1'dir ve çıktı hem Node'da hem tarayıcıda
 * `3.150,00`'dır (`AyOzeti.test.tsx` ve `SeansPaneli.test.tsx` metni tam
 * eşitlikle ölçüyor, yani başka bir ortamda sessizce kayamaz).
 */
const TL = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function tlMetni(kurus: number): string {
  return `${TL.format(kurus / 100)} TL`
}
