//! Ortak tarih/saat biçim doğrulaması.
//!
//! Beklenen biçim: `YYYY-AA-GGTSS:DD` (yerel duvar saati, zaman dilimi yok).
//!
//! Bu fonksiyon bir gizlilik kapısı görevi görür: `store::audit::Ayrinti`
//! içindeki `AralikBaslangici`/`SeriSilme` varyantları, ham (doğrulanmamış)
//! bir dizginin erişim loguna sızmasını bu fonksiyonla engeller;
//! `store::appointments` de randevu başlangıç/bitiş zamanlarının biçimini
//! aynı fonksiyonla doğrular. Önceden `audit.rs` içinde yerel bir kopyası
//! vardı; randevu deposu ikinci bir kopya ihtiyacı doğurunca ortak bu modüle
//! taşındı -- iki (veya daha fazla) kopyadan biri güncellenip diğeri
//! unutulursa sessiz bir tutarsızlık doğar, bu yüzden TEK tanım burada
//! tutulur ve diğer modüller buradan içe aktarır.
pub fn zaman_gecerli_mi(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 16
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b'T'
        && b[13] == b':'
        && b.iter().enumerate().all(|(i, c)| matches!(i, 4 | 7 | 10 | 13) || c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gecerli_bicim_kabul_edilir() {
        assert!(zaman_gecerli_mi("2026-09-07T14:00"));
    }

    #[test]
    fn bozuk_bicim_reddedilir() {
        assert!(!zaman_gecerli_mi("07.09.2026 14:00"));
    }

    #[test]
    fn eksik_uzunluk_reddedilir() {
        assert!(!zaman_gecerli_mi("2026-09-07T14:0"));
    }

    #[test]
    fn zaman_dilimli_bicim_reddedilir() {
        assert!(!zaman_gecerli_mi("2026-09-07T14:00Z"));
    }
}
