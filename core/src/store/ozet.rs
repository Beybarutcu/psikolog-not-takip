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
//! - **Borç kuralı** (tasarım §5.1, kullanıcı kararı 2026-09-25): bir seans
//!   borca girer ⇔ durumu `geldi` YA DA `gelmedi` ∧ ödenmemiş ∧ ücreti > 0.
//!   Terapist gelmeyen seansı ücretlendiriyor — bu artık uygulamanın
//!   bilmediği bir politika değil, ürün kararı. `iptal` ve `planlandi` hiçbir
//!   zaman borca girmez; ücreti `NULL` ya da `0` olan seans da girmez. Kuralın
//!   arayüzdeki eşi `web/src/borc.ts::borcaGirerMi`; ikisi
//!   `core/src/store/borc_ornekleri.json` ortak örnekleriyle birbirine
//!   bağlıdır (`tests::borc_ortak_ornekleri_saglar`).
//! - **Seans sayısı** hâlâ yalnızca `durum = 'geldi'` randevulardan gelir —
//!   bu, borç kuralından AYRI bir sayaçtır ve borç kuralı değişse de
//!   değişmez.
//! - **Tahsilat durumdan bağımsızdır** (dal incelemesi kararı D2): tahsilat
//!   alınan paradır. İptal edilmiş ama ücreti alınmış bir seans (Görev 1
//!   sözleşmesi: `odeme_iptal_edilmis_randevuda_da_isaretlenebilir`)
//!   tahsilattır, borç değildir; ön ödemesi alınmış planlı seans da öyle.
//!   Eski kural (yalnızca `geldi`) bu parayı ekrandan sessizce düşürüyordu:
//!   geldi+ödendi 450 + iptal+ödendi 450 → ekranda 450.
//! - Ay aralığı yarı açıktır: `baslangic >= 'YYYY-AA-01T00:00'` ve
//!   `baslangic < '<sonraki ay>-01T00:00'`. Duvar saati dizgileri sabit
//!   biçimli olduğu için sözlüksel karşılaştırma kronolojiktir. Aralık'ın
//!   sonraki ayı bir sonraki yılın Ocak'ıdır.
//! - `seans_sayisi`: gelinen (`geldi`) seans sayısı, **ücretsiz seanslar dahil**.
//! - `tahsilat_kurus`: ayın ödendi ∧ ücret girilmiş **bütün** seanslarının
//!   toplamı, durum ne olursa olsun.
//! - `bekleyen_kurus`: borca giren (`geldi` ∨ `gelmedi`) ∧ ödenmedi ∧ ücret
//!   > 0 seansların toplamı.
//! - `borclular`: borca giren (`geldi` ∨ `gelmedi`) ∧ ödenmedi ∧ ücret > 0
//!   seansların danışan başına toplamı; `borclular[].seans_sayisi` o
//!   danışanın BORCA GİREN seans sayısıdır (`geldi` + `gelmedi`, üstteki
//!   `seans_sayisi`'nden farklı bir sayım). **Arşivlenmiş danışanlar
//!   dahildir**: borç, dosyanın arşivlenmesiyle kaybolmaz. Sıralama
//!   `borc_kurus DESC, ad_soyad COLLATE NOCASE ASC, client_id ASC`.
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
///
/// `9999-12` de reddedilir: sonraki ayı `10000-01` olurdu — beş haneli yıl
/// sözlüksel karşılaştırmada `"10000-01..." < "9999-12..."` verir, aralık
/// boşalır ve ay sessizce sıfır görünürdü.
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
    if !(1..=12).contains(&ay_no) || (yil, ay_no) == (9999, 12) {
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

    // Aralik tum durumlari kapsar; durum kosulu her kolonun KENDI kuralidir
    // (modul basligi): seans sayisi yalnizca `geldi`, bekleyen borc kuralini
    // (`geldi` VEYA `gelmedi`) izler, tahsilat durumdan bagimsiz.
    let (seans_sayisi, tahsilat_kurus, bekleyen_kurus): (i64, i64, i64) = conn.query_row(
        "SELECT
             COALESCE(SUM(CASE WHEN durum = 'geldi' THEN 1 ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN odendi = 1 AND ucret IS NOT NULL THEN ucret END), 0),
             COALESCE(SUM(CASE WHEN durum IN ('geldi', 'gelmedi') AND odendi = 0
                               AND ucret IS NOT NULL AND ucret > 0
                               THEN ucret END), 0)
           FROM appointments
          WHERE baslangic >= ?1 AND baslangic < ?2",
        rusqlite::params![bas, son],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT a.client_id, c.ad_soyad, SUM(a.ucret) AS borc, COUNT(*)
           FROM appointments a
           JOIN clients c ON c.id = a.client_id
          WHERE a.durum IN ('geldi', 'gelmedi') AND a.odendi = 0
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

    /// Tasarim §5.1: borc kurali IKI dilde yazili; bu dosyayi
    /// `web/src/borc.test.ts` de okur. Her satir GERCEK yoldan gecer.
    #[test]
    fn borc_ortak_ornekleri_saglar() {
        let ornekler: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("borc_ornekleri.json")).unwrap();
        assert!(ornekler.len() >= 24, "ornek dosyasi beklenenden kucuk");
        let (_d, c) = kurulum();
        let mut beklenen_bekleyen = 0i64;
        let mut borclu_sayisi = 0usize;
        for (i, o) in ornekler.iter().enumerate() {
            let ad = o["ad"].as_str().unwrap();
            let durum = o["durum"].as_str().unwrap();
            let odendi = o["odendi"].as_bool().unwrap();
            let ucret = o["ucret"].as_i64();
            let girer = o["borca_girer"].as_bool().unwrap();
            let cid = danisan(&c, &format!("Ornek {i}"));
            seans(&c, cid, &format!("2026-09-{:02}T10:00", 1 + (i % 28)), ucret, durum, odendi);
            if girer {
                beklenen_bekleyen += ucret.unwrap();
                borclu_sayisi += 1;
            }
            let o_ = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
            let borclu = o_.borclular.iter().find(|b| b.client_id == cid);
            assert_eq!(borclu.is_some(), girer, "ornek: {ad}");
            if let Some(b) = borclu {
                assert_eq!(Some(b.borc_kurus), ucret, "ornek: {ad}");
                assert_eq!(b.seans_sayisi, 1, "ornek: {ad}");
            }
        }
        let son = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        assert_eq!(son.bekleyen_kurus, beklenen_bekleyen);
        assert_eq!(son.borclular.len(), borclu_sayisi);
        // On kosul: iki kolu ayiran vaka (gelmedi) gercekten borclu uretti.
        assert!(borclu_sayisi >= 2, "geldi ve gelmedi borclulari uretilmedi");
    }

    /// Kural (tasarim §5.1): `geldi` ve `gelmedi` AYNI biçimde borca girer;
    /// `seans_sayisi` ise yalnızca gelinen seansları sayar (değişmez).
    #[test]
    fn seans_sayisi_yalnizca_geldi_borc_geldi_ve_gelmedi() {
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
        // TAHSILATTIR (karar D2) ama seans sayisina ve borca girmez.
        seans(&c, a, "2026-09-17T10:00", Some(7), "iptal", true);
        seans(&c, a, "2026-09-18T10:00", Some(11), "gelmedi", true);
        // Gelmedigi, ODENMEMIS ve UCRETLI seansi olan danisan da borclu.
        seans(&c, g, "2026-09-03T10:00", Some(90000), "gelmedi", false);
        seans(&c, g, "2026-09-04T10:00", Some(90000), "iptal", false);
        seans(&c, g, "2026-09-05T10:00", Some(90000), "planlandi", false);

        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        assert_eq!(o.ay, "2026-09");
        assert_eq!(o.seans_sayisi, 3, "yalnizca geldi (ucretsiz dahil)");
        assert_eq!(o.tahsilat_kurus, 45018, "odenmis iptal/gelmedi seansin ucreti tahsilattir");
        assert_eq!(
            o.bekleyen_kurus, 180000,
            "gelmedi borca girer (kullanici karari 2026-09-25); iptal/planlandi girmez: \
             Ayse'nin gelmedisi 45000 + Ayse'nin geldisi 45000 + Gelmeyen'in gelmedisi 90000"
        );
        assert_eq!(o.borclular.len(), 2, "Ayse VE Gelmeyen borclu: {:?}", ozet_adlari(&o));
        // Ikisinin tutari esit (90000): sira ada gore (ORDER BY borc DESC, ad_soyad).
        assert_eq!(o.borclular[0].client_id, a);
        assert_eq!(o.borclular[0].ad_soyad, "Ayse");
        assert_eq!(o.borclular[0].borc_kurus, 90000, "geldi 45000 + gelmedi 45000");
        assert_eq!(o.borclular[0].seans_sayisi, 2, "borca giren iki seans: geldi + gelmedi");
        assert_eq!(o.borclular[1].client_id, g);
        assert_eq!(o.borclular[1].ad_soyad, "Gelmeyen");
        assert_eq!(o.borclular[1].borc_kurus, 90000);
        assert_eq!(o.borclular[1].seans_sayisi, 1, "yalnizca gelmedi");
    }

    /// Karar D2'nin dogrudan vakasi (dal incelemesi I5): eski kuralda ekran
    /// 450 gosteriyordu. Tahsilat alinan paradir; seans sayisi ve borc ise
    /// yalnizca gelinen seanslardan gelir.
    #[test]
    fn tahsilat_ayin_odendi_isaretli_tum_seanslaridir_durumdan_bagimsiz() {
        let (_d, c) = kurulum();
        let a = danisan(&c, "Ayse");
        seans(&c, a, "2026-09-02T10:00", Some(45000), "geldi", true);
        seans(&c, a, "2026-09-09T10:00", Some(45000), "iptal", true);
        seans(&c, a, "2026-09-16T10:00", Some(30000), "gelmedi", true);
        // Ucreti girilmemis odendi seans toplama bir sey katmaz (NULL).
        seans(&c, a, "2026-09-23T10:00", None, "iptal", true);

        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        assert_eq!(o.tahsilat_kurus, 120000, "geldi 450 + iptal 450 + gelmedi 300");
        assert_eq!(o.seans_sayisi, 1, "gelinen seans yalnizca geldi");
        assert_eq!(o.bekleyen_kurus, 0);
        assert!(o.borclular.is_empty(), "odenmis iptal/gelmedi borc degil");
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

        // Borclular sorgusunun ALT siniri DAHIL: ayin ilk dakikasindaki
        // odenmemis seans borcludur. Yukaridaki iki satir yalnizca disarida
        // kalmayi sinar; `a.baslangic >= ?1` -> `>` mutasyonu onlarla yesildi
        // (Plan 4 Gorev 3 incelemesi).
        seans(&c, a, "2026-09-01T00:00", Some(50), "geldi", false);
        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        assert_eq!(o.bekleyen_kurus, 50);
        assert_eq!(o.borclular.len(), 1, "ay basindaki seans borclu listesinde olmali");
        assert_eq!((o.borclular[0].client_id, o.borclular[0].borc_kurus), (a, 50));
        assert_eq!(o.borclular.iter().map(|b| b.borc_kurus).sum::<i64>(), o.bekleyen_kurus);
    }

    /// Deterministik sozde rastgele uretec (splitmix64). `rand`'in `StdRng`'si
    /// surumler arasinda ayni diziyi garanti etmez; test kararsizlasmasin.
    struct Tohum(u64);
    impl Tohum {
        fn sonraki(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^ (z >> 31)
        }
        fn asagi(&mut self, n: u64) -> u64 {
            self.sonraki() % n
        }
    }

    /// Degismez (Plan 4 Gorev 3 incelemesi): sabit tohumlu rastgele
    /// kurulumlarda ozet, SQL'den BAGIMSIZ bir Rust hesabiyla ayni sonucu
    /// verir ve `bekleyen_kurus == Σ borclular.borc_kurus`.
    ///
    /// Ucret `None`/0/deger, dort durum, uc ay (ay sinirlari dahil), rastgele
    /// odeme ve arsivleme. Ikinci esitlik su an tanim geregi tutar cunku
    /// "ucret > 0" kosulu toplamda notrdur; iki sorgudan biri ayri bir
    /// kosul/aralik kazanirsa (ör. yalnizca biri `>=`'yi `>` yaparsa) kirilir.
    /// Kume ikiye bolunuyor (tasarim §5.1): `gelinen` yalnizca `seans_sayisi`
    /// icin (degismez, yalnizca `geldi`), `borc_kumesi` ise `bekleyen_kurus`
    /// ve `borclular` icin (`geldi` VE `gelmedi`).
    #[test]
    fn ozet_bagimsiz_hesapla_esit_ve_bekleyen_borclular_toplamidir() {
        const AYLAR: [(&str, u32); 3] = [("2026-08", 31), ("2026-09", 30), ("2026-10", 31)];
        const DURUMLAR: [&str; 4] = ["planlandi", "geldi", "gelmedi", "iptal"];

        let mut ay_basi_borcu_goruldu = false;
        let mut gelinmemis_tahsilat_goruldu = false;
        let mut borclu_goruldu = 0;
        // On kosul (tasarim §5.1'in dogrudan sinama noktasi): "gelmedi" en az
        // bir kez GERCEKTEN borclu satiri uretti. Uretmezse asagidaki tum
        // esitlikler "gelmedi hala sayilmiyor" ile de saglanirdi.
        let mut gelmedi_borcu_goruldu = false;
        for tohum in [1u64, 7, 42, 2026, 0xDEAD_BEEF] {
            let (_d, c) = kurulum();
            let mut r = Tohum(tohum);
            let danisanlar: Vec<i64> =
                (0..4).map(|i| danisan(&c, &format!("Danisan {tohum} {i}"))).collect();
            // (client_id, baslangic, ucret, durum, odendi)
            let mut kayitlar: Vec<(i64, String, Option<i64>, &str, bool)> = Vec::new();
            for _ in 0..40 {
                let cid = danisanlar[r.asagi(4) as usize];
                let (ay, gun_sayisi) = AYLAR[r.asagi(3) as usize];
                // Sinirlar agirlikli: ayin ilk dakikasi ve son saati sik secilir.
                let bas = match r.asagi(4) {
                    0 => format!("{ay}-01T00:00"),
                    1 => format!("{ay}-{gun_sayisi:02}T23:00"),
                    _ => format!("{ay}-{:02}T{:02}:00", 1 + r.asagi(u64::from(gun_sayisi)), r.asagi(23)),
                };
                let ucret = match r.asagi(4) {
                    0 => None,
                    1 => Some(0),
                    _ => Some(1 + r.asagi(100_000) as i64),
                };
                let durum = DURUMLAR[r.asagi(4) as usize];
                let odendi = r.asagi(2) == 1;
                seans(&c, cid, &bas, ucret, durum, odendi);
                kayitlar.push((cid, bas, ucret, durum, odendi));
            }
            for &cid in &danisanlar {
                if r.asagi(2) == 1 {
                    arsivle(&c, cid, Cihaz::Masaustu).unwrap();
                }
            }

            for (ay, _) in AYLAR {
                let o = ay_ozeti(&c, ay, Cihaz::Masaustu).unwrap();
                // Ayin TUM seanslari; kural basina durum filtresi ayri
                // uygulanir (karar D2: tahsilat durumdan bagimsiz).
                let ayin_tumu: Vec<_> = kayitlar.iter().filter(|k| k.1.starts_with(ay)).collect();
                let gelinen: Vec<_> = ayin_tumu.iter().copied().filter(|k| k.3 == "geldi").collect();
                let borc_kumesi: Vec<_> = ayin_tumu
                    .iter()
                    .copied()
                    .filter(|k| k.3 == "geldi" || k.3 == "gelmedi")
                    .collect();
                let beklenen_seans = gelinen.len() as i64;
                let beklenen_tahsilat: i64 =
                    ayin_tumu.iter().filter(|k| k.4).filter_map(|k| k.2).sum();
                if ayin_tumu.iter().any(|k| k.4 && k.3 != "geldi" && k.2.is_some_and(|u| u > 0)) {
                    gelinmemis_tahsilat_goruldu = true;
                }
                let toplam = |odendi: bool| -> i64 {
                    borc_kumesi
                        .iter()
                        .filter(|k| k.4 == odendi && k.2.is_some_and(|u| u > 0))
                        .filter_map(|k| k.2)
                        .sum()
                };
                let mut beklenen_borc: std::collections::BTreeMap<i64, (i64, i64)> =
                    Default::default();
                for k in borc_kumesi.iter().filter(|k| !k.4 && k.2.is_some_and(|u| u > 0)) {
                    ay_basi_borcu_goruldu |= k.1.ends_with("-01T00:00");
                    borclu_goruldu += 1;
                    if k.3 == "gelmedi" {
                        gelmedi_borcu_goruldu = true;
                    }
                    let e = beklenen_borc.entry(k.0).or_default();
                    e.0 += k.2.unwrap();
                    e.1 += 1;
                }
                let mut gercek_borc: Vec<(i64, i64, i64)> =
                    o.borclular.iter().map(|b| (b.client_id, b.borc_kurus, b.seans_sayisi)).collect();
                gercek_borc.sort_unstable();
                let beklenen_borc: Vec<(i64, i64, i64)> =
                    beklenen_borc.into_iter().map(|(cid, (t, n))| (cid, t, n)).collect();

                let bag = format!("tohum {tohum}, ay {ay}");
                assert_eq!(o.seans_sayisi, beklenen_seans, "{bag}: seans_sayisi");
                assert_eq!(o.tahsilat_kurus, beklenen_tahsilat, "{bag}: tahsilat_kurus");
                assert_eq!(o.bekleyen_kurus, toplam(false), "{bag}: bekleyen_kurus");
                assert_eq!(gercek_borc, beklenen_borc, "{bag}: borclular");
                assert_eq!(
                    o.bekleyen_kurus,
                    o.borclular.iter().map(|b| b.borc_kurus).sum::<i64>(),
                    "{bag}: bekleyen == borclular toplami"
                );
            }
        }
        // ON KOSUL: tohumlar bos ya da sinirsiz bir kurulum uretmedi; aksi
        // halde esitlikler 0 == 0 uzerinde saglanirdi.
        assert!(borclu_goruldu >= 10, "yeterli borc uretilmedi: {borclu_goruldu}");
        assert!(ay_basi_borcu_goruldu, "ayin ilk dakikasinda borclu seans uretilmedi");
        // Tahsilat kuralinin iki kolunu ayiran vaka gercekten uretildi; yoksa
        // eski kurala donus (yalnizca geldi) bu testte gorunmezdi.
        assert!(gelinmemis_tahsilat_goruldu, "odenmis gelinmemis seans uretilmedi");
        assert!(gelmedi_borcu_goruldu, "gelmedi hic borclu satiri uretmedi");
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
        assert!(matches!(
            ay_ozeti(&c, "9999-12", Cihaz::Masaustu),
            Err(DepoHatasi::GecersizVeri(_))
        ));
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
        // Yil ust siniri: 9999-12'nin sonraki ayi dort haneye sigmaz.
        assert_eq!(sonraki_ay("9999-11").as_deref(), Some("9999-12"));
        assert_eq!(sonraki_ay("9999-12"), None);
        assert_eq!(sonraki_ay("9998-12").as_deref(), Some("9999-01"));
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
