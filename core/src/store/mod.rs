pub mod db;
pub mod keystore;
pub mod schema;
pub mod zaman;
pub mod audit;
pub mod clients;
pub mod appointments;
pub mod notes;
pub mod attachments;
pub mod search;
pub mod ozet;
pub mod veri_raporu;
/// HTML not içeriğinden düz metin (tasarım 2026-09-26 S2-S3): arama,
/// önizleme ve veri raporu bu metne bakar; istemcide eşi yoktur.
pub mod duz_metin;
/// Danışanın seans listesi (Plan 5 Görev 4): notu olsun olmasın TÜM
/// seansları döndürür (bkz. modül başlığı -- `notes::danisan_notlari`
/// yalnızca notu yazılmış seansları döndürüyordu).
pub mod danisan_seanslari;
/// Etiket deposu (Plan 6 Görev 4): seansın resmî notuna atanan serbest metin
/// etiketler ("kaygı", "aile", "ilaç değişimi"). Bkz. modül başlığı --
/// etiket adı erişim loguna asla girmez; kimlik `ad_anahtar_uret` (Türkçe
/// küçük harf, harf işaretleri KORUNUR), `store::search::katla` DEĞİL
/// (katla yalnızca aramanın yumuşak eşleşmesi).
pub mod tags;

/// "Boşluk" karakteri: Unicode `White_Space` (`char::is_whitespace`, Rust'ın
/// `trim`/`split_whitespace` tanımı) + U+FEFF (BOM / sıfır genişlikli
/// bölünmez boşluk). Son inceleme M5: arayüzün `trim()`/`\s` tanımı U+FEFF'i
/// boşluk sayıyor, Rust'ınki saymıyordu; BOM'la başlayan (başka programdan
/// yapıştırılmış) bir notun önizlemesi istemcide ve sunucuda farklı çıkıyor,
/// aynı seans iki farklı önizleme gösteriyordu. İki taraf da AÇIK küme
/// kullanır: iki tanımın BİRLEŞİMİ (arayüzde `web/src/bosluk.ts`: `\s` +
/// U+0085). Önizleme (`danisan_seanslari::onizleme`) ve etiket adı
/// normalleştirmesi (`tags::normallesmis_ad`) bunu kullanır.
pub(crate) fn bosluk_mu(k: char) -> bool {
    k.is_whitespace() || k == '\u{feff}'
}
