use crate::crypto::keyring::DataKey;
use crate::store::db::{open_encrypted, DbError};
use rusqlite::backup::Backup;
use rusqlite::ffi::ErrorCode;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const SAKLANAN_YEDEK_SAYISI: usize = 7;
const ONEK: &str = "yedek-";
const UZANTI: &str = "db";

#[derive(Debug, thiserror::Error)]
pub enum YedekHatasi {
    #[error("dosya hatasi: {0}")]
    Io(#[from] std::io::Error),
    #[error("yedek dosyasi okunamiyor veya bozuk")]
    BozukYedek,
    #[error("veritabani hatasi: {0}")]
    Db(#[from] DbError),
    #[error("gecersiz tarih damgasi: '{0}' (beklenen bicim: YYYY-AA-GG)")]
    GecersizTarih(String),
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct YedekBilgisi {
    pub yol: PathBuf,
    pub tarih: String,
    pub boyut: u64,
}

/// `s`'nin `YYYY-AA-GG` (ISO 8601 tarih) bicimine uyup uymadigini dogrular.
///
/// Yalnizca bicimi (rakam sayisi ve ayirac konumlari) kontrol eder; takvimsel
/// gecerliligi (ör. 2026-02-30) dogrulamaz - dosya adi siralamasi/rotasyonu
/// icin bu yeterli. Amac, kullanicinin elle koydugu (`yedek-eskiyedegim.db`)
/// veya isletim sisteminin urettigi (`yedek-2026-09-07 (2).db`) dosyalarin
/// rotasyona hic girmemesini saglamak (bkz. Bulgu 2).
fn tarih_bicimi_gecerli_mi(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..10].iter().all(u8::is_ascii_digit)
}

/// `open_encrypted`/`geri_yukle` dogrulamasindan gelen bir hatayi
/// `YedekHatasi`'ye siniflandirir.
///
/// Yalnizca gercek bozulma gostergeleri `BozukYedek` olur:
/// - `DbError::WrongKey`: dosya bu anahtarla hic acilamiyor (yanlis anahtar
///   veya dosya SQLCipher formatinda degil).
/// - `DbError::Sqlite` icindeki `ErrorCode::DatabaseCorrupt`: butunluk
///   kontrolu (`PRAGMA quick_check`) sayfa duzeyinde bozulma tespit etti.
///
/// Diger her sey (`Io`, kilitli dosya, gecici `Sqlite` hatalari) `Db`
/// olarak gecer - kullaniciya "yedeginiz bozuk" denilip saglam bir yedegin
/// silinmesine yol acilmamali (bkz. Bulgu 3).
fn siniflandir_geri_yukleme_hatasi(e: DbError) -> YedekHatasi {
    match e {
        DbError::WrongKey => YedekHatasi::BozukYedek,
        DbError::Sqlite(rusqlite::Error::SqliteFailure(ref ffi_hata, _))
            if ffi_hata.code == ErrorCode::DatabaseCorrupt =>
        {
            YedekHatasi::BozukYedek
        }
        other => YedekHatasi::Db(other),
    }
}

pub fn yedek_al(
    db_yolu: &Path,
    hedef_dizin: &Path,
    damga: &str,
    key: &DataKey,
) -> Result<YedekBilgisi, YedekHatasi> {
    if !tarih_bicimi_gecerli_mi(damga) {
        return Err(YedekHatasi::GecersizTarih(damga.to_string()));
    }
    std::fs::create_dir_all(hedef_dizin)?;
    let hedef = hedef_dizin.join(format!("{ONEK}{damga}.{UZANTI}"));

    // Once gecici dosyaya yaz, sonra tasi: yarim kalan kopya yedek gibi
    // gorunmesin. Onceki basarisiz bir denemeden kalmis olabilecek gecici
    // dosyayi ve WAL yan dosyalarini temiz baslamak icin sil.
    let gecici = hedef.with_extension("part");
    let _ = std::fs::remove_file(&gecici);
    for ek in ["part-wal", "part-shm"] {
        let _ = std::fs::remove_file(gecici.with_extension(ek));
    }

    {
        // SQLite Online Backup API: kaynak baglanti acikken (WAL modunda,
        // surmekte olan bir oturumla, henuz checkpoint edilmemis kayitlarla
        // birlikte) bile tutarli ve eksiksiz bir kopya uretir - salt dosya
        // kopyalama WAL'daki en son islenmemis kayitlari atlar (bkz. Bulgu 1).
        //
        // Hedef baglanti da `open_encrypted` ile AYNI anahtarla aciliyor;
        // aksi halde sqlite3_backup sayfalari hedefin sifrelenmemis
        // pager'ina yazar ve yedek duz metin olarak diskte kalir - bu kabul
        // edilemez, bu yuzden hedef de mutlaka keyed olarak aciliyor.
        let kaynak = open_encrypted(db_yolu, key)?;
        let mut hedef_baglanti = open_encrypted(&gecici, key)?;
        let yedekleme = Backup::new(&kaynak, &mut hedef_baglanti).map_err(DbError::from)?;
        yedekleme
            .run_to_completion(100, Duration::from_millis(250), None)
            .map_err(DbError::from)?;
        // `hedef_baglanti` burada scope disina cikip kapanir; gecici dosyaya
        // ait tek baglanti oldugu icin SQLite kapanista otomatik checkpoint
        // yapar ve WAL'i ana dosyaya birlestirir.
    }
    // Checkpoint sonrasi bos/kalinti WAL yan dosyalari kalmis olabilir;
    // rename'den once temizle ki yedek dizininde tek basina dolasan bir
    // '.part-wal' kalmasin.
    for ek in ["part-wal", "part-shm"] {
        let _ = std::fs::remove_file(gecici.with_extension(ek));
    }

    std::fs::rename(&gecici, &hedef)?;

    // Temizlik (eski yedeklerin silinmesi) basarisiz olsa bile bu yedek
    // diskte basariyla olusturuldu; temizlik hatasi yedegin basarisini
    // dusurmemeli (Bulgu 4). En kotu durumda bir eski yedek fazladan
    // diskte kalir - bu veri kaybi degil, aksine ekstra bir kopyadir.
    let _ = eskileri_temizle(hedef_dizin);

    let boyut = std::fs::metadata(&hedef)?.len();
    Ok(YedekBilgisi { yol: hedef, tarih: damga.to_string(), boyut })
}

pub fn yedekleri_listele(hedef_dizin: &Path) -> Result<Vec<YedekBilgisi>, YedekHatasi> {
    if !hedef_dizin.exists() {
        return Ok(Vec::new());
    }
    let mut liste = Vec::new();
    for girdi in std::fs::read_dir(hedef_dizin)? {
        let girdi = girdi?;
        let yol = girdi.path();
        let Some(ad) = yol.file_name().and_then(|s| s.to_str()) else { continue };
        let Some(tarih) = ad.strip_prefix(ONEK).and_then(|s| s.strip_suffix(&format!(".{UZANTI}")))
        else {
            continue;
        };
        if !tarih_bicimi_gecerli_mi(tarih) {
            // Kullanicinin elle koydugu ya da isletim sisteminin urettigi
            // (ör. "yedek-eskiyedegim.db", "yedek-2026-09-07 (2).db") bir
            // dosya listeye alinmaz - dolayisiyla rotasyonla asla silinmez
            // (bkz. Bulgu 2).
            continue;
        }
        liste.push(YedekBilgisi {
            yol: yol.clone(),
            tarih: tarih.to_string(),
            boyut: girdi.metadata()?.len(),
        });
    }
    // Dosya adindaki tarih ISO oldugu icin metin siralamasi tarih siralamasidir.
    liste.sort_by(|a, b| b.tarih.cmp(&a.tarih));
    Ok(liste)
}

fn eskileri_temizle(hedef_dizin: &Path) -> Result<(), YedekHatasi> {
    let liste = yedekleri_listele(hedef_dizin)?;
    for eski in liste.iter().skip(SAKLANAN_YEDEK_SAYISI) {
        std::fs::remove_file(&eski.yol)?;
    }
    Ok(())
}

pub fn geri_yukle(yedek_yolu: &Path, db_yolu: &Path, key: &DataKey) -> Result<(), YedekHatasi> {
    // Once yedegin gercekten acilabildigini ve butunlugunun saglam oldugunu
    // dogrula; ancak ondan sonra uzerine yaz. Bu dogrulama tamamlanana kadar
    // mevcut db_yolu'na hicbir kod yolundan dokunulmaz.
    let dogrulama = open_encrypted(yedek_yolu, key).map_err(siniflandir_geri_yukleme_hatasi)?;

    // `SELECT count(*) FROM sqlite_master` yalnizca sema sayfasini okur;
    // veri sayfalari bozuksa yakalamaz. `PRAGMA quick_check`, `integrity_check`
    // kadar kapsamli olmayan (cross-index dogrulamalarini atlayan) ama tum
    // veri sayfalarini tarayan daha hizli bir kontrol - bir yedek dosyasi
    // icin makul bir sure/kapsamlilik dengesi (bkz. Bulgu 5).
    let sonuc: rusqlite::Result<String> =
        dogrulama.query_row("PRAGMA quick_check", [], |r| r.get(0));
    match sonuc {
        Ok(ref s) if s == "ok" => {}
        Ok(_diger) => return Err(YedekHatasi::BozukYedek),
        Err(e) => return Err(siniflandir_geri_yukleme_hatasi(DbError::Sqlite(e))),
    }
    drop(dogrulama);

    let gecici = db_yolu.with_extension("restore");
    std::fs::copy(yedek_yolu, &gecici)?;
    std::fs::rename(&gecici, db_yolu)?;

    // WAL dosyalari eski veritabanina aitti, birakilirsa tutarsizlik uretir.
    for ek in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(db_yolu.with_extension(ek));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{db::open_encrypted, schema::migrate};
    use std::path::{Path, PathBuf};

    fn ornek_db(dir: &Path, key: &crate::crypto::keyring::DataKey) -> PathBuf {
        let yol = dir.join("veri.db");
        let c = open_encrypted(&yol, key).unwrap();
        migrate(&c).unwrap();
        c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse');").unwrap();
        drop(c);
        yol
    }

    #[test]
    fn yedek_alinir_ve_ayni_anahtarla_acilir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);

        let bilgi = yedek_al(&db, &hedef, "2026-09-07", &key).unwrap();
        assert!(bilgi.yol.exists());
        assert!(bilgi.boyut > 0);

        let c = open_encrypted(&bilgi.yol, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    #[test]
    fn yediden_fazla_yedek_birikmez_en_eski_silinir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);

        for gun in 1..=10 {
            yedek_al(&db, &hedef, &format!("2026-09-{gun:02}"), &key).unwrap();
        }

        let liste = yedekleri_listele(&hedef).unwrap();
        assert_eq!(liste.len(), SAKLANAN_YEDEK_SAYISI);
        assert_eq!(liste[0].tarih, "2026-09-10", "en yeni basta olmali");
        assert_eq!(liste[6].tarih, "2026-09-04", "8 gun oncesi silinmis olmali");
    }

