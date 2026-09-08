//! Keystore: parola/kurtarma kodu ile sarmalanmış veri anahtarının diskteki
//! tek doğruluk kaynağı. İlk kurulum, kilit açma ve parola değiştirme burada.
//!
//! Veri anahtarı (`DataKey`) hiçbir zaman düz baytlar veya hex olarak diske
//! yazılmaz, loglanmaz ya da hata mesajına girmez — yalnızca `WrappedKey`
//! (parola/kurtarma koduyla şifrelenmiş hâli) kalıcı hale gelir.

use crate::crypto::keyring::{
    generate_data_key, unwrap_key, wrap_key, wrapped_key_yapisal_gecerli_mi, CryptoError, DataKey,
    KdfParams, WrappedKey,
};
use crate::crypto::recovery::{generate_recovery_code, normalize_recovery_code};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Keystore dosya biçiminin sürümü. Şema değişirse (Görev 6 kapsamında olabilir)
/// yükleme sırasında bu alana bakılarak göç kararı verilebilir.
pub const KEYSTORE_VERSION: u32 = 1;

/// Diskte saklanan, tek bir veri anahtarının iki farklı sırla (parola ve
/// kurtarma kodu) sarmalanmış hâli. Kendisi hassas veri içermez: her iki alan
/// da AEAD şifreli metin + KDF parametreleridir, düz anahtar değildir.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keystore {
    pub version: u32,
    pub password: WrappedKey,
    pub recovery: WrappedKey,
}

/// İlk kurulumun sonucu. `recovery_code` ve `data_key` yalnızca bu an, bellekte
/// vardır; `recovery_code` kullanıcıya bir kerelik gösterilip diske yazılmaz,
/// `data_key` ise `Zeroizing` sarmalayıcısı sayesinde düşürüldüğünde sıfırlanır.
pub struct SetupResult {
    pub keystore: Keystore,
    pub recovery_code: String,
    pub data_key: DataKey,
}

/// Yeni bir veri anahtarı üretir, hem parola hem de (yeni üretilen) kurtarma
/// koduyla sarmalar. Kurtarma kodu, kullanıcının elle tire/boşlukla girebileceği
/// biçimiyle değil, `normalize_recovery_code` ile normalleştirilmiş hâliyle
/// sarmalanır — aksi hâlde ileride farklı yazımlarla girilen aynı kod açılamaz.
pub fn create(password: &str, kdf: KdfParams) -> Result<SetupResult, CryptoError> {
    let data_key = generate_data_key();
    let recovery_code = generate_recovery_code();
    let keystore = Keystore {
        version: KEYSTORE_VERSION,
        password: wrap_key(password, &data_key, kdf)?,
        recovery: wrap_key(&normalize_recovery_code(&recovery_code), &data_key, kdf)?,
    };
    Ok(SetupResult { keystore, recovery_code, data_key })
}

/// Belirtilen yolda bir keystore dosyası olup olmadığını bildirir.
pub fn exists(path: &Path) -> bool {
    path.exists()
}

/// Keystore'u diske **atomik** yazar: önce aynı dizinde bir geçici dosyaya
/// yazılır, sonra hedef yola `rename` edilir. Doğrudan hedef dosyaya yazıp
/// süreç yarıda kesilseydi (güç kesintisi, çökme) yarım yazılmış/bozuk bir
/// keystore kalırdı ve bu, danışan verisinin tamamına erişimi kaybettirirdi —
/// projedeki en yıkıcı tek hata sınıfı budur.
pub fn save(ks: &Keystore, path: &Path) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let gecici = path.with_extension("json.tmp");
    std::fs::write(&gecici, serde_json::to_vec_pretty(ks)?)?;
    // Bu dosya, verinin tamamına erişimi belirleyen tek dosyadır. Sarmalanmış
    // anahtar zaten şifreli olduğu için bu katı bir gereklilik değil, derinlemesine
    // savunma amaçlıdır: aynı makinedeki diğer kullanıcıların dosyayı okumasını/
    // üzerine yazmasını önler. Hedef platform macOS; Windows'ta Unix izin modeli
    // yok, bu yüzden bu adım atlanır (bkz. Bulgu 6).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&gecici, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&gecici, path)
}

