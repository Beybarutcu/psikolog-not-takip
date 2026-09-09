use rusqlite::{Connection, OptionalExtension};

pub const CURRENT_VERSION: i64 = 3;

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

/// Surum 3: seans notlari, ekli dosyalar ve not sablonlari.
///
/// `progress_notes` (resmi not) ile `private_notes` (terapistin kendi notu)
/// AYRI TABLOLARDIR, tek tabloda bir `gizli` bayragi degil. Gerekce: ozel
/// notlar hicbir disa aktarima, rapora veya liste uc noktasina girmemeli;
/// bunu `WHERE gizli = 0` gibi bir filtre saglayamaz -- unutulan tek bir
/// sorgu sozu bozar. Ayri tablo, korumayi yapisal hale getirir: ozel notu
/// yanlislikla dahil etmenin yolu, o tabloyu adiyla yazmaktir.
///
/// `appointment_id`'nin `UNIQUE` olmasi "bir randevu = bir seans = bir resmi
/// not" kuralini veritabani seviyesinde uygular; uygulama katmaninda tutulan
/// bir kural er gec ihlal edilir.
///
/// `templates.kod`, `progress_notes.sablon` ile AYNI kapali kumeyi
/// (`'dap','soap','serbest'`) tasir ve `UNIQUE`'tir. Gerekce: kullanici sablonun
/// **icerigini** (basliklarini) duzenler, yeni bir **tur** eklemez. Iki tablo
/// arasinda ortak bir kod olmasaydi -- `templates.ad` serbest metin, `sablon`
/// kapali enum -- arayuzun sablon acilir listesi `templates`'tan doldurulunca
/// secilen deger `progress_notes.sablon`'a HIC yazilamazdi; CHECK reddederdi.
/// `ad` kullanicinin gordugu/duzenledigi isim olarak kalir, `kod` ise iki
/// tablonun ayrisamamasini yapisal olarak garanti eder.
const V3: &str = r#"
CREATE TABLE IF NOT EXISTS progress_notes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id    INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    sablon            TEXT NOT NULL DEFAULT 'dap',
    icerik            TEXT NOT NULL DEFAULT '',
    guncelleme_zamani TEXT NOT NULL,
    CHECK (sablon IN ('dap','soap','serbest'))
);

CREATE INDEX IF NOT EXISTS ix_pnotes_client ON progress_notes(client_id);

CREATE TABLE IF NOT EXISTS private_notes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id    INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    icerik            TEXT NOT NULL DEFAULT '',
    guncelleme_zamani TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_prnotes_client ON private_notes(client_id);

CREATE TABLE IF NOT EXISTS attachments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    dosya_adi         TEXT NOT NULL,
    mime              TEXT NOT NULL,
    tur               TEXT NOT NULL DEFAULT 'diger',
    boyut             INTEGER NOT NULL,
    icerik            BLOB NOT NULL,
    eklenme_zamani    TEXT NOT NULL,
    CHECK (tur IN ('onam','test','diger'))
);

CREATE INDEX IF NOT EXISTS ix_att_client ON attachments(client_id);

CREATE TABLE IF NOT EXISTS templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kod         TEXT NOT NULL UNIQUE,
    ad          TEXT NOT NULL UNIQUE,
    basliklar   TEXT NOT NULL,
    yerlesik    INTEGER NOT NULL DEFAULT 0,
    CHECK (kod IN ('dap','soap','serbest'))
);

INSERT OR IGNORE INTO templates (kod, ad, basliklar, yerlesik) VALUES
    ('dap',     'DAP',  '["Veri","Değerlendirme","Plan"]', 1),
    ('soap',    'SOAP', '["Öznel","Nesnel","Değerlendirme","Plan"]', 1),
    ('serbest', 'Serbest', '[]', 1);
"#;

