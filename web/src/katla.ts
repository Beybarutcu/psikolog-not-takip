/**
 * Türkçe harf katlaması — arayüzdeki TEK kopya (tasarım §5.2, §9).
 *
 * Sunucudaki `core/src/store/search.rs::katla_karakter` ve SQL `lower()` +
 * 12 `replace()` zinciriyle AYNI kural. İstemci ile sunucu
 * `core/src/store/katlama_ornekleri.json` ortak örnekleriyle bağlı
 * (`katla.test.ts`, `search.rs::tests::katlama_ortak_ornekleri_saglar`).
 * Kullananlar: önceki notlarda vurgu ve arama eşiği (`not/vurgu.ts`,
 * `seans/OncekiNotlar.tsx`), danışan listesi araması
 * (`danisan/danisanAramasi.ts`, tasarım B1).
 *
 * Kod noktası başına bir eşleme: `ı İ I i` → `i`, `ş Ş` → `s`, `ğ Ğ` → `g`,
 * `ü Ü` → `u`, `ö Ö` → `o`, `ç Ç` → `c`. Geri kalandan yalnızca ASCII
 * `A`–`Z` küçülür (`Â` → `Â`). `toLowerCase`/`toLocaleLowerCase`
 * KULLANILMAZ: `'İ'.toLowerCase()` iki kod noktası (`i` + U+0307) üretir,
 * "İpek" katlanınca "ipek"i içermez ve katlanmış metindeki konum ham metinden
 * kayar (vurgu buna dayanır). Çıktının kod noktası sayısı ve UTF-16 uzunluğu
 * girdiyle aynıdır.
 *
 * Etiket kimliği (`etiket/etiketAdi.ts::etiketAnahtari`) bununla
 * BİRLEŞTİRİLMEZ: kimlik harf farklarını korur, arama korumaz.
 */
const KATLAMA: Readonly<Record<string, string>> = {
  ı: 'i', İ: 'i', I: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c',
}

export function katla(metin: string): string {
  let sonuc = ''
  for (const k of metin) {
    const eslesen = KATLAMA[k]
    if (eslesen !== undefined) sonuc += eslesen
    else if (k >= 'A' && k <= 'Z') sonuc += String.fromCharCode(k.charCodeAt(0) + 32)
    else sonuc += k
  }
  return sonuc
}
