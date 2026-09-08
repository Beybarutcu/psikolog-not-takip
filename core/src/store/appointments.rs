//! Randevu (appointment) deposu.
//!
//! Tasarım kararı gereği randevu ve seans aynı kayıttır (ileride not bu
//! kayıtlara bağlanacak); bu modül `appointments` tablosu üzerinde
//! oluşturma, aralık sorgusu, durum güncelleme ve silme işlemlerini sağlar.
//! Desen `store::clients` (Plan 2 Görev 3) ile birebir aynıdır: `DepoHatasi`
//! oradan içe aktarılır, `Debug` elle yazılır, yazma + audit log tek
//! transaction'da yapılır.
//!
//! # Hassas veri kuralı (bkz. `store::audit`)
//! `Randevu.danisan_adi` KVKK kapsamında özel nitelikli/kişisel veridir. Bu
//! modüldeki hiçbir fonksiyon bunu `audit::kaydet`'in `ayrinti` alanına
//! yazmaz; `varlik_id` alanına da yalnızca sayısal randevu kimliği yazılır,
//! isim asla yazılmaz.
//!
//! # Yazma + log aynı transaction'da
//! `olustur`, `durum_guncelle` ve `sil` veriyi değiştirir; üçü de tabloya
//! yazdıktan hemen sonra `audit::kaydet` çağırır. Bu adımlar
//! `conn.unchecked_transaction()` ile TEK transaction'a alınır -- log yazımı
//! başarısız olursa veri değişikliği de geri alınır, "randevu değişti ama
//! loglanmadı" durumu oluşmaz (bkz. `tests` modülündeki `..._atomik_...`
//! testleri: bu garanti `audit_log` tablosunu bilerek bozup hem pozitif hem
//! negatif yönde test edilir). `Connection::transaction()` (`&mut self`)
//! değil `unchecked_transaction()` (`&self`) kullanılıyor çünkü bu depo
//! fonksiyonlarının imzası (brief'te sabit) `&Connection` alıyor; bu güvenli
//! çünkü bu fonksiyonlar `schema::migrate`'i çağırmıyor, dolayısıyla iç içe
//! transaction riski yok. `aralik_getir` salt okunur olduğundan (veri
//! durumu değişmiyor) ayrı transaction gerektirmiyor.
//!
//! # UYARI — iç içe transaction açılamaz
//! `olustur`, `durum_guncelle` ve `sil` kendi `unchecked_transaction()`'ını
//! içeride açar. SQLite iç içe transaction'ı desteklemez ("cannot start a
//! transaction within a transaction"): bu üç fonksiyonu **başka bir
//! transaction'ın içinden** çağırmayın. Bu sessiz bir veri bozulması değil,
//! `rusqlite::Error` olarak dönen gürültülü bir hatadır -- ama derleyici
//! yakalamaz.

use crate::store::audit::{kaydet, Ayrinti, Cihaz, Eylem};
use crate::store::clients::DepoHatasi;
use crate::store::zaman::zaman_gecerli_mi;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub const GECERLI_DURUMLAR: [&str; 4] = ["planlandi", "geldi", "gelmedi", "iptal"];

/// Randevu (= seans) kaydı — asgari alanlar.
///
/// `Debug` türetilmiyor: `danisan_adi` KVKK kapsamında özel nitelikli/kişisel
/// veridir; türetilmiş `Debug` bunu `{:?}` ile bir hata mesajına veya loga
/// sızdırabilirdi (bkz. `store::clients::Danisan` ile aynı bulgu sınıfı).
/// `Serialize` ise arayüz için `danisan_adi`'nı İÇERİR -- gizleme yalnızca
/// `Debug` çıktısı içindir.
#[derive(Clone, Serialize)]
pub struct Randevu {
    pub id: i64,
    pub client_id: i64,
    pub danisan_adi: String,
    pub baslangic: String,
    pub bitis: String,
    pub durum: String,
    pub ucret: Option<i64>,
    pub odendi: bool,
    pub seri_id: Option<String>,
}

impl std::fmt::Debug for Randevu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Randevu")
            .field("id", &self.id)
            .field("client_id", &self.client_id)
            .field("danisan_adi", &"<gizli>")
            .field("baslangic", &self.baslangic)
            .field("bitis", &self.bitis)
            .field("durum", &self.durum)
            .field("ucret", &self.ucret)
            .field("odendi", &self.odendi)
            .field("seri_id", &self.seri_id)
            .finish()
    }
}

#[derive(Clone, Deserialize)]
pub struct YeniRandevu {
    pub client_id: i64,
    pub baslangic: String,
    pub bitis: String,
    pub ucret: Option<i64>,
}

fn simdi() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

const SECIM: &str = "SELECT a.id, a.client_id, c.ad_soyad, a.baslangic, a.bitis, a.durum,
                            a.ucret, a.odendi, a.seri_id
                     FROM appointments a JOIN clients c ON c.id = a.client_id";