/// Diskteki keystore dosyasını okur ve ayrıştırır.
pub fn load(path: &Path) -> std::io::Result<Keystore> {
    let bytes = std::fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Bir `Keystore`'un **parolayı bilmeden** yapısal olarak sağlam olup
/// olmadığını bildirir: her iki sarmalamanın da hex'i çözülebiliyor mu,
/// uzunlukları doğru mu, KDF parametreleri sınır içinde mi.
///
/// `load` yalnızca dosyanın geçerli JSON olduğuna bakar; yarım disk yazımından
/// kalma kısalmış bir `ciphertext_hex` `load`'dan sorunsuz geçer. Bu kontrol,
/// "dosya bozuk" ile "parola yanlış" durumlarının karıştırılmasını engelleyen
/// tek yerdir — bu ayrım bu projede dört ayrı katmanda hata olarak bulundu,
/// bu yüzden kural tek bir fonksiyonda toplandı: hem `AppState::keystore_durumu`
/// hem de `backup::geri_yukle`/`backup::yedek_al` bunu çağırır, kendi
/// kopyalarını taşımaz.
///
/// AEAD çözme (kimlik doğrulama) YAPMAZ; dolayısıyla asla "yanlış parola"yı
/// "bozuk dosya" diye raporlayamaz.
pub fn yapisal_gecerli_mi(ks: &Keystore) -> bool {
    wrapped_key_yapisal_gecerli_mi(&ks.password) && wrapped_key_yapisal_gecerli_mi(&ks.recovery)
}

/// Parolayla veri anahtarının kilidini açar. Parola yanlışsa `CryptoError::WrongSecret`
/// döner.
pub fn unlock_with_password(ks: &Keystore, password: &str) -> Result<DataKey, CryptoError> {
    unwrap_key(password, &ks.password)
}

/// Kurtarma koduyla veri anahtarının kilidini açar. Kod, kullanıcının tire,
/// boşluk veya küçük harfle girebileceği herhangi bir biçimde gelebilir;
/// karşılaştırmadan önce `normalize_recovery_code` ile normalleştirilir.
pub fn unlock_with_recovery(ks: &Keystore, code: &str) -> Result<DataKey, CryptoError> {
    unwrap_key(&normalize_recovery_code(code), &ks.recovery)
}

/// Eski parolayla veri anahtarının kilidini açıp yeni parolayla yeniden
/// sarmalanmış bir `Keystore` döndürür. Kurtarma sarmalaması (`recovery`)
/// **değişmeden** kopyalanır: parola değiştiğinde kurtarma kodunun geçerliliğini
/// yitirmesi, kullanıcının bunu ancak parolasını unuttuğu (yani çok geç olduğu)
/// anda fark etmesi anlamına gelirdi. Diske yazma sorumluluğu çağırana aittir —
/// bu fonksiyon `save` çağırmaz.
pub fn change_password(ks: &Keystore, old: &str, new: &str) -> Result<Keystore, CryptoError> {
    let data_key = unlock_with_password(ks, old)?;
    Ok(Keystore {
        version: ks.version,
        password: wrap_key(new, &data_key, ks.password.kdf)?,
        recovery: ks.recovery.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::KdfParams;

    fn kur() -> SetupResult {
        create("parola123", KdfParams::test_fast()).unwrap()
    }

    #[test]
    fn kurulum_parola_ve_kurtarma_koduyla_ayni_anahtari_acar() {
        let s = kur();
        let a = unlock_with_password(&s.keystore, "parola123").unwrap();
        let b = unlock_with_recovery(&s.keystore, &s.recovery_code).unwrap();
        assert_eq!(a.as_ref(), s.data_key.as_ref());
        assert_eq!(b.as_ref(), s.data_key.as_ref());
    }

    #[test]
    fn kurtarma_kodu_dagilmis_yazilsa_da_calisir() {
        let s = kur();
        let dagilmis = s.recovery_code.to_lowercase().replace('-', " ");
        let acilan = unlock_with_recovery(&s.keystore, &dagilmis).unwrap();
        assert_eq!(acilan.as_ref(), s.data_key.as_ref());
    }

    #[test]
    fn yanlis_parola_reddedilir() {
        let s = kur();
        assert!(matches!(
            unlock_with_password(&s.keystore, "yanlis").unwrap_err(),
            CryptoError::WrongSecret
        ));
    }

    #[test]
    fn parola_degisince_yeni_parola_calisir_eskisi_calismaz() {
        let s = kur();
        let yeni = change_password(&s.keystore, "parola123", "yeni-parola").unwrap();

        let acilan = unlock_with_password(&yeni, "yeni-parola").unwrap();
        assert_eq!(acilan.as_ref(), s.data_key.as_ref(), "veri anahtari degismemeli");
        assert!(unlock_with_password(&yeni, "parola123").is_err());
    }

    #[test]
    fn parola_degisince_kurtarma_kodu_gecerliligini_korur() {
        let s = kur();
        let yeni = change_password(&s.keystore, "parola123", "yeni-parola").unwrap();
        let acilan = unlock_with_recovery(&yeni, &s.recovery_code).unwrap();
        assert_eq!(acilan.as_ref(), s.data_key.as_ref());
    }

    #[test]
    fn yanlis_eski_parolayla_degistirilemez() {
        let s = kur();
        assert!(change_password(&s.keystore, "yanlis", "yeni").is_err());
    }

    #[test]
    fn diske_yazilip_geri_okunur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("keystore.json");
        let s = kur();
        assert!(!exists(&yol));
        save(&s.keystore, &yol).unwrap();
        assert!(exists(&yol));

        let okunan = load(&yol).unwrap();
        let acilan = unlock_with_password(&okunan, "parola123").unwrap();
        assert_eq!(acilan.as_ref(), s.data_key.as_ref());
    }

    #[test]
    fn keystore_dosyasi_duz_anahtar_icermez() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("keystore.json");
        let s = kur();
        save(&s.keystore, &yol).unwrap();

        let icerik = std::fs::read(&yol).unwrap();
        let anahtar_hex = hex::encode(s.data_key.as_ref());
        let metin = String::from_utf8_lossy(&icerik);
        assert!(!metin.contains(&anahtar_hex), "veri anahtari diske duz yazilmis");
        assert!(!icerik.windows(32).any(|w| w == s.data_key.as_ref()));
    }

    #[cfg(unix)]
    #[test]
    fn keystore_dosyasi_izinleri_sikilastirilir() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("keystore.json");
        let s = kur();
        save(&s.keystore, &yol).unwrap();

        let mod_biti = std::fs::metadata(&yol).unwrap().permissions().mode() & 0o777;
        assert_eq!(mod_biti, 0o600, "keystore.json izinleri 0600 olmali, gelen: {mod_biti:o}");
    }
}
