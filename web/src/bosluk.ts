/**
 * "Boşluk" karakter kümesi — sunucudaki `store::bosluk_mu` ile AYNI (son
 * inceleme M5).
 *
 * # Neden `trim()` / `\s` yetmiyor
 *
 * İki dilin hazır "boşluk" tanımı aynı değil: JS `trim()` ve `\s` U+FEFF'i
 * (BOM / sıfır genişlikli bölünmez boşluk) boşluk sayar, Rust `trim()` ve
 * `split_whitespace()` saymaz (Unicode `White_Space` özelliği); Rust U+0085'i
 * (NEL) boşluk sayar, JS saymaz. Başka bir programdan yapıştırılan bir not
 * BOM'la başlayabiliyor: istemcinin yerel önizleme yaması `"Uyku düzeni"`,
 * sunucunun sonraki okuması `"﻿Uyku düzeni"` üretir ve aynı seans iki
 * farklı önizleme gösterirdi (çapraz önbellek kuralı). Etiket adında da
 * aynı fark kimliği ayırırdı.
 *
 * Çözüm iki tarafta da AÇIK küme: iki tanımın BİRLEŞİMİ (JS `\s` + U+0085;
 * Rust `char::is_whitespace` + U+FEFF). Ölçen örnekler ortak dosyalarda:
 * `core/src/store/onizleme_ornekleri.json`, `etiket_kimlik_ornekleri.json`.
 */
const BOSLUK = '\\s\\u0085'

const BAS_SON_BOSLUK = new RegExp(`^[${BOSLUK}]+|[${BOSLUK}]+$`, 'gu')
const BOSLUK_DIZISI = new RegExp(`[${BOSLUK}]+`, 'u')

/** Baş ve sondaki boşlukları atar (sunucudaki `trim_matches(bosluk_mu)`). */
export function boslukKirp(metin: string): string {
  return metin.replace(BAS_SON_BOSLUK, '')
}

/** Boşluk dizilerinden böler, boş parçaları atar (sunucudaki `split(bosluk_mu)`). */
export function bosluklaBol(metin: string): string[] {
  return metin.split(BOSLUK_DIZISI).filter((p) => p !== '')
}
