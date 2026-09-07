use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub const DATA_KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
/// XChaCha20-Poly1305 kimlik dogrulama etiketi uzunlugu (AEAD standardi, sabit).
const TAG_LEN: usize = 16;

/// Diskten okunan (potansiyel olarak kurcalanmis) KDF parametreleri icin ust sinirlar.
/// `KdfParams::default()` (65536/3/1) ve `KdfParams::test_fast()` (8/1/1) bu sinirlarin
/// icinde kalir. Asilirsa (ornegin m_cost = u32::MAX) argon2 asiri bellek ayirmaya
/// calisirken sureci `handle_alloc_error` ile oldurebilir veya sureci suresiz kilitleyebilir.
const MAX_M_COST: u32 = 1 << 21; // 2 GiB
const MAX_T_COST: u32 = 16;
const MAX_P_COST: u32 = 8;

pub type DataKey = Zeroizing<[u8; DATA_KEY_LEN]>;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("parola veya kurtarma kodu hatalı")]
    WrongSecret,
    #[error("anahtar türetilemedi: {0}")]
    Kdf(String),
    #[error("kayıt biçimi bozuk: {0}")]
    Format(String),
    #[error("şifreleme başarısız: {0}")]
    Encryption(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self { m_cost: 65536, t_cost: 3, p_cost: 1 }
    }
}

impl KdfParams {
    #[cfg(test)]
    pub fn test_fast() -> Self {
        Self { m_cost: 8, t_cost: 1, p_cost: 1 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedKey {
    pub kdf: KdfParams,
    pub salt_hex: String,
    pub nonce_hex: String,
    pub ciphertext_hex: String,
}

pub fn generate_data_key() -> DataKey {
    let mut key = [0u8; DATA_KEY_LEN];
    rand::thread_rng().fill_bytes(&mut key);
    Zeroizing::new(key)
}

fn derive(secret: &str, salt: &[u8], kdf: KdfParams) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let params = Params::new(kdf.m_cost, kdf.t_cost, kdf.p_cost, Some(32))
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(secret.as_bytes(), salt, out.as_mut())
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    Ok(out)
}

pub fn wrap_key(secret: &str, key: &DataKey, kdf: KdfParams) -> Result<WrappedKey, CryptoError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce);

    let derived = derive(secret, &salt, kdf)?;
    let cipher = XChaCha20Poly1305::new(derived.as_ref().into());
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), key.as_slice())
        .map_err(|_| CryptoError::Encryption("veri anahtarı şifrelenemedi".into()))?;

    Ok(WrappedKey {
        kdf,
        salt_hex: hex::encode(salt),
        nonce_hex: hex::encode(nonce),
        ciphertext_hex: hex::encode(ciphertext),
    })
}

