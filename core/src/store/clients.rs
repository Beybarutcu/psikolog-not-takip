//! Danışan (client) deposu — asgari alanlar.
//!
//! Plan 1'de bu plana geçen `clients` tablosu üzerinde çalışır. Rıza takibi,
//! ekli dosyalar, saklama süresi gibi tam danışan dosyası alanları Plan 3'te
//! aynı tabloya sütun eklenerek gelecek; bu modül yalnızca ad soyad, telefon
//! ve durum ile ilgilenir.
//!
//! # Hassas veri kuralı (bkz. `store::audit`)
//! Danışan adı ve telefonu KVKK kapsamında özel nitelikli/kişisel veridir.
//! Bu modüldeki hiçbir fonksiyon bunları `audit::kaydet`'in `ayrinti`
//! alanına yazmaz; `varlik_id` alanına da yalnızca sayısal kimlik yazılır,
//! isim asla yazılmaz.
//!
//! # Yazma + log aynı transaction'da
//! `ekle` ve `arsivle` veriyi değiştirir; ikisi de tabloya yazdıktan hemen
//! sonra `audit::kaydet` çağırır. Bu iki adım `conn.unchecked_transaction()`
//! ile TEK transaction'a alınır -- log yazımı başarısız olursa veri
//! değişikliği de geri alınır, "kayıt eklendi ama loglanmadı" durumu
//! oluşmaz (bkz. `tests` modülündeki `..._atomik_...` testleri: bu garanti
//! `audit_log` tablosunu bilerek bozup hem pozitif hem negatif yönde test
//! edilir). `Connection::transaction()` (`&mut self`)
//! değil `unchecked_transaction()` (`&self`) kullanılıyor çünkü bu depo
//! fonksiyonlarının imzası (brief'te sabit) `&Connection` alıyor; bu güvenli
//! çünkü bu fonksiyonlar `schema::migrate`'i çağırmıyor, dolayısıyla iç içe
//! transaction riski yok. `getir`/`listele` salt okunur olduğundan (veri
//! durumu değişmiyor) ayrı transaction gerektirmiyor.
//!
//! # UYARI — iç içe transaction açılamaz
//! `ekle` ve `arsivle` kendi `unchecked_transaction()`'ını içeride açar.
//! SQLite iç içe transaction'ı desteklemez ("cannot start a transaction
//! within a transaction"): bu iki fonksiyonu **başka bir transaction'ın
//! içinden** (ör. çağıran taraf zaten `conn.unchecked_transaction()` açmışken,
//! veya `schema::migrate` gibi kendi transaction'ını açan başka bir
//! fonksiyonun içinden) çağırmayın. Bu sessiz bir veri bozulması değil,
//! `rusqlite::Error` olarak dönen gürültülü bir hatadır -- ama derleyici
//! yakalamaz. Plan 3'te "danışan oluştur + ilk not ekle" gibi çok adımlı bir
//! akış tek transaction altında toplanmak istenirse, bu fonksiyonlar yerine
//! ham SQL ifadeleri doğrudan o dış transaction üzerinde çalıştırılmalı.

use crate::store::audit::{kaydet, Ayrinti, Cihaz, Eylem};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, thiserror::Error)]
pub enum DepoHatasi {
    #[error("kayit bulunamadi")]
    Bulunamadi,
    #[error("gecersiz veri: {0}")]
    GecersizVeri(String),
    #[error("veritabani hatasi: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Danışan (client) kaydı — asgari alanlar.
///
/// `Debug` türetilmiyor: `ad_soyad` ve `telefon` KVKK kapsamında özel
/// nitelikli/kişisel veridir; türetilmiş `Debug` bunları `{:?}` ile bir
/// hata mesajına veya loga sızdırabilirdi (bkz. Plan 1 `DataKey`, Plan 2
/// Görev 2 `Ayrinti` ile aynı bulgu sınıfı). Yine de `Result<Danisan,
/// DepoHatasi>::unwrap_err()` (test yardımcı fonksiyonlarında kullanılıyor)
/// `Ok` tipinin `Debug` olmasını şart koşuyor; bu yüzden `Ayrinti` ile aynı
/// desen izlenip Debug ELLE yazılıyor ve yalnızca hassas olmayan `id` ile
/// `durum` alanları basılıyor, `ad_soyad`/`telefon` asla basılmıyor.
#[derive(Clone, Serialize)]
pub struct Danisan {
    pub id: i64,
    pub ad_soyad: String,
    pub telefon: Option<String>,
    pub durum: String,
}

impl std::fmt::Debug for Danisan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Danisan")
            .field("id", &self.id)
            .field("ad_soyad", &"<gizli>")
            .field("telefon", &"<gizli>")
            .field("durum", &self.durum)
            .finish()
    }
}

