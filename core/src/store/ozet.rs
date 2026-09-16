//! Ay sonu özeti (Plan 4 Görev 3).
//!
//! Tasarım §6: *"Ay sonu özeti: seans sayısı, tahsilat, borçlu danışanlar.
//! Tek sayfa."* Bu modül o sayfanın tek veri kaynağıdır ve **salt okurdur**:
//! hiçbir tabloya yazmaz (denetim kaydı hariç).
//!
//! # Sayım kuralları — sözleşme
//!
//! Aşağıdakilerin her biri `tests` modülünde bir testle sabitlenmiştir; kural
//! değişirse tek yer burasıdır.
//!
//! - Yalnızca `durum = 'geldi'` randevular sayılır. `gelmedi`, `iptal` ve
//!   `planlandi` **sayılmaz** — ne seans sayısına, ne tahsilata, ne borca.
//!   ("Gelmedi" ücretlendirmesi psikoloğun politikasına bağlı bir ürün
//!   kararıdır; bugünkü arayüz de sayılmadığını açıkça yazıyor.)
//! - Ay aralığı yarı açıktır: `baslangic >= 'YYYY-AA-01T00:00'` ve
//!   `baslangic < '<sonraki ay>-01T00:00'`. Duvar saati dizgileri sabit
//!   biçimli olduğu için sözlüksel karşılaştırma kronolojiktir. Aralık'ın
//!   sonraki ayı bir sonraki yılın Ocak'ıdır.
//! - `seans_sayisi`: gelinen seans sayısı, **ücretsiz seanslar dahil**.
//! - `tahsilat_kurus`: geldi ∧ ödendi ∧ ücret girilmiş toplamı.
//! - `bekleyen_kurus`: geldi ∧ ödenmedi ∧ ücret girilmiş toplamı.
//! - `borclular`: geldi ∧ ödenmedi ∧ ücret > 0 seansların danışan başına
//!   toplamı. **Arşivlenmiş danışanlar dahildir**: borç, dosyanın
//!   arşivlenmesiyle kaybolmaz. Sıralama `borc_kurus DESC, ad_soyad COLLATE
//!   NOCASE ASC, client_id ASC`.
//! - Danışan adı yetkili kaynaktan (`clients`) okunur.
//!
//! # Denetim kaydı
//!
//! Özet danışan adları gösterir, dolayısıyla bir **görüntülemedir**:
//! `Eylem::Goruntuleme`, varlık `"ozet"`, `varlik_id = "ay:YYYY-AA"`,
//! `ayrinti = None`. Ekran ay değiştirdikçe ve her açılışta yeniden
//! çağrılır; bu yüzden hacim `LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)`
//! — takvim yenilemesinin "loglanmaz" sınıfına girmez (isim listesi
//! gösterir), ama her yenilemede silinemez bir satır da düşürmez. Ay farklıysa
//! anahtar farklıdır, iki ayrı görüntüleme iki satırdır.
//!
//! Geçersiz bir `ay` hiçbir tabloyu okumaz ve **log yazmaz**: dışarıdan
//! tetiklenebilen, sınırsız ve silinemez bir gürültü yolu açılmasın.
//!
//! Loga ne tutar ne danışan adı ne de borçlu sayısı girer.

use crate::store::audit::{kaydet, Cihaz, Eylem, LogHacmi, BIRLESTIRME_PENCERESI_DK};
use crate::store::clients::DepoHatasi;
use rusqlite::Connection;
use serde::Serialize;

/// Bir ayın özeti.
///
/// `Debug` elle yazılır: `borclular` danışan adı taşır ve türetilmiş `Debug`
/// onu bir hata mesajına sızdırırdı (bkz. `Borclu`). Toplamlar ve ay tek
/// başına kimseyi tanımlamaz, görünür kalır. `Serialize` ise TÜM alanları
/// taşır — arayüz borçlunun adını göstermek zorunda.
#[derive(Clone, Serialize)]
pub struct AyOzeti {
    pub ay: String,
    pub seans_sayisi: i64,
    pub tahsilat_kurus: i64,
    pub bekleyen_kurus: i64,
    pub borclular: Vec<Borclu>,
}

impl std::fmt::Debug for AyOzeti {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AyOzeti")
            .field("ay", &self.ay)
            .field("seans_sayisi", &self.seans_sayisi)
            .field("tahsilat_kurus", &self.tahsilat_kurus)
            .field("bekleyen_kurus", &self.bekleyen_kurus)
            .field("borclular", &self.borclular)
            .finish()
    }
}

