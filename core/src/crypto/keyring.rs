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

pub type DataKey = Zeroizing<[u8; DATA_KEY_LEN]>;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("parola veya kurtarma kodu hatali")]
    WrongSecret,
    #[error("anahtar turetilemedi: {0}")]
    Kdf(String),
    #[error("kayit bicimi bozuk: {0}")]
    Format(String),
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
        .map_err(|_| CryptoError::Kdf("sifreleme basarisiz".into()))?;

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
        return Err(CryptoError::Format("nonce uzunlugu hatali".into()));
    }

    let derived = derive(secret, &salt, wrapped.kdf)?;
    let cipher = XChaCha20Poly1305::new(derived.as_ref().into());
    let plain = cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_slice())
        .map_err(|_| CryptoError::WrongSecret)?;

    let bytes: [u8; DATA_KEY_LEN] = plain
        .as_slice()
        .try_into()
        .map_err(|_| CryptoError::Format("anahtar uzunlugu hatali".into()))?;
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
        wrapped.ciphertext_hex.replace_range(0..2, "ff");
        assert!(matches!(unwrap_key("p", &wrapped).unwrap_err(), CryptoError::WrongSecret));
    }

    #[test]
    fn varsayilan_kdf_parametreleri_spec_ile_uyusur() {
        let p = KdfParams::default();
        assert_eq!((p.m_cost, p.t_cost, p.p_cost), (65536, 3, 1));
    }
}