#[derive(Clone, Deserialize)]
pub struct YeniDanisan {
    pub ad_soyad: String,
    pub telefon: Option<String>,
}

fn simdi() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

fn satirdan(r: &rusqlite::Row) -> Result<Danisan, rusqlite::Error> {
    Ok(Danisan { id: r.get(0)?, ad_soyad: r.get(1)?, telefon: r.get(2)?, durum: r.get(3)? })
}

/// Yeni bir danışan ekler. Ekleme ve erişim logu tek transaction'da yazılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn ekle(conn: &Connection, yeni: &YeniDanisan, cihaz: Cihaz) -> Result<Danisan, DepoHatasi> {
    let ad = yeni.ad_soyad.trim();
    if ad.is_empty() {
        return Err(DepoHatasi::GecersizVeri("Danışan adı boş olamaz.".into()));
    }

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO clients (ad_soyad, telefon, durum, olusturma_zamani)
         VALUES (?1, ?2, 'aktif', ?3)",
        rusqlite::params![ad, yeni.telefon, simdi()],
    )?;
    let id = tx.last_insert_rowid();
    kaydet(&tx, Eylem::Ekleme, "client", &id.to_string(), cihaz, None)?;

    tx.commit()?;

    Ok(Danisan { id, ad_soyad: ad.to_string(), telefon: yeni.telefon.clone(), durum: "aktif".into() })
}