fn satirdan(r: &rusqlite::Row) -> Result<Randevu, rusqlite::Error> {
    Ok(Randevu {
        id: r.get(0)?,
        client_id: r.get(1)?,
        danisan_adi: r.get(2)?,
        baslangic: r.get(3)?,
        bitis: r.get(4)?,
        durum: r.get(5)?,
        ucret: r.get(6)?,
        odendi: r.get::<_, i64>(7)? != 0,
        seri_id: r.get(8)?,
    })
}

/// Yeni bir randevu oluşturur. Ekleme ve erişim logu tek transaction'da
/// yazılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn olustur(
    conn: &Connection,
    yeni: &YeniRandevu,
    cihaz: Cihaz,
) -> Result<Randevu, DepoHatasi> {
    if !zaman_gecerli_mi(&yeni.baslangic) || !zaman_gecerli_mi(&yeni.bitis) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }
    if yeni.bitis <= yeni.baslangic {
        return Err(DepoHatasi::GecersizVeri(
            "Randevu bitişi başlangıcından sonra olmalı.".into(),
        ));
    }
    if yeni.ucret.is_some_and(|u| u < 0) {
        return Err(DepoHatasi::GecersizVeri("Ücret negatif olamaz.".into()));
    }

    let tx = conn.unchecked_transaction()?;

    let z = simdi();
    tx.execute(
        "INSERT INTO appointments
           (client_id, baslangic, bitis, durum, ucret, odendi, olusturma_zamani, guncelleme_zamani)
         VALUES (?1, ?2, ?3, 'planlandi', ?4, 0, ?5, ?5)",
        rusqlite::params![yeni.client_id, yeni.baslangic, yeni.bitis, yeni.ucret, z],
    )?;
    let id = tx.last_insert_rowid();
    kaydet(&tx, Eylem::Ekleme, "appointment", &id.to_string(), cihaz, None)?;

    let randevu = tx.query_row(&format!("{SECIM} WHERE a.id = ?1"), [id], satirdan)?;

    tx.commit()?;
    Ok(randevu)
}

/// `baslangic` (dahil) ile `bitis` (hariç) arasındaki randevuları zamana
/// göre sıralı listeler. Salt okunur olduğundan transaction gerektirmez.
/// Kaç satır dönerse dönsün tek bir "goruntuleme" kaydı üretir -- satır
/// başına ayrı log gürültü üretir.
pub fn aralik_getir(
    conn: &Connection,
    baslangic: &str,
    bitis: &str,
    cihaz: Cihaz,
) -> Result<Vec<Randevu>, DepoHatasi> {
    let mut stmt = conn.prepare(&format!(
        "{SECIM} WHERE a.baslangic >= ?1 AND a.baslangic < ?2 ORDER BY a.baslangic"
    ))?;
    let liste = stmt
        .query_map([baslangic, bitis], satirdan)?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Liste tek bir goruntuleme kaydi uretir, satir basina degil.
    kaydet(
        conn,
        Eylem::Goruntuleme,
        "appointment",
        "liste",
        cihaz,
        Some(Ayrinti::AralikBaslangici(baslangic.to_string())),
    )?;
    Ok(liste)
}

/// Bir randevunun durumunu günceller. Güncelleme ve erişim logu tek
/// transaction'da yazılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn durum_guncelle(
    conn: &Connection,
    id: i64,
    durum: &str,
    cihaz: Cihaz,
) -> Result<(), DepoHatasi> {
    // GECERLI_DURUMLAR icindeki eslesen &'static str referansi kullanilir
    // (cagirandan gelen `durum: &str` degil): boylece `Ayrinti::Durum`'a
    // yalnizca sabit, bilinen degerler gecer, kullanicidan gelen rastgele
    // metin -- bicimce eslesse bile -- asla loglanan degerin kaynagi olmaz.
    let Some(&sabit_durum) = GECERLI_DURUMLAR.iter().find(|&&d| d == durum) else {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Geçersiz randevu durumu: {durum}"
        )));
    };

    let tx = conn.unchecked_transaction()?;

    let etkilenen = tx.execute(
        "UPDATE appointments SET durum = ?1, guncelleme_zamani = ?2 WHERE id = ?3",
        rusqlite::params![sabit_durum, simdi(), id],
    )?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(
        &tx,
        Eylem::Duzenleme,
        "appointment",
        &id.to_string(),
        cihaz,
        Some(Ayrinti::Durum(sabit_durum)),
    )?;

    tx.commit()?;
    Ok(())
}

