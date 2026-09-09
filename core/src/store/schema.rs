use crate::store::appointments::ASGARI_UCRET;
use rusqlite::{Connection, OptionalExtension};

pub const CURRENT_VERSION: i64 = 4;

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
    ('dap',     'DAP',  '["Veri","DeÄŸerlendirme","Plan"]', 1),
    ('soap',    'SOAP', '["Ã–znel","Nesnel","DeÄŸerlendirme","Plan"]', 1),
    ('serbest', 'Serbest', '[]', 1);
"#;

/// Surum 4: `appointments.ucret` icin veritabani kisiti.
///
/// # Neden tablo yeniden olusturuluyor
///
/// `ucret >= 0` kurali bugune kadar YALNIZCA uygulama katmanindaydi
/// (`appointments::ucret_gecerli_mi`). SQLite var olan bir tabloya `CHECK`
/// EKLEYEMEZ (`ALTER TABLE ... ADD CONSTRAINT` yok), bu yuzden SQLite'in
/// kendi belgeledigi yol izleniyor: yeni tablo, veri kopyasi, eski tabloyu
/// dusur, yeniden adlandir, indeksleri kur.
///
/// # KRITIK: bu adim yabanci anahtarlar KAPALIYKEN calismak zorunda
///
/// `progress_notes` ve `private_notes` `appointments`'a `ON DELETE CASCADE`
/// ile bagli. Yabanci anahtarlar acikken `DROP TABLE appointments` ortulu
/// bir `DELETE FROM appointments` calistirir ve **butun seans notlariyla
/// ozel notlari siler** -- yani "ucrete kisit ekleyen" bir gocun yan etkisi
/// klinik kaydin tamaminin yok olmasi olurdu. `migrate` bu yuzden
/// `PRAGMA foreign_keys`'i BEGIN'den once kapatir (pragma transaction icinde
/// no-op'tur) ve her cikista geri acar; `v4_uygula` de kopyalamadan sonra
/// `pragma_foreign_key_check` ile baglarin saglam kaldigini dogrular.
///
/// # `CHECK (ucret IS NULL OR ucret >= 0)`
///
/// `NULL` bilerek gecerli: ucretsiz ya da henuz girilmemis seans. Sabit
/// `appointments::ASGARI_UCRET` ile ayni kumeyi tasir; ayrisma
/// `tests::ucret_alt_siniri_semada_ve_uygulama_katmaninda_ayni` ile iki
/// yonlu yakalanir. Sayi buraya ELLE yazili -- goc adimi tarihsel bir
/// metindir, mutasyona ugrayabilen bir sabitten turetilemez.
///
/// `CREATE TABLE`'da `IF NOT EXISTS` YOK: `appointments_v4` adinda bir nesne
/// kalmissa bir onceki gocun yarida kaldigi anlamina gelir ve sessizce
/// uzerine calismak yerine hata verilmelidir. Adimin kendisi idempotent
/// degildir; onu koruyan sey surum kapisidir
/// (`tests::surum_kapisi_uygulanmis_adimi_yeniden_calistirmaz`).
const V4: &str = r#"
CREATE TABLE appointments_v4 (
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
    CHECK (bitis > baslangic),
    CHECK (ucret IS NULL OR ucret >= 0)
);

INSERT INTO appointments_v4
    (id, client_id, baslangic, bitis, durum, ucret, odendi, seri_id,
     olusturma_zamani, guncelleme_zamani)
SELECT id, client_id, baslangic, bitis, durum, ucret, odendi, seri_id,
       olusturma_zamani, guncelleme_zamani
FROM appointments;

DROP TABLE appointments;

ALTER TABLE appointments_v4 RENAME TO appointments;

CREATE INDEX IF NOT EXISTS ix_app_baslangic ON appointments(baslangic);
CREATE INDEX IF NOT EXISTS ix_app_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS ix_app_seri ON appointments(seri_id);
"#;