/// Ödenmemiş seansı olan bir danışan.
///
/// `Debug`'da `client_id` ve `ad_soyad` `<gizli>`: "42 numaralı danışanın bu
/// ay 3 ödenmemiş seansı var" isim olmadan da kimliklenebilir bir kişinin
/// terapiye geldiğini söyler (`Randevu`'daki gerekçeyle aynı).
#[derive(Clone, Serialize)]
pub struct Borclu {
    pub client_id: i64,
    pub ad_soyad: String,
    pub borc_kurus: i64,
    pub seans_sayisi: i64,
}

impl std::fmt::Debug for Borclu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Borclu")
            .field("client_id", &"<gizli>")
            .field("ad_soyad", &"<gizli>")
            .field("borc_kurus", &self.borc_kurus)
            .field("seans_sayisi", &self.seans_sayisi)
            .finish()
    }
}

/// `YYYY-AA` biçimini doğrular ve **sonraki ayı** aynı biçimde döner.
///
/// Katı: tam 7 ASCII karakter, 5. karakter `-`, yıl 4 rakam, ay `01..=12`.
/// `2026-9`, `2026-13`, `2026-09-01` reddedilir.
fn sonraki_ay(ay: &str) -> Option<String> {
    let b = ay.as_bytes();
    if b.len() != 7 || b[4] != b'-' {
        return None;
    }
    if !b[..4].iter().chain(&b[5..]).all(u8::is_ascii_digit) {
        return None;
    }
    let yil: u32 = ay[..4].parse().ok()?;
    let ay_no: u32 = ay[5..].parse().ok()?;
    if !(1..=12).contains(&ay_no) {
        return None;
    }
    Some(if ay_no == 12 {
        format!("{:04}-01", yil + 1)
    } else {
        format!("{yil:04}-{:02}", ay_no + 1)
    })
}