/// Bir randevuyu siler. Silme ve erişim logu tek transaction'da yazılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn sil(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi> {
    let tx = conn.unchecked_transaction()?;

    let etkilenen = tx.execute("DELETE FROM appointments WHERE id = ?1", [id])?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(&tx, Eylem::Silme, "appointment", &id.to_string(), cihaz, None)?;

    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        clients::{ekle as danisan_ekle, YeniDanisan},
        db::open_encrypted,
        schema::migrate,
    };

    fn kurulum() -> (tempfile::TempDir, rusqlite::Connection, i64) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        let d = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ayse Yilmaz".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        (dir, c, d.id)
    }

    fn yeni(client_id: i64, baslangic: &str, bitis: &str) -> YeniRandevu {
        YeniRandevu {
            client_id,
            baslangic: baslangic.into(),
            bitis: bitis.into(),
            ucret: Some(45000),
        }
    }

    #[test]
    fn olusturulan_randevu_danisan_adiyla_birlikte_doner() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        assert_eq!(r.durum, "planlandi");
        assert_eq!(r.danisan_adi, "Ayse Yilmaz");
        assert_eq!(r.ucret, Some(45000));
        assert!(!r.odendi);
    }

    #[test]
    fn bitis_baslangictan_once_olamaz() {
        let (_d, c, cid) = kurulum();
        let hata = olustur(&c, &yeni(cid, "2026-09-07T15:00", "2026-09-07T14:00"), Cihaz::Masaustu)
            .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn bozuk_tarih_bicimi_reddedilir() {
        let (_d, c, cid) = kurulum();
        let hata =
            olustur(&c, &yeni(cid, "07.09.2026 14:00", "07.09.2026 15:00"), Cihaz::Masaustu)
                .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn aralik_sorgusu_baslangici_dahil_bitisi_haric_alir() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T09:00", "2026-09-07T10:00"), Cihaz::Masaustu).unwrap();
        olustur(&c, &yeni(cid, "2026-09-14T09:00", "2026-09-14T10:00"), Cihaz::Masaustu).unwrap();

        let hafta = aralik_getir(&c, "2026-09-07T00:00", "2026-09-14T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(hafta.len(), 1, "sonraki haftanin randevusu girmemeli");
        assert_eq!(hafta[0].baslangic, "2026-09-07T09:00");
    }

    #[test]
    fn aralik_sonuclari_zamana_gore_siralanir() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T16:00", "2026-09-07T17:00"), Cihaz::Masaustu).unwrap();
        olustur(&c, &yeni(cid, "2026-09-07T09:00", "2026-09-07T10:00"), Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].baslangic, "2026-09-07T09:00");
    }

    #[test]
    fn durum_guncellenir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].durum, "geldi");
    }

    #[test]
    fn gecersiz_durum_reddedilir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        let hata = durum_guncelle(&c, r.id, "belki_gelir", Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn silinen_randevu_listede_cikmaz_ve_loglanir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        sil(&c, r.id, Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert!(liste.is_empty());

        let eylemler: Vec<String> = crate::store::audit::son_kayitlar(&c, 10)
            .unwrap()
            .into_iter()
            .map(|k| k.eylem)
            .collect();
        assert!(eylemler.contains(&"silme".to_string()));
    }

    fn appointments_satir_sayisi(c: &rusqlite::Connection) -> i64 {
        c.query_row("SELECT COUNT(*) FROM appointments", [], |r| r.get(0)).unwrap()
    }

    // Bu uc test, `olustur`/`durum_guncelle`/`sil`'in veri yazma + audit log
    // yazma adimlarini tek transaction'a aldigini KANITLAR: `audit_log`
    // tablosunu kasten dusurup `kaydet`'i basarisiz kilariz. Transaction
    // yoksa (ya da `tx.commit()` cagrilmasa) veri degisikligi kalici olur,
    // log yazimi basarisiz olsa bile -- tam da onlemek istedigimiz "randevu
    // degisti ama loglanmadi" durumu. `clients.rs`'teki desenin aynisidir
    // (bkz. o dosyadaki `..._atomik_...` testleri). Bu testlerin transaction
    // OLMADAN gercekten basarisiz oldugunu dogrulamak icin `tx.commit()`/
    // `tx.execute`/`kaydet(&tx, ...)` gecici olarak dogrudan `conn`
    // kullanacak sekilde degistirilip calistirildi; cikti task-4-report.md
    // ekinde, sonra kod geri alindi.

    #[test]
    fn olustur_audit_basarisiz_olursa_yazma_geri_alinir() {
        let (_d, c, cid) = kurulum();
        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken olustur Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        assert_eq!(
            appointments_satir_sayisi(&c),
            0,
            "audit log basarisiz oldugunda appointments tablosuna hicbir satir kalici yazilmamali"
        );
    }

    #[test]
    fn durum_guncelle_audit_basarisiz_olursa_durum_degismez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken durum_guncelle Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        let durum: String = c
            .query_row("SELECT durum FROM appointments WHERE id = ?1", [r.id], |row| row.get(0))
            .unwrap();
        assert_eq!(durum, "planlandi", "audit log basarisiz oldugunda durum degisikligi geri alinmali");
    }

    #[test]
    fn sil_audit_basarisiz_olursa_kayit_silinmez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = sil(&c, r.id, Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken sil Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        assert_eq!(
            appointments_satir_sayisi(&c),
            1,
            "audit log basarisiz oldugunda silme geri alinmali, kayit kalmali"
        );
    }
}