/// V4 adimi: once mevcut verinin yeni kisiti gecip gecmedigi denetlenir,
/// sonra tablo yeniden olusturulur, en sonunda yabanci anahtar baglari
/// dogrulanir.
///
/// Uc adimin da hatasi cagirandaki **tek transaction** icinde olustugu icin
/// herhangi biri basarisiz olursa sema butunuyle eski haline doner
/// (`tests::basarisiz_v4_migrate_semayi_geri_alir`).
fn v4_uygula(tx: &Connection) -> Result<(), MigrateHatasi> {
    // Uygulama katmani negatif ucreti her zaman reddetti, ama ham SQL'le
    // ya da baska bir aractan gelen bir satir olabilir. Ciplak bir
    // "CHECK constraint failed" mesaji kullaniciya hicbir sey anlatmaz;
    // bu kod tabaninin kurali hatalarin AYRISIK olmasi (bkz. `DbError`).
    let ihlal: i64 = tx.query_row(
        "SELECT COUNT(*) FROM appointments WHERE ucret IS NOT NULL AND ucret < ?1",
        [ASGARI_UCRET],
        |r| r.get(0),
    )?;
    if ihlal > 0 {
        return Err(MigrateHatasi::UcretKisitiIhlali { adet: ihlal as usize });
    }

    tx.execute_batch(V4)?;

    // Yeniden olusturma, `appointments`'a bagli olan (ve olan) yabanci
    // anahtarlari bozmus olabilir -- ve bu goc yabanci anahtarlar KAPALIYKEN
    // calisiyor, yani motor bunu kendiliginden soylemez. SQLite'in
    // belgeledigi yordamdaki dogrulama adimi bu.
    //
    // Kume, yeniden olusturmanin bozabilecegi UC tabloyla sinirli: tum
    // semayi taramak, bu gocle hicbir ilgisi olmayan eski bir kirik bag
    // yuzunden yukseltmeyi engellerdi.
    for tablo in ["appointments", "progress_notes", "private_notes"] {
        let kirik: i64 = tx.query_row(
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{tablo}')"),
            [],
            |r| r.get(0),
        )?;
        if kirik > 0 {
            return Err(MigrateHatasi::YabanciAnahtarKirik { tablo, adet: kirik as usize });
        }
    }
    Ok(())
}

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
    /// V4, `appointments` tablosunu `CHECK (ucret IS NULL OR ucret >= 0)`
    /// ile yeniden olusturuyor. Veritabaninda bu kisiti ihlal eden satir
    /// varsa yukseltme UYGULANMAZ ve hicbir kayit degismez.
    ///
    /// `Sqlite`'tan **ayri** bir varyant olmasinin sebebi bu kod tabaninin
    /// dort katmanda tekrarlanan hata sinifi: "her hata ayni hatadir".
    /// Ciplak bir `CHECK constraint failed`, kullanicinin ne yapmasi
    /// gerektigini soylemez. Yalnizca ADET tasinir, kayit icerigi TASINMAZ.
    #[error(
        "veritabaninda ucreti eksi olan {adet} randevu var; sema yukseltmesi uygulanmadi ve \
         hicbir kayit degismedi. Once o randevularin ucretini duzeltin."
    )]
    UcretKisitiIhlali { adet: usize },
    /// V4'un tablo yeniden olusturma adimindan sonra
    /// `pragma_foreign_key_check` kirik bag buldu: yukseltme geri alinir.
    ///
    /// Tablo ADI `&'static str`'dir (sabit kume), kayit icerigi tasinmaz.
    #[error(
        "sema yukseltmesinden sonra `{tablo}` tablosunda {adet} kirik bag bulundu; \
         yukseltme geri alindi ve hicbir kayit degismedi"
    )]
    YabanciAnahtarKirik { tablo: &'static str, adet: usize },
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
/// DEGISTIRILMEZ. Ayni baglantida birden fazla kez cagirmak guvenlidir:
/// V1-V3 betikleri `IF NOT EXISTS` kullanir, sutun eklemeleri `sutun_ekle`
/// uzerinden gecer ve surum damgasi zaten guncelse yeniden yazmak
/// zararsizdir. V4 (tablo yeniden olusturma) kendi basina idempotent
/// DEGILDIR -- ikinci kez calisirsa `appointments_v4` cakisir ve hata
/// verir; onu koruyan sey `if mevcut < 4` surum kapisidir. Kapinin dusmesi
/// bu yuzden `tests::surum_kapisi_uygulanmis_adimi_yeniden_calistirmaz`
/// ile ayrica sabitleniyor.
///
/// # V4 yabanci anahtarlari GECICI OLARAK kapatir
///
/// Gerekce `V4` basliginda: `DROP TABLE appointments` yabanci anahtarlar
/// acikken butun seans/ozel notlari cascade ile silerdi. Pragma
/// transaction icinde no-op oldugu icin BEGIN'den once kapatilir ve her
/// cikista geri acilir.
pub fn migrate(conn: &Connection) -> Result<(), MigrateHatasi> {
    let mevcut = okunan_surum(conn)?;

    if mevcut > CURRENT_VERSION {
        return Err(MigrateHatasi::SurumDusuk { veritabani: mevcut, uygulama: CURRENT_VERSION });
    }

    // V4 `appointments` tablosunu YENIDEN OLUSTURUYOR ve bu, yabanci
    // anahtarlar acikken YAPILAMAZ: `DROP TABLE appointments` ortulu bir
    // `DELETE FROM appointments` calistirir, `progress_notes` ve
    // `private_notes` uzerindeki `ON DELETE CASCADE` tetiklenir ve butun
    // seans/ozel notlar silinir (bkz. `V4` basligi -- bu gocteki en yikici
    // tek hata).
    //
    // `PRAGMA foreign_keys` transaction ICINDE no-op'tur; bu yuzden
    // BEGIN'den ONCE kapatilir. Baglantinin varsayilani `db::open_*`
    // tarafindan `ON` yapiliyor ve buradan cikarken -- hata yolunda da --
    // `ON`'a geri donuluyor.
    let fk_kapatiliyor = mevcut < 4;
    if fk_kapatiliyor {
        conn.pragma_update(None, "foreign_keys", "OFF")?;
    }

    let sonuc = adimlari_uygula(conn, mevcut);

    if fk_kapatiliyor {
        let geri_acma = conn.pragma_update(None, "foreign_keys", "ON");
        // Geri acma hatasi ASIL hatanin yerine gecmez: cagirana "goc neden
        // basarisiz oldu" sorusunun cevabi donmeli. Goc basariliysa geri
        // acmanin basarisizligi gercek bir hatadir (baglanti kisitsiz
        // calismaya devam ederdi) ve dondurulur.
        if sonuc.is_ok() {
            geri_acma?;
        }
    }

    sonuc
}

/// `migrate`'in transaction'li govdesi.
///
/// `migrate`'ten AYRI bir fonksiyon: yabanci anahtar pragmasi transaction'in
/// disinda kalmak zorunda (bkz. `migrate`), dolayisiyla "kapat / uygula /
/// geri ac" uclusunun ortasi kendi kapsamina alindi.
fn adimlari_uygula(conn: &Connection, mevcut: i64) -> Result<(), MigrateHatasi> {
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
    if mevcut < 4 {
        v4_uygula(&tx)?;
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
        assert_eq!(okunan, "0501234567", "bastaki sifir korunmalÄ±");
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
            matches!(hata, MigrateHatasi::SurumDusuk { veritabani: 99, uygulama: 4 }),
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
    fn surum_dort_olarak_kaydedilir() {
        let (_d, c) = baglanti();
        // deger sutunu TEXT'tir; metin okuyup ayristir. Gerekce Plan 1 Gorev 6'da.
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 4);
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
        assert!(sonuc.is_err(), "yabanci anahtar kisiti calismalÄ±");
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
    fn v2_veritabani_veri_kaybetmeden_guncel_surume_yukselir() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();

        v2_veritabani(&yol, &key);

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        migrate(&c).unwrap();

        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), CURRENT_VERSION);

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

    // ---- Surum 4: `ucret >= 0` veritabani kisiti --------------------------
    //
    // V4 `appointments` tablosunu YENIDEN OLUSTURUYOR. Bu adimin uc ayri
    // yikici hata modu var ve her biri asagida ayri ayri olculuyor:
    //
    //   1. `DROP TABLE` cascade ile butun seans/ozel notlari silebilir
    //      (yabanci anahtarlar acik kalirsa) -- **Critical**;
    //   2. tasima sirasinda veri kaybolabilir;
    //   3. yeniden olusturulan tablo indeksleri/yabanci anahtarlari
    //      kaybedebilir, yani cascade davranisi SESSIZCE olebilir.

    /// V3 semali, icinde danisan + randevu + iki not olan bir veritabani
    /// hazirlar (henuz V4 yok). Kimlikler: danisan 1, randevu 1.
    fn v3_veritabani(yol: &std::path::Path, key: &crate::crypto::keyring::DataKey) {
        let c = crate::store::db::open_encrypted(yol, key).unwrap();
        c.execute_batch(V1).unwrap();
        c.execute_batch(V2).unwrap();
        c.execute_batch(V3).unwrap();
        for (tablo, tanim) in V3_SUTUNLAR {
            sutun_ekle(&c, tablo, tanim).unwrap();
        }
        c.execute(
            "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version','3')
             ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
            [],
        )
        .unwrap();
        c.execute_batch(
            "INSERT INTO clients (ad_soyad, durum, olusturma_zamani)
             VALUES ('Eski Danisan','aktif','2026-01-01T00:00:00Z');
             INSERT INTO appointments
               (client_id, baslangic, bitis, durum, ucret, odendi, seri_id,
                olusturma_zamani, guncelleme_zamani)
             VALUES (1,'2026-09-07T14:00','2026-09-07T15:00','geldi',45000,1,'seri-abc','z','z');
             INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
             VALUES (1,1,'soap','V3TEN KALAN RESMI NOT','z');
             INSERT INTO private_notes (appointment_id, client_id, icerik, guncelleme_zamani)
             VALUES (1,1,'V3TEN KALAN OZEL NOT','z');",
        )
        .unwrap();
    }

    fn randevu_ve_not_sayilari(c: &rusqlite::Connection) -> (i64, i64, i64) {
        let say = |t: &str| -> i64 {
            c.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0)).unwrap()
        };
        (say("appointments"), say("progress_notes"), say("private_notes"))
    }

    /// `appointments` tablosunun `sqlite_master`'daki tanimi.
    fn appointments_semasi(c: &rusqlite::Connection) -> String {
        c.query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='appointments'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn v3_veritabani_veri_kaybetmeden_v4e_yukselir() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();
        v3_veritabani(&yol, &key);

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        // ON KOSUL: yukseltmeden ONCE kisit YOK. Bu satirlar olmadan
        // asagidaki "kisit var" iddiasi, V4 hic calismasa bile saglanabilirdi.
        assert!(
            !appointments_semasi(&c).contains("ucret IS NULL"),
            "on kosul: V3 semasinda ucret KISITI olmamali (sutun var, CHECK yok)"
        );
        assert!(
            c.execute("UPDATE appointments SET ucret = -1 WHERE id = 1", []).is_ok(),
            "on kosul: V3'te eksi ucret veritabanina yazilabiliyor olmali"
        );
        c.execute("UPDATE appointments SET ucret = 45000 WHERE id = 1", []).unwrap();

        migrate(&c).unwrap();

        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 4);

        // Randevunun HER alani tasindi -- yalnizca satir sayisi degil.
        #[allow(clippy::type_complexity)]
        let (id, cid, bas, bit, durum, ucret, odendi, seri): (
            i64,
            i64,
            String,
            String,
            String,
            Option<i64>,
            i64,
            Option<String>,
        ) = c
            .query_row(
                "SELECT id, client_id, baslangic, bitis, durum, ucret, odendi, seri_id
                 FROM appointments",
                [],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            (id, cid, bas.as_str(), bit.as_str(), durum.as_str(), ucret, odendi, seri.as_deref()),
            (
                1,
                1,
                "2026-09-07T14:00",
                "2026-09-07T15:00",
                "geldi",
                Some(45000),
                1,
                Some("seri-abc")
            ),
            "v3 -> v4 yukseltmesi randevunun alanlarini oldugu gibi tasimali"
        );

        // Ve kisit ARTIK var.
        assert!(
            c.execute("UPDATE appointments SET ucret = -1 WHERE id = 1", []).is_err(),
            "v4 sonrasi eksi ucret veritabaninca reddedilmeli"
        );
    }

    #[test]
    fn v4_yukseltmesi_seans_ve_ozel_notlari_silmez() {
        // ** BU TESTIN KORUDUGU SEY (Critical) **
        //
        // `progress_notes` ve `private_notes` `appointments`'a
        // `ON DELETE CASCADE` ile bagli. V4 tabloyu yeniden olusturmak icin
        // `DROP TABLE appointments` calistiriyor ve yabanci anahtarlar ACIK
        // kalirsa SQLite bunu ortulu bir `DELETE FROM appointments` gibi
        // isler: butun klinik kayit gider.
        //
        // MUTASYON: `migrate`'teki `pragma_update(..., "foreign_keys", "OFF")`
        // satirini sil -> notlarin ikisi de yok olur, bu test kirilir.
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();
        v3_veritabani(&yol, &key);

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        // ON KOSUL: notlar yukseltmeden ONCE gercekten oradaydi.
        assert_eq!(randevu_ve_not_sayilari(&c), (1, 1, 1), "on kosul: v3 verisi yerinde olmali");

        migrate(&c).unwrap();

        assert_eq!(
            randevu_ve_not_sayilari(&c),
            (1, 1, 1),
            "V4 yukseltmesi randevuyu ya da notlari SILMEMELI"
        );
        // Icerik de bozulmamis olmali: "satir sayisi ayni" bos satirlarla da
        // saglanabilirdi.
        let resmi: String =
            c.query_row("SELECT icerik FROM progress_notes WHERE id=1", [], |r| r.get(0)).unwrap();
        let ozel: String =
            c.query_row("SELECT icerik FROM private_notes WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(resmi, "V3TEN KALAN RESMI NOT");
        assert_eq!(ozel, "V3TEN KALAN OZEL NOT");
    }

    #[test]
    fn v4_sonrasi_cascade_indeksler_ve_yabanci_anahtarlar_yerinde() {
        // Yeniden olusturulan tablo bagli davranisi SESSIZCE kaybedebilir:
        // notlar silinmez ama randevu silinince de gitmezler (sarkan kayit),
        // ya da indeksler geri gelmez. Ucu de burada olculuyor.
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();
        v3_veritabani(&yol, &key);

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        migrate(&c).unwrap();

        // (1) Indeksler geri geldi.
        for indeks in ["ix_app_baslangic", "ix_app_client", "ix_app_seri"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?1",
                    [indeks],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "{indeks} yeniden olusturmadan sonra kaybolmus");
        }

        // (2) `clients`'a giden yabanci anahtar HALA zorlaniyor.
        let sonuc = c.execute(
            "INSERT INTO appointments (client_id, baslangic, bitis, durum, olusturma_zamani, guncelleme_zamani)
             VALUES (999,'2026-09-08T14:00','2026-09-08T15:00','planlandi','z','z')",
            [],
        );
        assert!(sonuc.is_err(), "olmayan danisana randevu eklenebiliyor: yabanci anahtar kaybolmus");

        // (3) ON DELETE CASCADE: randevu silinince notlar da gider.
        c.execute("DELETE FROM appointments WHERE id=1", []).unwrap();
        assert_eq!(
            randevu_ve_not_sayilari(&c),
            (0, 0, 0),
            "v4 sonrasi randevu silinince notlar da silinmeli (cascade)"
        );
    }

    #[test]
    fn basarisiz_v4_migrate_semayi_geri_alir() {
        // V4'un ORTASINDA -- tablo dusurulup yeniden adlandirildiktan SONRA --
        // gercek bir hata tetikler.
        //
        // Enjeksiyon yolu: `progress_notes`'ta var olmayan bir randevuya
        // isaret eden bir satir. Bu, bu gocun kendi dogrulama adiminin
        // (`pragma_foreign_key_check`) yakalamak icin var oldugu durum ve
        // gercek hayatta yarim bir geri yuklemeden/ham SQL'den gelebilir.
        // Hata `DROP TABLE` + `ALTER TABLE ... RENAME`ten SONRA olustugu icin
        // geri alma gercekten yarim uygulanmis bir semayi toparlamak zorunda.
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();
        v3_veritabani(&yol, &key);
        {
            let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
            // Sarkan satiri yerlestirmek icin kisitlari gecici olarak kapat:
            // uretimde bu satir zaten kisitlarin zorlanmadigi bir yoldan gelir.
            c.pragma_update(None, "foreign_keys", "OFF").unwrap();
            c.execute(
                "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
                 VALUES (4242,1,'dap','SARKAN NOT','z')",
                [],
            )
            .unwrap();
        }

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        let onceki_sema = appointments_semasi(&c);
        let hata = migrate(&c).unwrap_err();
        assert!(
            matches!(
                hata,
                MigrateHatasi::YabanciAnahtarKirik { tablo: "progress_notes", adet: 1 }
            ),
            "kirik bag ayrisik bir hata olarak donmeli: {hata:?}"
        );

        // (1) TABLO GERI GELDI ve tanimi ESKISININ AYNISI: `DROP TABLE` +
        //     `RENAME` geri alindi.
        assert_eq!(
            appointments_semasi(&c),
            onceki_sema,
            "basarisiz V4 eski tablo tanimini geri getirmeli"
        );
        assert!(
            !appointments_semasi(&c).contains("ucret IS NULL"),
            "basarisiz V4 yeni kisiti geride birakmamali"
        );

        // (2) Gecici tablo geride kalmamali.
        let gecici: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='appointments_v4'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(gecici, 0, "basarisiz V4 `appointments_v4` tablosunu geride birakmamali");

        // (3) VERI DURUYOR -- ozellikle cascade tetiklenmedi.
        assert_eq!(
            randevu_ve_not_sayilari(&c),
            (1, 2, 1),
            "geri alma randevuyu ya da notlari silmemeli (sarkan not dahil 2 resmi not)"
        );

        // (4) Indeksler yerinde.
        for indeks in ["ix_app_baslangic", "ix_app_client", "ix_app_seri"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?1",
                    [indeks],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "{indeks} geri almadan sonra kaybolmus");
        }

        // (5) Surum damgasi yukselmedi.
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham, "3", "basarisiz migrate surum damgasini yukseltmemeli");

        // (6) Yabanci anahtarlar GERI ACILDI: goc hata yolundan cikti ama
        //     baglanti kisitsiz kalmamali.
        let fk: i64 = c.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1, "basarisiz goc yabanci anahtarlari kapali birakmamali");
    }

    #[test]
    fn negatif_ucretli_kayit_v4_yukseltmesini_ayrisik_hatayla_reddeder() {
        // Uygulama katmani eksi ucreti hep reddetti, ama ham SQL'le gelmis
        // bir satir olabilir. Beklenen davranis: ciplak bir "CHECK constraint
        // failed" DEGIL, ne yapilacagini soyleyen ayri bir hata -- ve hicbir
        // sey degismemis bir veritabani.
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();
        v3_veritabani(&yol, &key);
        {
            let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
            c.execute("UPDATE appointments SET ucret = -500 WHERE id = 1", []).unwrap();
        }

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        let hata = migrate(&c).unwrap_err();
        assert!(
            matches!(hata, MigrateHatasi::UcretKisitiIhlali { adet: 1 }),
            "eksi ucret ayrisik bir hata olarak donmeli: {hata:?}"
        );
        // Mesaj kullaniciya ne yapacagini soylemeli ve "her sey bozuldu"
        // izlenimi vermemeli (bu kod tabaninin dort katmanda tekrarlanan
        // hata sinifi).
        let metin = hata.to_string();
        assert!(metin.contains("hicbir kayit degismedi"), "mesaj: {metin}");

        // Kayit AYNEN duruyor ve surum yukselmedi.
        let ucret: i64 =
            c.query_row("SELECT ucret FROM appointments WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(ucret, -500, "reddedilen goc veriyi degistirmemeli");
        assert_eq!(randevu_ve_not_sayilari(&c), (1, 1, 1));
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham, "3");
    }

    #[test]
    fn ucret_alt_siniri_semada_ve_uygulama_katmaninda_ayni() {
        // AYRISMAYI YAKALAYAN TEST. Kural iki yerde yazili:
        //   - `appointments::ASGARI_UCRET` (uygulama katmani),
        //   - `schema::V4` icindeki `CHECK (ucret IS NULL OR ucret >= 0)`.
        //
        // Iki yon de olculuyor ve veritabanina denenen degerler SABITTEN
        // turetiliyor:
        //   * `CHECK`'i gevsetmek (ornegin `>= -100`) -> "bir alti reddedilir"
        //     iddiasi kirilir;
        //   * `ASGARI_UCRET`'i degistirmek -> denenen degerler kayar ve
        //     "sinirdaki deger kabul edilir" iddiasi kirilir.
        use crate::store::appointments::{ucret_gecerli_mi, ASGARI_UCRET};
        let (_d, c) = baglanti();
        danisan_ve_randevu(&c);

        let ucreti_yaz = |deger: Option<i64>| -> Result<usize, rusqlite::Error> {
            c.execute("UPDATE appointments SET ucret = ?1 WHERE id = 1", [deger])
        };

        // ARTI YON: uygulama katmaninin kabul ettigi degerleri veritabani da
        // kabul etmeli. (Bu yari olmadan "her seyi reddeden" bir CHECK de
        // eksi yon iddiasini gecerdi.)
        for gecerli in [Some(ASGARI_UCRET), Some(ASGARI_UCRET + 45000), None] {
            assert!(ucret_gecerli_mi(gecerli), "on kosul: {gecerli:?} uygulama katmaninca gecerli");
            assert!(
                ucreti_yaz(gecerli).is_ok(),
                "uygulama katmani {gecerli:?} degerini kabul ediyor ama CHECK reddetti"
            );
        }

        // EKSI YON: uygulama katmaninin reddettigi deger veritabanina da
        // girememeli.
        let gecersiz = Some(ASGARI_UCRET - 1);
        assert!(!ucret_gecerli_mi(gecersiz), "on kosul: {gecersiz:?} uygulama katmaninca gecersiz");
        assert!(
            ucreti_yaz(gecersiz).is_err(),
            "uygulama katmani {gecersiz:?} degerini reddediyor ama CHECK kabul etti -- \
             kisit yalnizca uygulama katmaninda kalmis"
        );
    }

    #[test]
    fn randevu_durum_kumesi_semada_ve_uygulama_katmaninda_ayni() {
        // `ucret` icin yazilan ayrisma testinin kardesi: `durum` kumesi de
        // hem `GECERLI_DURUMLAR` sabitinde hem `CHECK`'te yazili.
        use crate::store::appointments::GECERLI_DURUMLAR;
        let (_d, c) = baglanti();
        danisan_ve_randevu(&c);

        for durum in GECERLI_DURUMLAR {
            assert!(
                c.execute("UPDATE appointments SET durum = ?1 WHERE id = 1", [durum]).is_ok(),
                "GECERLI_DURUMLAR icindeki '{durum}' CHECK tarafindan reddedildi"
            );
        }
        assert!(
            c.execute("UPDATE appointments SET durum = 'uydurma' WHERE id = 1", []).is_err(),
            "kume disindaki durum CHECK tarafindan kabul edildi"
        );
    }
}
