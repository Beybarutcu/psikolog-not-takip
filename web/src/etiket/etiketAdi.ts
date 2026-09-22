/**
 * Etiket adının istemci tarafı kuralları — sunucudaki `store::tags` ile
 * BİREBİR aynı tutulan üç küçük saf fonksiyon (Plan 6 Görev 6).
 *
 * # Neden istemcide de var
 *
 * Etiket yazması listeyi yeniden ÇEKMEZ (her okuma sunucuda silinemez bir
 * `goruntuleme` satırı): ekleme/kaldırmanın sonucu seansın etiket listesine,
 * danışan dosyasının seans listesindeki satıra ve sözlüğe YEREL olarak
 * işleniyor (bkz. `AnaEkran.tsx` "TEK yazma yolu"). Yerel sonucun sunucunun
 * sonraki okumasıyla AYNI görünmesi için sıralama kuralı da aynı olmalı:
 * sunucu `ORDER BY t.ad_anahtar` diyor, yani Türkçe küçük harfli kimliğin
 * BAYT sırası (SQLite `BINARY` harmanlaması = UTF-8 bayt sırası = kod noktası
 * sırası).
 */

/** Sunucudaki `AD_AZAMI` (karakter, bayt değil). */
export const ETIKET_AZAMI_KARAKTER = 40

/**
 * Baş/son boşluğu atar, iç boşlukları teke indirir — sunucudaki
 * `normallesmis_ad` (`split_whitespace().join(" ")`) ile aynı.
 */
export function etiketAdiNormallestir(ad: string): string {
  return ad.trim().split(/\s+/u).filter(Boolean).join(' ')
}

/**
 * KARAKTER sayısı: sunucu `chars().count()` (Unicode skaler değer) sayıyor;
 * `String.length` UTF-16 birimi sayar ve bir emoji için 2 derdi. Yayma
 * (`[...ad]`) kod noktası üzerinden yürür — Rust'ın `chars()`'ıyla aynı.
 */
export function etiketAdiUzunlugu(ad: string): number {
  return [...ad].length
}

/**
 * Sunucudaki `ad_anahtar_uret`'in eşi: yalnızca büyük/küçük harf farkını yok
 * sayar, harf işaretlerini KORUR ("Kaygı"/"kaygı" aynı, "yas"/"yaş" farklı).
 * `I`/`İ` önce elle çevrilir: `toLowerCase()` Türkçe'ye duyarlı değildir ve
 * `I`'yı `i` yapardı (`toLocaleLowerCase('tr')` ise çalışma ortamının yerel
 * ayar verisine bağlı — sunucu kuralı sabit, bu da sabit olmalı).
 */
export function etiketAnahtari(ad: string): string {
  return ad.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase()
}

/**
 * İki adı sunucunun `ORDER BY ad_anahtar ASC` sırasıyla karşılaştırır: kod
 * noktası sırası (UTF-8 bayt sırasıyla aynı). `localeCompare` KULLANILMAZ —
 * Türkçe alfabetik sıra ("ç" "c"den hemen sonra) sunucunun sırası değil ve
 * yerel yama ile sonraki okuma farklı sıralanırdı.
 */
export function etiketSirasi(a: string, b: string): number {
  const ka = [...etiketAnahtari(a)]
  const kb = [...etiketAnahtari(b)]
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
    const fark = ka[i].codePointAt(0)! - kb[i].codePointAt(0)!
    if (fark !== 0) return fark
  }
  return ka.length - kb.length
}
