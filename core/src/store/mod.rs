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
/// Danışanın seans listesi (Plan 5 Görev 4): notu olsun olmasın TÜM
/// seansları döndürür (bkz. modül başlığı -- `notes::danisan_notlari`
/// yalnızca notu yazılmış seansları döndürüyordu).
pub mod danisan_seanslari;
/// Etiket deposu (Plan 6 Görev 4): seansın resmî notuna atanan serbest metin
/// etiketler ("kaygı", "aile", "ilaç değişimi"). Bkz. modül başlığı --
/// etiket adı erişim loguna asla girmez, katlama `store::search::katla`'dan
/// yeniden kullanılır.
pub mod tags;
