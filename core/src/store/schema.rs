use rusqlite::Connection;

pub const CURRENT_VERSION: i64 = 1;

const V1: &str = r#"
CREATE TABLE IF NOT EXISTS app_meta (
    anahtar TEXT PRIMARY KEY,
    deger   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    olay_zamani  TEXT NOT NULL,
    eylem        TEXT NOT NULL,
    varlik       TEXT NOT NULL,
    varlik_id    TEXT NOT NULL,
    cihaz        TEXT NOT NULL,
    ayrinti      TEXT
);

CREATE INDEX IF NOT EXISTS ix_audit_zaman ON audit_log(olay_zamani);

-- KVKK 2018/10: erisim logu degistirilemez olmali.
CREATE TRIGGER IF NOT EXISTS audit_log_guncelleme_yasak
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'erisim logu degistirilemez');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_silme_yasak
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'erisim logu silinemez');
END;
"#;

pub fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(V1)?;
    conn.execute(
        "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version', ?1)
         ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger",
        [CURRENT_VERSION.to_string()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::db::open_encrypted;

    fn baglanti() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_encrypted(&dir.path().join("veri.db"), &generate_data_key()).unwrap();
        migrate(&conn).unwrap();
        (dir, conn)
    }

    #[test]
    fn migration_surumu_kaydeder() {
        let (_d, c) = baglanti();
        // DIKKAT: deger sutunu TEXT'tir. app_meta genel amacli bir anahtar/deger
        // tablosudur ve ileride metin ayarlar da tutacaktir. Sutunu NUMERIC yapip
        // burada i64 okumak, sayi gibi gorunen metinleri (bastaki sifirlar, "1.50")
        // sessizce bozar. Dogru olan, degeri metin okuyup ayristirmaktir.
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), CURRENT_VERSION);
    }

    #[test]
    fn migration_iki_kez_calisabilir() {
        let (_d, c) = baglanti();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
    }

    #[test]
    fn app_meta_sayi_gibi_gorunen_metni_bozmadan_saklar() {
        let (_d, c) = baglanti();
        c.execute(
            "INSERT INTO app_meta (anahtar, deger) VALUES ('test_deger', '0501234567')",
            [],
        )
        .unwrap();
        let okunan: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='test_deger'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(okunan, "0501234567", "bastaki sifir korunmalı");
    }

    #[test]
    fn audit_log_guncellenemez() {
        let (_d, c) = baglanti();
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz)
             VALUES ('2026-09-07T10:00:00Z','goruntuleme','client','1','masaustu')",
            [],
        )
        .unwrap();

        let hata = c.execute("UPDATE audit_log SET eylem='silme'", []).unwrap_err();
        assert!(hata.to_string().contains("erisim logu degistirilemez"));
    }

    #[test]
    fn audit_log_silinemez() {
        let (_d, c) = baglanti();
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz)
             VALUES ('2026-09-07T10:00:00Z','goruntuleme','client','1','masaustu')",
            [],
        )
        .unwrap();

        let hata = c.execute("DELETE FROM audit_log", []).unwrap_err();
        assert!(hata.to_string().contains("erisim logu silinemez"));
    }
}
