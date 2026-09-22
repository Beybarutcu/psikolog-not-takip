/**
 * Etiket adının istemci tarafı kuralları — sunucudaki `store::tags` ile
 * BİREBİR aynı tutulan küçük saf fonksiyonlar (Plan 6 Görev 6).
 *
 * # Neden istemcide de var
 *
 * Etiket yazması seansın etiketlerini ve dosyanın seans listesini yeniden
 * ÇEKMEZ (her okuma sunucuda silinemez bir `goruntuleme` satırı): sonuç
 * YEREL olarak işleniyor (bkz. `AnaEkran.tsx` "TEK yazma yolu"). Yerel
 * sonucun sunucunun sonraki okumasıyla AYNI görünmesi için sıralama kuralı
 * da aynı olmalı (`etiketSirasi`, Türk alfabesi).
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
 *
 * Kimlik kuralı (`etiketAdiNormallestir` + bu fonksiyon) sunucuyla ORTAK
 * örnek dosyasına bağlı (son inceleme M3):
 * `core/src/store/etiket_kimlik_ornekleri.json`.
 */
export function etiketAnahtari(ad: string): string {
  return ad.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase()
}

/**
 * İki etiket nesnesi AYNI etiket mi: kimlik VE ad anahtarı (Görev 6 inceleme
 * IMPORTANT-1). Kimlik tek başına yetmez: kullanımı sıfıra düşen etiket
 * sunucuda silinir ve şema bugün kimliği yeniden vermese de (`tags.id
 * AUTOINCREMENT`) istemci kimliğin sonsuza kadar tek olduğunu VARSAYMAZ —
 * aynı kimliği taşıyan ama adı farklı bir etiket BAŞKA etikettir.
 */
export function ayniEtiket(a: { id: number; ad: string }, b: { id: number; ad: string }): boolean {
  return a.id === b.id && etiketAnahtari(a.ad) === etiketAnahtari(b.ad)
}

/**
 * Sıralama alfabesi — sunucudaki `store::tags::TURKCE_ALFABE` ile AYNI: Türk
 * alfabesi + Latin yerlerinde `q`, `w`, `x`.
 */
const TURKCE_ALFABE = [...'abcçdefgğhıijklmnoöpqrsştuüvwxyz']
const SAPKALI: Record<string, string> = { â: 'a', î: 'i', û: 'u' }

/** Sunucudaki `sira_anahtari`: her karakter için [sınıf, sıra]. */
function siraAnahtari(ad: string): [number, number][] {
  return [...etiketAnahtari(ad)].map((k) => {
    const temel = SAPKALI[k] ?? k
    const i = TURKCE_ALFABE.indexOf(temel)
    const kod = temel.codePointAt(0)!
    if (i >= 0) return [1, i]
    return kod < 0x80 ? [0, kod] : [2, kod]
  })
}

/** Kod noktası sırasıyla karşılaştırma (Rust `str::cmp` = UTF-8 bayt sırası). */
function kodNoktasiSirasi(a: string, b: string): number {
  const ka = [...a]
  const kb = [...b]
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
    const fark = ka[i].codePointAt(0)! - kb[i].codePointAt(0)!
    if (fark !== 0) return fark
  }
  return ka.length - kb.length
}

/**
 * Etiket adlarının TEK sıralama kuralı — sunucudaki `store::tags::
 * etiket_sirasi`nin birebir eşi (Görev 6 inceleme MINOR-3): Türk alfabesi,
 * büyük/küçük harf duyarsız (Türkçe kural); alfabe dışı ASCII (boşluk,
 * rakam, noktalama) harflerden önce, diğer karakterler sonra; şapkalı harf
 * temel harfin yerinde. Eşitlikte önce anahtarın, sonra ham adın kod noktası
 * sırası. `Intl`/`localeCompare` KULLANILMAZ: ICU davranışı platforma göre
 * değişebilir ve yerel yama sunucunun sonraki okumasıyla AYNI sırayı
 * üretmeli. İki uygulama ORTAK örnek dosyasıyla eşit tutuluyor
 * (`core/src/store/etiket_siralama_ornekleri.json`).
 */
export function etiketSirasi(a: string, b: string): number {
  const sa = siraAnahtari(a)
  const sb = siraAnahtari(b)
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const fark = sa[i][0] - sb[i][0] || sa[i][1] - sb[i][1]
    if (fark !== 0) return fark
  }
  return (
    sa.length - sb.length ||
    kodNoktasiSirasi(etiketAnahtari(a), etiketAnahtari(b)) ||
    kodNoktasiSirasi(a, b)
  )
}
