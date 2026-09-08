use rusqlite::{Connection, OptionalExtension};

pub const CURRENT_VERSION: i64 = 2;

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

const V2: &str = r#"
CREATE TABLE IF NOT EXISTS clients (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_soyad          TEXT NOT NULL,
    telefon           TEXT,
    durum             TEXT NOT NULL DEFAULT 'aktif',
    olusturma_zamani  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_clients_durum ON clients(durum);

CREATE TABLE IF NOT EXISTS appointments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    baslangic         TEXT NOT NULL,
    bitis             TEXT NOT NULL,
    durum             TEXT NOT NULL DEFAULT 'planlandi',
    ucret             INTEGER,
    odendi            INTEGER NOT NULL DEFAULT 0,
    seri_id           TEXT,
    olusturma_zamani  TEXT NOT NULL,
    guncelleme_zamani TEXT NOT NULL,
    CHECK (durum IN ('planlandi','geldi','gelmedi','iptal')),
    CHECK (bitis > baslangic)
);

CREATE INDEX IF NOT EXISTS ix_app_baslangic ON appointments(baslangic);
CREATE INDEX IF NOT EXISTS ix_app_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS ix_app_seri ON appointments(seri_id);
"#;

/// `migrate` sirasinda olusabilecek hatalar.
///
/// `SurumDusuk`, veritabanindaki semanin bu uygulama surumunun bildiginden
/// DAHA YENI oldugu durumu isaret eder (kullanici eski bir `.app` geri
/// koymus olabilir). Bu durumda `migrate` acmayi reddeder ve
/// `schema_version`'i ASLA geri yazmaz -- aksi halde veritabani sessizce
/// eski surume dusurulmus gibi isaretlenir, yeni tablolar ortada kalir ve
/// sonraki hicbir teshis dogru olmaz.
#[derive(Debug, thiserror::Error)]
pub enum MigrateHatasi {
    #[error(
        "veritabani semasi (surum {veritabani}) bu uygulamanin destekledigi surumden (surum {uygulama}) daha yeni; lutfen uygulamayi guncelleyin"
    )]
    SurumDusuk { veritabani: i64, uygulama: i64 },
    #[error("schema_version degeri sayiya cevrilemedi: {0:?}")]
    BozukSurum(String),
    #[error("veritabani hatasi: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// `app_meta` tablosundaki `schema_version` degerini okur.
///
/// `app_meta` tablosu henuz yoksa (hic `migrate` calismamis bos bir
/// veritabani) `0` doner -- bu bir hata degil, en dusuk surum anlamina gelir.
/// `deger` sutunu TEXT'tir (bkz. Plan 1 Gorev 6): metin okunup ayristirilir,
/// sayiya cevrilemiyorsa `BozukSurum` donulur.
pub fn okunan_surum(conn: &Connection) -> Result<i64, MigrateHatasi> {
    let tablo_var: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='app_meta'",
        [],
        |r| r.get(0),
    )?;
    if tablo_var == 0 {
        return Ok(0);
    }

    let ham: Option<String> = conn
        .query_row(
            "SELECT deger FROM app_meta WHERE anahtar='schema_version'",
            [],
            |r| r.get(0),
        )
        .optional()?;

    match ham {
        None => Ok(0),
        Some(s) => s
            .parse::<i64>()
            .map_err(|_| MigrateHatasi::BozukSurum(s)),
    }
}

