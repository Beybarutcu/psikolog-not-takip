use crate::crypto::keyring::DataKey;
use rusqlite::Connection;
use std::path::Path;

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
    let anahtar_sonucu =
        conn.pragma_update(None, "key", format!("x'{}'", hex::encode(key.as_ref())));

    match anahtar_sonucu {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(_, _)) => return Err(DbError::WrongKey),
        Err(e) => return Err(DbError::Sqlite(e)),
    }

    // Anahtar yanlışsa ilk gerçek okuma "file is not a database" ile patlar.
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(_, _)) => return Err(DbError::WrongKey),
        Err(e) => return Err(DbError::Sqlite(e)),
    }

    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    Ok(conn)
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
}
