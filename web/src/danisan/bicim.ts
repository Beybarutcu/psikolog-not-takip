/**
 * Danışan kartının biçimlendirme yardımcıları.
 *
 * Ayrı bir dosyada, çünkü hepsi **saf fonksiyon**: doğrudan sınanabilirler ve
 * bileşen testlerinin ekrandan okuyarak dolaylı ölçtüğü şeyleri (sınır
 * değerler, negatif gün farkı, bayt eşikleri) burada tek tek sabitlemek
 * mümkün. `seans/sablon.ts` ile aynı gerekçe: veri/biçim bileşen değildir.
 */

/**
 * `2026-03-01` -> `01.03.2026`.
 *
 * Parçalar olduğu gibi doğru; `Date`'e **çevrilmiyor**. `new Date('2026-03-01')`
 * dizgiyi UTC olarak yorumlar ve UTC'nin gerisindeki bir saat diliminde
 * `getDate()` bir önceki günü verir (bkz. `hafta.ts::zamandanDate`, aynı
 * sınıf hata). Biçimi tanınmayan bir değer olduğu gibi geri döner: uydurulmuş
 * bir tarih göstermek, ham değeri göstermekten kötüdür.
 */
export function tarihBicimle(gun: string): string {
  const [yil, ay, g] = gun.split('-')
  if (!yil || !ay || !g) return gun
  return `${g}.${ay}.${yil}`
}

/**
 * Kuruş -> `"450,00 ₺"`.
 *
 * `Intl.NumberFormat` kullanılmıyor: çıktısı çalıştırma ortamının ICU
 * sürümüne göre değişir (para simgesinin yeri, boşluk karakteri) ve testte
 * sabitlenemez — sabitlense bile başka bir ortamda sessizce farklı basardı.
 */
export function tlBicimle(kurus: number): string {
  return `${(kurus / 100).toFixed(2).replace('.', ',')} ₺`
}

/** Bayt -> `"2,0 MB"` / `"1,5 KB"` / `"512 B"`. */
export function boyutBicimle(bayt: number): string {
  if (bayt >= 1024 * 1024) return `${(bayt / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  if (bayt >= 1024) return `${(bayt / 1024).toFixed(1).replace('.', ',')} KB`
  return `${bayt} B`
}

/**
 * İki takvim günü arasındaki gün farkı (`bitis - bugun`), ya da biçim
 * bozuksa `null`.
 *
 * # `Date.UTC` bir HATAYA karşı koruma DEĞİL
 *
 * Bu satırın eski gerekçesi "yerel `new Date(y, m, d)` yaz saati geçişini
 * kapsayan bir aralıkta 23/25 saatlik gün üretir ve kalan gün bir gün
 * kayardı; bu bir korumadır ama testle değil yalnızca bu yorumla korunuyor"
 * idi. **Yanlıştı ve silindi.**
 *
 * Aşağıdaki `Math.round` o kaymayı ZATEN emiyor: ±1 saatlik bir geçiş gün
 * cinsinden ±0,0417'dir ve tam sayıya yuvarlama bunu her durumda yutar.
 * (Ampirik olarak da doğrulandı: `Date.UTC` ile yerel aritmetik, yaz saati
 * sınırlarını kapsayan tarih çiftlerinde `Europe/Istanbul`,
 * `America/New_York`, `America/Santiago`, `Asia/Beirut`, `Pacific/Chatham`
 * ve `Australia/Lord_Howe` saat dilimlerinde AYNI sonucu veriyor.)
 *
 * `Date.UTC`'nin tek işlevi hesabı ana bilgisayarın saat diliminden
 * bağımsız kılmak — okunurluk ve belirlilik, savunma değil. Bu yüzden
 * burada "testle korunmayan bir koruma" da yok: korunacak bir hata yok.
 *
 * Saat dilimi burada gerçekten yük taşımıyor; taşıdığı yer `bugun`'ün
 * NEREDEN türetildiğidir (`AnaEkran::yerelGun` — yerel duvar saati, UTC
 * değil) ve orası testli.
 */
export function kalanGun(bugun: string, bitis: string): number | null {
  const coz = (s: string): number | null => {
    const p = s.split('-')
    if (p.length !== 3) return null
    const sayilar = p.map(Number)
    if (sayilar.some((n) => !Number.isFinite(n))) return null
    return Date.UTC(sayilar[0], sayilar[1] - 1, sayilar[2])
  }
  const a = coz(bugun)
  const b = coz(bitis)
  if (a === null || b === null) return null
  return Math.round((b - a) / 86_400_000)
}