pub fn unwrap_key(secret: &str, wrapped: &WrappedKey) -> Result<DataKey, CryptoError> {
    let salt = hex::decode(&wrapped.salt_hex).map_err(|e| CryptoError::Format(e.to_string()))?;
    let nonce = hex::decode(&wrapped.nonce_hex).map_err(|e| CryptoError::Format(e.to_string()))?;
    let ciphertext =
        hex::decode(&wrapped.ciphertext_hex).map_err(|e| CryptoError::Format(e.to_string()))?;
    if nonce.len() != NONCE_LEN {
        return Err(CryptoError::Format("nonce uzunluğu hatalı".into()));
    }
    if salt.len() != SALT_LEN {
        return Err(CryptoError::Format("tuz uzunluğu hatalı".into()));
    }
    // AEAD cozmeden once yapisal uzunluk kontrolu: boyut uyusmuyorsa kayit bozuktur,
    // bu "yanlis parola" degildir - kullanicinin yanlislikla parolasini/kurtarma kodunu
    // tekrar tekrar deneyip veriyi sifirlamasini onlemek icin ayri bir hata donuyoruz.
    if ciphertext.len() != DATA_KEY_LEN + TAG_LEN {
        return Err(CryptoError::Format("şifreli metin uzunluğu hatalı".into()));
    }
    // Diskten okunan KDF parametreleri kurcalanmis olabilir. Turetmeden once ust sinir
    // kontrolu yapmazsak asiri buyuk m_cost surecin bellek ayirirken cokmesine (abort),
    // asiri buyuk t_cost ise suresiz kilitlenmeye yol acabilir.
    if wrapped.kdf.m_cost > MAX_M_COST
        || wrapped.kdf.t_cost > MAX_T_COST
        || wrapped.kdf.p_cost > MAX_P_COST
    {
        return Err(CryptoError::Format(
            "kdf parametreleri geçersiz: izin verilen üst sınırı aşıyor".into(),
        ));
    }

    let derived = derive(secret, &salt, wrapped.kdf)?;
    let cipher = XChaCha20Poly1305::new(derived.as_ref().into());
    let plain = Zeroizing::new(
        cipher
            .decrypt(XNonce::from_slice(&nonce), ciphertext.as_slice())
            .map_err(|_| CryptoError::WrongSecret)?,
    );

    let bytes: [u8; DATA_KEY_LEN] = plain
        .as_slice()
        .try_into()
        .map_err(|_| CryptoError::Format("anahtar uzunluğu hatalı".into()))?;
    Ok(Zeroizing::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sarmalanan_anahtar_ayni_parolayla_geri_acilir() {
        let key = generate_data_key();
        let wrapped = wrap_key("dogru-parola", &key, KdfParams::test_fast()).unwrap();
        let acilan = unwrap_key("dogru-parola", &wrapped).unwrap();
        assert_eq!(key.as_ref(), acilan.as_ref());
    }

    #[test]
    fn yanlis_parola_wrong_secret_dondurur() {
        let key = generate_data_key();
        let wrapped = wrap_key("dogru-parola", &key, KdfParams::test_fast()).unwrap();
        let hata = unwrap_key("yanlis-parola", &wrapped).unwrap_err();
        assert!(matches!(hata, CryptoError::WrongSecret));
    }

    #[test]
    fn ayni_anahtar_iki_kez_sarmalaninca_ciktilar_farklidir() {
        let key = generate_data_key();
        let a = wrap_key("p", &key, KdfParams::test_fast()).unwrap();
        let b = wrap_key("p", &key, KdfParams::test_fast()).unwrap();
        assert_ne!(a.salt_hex, b.salt_hex, "her sarmalama yeni tuz uretmeli");
        assert_ne!(a.nonce_hex, b.nonce_hex, "her sarmalama yeni nonce uretmeli");
        assert_ne!(a.ciphertext_hex, b.ciphertext_hex);
    }

    #[test]
    fn uretilen_anahtarlar_birbirinden_farklidir() {
        assert_ne!(generate_data_key().as_ref(), generate_data_key().as_ref());
    }

    #[test]
    fn bozuk_sifreli_metin_wrong_secret_dondurur() {
        let key = generate_data_key();
        let mut wrapped = wrap_key("p", &key, KdfParams::test_fast()).unwrap();
        // Ilk baytin degerine gore deterministik biçimde ilk bayti degistir: ciphertext
        // zaten "ff" ile basliyorsa "00" yaz, degilse "ff" yaz. Boylece uzunluk (dolayisiyla
        // yapisal format kontrolu) degismez ve bayt her zaman gercekten bozulur - orijinal
        // kod ~1/256 ihtimalle hicbir seyi degistirmiyordu ("ff" zaten "ff" ise) ve test
        // panikleyebiliyordu.
        let ilk_bayt = &wrapped.ciphertext_hex[0..2];
        let yeni_bayt = if ilk_bayt == "ff" { "00" } else { "ff" };
        wrapped.ciphertext_hex.replace_range(0..2, yeni_bayt);
        assert!(matches!(unwrap_key("p", &wrapped).unwrap_err(), CryptoError::WrongSecret));
    }

    #[test]
    fn yapisal_olarak_bozuk_kayit_format_hatasi_dondurur() {
        let key = generate_data_key();
        let mut wrapped = wrap_key("p", &key, KdfParams::test_fast()).unwrap();
        // Ciphertext'i tamamen bosaltmak, boyutu bekleneni (DATA_KEY_LEN + TAG_LEN) bozar.
        // Bu durum "yanlis parola" degil, kaydin kendisinin bozuk oldugu anlamina gelir;
        // kullaniciyi yanlis parola girdigini sanip tekrar tekrar denemeye (ve sonunda
        // kurtarilamayan veriyi sifirlamaya) itmemek icin ayri bir hata donmeli.
        wrapped.ciphertext_hex.clear();
        assert!(matches!(unwrap_key("p", &wrapped).unwrap_err(), CryptoError::Format(_)));
    }

    #[test]
    fn asiri_buyuk_kdf_parametreleri_format_hatasi_dondurur() {
        let key = generate_data_key();
        let mut wrapped = wrap_key("p", &key, KdfParams::test_fast()).unwrap();
        // Diskten okunan kayit kurcalanmis olabilir; m_cost = u32::MAX turetmeden once
        // reddedilmezse argon2 asiri bellek ayirmaya calisip sureci coker (handle_alloc_error).
        wrapped.kdf.m_cost = u32::MAX;
        assert!(matches!(unwrap_key("p", &wrapped).unwrap_err(), CryptoError::Format(_)));
    }

    #[test]
    fn varsayilan_kdf_parametreleri_spec_ile_uyusur() {
        let p = KdfParams::default();
        assert_eq!((p.m_cost, p.t_cost, p.p_cost), (65536, 3, 1));
    }

    // NOT: Bu test asagida olculdu (bkz. task-2-report.md, Bulgu 7) ve debug derlemesinde
    // 10 saniyenin altinda tamamlandigi icin normal test olarak birakildi (#[ignore] YOK).
    // Eger gelecekte cihaz/donanim degisikligiyle bu esigi asarsa:
    //   #[ignore] ekleyip su komutla calistirin: cargo test -p psikolog-core --release -- --ignored
    #[test]
    fn gercek_kdf_parametreleriyle_round_trip() {
        let key = generate_data_key();
        let baslangic = std::time::Instant::now();
        let wrapped = wrap_key("dogru-parola", &key, KdfParams::default()).unwrap();
        let acilan = unwrap_key("dogru-parola", &wrapped).unwrap();
        let sure = baslangic.elapsed();
        assert_eq!(key.as_ref(), acilan.as_ref());
        eprintln!("gercek KDF (65536/3/1) ile wrap+unwrap suresi: {sure:?}");
    }
}