/// Surum 3'te `clients` tablosuna eklenen sutunlar.
///
/// `ALTER TABLE ... ADD COLUMN`'un `IF NOT EXISTS` bicimi yok, bu yuzden
/// betige gomulemezler; `sutun_ekle` ile tek tek uygulanirlar.
const V3_SUTUNLAR: &[(&str, &str)] = &[
    ("clients", "dogum_tarihi TEXT"),
    ("clients", "riza_tarihi TEXT"),
    ("clients", "riza_dosya_id INTEGER"),
    ("clients", "son_temas TEXT"),
    ("clients", "saklama_bitis TEXT"),
    ("clients", "basvuru_nedeni TEXT"),
    ("clients", "risk_notu TEXT"),
];

/// Bir tabloya sutun ekler; sutun zaten varsa sessizce basarili olur.
///
/// YALNIZCA "duplicate column" hatasi yutulur -- olmayan tablo, bozuk tanim
/// veya kilitli veritabani gibi her turlu baska hata cagirana geri doner.
fn sutun_ekle(conn: &Connection, tablo: &str, tanim: &str) -> Result<(), rusqlite::Error> {
    let sonuc = conn.execute(&format!("ALTER TABLE {tablo} ADD COLUMN {tanim}"), []);
    match sonuc {
        Ok(_) => Ok(()),
        // Sutun zaten varsa migration yeniden calistirilmis demektir; idempotent olmali.
        Err(rusqlite::Error::SqliteFailure(_, Some(ref m))) if m.contains("duplicate column") => {
            Ok(())
        }
        Err(e) => Err(e),
    }
}

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
/// (idempotent): butun betikler `IF NOT EXISTS` kullanir, sutun eklemeleri
/// `sutun_ekle` uzerinden gecer ve surum damgasi zaten guncelse yeniden
/// yazmak zararsizdir.
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
    if mevcut < 3 {
        tx.execute_batch(V3)?;
        for (tablo, tanim) in V3_SUTUNLAR {
            sutun_ekle(&tx, tablo, tanim)?;
        }
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
            matches!(hata, MigrateHatasi::SurumDusuk { veritabani: 99, uygulama: 3 }),
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
    fn surum_uc_olarak_kaydedilir() {
        let (_d, c) = baglanti();
        // deger sutunu TEXT'tir; metin okuyup ayristir. Gerekce Plan 1 Gorev 6'da.
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 3);
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
    fn v1_veritabani_veri_kaybetmeden_guncel_surume_yukselir() {
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
        assert_eq!(ham.parse::<i64>().unwrap(), CURRENT_VERSION);

        let log_sayisi: i64 = c.query_row("SELECT count(*) FROM audit_log", [], |r| r.get(0)).unwrap();
        assert_eq!(log_sayisi, 1, "yukseltme eski erisim logunu silmemeli");

        // Surum 1'den gelen veritabani ATLANAN adimlarin (V2 ve V3) HEPSINI
        // almali; yalnizca son adimi degil.
        for tablo in ["clients", "appointments", "progress_notes", "private_notes"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [tablo],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "v1 -> guncel yukseltme {tablo} tablosunu olusturmali");
        }
    }

    #[test]
    fn basarisiz_migrate_semayi_geri_alir() {
        // V2 ortasinda gercek bir hata tetikleyip transaction'in tamamini geri
        // aldigini kanitlar. Enjeksiyon yolu: V2 "ix_clients_durum" adinda bir
        // INDEX olusturuyor (CREATE INDEX IF NOT EXISTS). "IF NOT EXISTS" yalnizca
        // AYNI TURDE bir nesne varsa atlar; ayni isimde farkli turde bir nesne
        // (bir TABLO) varsa SQLite "there is already an object named
        // ix_clients_durum" hatasi verir. clients tablosu V2'de bu index'ten
        // ONCE olusturuluyor, dolayisiyla hata clients olusturulduktan SONRA
        // ama V2'nin geri kalani (appointments dahil) olusturulmadan ONCE
        // tetiklenir -- transaction'in ortasinda gercek bir kismi geri alma
        // senaryosu.
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
            // V2'nin olusturacagi index ile AYNI ISIMDE, FARKLI TURDE (tablo)
            // bir nesne yerlestir -- "CREATE INDEX IF NOT EXISTS
            // ix_clients_durum" bunu atlamaz, hata verir.
            c.execute("CREATE TABLE ix_clients_durum (x)", []).unwrap();
        }

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        let hata = migrate(&c).unwrap_err();
        assert!(
            matches!(hata, MigrateHatasi::Sqlite(_)),
            "ismi catisan nesne sqlite hatasi uretmeli: {hata:?}"
        );

        // V2'nin hatadan ONCE olusturdugu clients tablosu GERI ALINMIS olmali.
        let clients_var: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='clients'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(clients_var, 0, "basarisiz migrate clients tablosunu geride birakmamali (rollback calismali)");

        // appointments hic olusturulmamis olmali (V2'de clients'tan sonra geliyor).
        let appointments_var: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='appointments'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(appointments_var, 0, "basarisiz migrate appointments tablosunu olusturmamali");

        // schema_version hala 1 olmali, 2'ye yukseltilmemis.
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham, "1", "basarisiz migrate surum damgasini yukseltmemeli");

        // ix_clients_durum HALA bir tablo olmali (bizim yerlestirdigimiz), index degil.
        let tur: String = c
            .query_row(
                "SELECT type FROM sqlite_master WHERE name='ix_clients_durum'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tur, "table", "catisan nesne degismeden kalmali");
    }

    // ---- Surum 3 ----------------------------------------------------------

    /// V2 semali, icinde veri olan bir veritabani hazirlar (henuz V3 yok).
    fn v2_veritabani(yol: &std::path::Path, key: &crate::crypto::keyring::DataKey) {
        let c = crate::store::db::open_encrypted(yol, key).unwrap();
        c.execute_batch(V1).unwrap();
        c.execute_batch(V2).unwrap();
        c.execute(
            "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version','2')
             ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO clients (ad_soyad, durum, olusturma_zamani)
             VALUES ('Eski Danisan','aktif','2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    /// Bir danisan + bir randevu ekler (id'ler 1).
    fn danisan_ve_randevu(c: &rusqlite::Connection) {
        c.execute_batch(
            "INSERT INTO clients (ad_soyad, durum, olusturma_zamani) VALUES ('Ayse','aktif','z');
             INSERT INTO appointments (client_id, baslangic, bitis, durum, olusturma_zamani, guncelleme_zamani)
             VALUES (1,'2026-09-07T14:00','2026-09-07T15:00','planlandi','z','z');",
        )
        .unwrap();
    }

    #[test]
    fn not_ve_ek_tablolari_olusur() {
        let (_d, c) = baglanti();
        for tablo in ["progress_notes", "private_notes", "attachments", "templates"] {
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
    fn danisan_tablosuna_riza_ve_saklama_alanlari_eklenir() {
        let (_d, c) = baglanti();
        for sutun in ["riza_tarihi", "riza_dosya_id", "son_temas", "saklama_bitis", "dogum_tarihi"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM pragma_table_info('clients') WHERE name=?1",
                    [sutun],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "clients.{sutun} yok");
        }
    }

    #[test]
    fn bir_randevuya_yalnizca_bir_resmi_not_baglanir() {
        let (_d, c) = baglanti();
        danisan_ve_randevu(&c);
        c.execute(
            "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
             VALUES (1,1,'dap','ilk not','z')",
            [],
        )
        .unwrap();

        let ikinci = c.execute(
            "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
             VALUES (1,1,'dap','ikinci not','z')",
            [],
        );
        assert!(ikinci.is_err(), "randevu basina tek resmi not olmali");
    }

    #[test]
    fn bir_randevuya_yalnizca_bir_ozel_not_baglanir() {
        let (_d, c) = baglanti();
        danisan_ve_randevu(&c);
        c.execute(
            "INSERT INTO private_notes (appointment_id, client_id, icerik, guncelleme_zamani)
             VALUES (1,1,'ilk','z')",
            [],
        )
        .unwrap();

        let ikinci = c.execute(
            "INSERT INTO private_notes (appointment_id, client_id, icerik, guncelleme_zamani)
             VALUES (1,1,'ikinci','z')",
            [],
        );
        assert!(ikinci.is_err(), "randevu basina tek ozel not olmali");
    }

    #[test]
    fn ozel_not_ayri_tabloda_ve_randevuya_bagli() {
        let (_d, c) = baglanti();
        danisan_ve_randevu(&c);

        // AYNI randevuya once bir RESMI not yaz. Bu satir olmadan asagidaki
        // "resmi not tablosunda ozel notun izi yok" iddiasi islem oncesi durum
        // tarafindan tatmin edilirdi (tablo zaten bostu) -- totoloji.
        c.execute(
            "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
             VALUES (1,1,'dap','resmi kayit','z')",
            [],
        )
        .unwrap();

        c.execute(
            "INSERT INTO private_notes (appointment_id, client_id, icerik, guncelleme_zamani)
             VALUES (1,1,'kendi hipotezim','z')",
            [],
        )
        .unwrap();

        let sayi: i64 = c.query_row("SELECT count(*) FROM private_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 1);

        // Ozel not RESMI not tablosuna DUSMEMELI: ayriligin butun anlami bu.
        // Resmi tabloda tam olarak bizim yazdigimiz kayit durmali, ozel notun
        // icerigi orada HIC gecmemeli.
        let resmi: i64 =
            c.query_row("SELECT count(*) FROM progress_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(resmi, 1, "resmi not tablosunda yalnizca resmi not olmali");

        let sizinti: i64 = c
            .query_row(
                "SELECT count(*) FROM progress_notes WHERE icerik LIKE '%kendi hipotezim%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sizinti, 0, "ozel not icerigi resmi not tablosuna sizmamali");
    }

    #[test]
    fn resmi_not_tablosunda_gizlilik_bayragi_yoktur() {
        // Ozel notlar AYRI TABLODA tutulur. Eger biri ileride progress_notes'a
        // bir "gizli/ozel" sutunu eklerse koruma bir WHERE filtresine
        // devrolur -- unutulan tek bir sorgu ozel notu disa aktarima sizdirir.
        // Bu test o donusumu yakalar.
        let (_d, c) = baglanti();

        // ONCE tablonun VAR oldugunu dogrula: pragma_table_info OLMAYAN bir
        // tablo icin de bos doner, yani asagidaki "bayrak yok" iddiasi tablo
        // hic olusmamisken de saglanirdi. Bu satir olmadan test, koruma
        // kaldirilmis olsa bile yesil kalabilecek bir totolojiye dusar.
        let sutun_sayisi: i64 = c
            .query_row("SELECT count(*) FROM pragma_table_info('progress_notes')", [], |r| r.get(0))
            .unwrap();
        assert!(sutun_sayisi > 0, "progress_notes tablosu olusmamis");

        let bayrak: i64 = c
            .query_row(
                "SELECT count(*) FROM pragma_table_info('progress_notes')
                 WHERE name IN ('gizli','ozel','private','gizlilik')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            bayrak, 0,
            "ozel notlar bir bayrakla degil, ayri tabloyla ayrilmali"
        );
    }

    #[test]
    fn randevu_silinince_notlari_da_silinir() {
        let (_d, c) = baglanti();
        danisan_ve_randevu(&c);
        c.execute_batch(
            "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
             VALUES (1,1,'dap','resmi','z');
             INSERT INTO private_notes (appointment_id, client_id, icerik, guncelleme_zamani)
             VALUES (1,1,'ozel','z');",
        )
        .unwrap();

        c.execute("DELETE FROM appointments WHERE id=1", []).unwrap();

        let resmi: i64 =
            c.query_row("SELECT count(*) FROM progress_notes", [], |r| r.get(0)).unwrap();
        let ozel: i64 =
            c.query_row("SELECT count(*) FROM private_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(resmi, 0, "randevu silinince resmi not da silinmeli");
        assert_eq!(ozel, 0, "randevu silinince ozel not da silinmeli");
    }

    #[test]
    fn not_sablonu_kapali_kumeden_secilir() {
        // CHECK kisiti, uygulama katmanindaki dogrulamayla ayni kumeyi tutar.
        let (_d, c) = baglanti();
        danisan_ve_randevu(&c);
        for gecerli in ["dap", "soap", "serbest"] {
            let sonuc = c.execute(
                "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
                 VALUES (1,1,?1,'x','z')",
                [gecerli],
            );
            assert!(sonuc.is_ok(), "{gecerli} gecerli bir sablon olmali: {sonuc:?}");
            c.execute("DELETE FROM progress_notes", []).unwrap();
        }
        let sonuc = c.execute(
            "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
             VALUES (1,1,'uydurma','x','z')",
            [],
        );
        assert!(sonuc.is_err(), "tanimsiz sablon adi kabul edilmemeli");
    }

    #[test]
    fn ek_dosya_turu_kapali_kumeden_secilir() {
        let (_d, c) = baglanti();
        danisan_ve_randevu(&c);
        for gecerli in ["onam", "test", "diger"] {
            let sonuc = c.execute(
                "INSERT INTO attachments (client_id, dosya_adi, mime, tur, boyut, icerik, eklenme_zamani)
                 VALUES (1,'a.pdf','application/pdf',?1,3,X'010203','2026-09-07T10:00')",
                [gecerli],
            );
            assert!(sonuc.is_ok(), "{gecerli} gecerli bir tur olmali: {sonuc:?}");
        }
        let sonuc = c.execute(
            "INSERT INTO attachments (client_id, dosya_adi, mime, tur, boyut, icerik, eklenme_zamani)
             VALUES (1,'a.pdf','application/pdf','uydurma',3,X'010203','2026-09-07T10:00')",
            [],
        );
        assert!(sonuc.is_err(), "tanimsiz ek dosya turu kabul edilmemeli");
    }

    #[test]
    fn yerlesik_sablonlar_bir_kez_yuklenir() {
        let (_d, c) = baglanti();
        let sayi: i64 =
            c.query_row("SELECT count(*) FROM templates WHERE yerlesik=1", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 3, "DAP/SOAP/Serbest yerlesik sablonlari yuklenmeli");

        // V3 betigini bir daha calistirmak sablonlari cogaltmamali.
        c.execute_batch(V3).unwrap();
        let tekrar: i64 =
            c.query_row("SELECT count(*) FROM templates", [], |r| r.get(0)).unwrap();
        assert_eq!(tekrar, 3, "V3 yeniden calisinca sablonlar cogalmamali");
    }

    #[test]
    fn sutun_ekle_var_olan_sutunu_sessizce_gecer() {
        let (_d, c) = baglanti();
        let var_mi = |c: &rusqlite::Connection| -> i64 {
            c.query_row(
                "SELECT count(*) FROM pragma_table_info('clients') WHERE name='riza_tarihi'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };

        // Sutunun ZATEN var oldugunu dogrula. Bu satir olmadan test, sutunu
        // ilk kez ekleyerek de yesil kalir ve "zaten varsa yut" dalini hic
        // calistirmaz.
        assert_eq!(var_mi(&c), 1, "migrate riza_tarihi'ni eklemis olmali");

        // Var olan sutunu yeniden eklemek hata degil, no-op olmali.
        sutun_ekle(&c, "clients", "riza_tarihi TEXT").unwrap();
        assert_eq!(var_mi(&c), 1, "sutun cogalmamali");
    }

    #[test]
    fn sutun_ekle_gercek_hatayi_yutmaz() {
        // "duplicate column" disindaki hatalar cagirana donmeli; aksi halde
        // yardimci, sessizce basarisiz olan bir migration uretir.
        let (_d, c) = baglanti();
        let sonuc = sutun_ekle(&c, "boyle_bir_tablo_yok", "x TEXT");
        assert!(sonuc.is_err(), "olmayan tablo hatasi yutulmamali");
    }

    #[test]
    fn v2_veritabani_veri_kaybetmeden_v3e_yukselir() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();

        v2_veritabani(&yol, &key);

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        migrate(&c).unwrap();

        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 3);

        let ad: String =
            c.query_row("SELECT ad_soyad FROM clients WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Eski Danisan", "yukseltme mevcut danisani kaybetmemeli");

        // Damganin 3 olmasi V3'un UYGULANDIGI anlamina GELMEZ. Plan 2 surumunu
        // kullanan bir psikolog guncellemeyi aldiginda V3'un HER parcasini
        // almali; aksi halde danisan dosyasi ekrani ilk acilista
        // "no such column" ile coker. Bu yuzden hem tablolar hem sutunlar
        // tek tek dogrulanir.
        for tablo in ["progress_notes", "private_notes", "attachments", "templates"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [tablo],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "v2 -> v3 yukseltme {tablo} tablosunu olusturmali");
        }

        for (_, tanim) in V3_SUTUNLAR {
            let sutun = tanim.split_whitespace().next().unwrap();
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM pragma_table_info('clients') WHERE name=?1",
                    [sutun],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "v2 -> v3 yukseltme clients.{sutun} sutununu eklemeli");
        }

        // Yerlesik sablonlar da yukseltmeyle gelmeli.
        let sablon_sayisi: i64 =
            c.query_row("SELECT count(*) FROM templates WHERE yerlesik=1", [], |r| r.get(0)).unwrap();
        assert_eq!(sablon_sayisi, 3, "v2 -> v3 yukseltme yerlesik sablonlari yuklemeli");
    }

    #[test]
    fn surum_kapisi_uygulanmis_adimi_yeniden_calistirmaz() {
        // migrate'in "kosulsuz execute_batch zinciri" DEGIL, surum kapili
        // olmasini korur. Kapilar (`if mevcut < 1/2/3`) dusrse V3 betigi her
        // acilista yeniden kosar ve `INSERT OR IGNORE INTO templates`
        // psikologun sildigi "Serbest" sablonunu geri getirir.
        let (_d, c) = baglanti();
        c.execute("DELETE FROM templates WHERE ad='Serbest'", []).unwrap();

        migrate(&c).unwrap();

        let geri_geldi: i64 = c
            .query_row("SELECT count(*) FROM templates WHERE ad='Serbest'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            geri_geldi, 0,
            "surum kapisi calismali: uygulanmis V3 adimi yeniden kosmamali, silinen sablon geri gelmemeli"
        );
    }

    #[test]
    fn templates_kodlari_progress_notes_sablonuna_yazilabilir() {
        // templates ile progress_notes.sablon YAPISAL olarak ayrisamaz olmali.
        // Arayuzun sablon acilir listesi templates'tan doldurulur; oradan gelen
        // her deger resmi nota yazilabilmelidir. Bu test ayrisma ihtimalini
        // fiilen dener: her kodu gercekten INSERT eder.
        let (_d, c) = baglanti();
        danisan_ve_randevu(&c);

        let mut sorgu = c.prepare("SELECT kod FROM templates ORDER BY id").unwrap();
        let kodlar: Vec<String> = sorgu
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|k| k.unwrap())
            .collect();
        drop(sorgu);
        assert_eq!(kodlar.len(), 3, "yerlesik sablon kodlari yuklenmeli: {kodlar:?}");

        for kod in &kodlar {
            let sonuc = c.execute(
                "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
                 VALUES (1,1,?1,'x','z')",
                [kod],
            );
            assert!(
                sonuc.is_ok(),
                "templates.kod='{kod}' progress_notes.sablon'a yazilabilmeli (CHECK reddetti): {sonuc:?}"
            );
            c.execute("DELETE FROM progress_notes", []).unwrap();
        }
    }

    #[test]
    fn templates_kodu_kapali_kumeden_secilir() {
        // `kod` sutunu, progress_notes.sablon ile AYNI kapali kumeyi tasir.
        // Buraya kumenin disindan bir deger girilebilseydi iki tablo yeniden
        // ayrisabilirdi.
        let (_d, c) = baglanti();
        let sonuc = c.execute(
            "INSERT INTO templates (kod, ad, basliklar, yerlesik) VALUES ('uydurma','Uydurma','[]',0)",
            [],
        );
        assert!(sonuc.is_err(), "templates.kod kapali kume disina cikamamali");

        // Ayni kod ikinci kez de eklenememeli (UNIQUE).
        let cift = c.execute(
            "INSERT INTO templates (kod, ad, basliklar, yerlesik) VALUES ('dap','DAP Kopya','[]',0)",
            [],
        );
        assert!(cift.is_err(), "ayni kod iki sablon kaydina bolunememeli");
    }

    #[test]
    fn basarisiz_v3_migrate_semayi_geri_alir() {
        // V3'un ORTASINDA gercek bir hata tetikler. Enjeksiyon yolu V2 geri
        // alma testiyle ayni: V3, "ix_pnotes_client" adinda bir INDEX
        // olusturur; ayni isimde FARKLI TURDE (tablo) bir nesne varsa
        // "IF NOT EXISTS" bunu atlamaz, SQLite hata verir. Bu index V3'te
        // progress_notes'tan SONRA, private_notes'tan ONCE geldigi icin hata
        // gercekten yarim uygulanmis bir semanin ortasinda olusur.
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();

        v2_veritabani(&yol, &key);
        {
            let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
            c.execute("CREATE TABLE ix_pnotes_client (x)", []).unwrap();
        }

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        let hata = migrate(&c).unwrap_err();
        assert!(
            matches!(hata, MigrateHatasi::Sqlite(_)),
            "ismi catisan nesne sqlite hatasi uretmeli: {hata:?}"
        );

        // Hatadan ONCE olusturulan progress_notes GERI ALINMIS olmali.
        let pnotes: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='progress_notes'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pnotes, 0, "basarisiz migrate progress_notes'u geride birakmamali");

        // Hatadan SONRA gelenler hic olusturulmamis olmali.
        for tablo in ["private_notes", "attachments", "templates"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [tablo],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 0, "basarisiz migrate {tablo} tablosunu olusturmamali");
        }

        // clients'a eklenecek V3 sutunlari da geri alinmis olmali.
        let riza: i64 = c
            .query_row(
                "SELECT count(*) FROM pragma_table_info('clients') WHERE name='riza_tarihi'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(riza, 0, "basarisiz migrate yarim eklenmis sutun birakmamali");

        // V2'den kalan veri BOZULMAMIS olmali.
        let ad: String =
            c.query_row("SELECT ad_soyad FROM clients WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Eski Danisan", "geri alma mevcut veriyi silmemeli");

        // schema_version hala 2 olmali, 3'e yukseltilmemis.
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham, "2", "basarisiz migrate surum damgasini yukseltmemeli");

        // Catisan nesne bizim yerlestirdigimiz TABLO olarak kalmali.
        let tur: String = c
            .query_row(
                "SELECT type FROM sqlite_master WHERE name='ix_pnotes_client'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tur, "table", "catisan nesne degismeden kalmali");
    }
}