/// Semayi mevcut veritabani surumunden `CURRENT_VERSION`'a yukseltir.
///
/// Once mevcut surum **okunur**; yalnizca eksik adimlar sirayla uygulanir ve
/// tumu **tek transaction** icinde calisir -- yarim uygulanmis bir sema asla
/// kalici olmaz. Veritabani surumu uygulamadan yeniyse (kullanici eski bir
/// `.app` geri koymus olabilir) yukseltme reddedilir ve surum damgasi
/// DEGISTIRILMEZ. Ayni baglantida birden fazla kez cagirmak guvenlidir
/// (idempotent): butun betikler `IF NOT EXISTS` kullanir ve surum damgasi
/// zaten guncelse yeniden yazmak zararsizdir.
pub fn migrate(conn: &Connection) -> Result<(), MigrateHatasi> {
    let mevcut = okunan_surum(conn)?;

    if mevcut > CURRENT_VERSION {
        return Err(MigrateHatasi::SurumDusuk { veritabani: mevcut, uygulama: CURRENT_VERSION });
    }

    let tx = conn.unchecked_transaction()?;

    if mevcut < 1 {
        tx.execute_batch(V1)?;
    }
    if mevcut < 2 {
        tx.execute_batch(V2)?;
    }

    tx.execute(
        "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version', ?1)
         ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger",
        [CURRENT_VERSION.to_string()],
    )?;

    tx.commit()?;
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

    #[test]
    fn bos_veritabaninda_okunan_surum_sifir() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::store::db::open_encrypted(
            &dir.path().join("v.db"),
            &crate::crypto::keyring::generate_data_key(),
        )
        .unwrap();
        assert_eq!(okunan_surum(&c).unwrap(), 0, "app_meta yokken 0 donmeli");
    }

    #[test]
    fn ileri_surumlu_veritabani_reddedilir_ve_surum_geri_yazilmaz() {
        let (_d, c) = baglanti();
        // Kullanici eski bir .app geri koymus: veritabani uygulamadan yeni.
        c.execute(
            "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version','99')
             ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
            [],
        )
        .unwrap();

        let hata = migrate(&c).unwrap_err();
        assert!(
            matches!(hata, MigrateHatasi::SurumDusuk { veritabani: 99, uygulama: 2 }),
            "ileri surumlu veritabani acilmamali: {hata:?}"
        );

        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham, "99", "reddedilen migrate surumu ASLA geri yazmamali");
    }

    #[test]
    fn sayiya_cevrilemeyen_surum_panik_degil_hata_uretir() {
        let (_d, c) = baglanti();
        c.execute(
            "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version','abc')
             ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
            [],
        )
        .unwrap();
        assert!(matches!(migrate(&c).unwrap_err(), MigrateHatasi::BozukSurum(_)));
    }

    #[test]
    fn migrate_ucuncu_kez_calistirilabilir() {
        // baglanti() zaten bir kez calistiriyor; iki kez daha.
        let (_d, c) = baglanti();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
    }

    #[test]
    fn surum_iki_olarak_kaydedilir() {
        let (_d, c) = baglanti();
        // deger sutunu TEXT'tir; metin okuyup ayristir. Gerekce Plan 1 Gorev 6'da.
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 2);
    }

    #[test]
    fn danisan_ve_randevu_tablolari_olusur() {
        let (_d, c) = baglanti();
        for tablo in ["clients", "appointments"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [tablo],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "{tablo} tablosu yok");
        }
    }

    #[test]
    fn ucret_alani_tam_sayidir() {
        let (_d, c) = baglanti();
        let tip: String = c
            .query_row(
                "SELECT type FROM pragma_table_info('appointments') WHERE name='ucret'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tip, "INTEGER", "ucret kurus cinsinden tam sayi olmali");
    }

    #[test]
    fn olmayan_danisana_randevu_eklenemez() {
        let (_d, c) = baglanti();
        let sonuc = c.execute(
            "INSERT INTO appointments (client_id, baslangic, bitis, durum, olusturma_zamani, guncelleme_zamani)
             VALUES (999, '2026-09-07T14:00', '2026-09-07T15:00', 'planlandi', 'z', 'z')",
            [],
        );
        assert!(sonuc.is_err(), "yabanci anahtar kisiti calismalı");
    }

    #[test]
    fn v1_veritabani_veri_kaybetmeden_v2ye_yukselir() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();

        // V1 durumunu taklit et: yalnizca V1 tablolari ve surum 1.
        {
            let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
            c.execute_batch(V1).unwrap();
            c.execute(
                "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version','1')
                 ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
                [],
            )
            .unwrap();
            c.execute(
                "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz)
                 VALUES ('2026-09-01T09:00:00Z','giris','session','-','masaustu')",
                [],
            )
            .unwrap();
        }

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        migrate(&c).unwrap();

        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 2);

        let log_sayisi: i64 = c.query_row("SELECT count(*) FROM audit_log", [], |r| r.get(0)).unwrap();
        assert_eq!(log_sayisi, 1, "yukseltme eski erisim logunu silmemeli");
    }
}