    #[test]
    fn ayni_gun_iki_kez_yedek_alinca_tek_dosya_kalir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);

        yedek_al(&db, &hedef, "2026-09-07", &key).unwrap();
        yedek_al(&db, &hedef, "2026-09-07", &key).unwrap();
        assert_eq!(yedekleri_listele(&hedef).unwrap().len(), 1);
    }

    #[test]
    fn bozuk_yedek_geri_yuklenmez_ve_mevcut_veri_korunur() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let bilgi = yedek_al(&db, &hedef, "2026-09-07", &key).unwrap();

        std::fs::write(&bilgi.yol, b"bu bir veritabani degil").unwrap();
        let hata = geri_yukle(&bilgi.yol, &db, &key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::BozukYedek));

        // Mevcut veritabani bozulmamis olmali.
        let c = open_encrypted(&db, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    #[test]
    fn geri_yukleme_veriyi_yedekteki_haline_dondurur() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let bilgi = yedek_al(&db, &hedef, "2026-09-07", &key).unwrap();

        {
            let c = open_encrypted(&db, &key).unwrap();
            c.execute("UPDATE t SET ad='Degistirildi'", []).unwrap();
        }

        geri_yukle(&bilgi.yol, &db, &key).unwrap();

        let c = open_encrypted(&db, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    // --- Bulgu 1: WAL yan dosyalari yedege girmiyor ---------------------

    #[test]
    fn acik_baglanti_varken_yazilan_veri_yedege_dahil_olur() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = d.path().join("veri.db");

        let c = open_encrypted(&db, &key).unwrap();
        migrate(&c).unwrap();
        c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse');").unwrap();
        // BILEREK KAPATMIYORUZ: uygulama oturum boyunca baglantiyi acik
        // tutar; son yazilan kayitlar WAL dosyasinda kalabilir ve henuz
        // ana .db dosyasina checkpoint edilmemis olabilir.

        let bilgi = yedek_al(&db, &hedef, "2026-09-07", &key).unwrap();

        let dogrulama = open_encrypted(&bilgi.yol, &key).unwrap();
        let ad: String = dogrulama.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(
            ad, "Ayse",
            "acik baglanti varken yazilan veri yedekte olmali (WAL kaybi yasanmamali)"
        );

        drop(dogrulama);
        drop(c);
    }

    #[test]
    fn yedek_dosyasinda_duz_metin_bulunmaz() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = d.path().join("veri.db");
        {
            let c = open_encrypted(&db, &key).unwrap();
            migrate(&c).unwrap();
            c.execute_batch(
                "CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('GIZLI_DANISAN_ADI');",
            )
            .unwrap();
        }

        let bilgi = yedek_al(&db, &hedef, "2026-09-07", &key).unwrap();

        let bytes = std::fs::read(&bilgi.yol).unwrap();
        assert!(
            !bytes.windows(17).any(|w| w == b"GIZLI_DANISAN_ADI"),
            "yedek dosyasinda duz metin bulundu"
        );
        assert!(&bytes[..15] != b"SQLite format 3", "yedek sifrelenmemis");
    }

    // --- Bulgu 2: beklenmeyen dosyalar sessizce silinebiliyor -----------

    #[test]
    fn elle_konan_gecersiz_isimli_dosya_rotasyonda_silinmez() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);

        std::fs::create_dir_all(&hedef).unwrap();
        let elle_konan = hedef.join("yedek-eskiyedegim.db");
        std::fs::write(&elle_konan, b"kullanicinin elle koydugu eski yedek").unwrap();
        let windows_kopyasi = hedef.join("yedek-2026-09-07 (2).db");
        std::fs::write(&windows_kopyasi, b"windows kopyalama sonucu uretilen dosya").unwrap();

        for gun in 1..=10 {
            yedek_al(&db, &hedef, &format!("2026-09-{gun:02}"), &key).unwrap();
        }

        assert!(elle_konan.exists(), "kullanicinin elle koydugu yedek silinmemeli");
        assert!(windows_kopyasi.exists(), "gecersiz bicimli dosya silinmemeli");

        let liste = yedekleri_listele(&hedef).unwrap();
        assert_eq!(
            liste.len(),
            SAKLANAN_YEDEK_SAYISI,
            "gecersiz bicimli dosyalar listeye/rotasyona hic girmemeli"
        );
        assert!(liste.iter().all(|b| b.tarih != "eskiyedegim" && b.tarih != "2026-09-07 (2)"));
    }

    #[test]
    fn gecersiz_bicimli_damga_ile_yedek_alinamaz() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);

        let hata = yedek_al(&db, &hedef, "eskiyedegim", &key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::GecersizTarih(_)));

        let hata2 = yedek_al(&db, &hedef, "2026-09-07 (2)", &key).unwrap_err();
        assert!(matches!(hata2, YedekHatasi::GecersizTarih(_)));
    }

    // --- Bulgu 3: her acma hatasi "bozuk yedek" olarak raporlaniyor -----

    #[test]
    fn kalici_olmayan_io_hatasi_bozukyedek_olarak_raporlanmaz() {
        let io_hata = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "erisim engellendi");
        let sonuc = siniflandir_geri_yukleme_hatasi(DbError::Io(io_hata));
        assert!(
            matches!(sonuc, YedekHatasi::Db(DbError::Io(_))),
            "beklenen Db(Io), gelen: {sonuc:?}"
        );
    }

    #[test]
    fn gecici_sqlite_hatasi_bozukyedek_olarak_raporlanmaz() {
        // ör. dosya kilitli (SQLITE_BUSY) - bu "bozuk" degil, gecici bir durum.
        let sahte_ffi_hata =
            rusqlite::ffi::Error { code: ErrorCode::DatabaseBusy, extended_code: 5 };
        let sonuc = siniflandir_geri_yukleme_hatasi(DbError::Sqlite(rusqlite::Error::SqliteFailure(
            sahte_ffi_hata,
            None,
        )));
        assert!(
            matches!(sonuc, YedekHatasi::Db(DbError::Sqlite(_))),
            "beklenen Db(Sqlite), gelen: {sonuc:?}"
        );
    }

    #[test]
    fn wrongkey_bozukyedek_olarak_raporlanir() {
        let sonuc = siniflandir_geri_yukleme_hatasi(DbError::WrongKey);
        assert!(matches!(sonuc, YedekHatasi::BozukYedek), "beklenen BozukYedek, gelen: {sonuc:?}");
    }

    // --- Bulgu 5: butunluk kontrolu yuzeysel -----------------------------

    #[test]
    fn veri_sayfasi_bozuk_yedek_quick_check_ile_yakalanir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = d.path().join("veri.db");
        {
            let c = open_encrypted(&db, &key).unwrap();
            migrate(&c).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT);").unwrap();
            let mut stmt = c.prepare("INSERT INTO t VALUES (?1)").unwrap();
            // Sema sayfasinin (page 1) disinda en az bir veri sayfasi daha
            // olusturacak kadar veri yaz; boylece bozacagimiz bayt semaya
            // degil bir veri sayfasina denk gelsin (open_encrypted sadece
            // sema sayfasini okur, bu yuzden acilis basarili olmali).
            for i in 0..500 {
                stmt.execute([format!("satir-{i}-{}", "x".repeat(50))]).unwrap();
            }
        }
        let bilgi = yedek_al(&db, &hedef, "2026-09-07", &key).unwrap();

        let mut bytes = std::fs::read(&bilgi.yol).unwrap();
        let uzunluk = bytes.len();
        assert!(uzunluk > 8192, "test icin en az iki sayfalik veri gerekiyor, uzunluk={uzunluk}");
        // Dosyanin son 200 baytini boz: sema (ilk sayfa) saglam kalsin, son
        // veri sayfalari bozulsun.
        for b in bytes.iter_mut().skip(uzunluk - 200) {
            *b ^= 0xFF;
        }
        std::fs::write(&bilgi.yol, &bytes).unwrap();

        let hata = geri_yukle(&bilgi.yol, &db, &key).unwrap_err();
        assert!(
            matches!(hata, YedekHatasi::BozukYedek),
            "beklenen BozukYedek (quick_check veri sayfasi bozuklugunu yakalamali), gelen: {hata:?}"
        );
    }
}