/// Tek bir danışanı kimliğiyle okur; bu bir "goruntuleme" olayı olarak loglanır.
pub fn getir(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<Danisan, DepoHatasi> {
    let danisan = conn
        .query_row(
            "SELECT id, ad_soyad, telefon, durum FROM clients WHERE id = ?1",
            [id],
            satirdan,
        )
        .optional()?
        .ok_or(DepoHatasi::Bulunamadi)?;

    kaydet(conn, Eylem::Goruntuleme, "client", &id.to_string(), cihaz, None)?;
    Ok(danisan)
}

/// Danışanları ada göre sıralı listeler. `arsiv_dahil` false ise yalnızca
/// aktif danışanlar döner. Kaç satır dönerse dönsün tek bir "goruntuleme"
/// kaydı üretir -- satır başına ayrı log KVKK amacına aykırı gürültü üretir.
pub fn listele(
    conn: &Connection,
    arsiv_dahil: bool,
    cihaz: Cihaz,
) -> Result<Vec<Danisan>, DepoHatasi> {
    let mut stmt = conn.prepare(
        "SELECT id, ad_soyad, telefon, durum FROM clients
         WHERE (?1 = 1 OR durum = 'aktif')
         ORDER BY ad_soyad COLLATE NOCASE",
    )?;
    let liste = stmt
        .query_map([arsiv_dahil as i64], satirdan)?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Liste tek bir goruntuleme kaydi uretir, satir basina degil.
    kaydet(conn, Eylem::Goruntuleme, "client", "liste", cihaz, None)?;
    Ok(liste)
}

/// Danışanı arşivler (yumuşak silme). Güncelleme ve erişim logu tek
/// transaction'da yazılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn arsivle(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi> {
    let tx = conn.unchecked_transaction()?;

    let etkilenen = tx.execute("UPDATE clients SET durum='arsiv' WHERE id = ?1", [id])?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(&tx, Eylem::Duzenleme, "client", &id.to_string(), cihaz, Some(Ayrinti::Arsivlendi))?;

    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{audit::son_kayitlar, db::open_encrypted, schema::migrate};

    fn baglanti() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        (dir, c)
    }

    fn yeni(ad: &str) -> YeniDanisan {
        YeniDanisan { ad_soyad: ad.to_string(), telefon: None }
    }

    #[test]
    fn eklenen_danisan_geri_okunur() {
        let (_d, c) = baglanti();
        let eklenen = ekle(&c, &yeni("Ayse Yilmaz"), Cihaz::Masaustu).unwrap();
        assert!(eklenen.id > 0);
        assert_eq!(eklenen.durum, "aktif");

        let okunan = getir(&c, eklenen.id, Cihaz::Masaustu).unwrap();
        assert_eq!(okunan.ad_soyad, "Ayse Yilmaz");
    }

    #[test]
    fn bos_ad_reddedilir() {
        let (_d, c) = baglanti();
        let hata = ekle(&c, &yeni("   "), Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn olmayan_danisan_bulunamadi_dondurur() {
        let (_d, c) = baglanti();
        assert!(matches!(getir(&c, 999, Cihaz::Masaustu).unwrap_err(), DepoHatasi::Bulunamadi));
    }

    #[test]
    fn arsivlenen_danisan_varsayilan_listede_gorunmez() {
        let (_d, c) = baglanti();
        let a = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        ekle(&c, &yeni("Mehmet"), Cihaz::Masaustu).unwrap();

        arsivle(&c, a.id, Cihaz::Masaustu).unwrap();

        let aktifler = listele(&c, false, Cihaz::Masaustu).unwrap();
        assert_eq!(aktifler.len(), 1);
        assert_eq!(aktifler[0].ad_soyad, "Mehmet");

        let hepsi = listele(&c, true, Cihaz::Masaustu).unwrap();
        assert_eq!(hepsi.len(), 2);
    }

    #[test]
    fn liste_ada_gore_siralanir() {
        let (_d, c) = baglanti();
        ekle(&c, &yeni("Zeynep"), Cihaz::Masaustu).unwrap();
        ekle(&c, &yeni("Ahmet"), Cihaz::Masaustu).unwrap();
        let liste = listele(&c, false, Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].ad_soyad, "Ahmet");
    }

    #[test]
    fn ekleme_ve_goruntuleme_erisim_loguna_yazilir() {
        let (_d, c) = baglanti();
        let e = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        getir(&c, e.id, Cihaz::Masaustu).unwrap();

        let eylemler: Vec<String> =
            son_kayitlar(&c, 10).unwrap().into_iter().map(|k| k.eylem).collect();
        assert!(eylemler.contains(&"ekleme".to_string()));
        assert!(eylemler.contains(&"goruntuleme".to_string()));
    }

    #[test]
    fn liste_sorgusu_tek_log_kaydi_uretir() {
        let (_d, c) = baglanti();
        ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        ekle(&c, &yeni("Mehmet"), Cihaz::Masaustu).unwrap();

        let once = son_kayitlar(&c, 100).unwrap().len();
        listele(&c, false, Cihaz::Masaustu).unwrap();
        let sonra = son_kayitlar(&c, 100).unwrap().len();
        assert_eq!(sonra - once, 1, "liste, satir basina log uretmemeli");
    }

    fn clients_satir_sayisi(c: &rusqlite::Connection) -> i64 {
        c.query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0)).unwrap()
    }

    // Bu iki test, `ekle`/`arsivle`'nin veri yazma + audit log yazma
    // adimlarini tek transaction'a aldigini KANITLAR: `audit_log` tablosunu
    // kasten dusurup `kaydet`'i basarisiz kilariz. Transaction yoksa (ya da
    // `tx.commit()` cagrilmasa) veri degisikligi kalici olur, log yazimi
    // basarisiz olsa bile -- tam da onlemek istedigimiz "eklendi ama
    // loglanmadi" durumu. Bu testlerin transaction OLMADAN gercekten
    // basarisiz oldugunu dogrulamak icin `tx.commit()`/`tx.execute` gecici
    // olarak `conn` kullanacak sekilde degistirilip calistirildi; cikti
    // asagida (bkz. task-3-report.md eki), sonra kod geri alindi.

    #[test]
    fn ekle_audit_basarisiz_olursa_yazma_geri_alinir() {
        let (_d, c) = baglanti();
        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = ekle(&c, &yeni("Ayse Yilmaz"), Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken ekle Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        assert_eq!(
            clients_satir_sayisi(&c),
            0,
            "audit log basarisiz oldugunda clients tablosuna hicbir satir kalici yazilmamali"
        );
    }

    #[test]
    fn arsivle_audit_basarisiz_olursa_durum_degismez() {
        let (_d, c) = baglanti();
        let danisan = ekle(&c, &yeni("Ayse Yilmaz"), Cihaz::Masaustu).unwrap();

        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = arsivle(&c, danisan.id, Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken arsivle Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        let durum: String = c
            .query_row("SELECT durum FROM clients WHERE id = ?1", [danisan.id], |r| r.get(0))
            .unwrap();
        assert_eq!(durum, "aktif", "audit log basarisiz oldugunda durum degisikligi geri alinmali");
    }
}