/// `ay` (`YYYY-AA`) için özeti hesaplar ve görüntülemeyi loglar.
///
/// Geçersiz `ay` → `DepoHatasi::GecersizVeri`, hiçbir sorgu çalışmaz, log
/// yazılmaz. Sayım kuralları için bkz. modül başlığı.
pub fn ay_ozeti(conn: &Connection, ay: &str, cihaz: Cihaz) -> Result<AyOzeti, DepoHatasi> {
    let Some(sonraki) = sonraki_ay(ay) else {
        return Err(DepoHatasi::GecersizVeri(
            "Ay YYYY-AA biçiminde olmalı.".to_string(),
        ));
    };
    let bas = format!("{ay}-01T00:00");
    let son = format!("{sonraki}-01T00:00");

    let (seans_sayisi, tahsilat_kurus, bekleyen_kurus): (i64, i64, i64) = conn.query_row(
        "SELECT
             COUNT(*),
             COALESCE(SUM(CASE WHEN odendi = 1 AND ucret IS NOT NULL THEN ucret END), 0),
             COALESCE(SUM(CASE WHEN odendi = 0 AND ucret IS NOT NULL THEN ucret END), 0)
           FROM appointments
          WHERE durum = 'geldi' AND baslangic >= ?1 AND baslangic < ?2",
        rusqlite::params![bas, son],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT a.client_id, c.ad_soyad, SUM(a.ucret) AS borc, COUNT(*)
           FROM appointments a
           JOIN clients c ON c.id = a.client_id
          WHERE a.durum = 'geldi' AND a.odendi = 0
            AND a.ucret IS NOT NULL AND a.ucret > 0
            AND a.baslangic >= ?1 AND a.baslangic < ?2
          GROUP BY a.client_id
          ORDER BY borc DESC, c.ad_soyad COLLATE NOCASE ASC, a.client_id ASC",
    )?;
    let borclular = stmt
        .query_map(rusqlite::params![bas, son], |r| {
            Ok(Borclu {
                client_id: r.get(0)?,
                ad_soyad: r.get(1)?,
                borc_kurus: r.get(2)?,
                seans_sayisi: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    kaydet(
        conn,
        Eylem::Goruntuleme,
        "ozet",
        &format!("ay:{ay}"),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;

    Ok(AyOzeti {
        ay: ay.to_string(),
        seans_sayisi,
        tahsilat_kurus,
        bekleyen_kurus,
        borclular,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        appointments::{durum_guncelle, odeme_guncelle, olustur, YeniRandevu},
        audit::{son_kayitlar, Cihaz},
        clients::{arsivle, ekle as danisan_ekle, YeniDanisan},
        db::open_encrypted,
        schema::migrate,
    };
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};

    fn kurulum() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        (dir, c)
    }

    fn danisan(c: &rusqlite::Connection, ad: &str) -> i64 {
        danisan_ekle(c, &YeniDanisan { ad_soyad: ad.into(), telefon: None }, Cihaz::Masaustu)
            .unwrap()
            .id
    }

    /// Randevu olusturur, durumunu ve odemesini ayarlar.
    fn seans(
        c: &rusqlite::Connection,
        cid: i64,
        bas: &str,
        ucret: Option<i64>,
        durum: &str,
        odendi: bool,
    ) -> i64 {
        let bitis = format!("{}T23:59", &bas[..10]);
        let r = olustur(
            c,
            &YeniRandevu { client_id: cid, baslangic: bas.into(), bitis, ucret },
            Cihaz::Masaustu,
        )
        .unwrap();
        if durum != "planlandi" {
            durum_guncelle(c, r.id, durum, Cihaz::Masaustu).unwrap();
        }
        if odendi {
            odeme_guncelle(c, r.id, true, Cihaz::Masaustu).unwrap();
        }
        r.id
    }

    fn ozet_satirlari(c: &rusqlite::Connection) -> Vec<String> {
        son_kayitlar(c, 1000)
            .unwrap()
            .into_iter()
            .filter(|k| k.varlik == "ozet")
            .map(|k| format!("{}|{}|{}|{:?}", k.eylem, k.varlik_id, k.cihaz, k.ayrinti))
            .collect()
    }

    #[test]
    fn yalnizca_gelinmis_seanslar_sayilir_ve_tutarlar_kurusla_dogru() {
        let (_d, c) = kurulum();
        let a = danisan(&c, "Ayse");
        let g = danisan(&c, "Gelmeyen");
        seans(&c, a, "2026-09-02T10:00", Some(45000), "geldi", true);
        seans(&c, a, "2026-09-09T10:00", Some(45000), "geldi", false);
        seans(&c, a, "2026-09-16T10:00", Some(45000), "gelmedi", false);
        seans(&c, a, "2026-09-23T10:00", Some(45000), "iptal", false);
        seans(&c, a, "2026-09-30T10:00", Some(45000), "planlandi", false);
        seans(&c, a, "2026-09-25T10:00", None, "geldi", false);
        // Ucreti ALINMIS ama gelinmemis seanslar (on odeme / iptal ucreti)
        // tahsilata da girmez: "odendi" kolu durum kosulunu atlatmamali.
        seans(&c, a, "2026-09-17T10:00", Some(7), "iptal", true);
        seans(&c, a, "2026-09-18T10:00", Some(11), "gelmedi", true);
        // Yalnizca gelmedigi/iptal ettigi/planli seansi olan danisan borclu DEGIL.
        seans(&c, g, "2026-09-03T10:00", Some(90000), "gelmedi", false);
        seans(&c, g, "2026-09-04T10:00", Some(90000), "iptal", false);
        seans(&c, g, "2026-09-05T10:00", Some(90000), "planlandi", false);

        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        assert_eq!(o.ay, "2026-09");
        assert_eq!(o.seans_sayisi, 3, "yalnizca geldi (ucretsiz dahil)");
        assert_eq!(o.tahsilat_kurus, 45000, "gelinmemis ama odenmis seans tahsilata girmez");
        assert_eq!(o.bekleyen_kurus, 45000, "gelmedi/iptal/planlandi borca girmez");
        assert_eq!(o.borclular.len(), 1, "yalnizca Ayse borclu: {:?}", ozet_adlari(&o));
        assert_eq!(o.borclular[0].client_id, a);
        assert_eq!(o.borclular[0].ad_soyad, "Ayse");
        assert_eq!(o.borclular[0].borc_kurus, 45000);
        assert_eq!(o.borclular[0].seans_sayisi, 1, "ucretsiz (NULL) seans borc sayilmaz");
    }

    fn ozet_adlari(o: &AyOzeti) -> Vec<String> {
        o.borclular.iter().map(|b| b.ad_soyad.clone()).collect()
    }

    #[test]
    fn ay_siniri_dahil_haric_dogru_ve_aralik_yil_devrediyor() {
        let (_d, c) = kurulum();
        let a = danisan(&c, "Ayse");
        seans(&c, a, "2026-08-31T23:00", Some(100), "geldi", true);
        seans(&c, a, "2026-09-01T00:00", Some(200), "geldi", true);
        seans(&c, a, "2026-09-30T23:30", Some(400), "geldi", true);
        seans(&c, a, "2026-10-01T00:00", Some(800), "geldi", true);
        seans(&c, a, "2026-12-31T23:00", Some(1600), "geldi", true);
        seans(&c, a, "2027-01-01T00:00", Some(3200), "geldi", true);

        assert_eq!(ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap().tahsilat_kurus, 600);
        assert_eq!(ay_ozeti(&c, "2026-08", Cihaz::Masaustu).unwrap().tahsilat_kurus, 100);
        assert_eq!(ay_ozeti(&c, "2026-10", Cihaz::Masaustu).unwrap().tahsilat_kurus, 800);
        assert_eq!(ay_ozeti(&c, "2026-12", Cihaz::Masaustu).unwrap().tahsilat_kurus, 1600);
        assert_eq!(ay_ozeti(&c, "2027-01", Cihaz::Masaustu).unwrap().tahsilat_kurus, 3200);
        // Borclular da ayni araligi kullanir (ikinci sorgu ayri yazilmis).
        seans(&c, a, "2026-10-01T00:00", Some(5), "geldi", false);
        seans(&c, a, "2026-08-31T23:58", Some(5), "geldi", false);
        assert!(ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap().borclular.is_empty());
        assert_eq!(ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap().bekleyen_kurus, 0);
    }

    #[test]
    fn borclular_tutara_gore_sonra_ada_gore_siralanir_ve_arsivliler_dahildir() {
        let (_d, c) = kurulum();
        // Ekleme sirasi, beklenen siranin NE AYNISI NE TERSI (bicim 8).
        // "ali" KUCUK harfle: ikili karsilastirmada "Zeynep" < "ali" olurdu,
        // COLLATE NOCASE ise ali'yi one alir.
        let z = danisan(&c, "Zeynep");
        let b = danisan(&c, "Burak");
        let a = danisan(&c, "ali");
        seans(&c, z, "2026-09-03T10:00", Some(30000), "geldi", false);
        seans(&c, b, "2026-09-04T10:00", Some(40000), "geldi", false);
        seans(&c, b, "2026-09-11T10:00", Some(50000), "geldi", false);
        seans(&c, a, "2026-09-05T10:00", Some(30000), "geldi", false);
        seans(&c, a, "2026-09-06T10:00", Some(0), "geldi", false);
        arsivle(&c, b, Cihaz::Masaustu).unwrap();

        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        let sira: Vec<&str> = o.borclular.iter().map(|x| x.ad_soyad.as_str()).collect();
        assert_eq!(
            sira,
            ["Burak", "ali", "Zeynep"],
            "tutar DESC, esitlikte ad ASC (harf duyarsiz); arsivli Burak dahil"
        );
        assert_eq!(o.borclular[0].borc_kurus, 90000, "danisan basina TOPLAM");
        assert_eq!(o.borclular[0].seans_sayisi, 2);
        assert_eq!(o.borclular[1].seans_sayisi, 1, "0 TL'lik seans borc sayilmaz");
        assert_eq!(o.borclular[1].borc_kurus, 30000);
    }

    #[test]
    fn ayni_tutar_ve_ayni_adda_client_id_artan_sirada() {
        let (_d, c) = kurulum();
        let ilk = danisan(&c, "Deniz");
        let ikinci = danisan(&c, "deniz");
        // Seanslar TERS sirada eklenir: randevu kimligine gore siralama da
        // client_id DESC gibi gorunmesin.
        seans(&c, ikinci, "2026-09-03T10:00", Some(100), "geldi", false);
        seans(&c, ilk, "2026-09-04T10:00", Some(100), "geldi", false);
        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        let kimlikler: Vec<i64> = o.borclular.iter().map(|b| b.client_id).collect();
        assert_eq!(kimlikler, [ilk, ikinci]);
    }

    #[test]
    fn odenmis_danisan_borclular_listesinden_cikar() {
        let (_d, c) = kurulum();
        let a = danisan(&c, "Ayse");
        let r = seans(&c, a, "2026-09-02T10:00", Some(45000), "geldi", false);
        assert_eq!(
            ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap().borclular.len(),
            1,
            "on kosul"
        );
        odeme_guncelle(&c, r, true, Cihaz::Masaustu).unwrap();
        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        assert!(o.borclular.is_empty());
        assert_eq!((o.tahsilat_kurus, o.bekleyen_kurus), (45000, 0));
    }

    #[test]
    fn gecersiz_ay_reddedilir_gecerli_ay_kabul_edilir_ve_gecersizde_log_yazilmaz() {
        let (_d, c) = kurulum();
        let once = son_kayitlar(&c, 1000).unwrap().len();
        for kotu in [
            "2026-9", "2026-13", "2026-00", "2026-09-01", "", "abcd-ef", "2026/09", "+026-09",
            "2026-+9", "2026-09 ", "٢٠٢٦-09",
        ] {
            assert!(
                matches!(ay_ozeti(&c, kotu, Cihaz::Masaustu), Err(DepoHatasi::GecersizVeri(_))),
                "{kotu}"
            );
        }
        assert_eq!(son_kayitlar(&c, 1000).unwrap().len(), once);
        for iyi in ["2026-01", "2026-12", "2028-02", "2026-10"] {
            assert!(ay_ozeti(&c, iyi, Cihaz::Masaustu).is_ok(), "{iyi}");
        }
    }

    #[test]
    fn sonraki_ay_yil_devreder_ve_sifirla_doldurur() {
        assert_eq!(sonraki_ay("2026-09").as_deref(), Some("2026-10"));
        assert_eq!(sonraki_ay("2026-12").as_deref(), Some("2027-01"));
        assert_eq!(sonraki_ay("2026-01").as_deref(), Some("2026-02"));
    }

    #[test]
    fn ozet_goruntulemesi_ay_basina_birlesir_farkli_ay_ayri_satir() {
        let (_d, c) = kurulum();
        for _ in 0..5 {
            ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        }
        ay_ozeti(&c, "2026-08", Cihaz::Masaustu).unwrap();
        assert_eq!(
            ozet_satirlari(&c),
            [
                "goruntuleme|ay:2026-08|masaustu|None",
                "goruntuleme|ay:2026-09|masaustu|None",
            ],
            "5 x Eylul = 1 satir, Agustos = 1 satir; ayrinti yok"
        );
    }

    /// Susturma yonu (bicim 7): pencere cok buyutulurse (log susar) bu test
    /// kirilir. Pencere DISINDA kalan eski bir satir yeni goruntulemeyi
    /// gizlememeli.
    #[test]
    fn pencere_disindaki_ozet_satiri_yeni_goruntulemeyi_susturmaz() {
        let (_d, c) = kurulum();
        let eski = (OffsetDateTime::now_utc()
            - time::Duration::minutes(BIRLESTIRME_PENCERESI_DK * 2))
        .replace_nanosecond(0)
        .unwrap()
        .format(&Rfc3339)
        .unwrap();
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti)
             VALUES (?1, 'goruntuleme', 'ozet', 'ay:2026-09', 'masaustu', NULL)",
            [&eski],
        )
        .unwrap();
        assert_eq!(ozet_satirlari(&c).len(), 1, "on kosul");

        ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        assert_eq!(ozet_satirlari(&c).len(), 2, "pencere disindaki satir susturmamali");
    }

    #[test]
    fn debug_danisan_adini_ve_kimligini_basmaz_serialize_basar() {
        let (_d, c) = kurulum();
        // Kimlik ayirt edici olsun diye birkac danisan once eklenir.
        for i in 0..40 {
            danisan(&c, &format!("Dolgu {i}"));
        }
        let a = danisan(&c, "COKGIZLIAD");
        seans(&c, a, "2026-09-02T10:00", Some(45000), "geldi", false);
        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        let hata_ayikla = format!("{o:?} {:?}", Ok::<_, ()>(&o));
        assert!(!hata_ayikla.contains("COKGIZLIAD"), "{hata_ayikla}");
        assert!(!hata_ayikla.contains(&a.to_string()), "client_id basilmamali: {hata_ayikla}");
        assert!(hata_ayikla.contains("45000"), "arti yon: tutar Debug'da gorunur");
        let json = serde_json::to_string(&o).unwrap();
        assert!(json.contains("COKGIZLIAD"), "arti yon: arayuz adi gormeli");
        assert!(json.contains(&format!("\"client_id\":{a}")), "arti yon: arayuz kimligi gormeli");
    }
}
