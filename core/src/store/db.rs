use crate::crypto::keyring::DataKey;
use rusqlite::ffi::ErrorCode;
use rusqlite::Connection;
use std::path::Path;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("veritabanı bu parolayla açılamıyor")]
    WrongKey,
    #[error("veritabanı hatası: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("dosya hatası: {0}")]
    Io(#[from] std::io::Error),
}

pub fn open_encrypted(path: &Path, key: &DataKey) -> Result<Connection, DbError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;

    // Anahtarın hex temsili ve onu saran PRAGMA değeri, ara String'ler olarak
    // bellekte kalabileceğinden Zeroizing ile sarılıyor (bkz. Görev 2'deki
    // aynı sınıftan bulgu: anahtar tutan her ara buffer sıfırlanmalı).
    let anahtar_hex: Zeroizing<String> = Zeroizing::new(hex::encode(key.as_ref()));
    let pragma_degeri: Zeroizing<String> = Zeroizing::new(format!("x'{}'", anahtar_hex.as_str()));
    let anahtar_sonucu = conn.pragma_update(None, "key", pragma_degeri.as_str());

    match anahtar_sonucu {
        Ok(_) => {}
        Err(e) => return Err(siniflandir_anahtar_hatasi(e)),
    }

    // Anahtar yanlışsa ilk gerçek okuma "file is not a database" ile patlar.
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)) {
        Ok(_) => {}
        Err(e) => return Err(siniflandir_anahtar_hatasi(e)),
    }

    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    Ok(conn)
}

/// SQLite/SQLCipher hatasını sınıflandırır.
///
/// Yalnızca `SQLITE_NOTADB` (ErrorCode::NotADatabase) yanlış parolayı işaret eder:
/// SQLCipher yanlış anahtarla açılan bir dosyayı okumaya çalıştığında sayfa
/// başlıklarını çözemez ve bunu "dosya bir veritabanı değil" hatası olarak
/// bildirir. Kilitli dosya (`SQLITE_BUSY`/`SQLITE_LOCKED`), disk G/Ç hatası
/// (`SQLITE_IOERR`) veya gerçekten bozuk bir veritabanı (`SQLITE_CORRUPT`)
/// gibi diğer tüm `SqliteFailure` türleri `DbError::Sqlite` olarak geçirilir;
/// aksi halde kullanıcı doğru parolayla karşılaştığı geçici bir sorunu
/// "parolanız yanlış" sanıp kurtarılabilir veriyi sıfırlayarak imha edebilir.
fn siniflandir_anahtar_hatasi(err: rusqlite::Error) -> DbError {
    match err {
        rusqlite::Error::SqliteFailure(ref ffi_hata, _)
            if ffi_hata.code == ErrorCode::NotADatabase =>
        {
            DbError::WrongKey
        }
        other => DbError::Sqlite(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;

    #[test]
    fn ayni_anahtarla_yazilan_veri_geri_okunur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = generate_data_key();

        {
            let c = open_encrypted(&yol, &key).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse Yilmaz');")
                .unwrap();
        }

        let c = open_encrypted(&yol, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse Yilmaz");
    }

    #[test]
    fn yanlis_anahtar_wrong_key_dondurur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        {
            let c = open_encrypted(&yol, &generate_data_key()).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT);").unwrap();
        }
        let hata = open_encrypted(&yol, &generate_data_key()).unwrap_err();
        assert!(matches!(hata, DbError::WrongKey));
    }

    #[test]
    fn dosya_icinde_duz_metin_bulunmaz() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        {
            let c = open_encrypted(&yol, &generate_data_key()).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('GIZLI_DANISAN_ADI');")
                .unwrap();
        }
        let bytes = std::fs::read(&yol).unwrap();
        assert!(
            !bytes.windows(17).any(|w| w == b"GIZLI_DANISAN_ADI"),
            "veritabani dosyasinda duz metin bulundu"
        );
        assert!(&bytes[..15] != b"SQLite format 3", "dosya sifrelenmemis");
    }

    #[test]
    fn sifrelenmemis_duz_sqlite_dosyasi_wrong_key_olarak_siniflandirilir() {
        // Şifrelenmemiş ama tamamen geçerli bir SQLite dosyası: anahtarla
        // açılmaya çalışıldığında SQLCipher sayfa başlıklarını çözemez ve bu,
        // gerçek SQLCipher davranışında SQLITE_NOTADB olarak yüzeye çıkar.
        // Bu, `siniflandir_anahtar_hatasi`nin isabet etmesi gereken asıl
        // WrongKey senaryosudur.
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("duz.db");
        {
            let c = rusqlite::Connection::open(&yol).unwrap();
            c.execute_batch("CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);")
                .unwrap();
        }

        let hata = open_encrypted(&yol, &generate_data_key()).unwrap_err();
        assert!(
            matches!(hata, DbError::WrongKey),
            "beklenen WrongKey, gelen: {hata:?}"
        );
    }

    #[test]
    fn olusturulamayan_dizin_io_hatasi_dondurur() {
        // `path.parent()` bir dizin değil de var olan bir dosyaysa
        // `create_dir_all` başarısız olur; bu hatanın WrongKey'e değil
        // DbError::Io'ya gitmesi gerekir.
        let dir = tempfile::tempdir().unwrap();
        let engel = dir.path().join("bu_bir_dizin_degil");
        std::fs::write(&engel, b"ben bir dizin degilim, duz bir dosyayim").unwrap();
        let yol = engel.join("veri.db");

        let hata = open_encrypted(&yol, &generate_data_key()).unwrap_err();
        assert!(
            matches!(hata, DbError::Io(_)),
            "beklenen Io, gelen: {hata:?}"
        );
    }

    #[test]
    fn notadb_disindaki_sqlite_hatasi_wrongkey_e_donusturulmez() {
        // `siniflandir_anahtar_hatasi`nin asıl düzeltmesi: NotADatabase
        // dışındaki her SqliteFailure türü (ör. kilitli dosya, disk G/Ç,
        // bozukluk) DbError::Sqlite'a gitmeli, WrongKey'e değil. Gerçek bir
        // SQLITE_BUSY/SQLITE_IOERR durumunu dosya kilitleme ile uçtan uca
        // deterministik biçimde tetiklemek platforma/zamanlamaya bağlı ve
        // kırılgan olacağından, sınıflandırma fonksiyonu burada doğrudan
        // sahte bir DatabaseBusy hatasıyla test ediliyor (bkz. rapor: "yazılamayan
        // testler").
        let sahte_ffi_hata = rusqlite::ffi::Error {
            code: ErrorCode::DatabaseBusy,
            extended_code: 5, // SQLITE_BUSY
        };
        let hata = siniflandir_anahtar_hatasi(rusqlite::Error::SqliteFailure(sahte_ffi_hata, None));
        assert!(
            matches!(hata, DbError::Sqlite(_)),
            "beklenen Sqlite, gelen: {hata:?}"
        );
    }
}
