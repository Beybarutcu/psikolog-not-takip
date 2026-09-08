//! Kurtarma kodu üretimi ve normalleştirmesi.
//!
//! Kullanıcı ana parolasını unutursa verisine erişmenin tek yolu bu koddur.
//! Kod kağıda elle yazılıp güvenli bir yerde saklanmak üzere tasarlanmıştır,
//! bu yüzden alfabesi elle yazarken karışması kolay karakterleri (O/0, I/1, L/1)
//! içermez ve normalleştirme bu karışıklıkları tolere eder.

use rand::Rng;

/// Crockford Base32 benzeri alfabe: karışan O, I, L, U karakterleri çıkarılmıştır.
const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS: usize = 5;
const GROUP_LEN: usize = 5;

/// `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX` biçiminde rastgele bir kurtarma kodu üretir
/// (25 karakter + 4 tire). Rastgelelik kriptografik olarak güvenli `rand`
/// üreticisinden gelir.
pub fn generate_recovery_code() -> String {
    let mut rng = rand::thread_rng();
    let mut gruplar = Vec::with_capacity(GROUPS);
    for _ in 0..GROUPS {
        let grup: String = (0..GROUP_LEN)
            .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
            .collect();
        gruplar.push(grup);
    }
    gruplar.join("-")
}

/// Kullanıcının elle girdiği kurtarma kodunu karşılaştırmaya hazır hale getirir:
/// tire ve boşluk gibi alfanümerik olmayan karakterleri atar, büyük harfe
/// çevirir ve sık karışan karakterleri düzeltir (`O`→`0`, `I`/`L`→`1`).
pub fn normalize_recovery_code(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uretilen_kod_bes_gruplu_ve_normallesince_25_karakter() {
        let kod = generate_recovery_code();
        assert_eq!(kod.split('-').count(), 5);
        assert!(kod.split('-').all(|g| g.len() == 5));
        assert_eq!(normalize_recovery_code(&kod).len(), 25);
    }

    #[test]
    fn kodlar_birbirinden_farklidir() {
        assert_ne!(generate_recovery_code(), generate_recovery_code());
    }

    #[test]
    fn kucuk_harf_bosluk_ve_tire_tolere_edilir() {
        let kod = generate_recovery_code();
        let dagilmis = format!("  {}  ", kod.to_lowercase().replace('-', " "));
        assert_eq!(normalize_recovery_code(&dagilmis), normalize_recovery_code(&kod));
    }

    #[test]
    fn karisan_karakterler_duzeltilir() {
        assert_eq!(normalize_recovery_code("OIL01"), "01101");
    }

    #[test]
    fn alfabe_karisan_karakter_icermez() {
        let kod = normalize_recovery_code(&generate_recovery_code());
        assert!(!kod.contains('O') && !kod.contains('I') && !kod.contains('L'));
    }
}
