use crate::crypto::keyring::DataKey;
use crate::store::db::{open_encrypted, DbError};
use std::path::{Path, PathBuf};

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
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct YedekBilgisi {
    pub yol: PathBuf,
    pub tarih: String,
    pub boyut: u64,
}

pub fn yedek_al(db_yolu: &Path, hedef_dizin: &Path, damga: &str) -> Result<YedekBilgisi, YedekHatasi> {
    std::fs::create_dir_all(hedef_dizin)?;
    let hedef = hedef_dizin.join(format!("{ONEK}{damga}.{UZANTI}"));

    // Once gecici dosyaya yaz, sonra tasi: yarim kalan kopya yedek gibi gorunmesin.
    let gecici = hedef.with_extension("part");
    std::fs::copy(db_yolu, &gecici)?;
    std::fs::rename(&gecici, &hedef)?;

    eskileri_temizle(hedef_dizin)?;

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
    // Once yedegin gercekten acilabildigini dogrula; ancak ondan sonra uzerine yaz.
    match open_encrypted(yedek_yolu, key) {
        Ok(c) => {
            c.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
                .map_err(|_| YedekHatasi::BozukYedek)?;
        }
        Err(_) => return Err(YedekHatasi::BozukYedek),
    }

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

        let bilgi = yedek_al(&db, &hedef, "2026-09-07").unwrap();
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
            yedek_al(&db, &hedef, &format!("2026-09-{gun:02}")).unwrap();
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

        yedek_al(&db, &hedef, "2026-09-07").unwrap();
        yedek_al(&db, &hedef, "2026-09-07").unwrap();
        assert_eq!(yedekleri_listele(&hedef).unwrap().len(), 1);
    }

    #[test]
    fn bozuk_yedek_geri_yuklenmez_ve_mevcut_veri_korunur() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let bilgi = yedek_al(&db, &hedef, "2026-09-07").unwrap();

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
        let bilgi = yedek_al(&db, &hedef, "2026-09-07").unwrap();

        {
            let c = open_encrypted(&db, &key).unwrap();
            c.execute("UPDATE t SET ad='Degistirildi'", []).unwrap();
        }

        geri_yukle(&bilgi.yol, &db, &key).unwrap();

        let c = open_encrypted(&db, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }
}
