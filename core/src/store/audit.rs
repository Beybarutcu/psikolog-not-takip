//! Erişim logu yazma ve okuma katmanı.
//!
//! KVKK Kurul Kararı 2018/10 uyarınca özel nitelikli veri (danışan/seans verisi)
//! üzerindeki her işlem güvenli biçimde loglanmalıdır. `audit_log` tablosu
//! (bkz. `schema.rs`) UPDATE/DELETE'e karşı tetikleyiciyle korunur; bu modül
//! o tabloya yazan ve ondan okuyan tek API'dir.
//!
//! # KRİTİK: Hassas içerik bu loga ASLA yazılmaz
//!
//! `kaydet` yalnızca "kim, ne zaman, hangi kaydı, hangi cihazdan" bilgisini
//! tutar: eylem türü, varlık adı (ör. "client"), varlık kimliği ve cihaz.
//! Seans notu içeriği, danışan adı/soyadı, arama sorgusu metni, dosya
//! içeriği veya benzeri herhangi bir hassas/özel nitelikli veri bu tabloya
//! **kesinlikle** yazılmamalıdır — aksi hâlde audit log kendisi ikinci bir
//! sızıntı yüzeyi hâline gelir.
//!
//! `ayrinti` alanı artık serbest metin değil, kapalı bir enum'dur (`Ayrinti`):
//! kural artık derleyici tarafından **yapısal olarak** uygulanır — çağıran
//! kod rastgele bir `&str` geçiremez. `Durum` yalnızca `&'static str` kabul
//! eder (randevu durumları sabit bir kümedir, kullanıcı verisi değildir).
//! `AralikBaslangici` ve `SeriSilme` bir tarih damgası (`String`) taşır;
//! bu, kapalı enum'un kapattığı kapıyı arka taraftan yeniden açabilecek tek
//! nokta olduğundan `metin()` içinde **biçim doğrulaması yapılır** — biçime
//! uymayan bir dizgi asla ham hâliyle loga yazılmaz, yerine `"gecersiz"`
//! sabit işareti konur. **Yeni bir `Ayrinti` varyantı eklerken**: varyant
//! doğrulanmamış serbest metin (seans notu, danışan adı, arama sorgusu vb.)
//! taşımamalı; bir `String`/`&str` alanı gerekiyorsa mutlaka dar bir biçim
//! doğrulaması eklenmeli.

use rusqlite::Connection;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

/// Beklenen bicim: YYYY-AA-GGTSS:DD (yerel duvar saati, zaman dilimi yok).
///
/// Plan 1'deki `zaman_gecerli_mi` deseniyle aynıdır; burada ayrıca
/// kopyalanmıştır çünkü `Ayrinti::metin()` hassas olmayan yalnızca kısa,
/// biçimi doğrulanmış dizgileri loga yazmalıdır.
fn zaman_gecerli_mi(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 16
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b'T'
        && b[13] == b':'
        && b.iter().enumerate().all(|(i, c)| matches!(i, 4 | 7 | 10 | 13) || c.is_ascii_digit())
}

/// `audit_log.ayrinti` alanına yazılabilecek kapalı değer kümesi.
///
/// Bkz. modül başlığı: hassas veri kuralı burada derleyici tarafından
/// zorlanır. Yeni varyant eklerken doğrulanmamış serbest metin taşımamaya
/// dikkat edin.
#[derive(Debug, Clone)]
pub enum Ayrinti {
    IlkKurulum,
    Arsivlendi,
    Durum(&'static str),
    AralikBaslangici(String),
    SeriSilme { adet: usize, tarihten: String },
}

impl Ayrinti {
    /// Veritabanına yazılan dizgiyi üretir. Doğrulanmayan tarih dizgileri
    /// ham hâliyle **asla** döndürülmez; yerine `"gecersiz"` yazılır.
    pub fn metin(&self) -> String {
        match self {
            Ayrinti::IlkKurulum => "ilk kurulum".to_string(),
            Ayrinti::Arsivlendi => "arsivlendi".to_string(),
            Ayrinti::Durum(s) => format!("durum: {s}"),
            Ayrinti::AralikBaslangici(t) => {
                if zaman_gecerli_mi(t) {
                    format!("aralik: {t}")
                } else {
                    "aralik: gecersiz".to_string()
                }
            }
            Ayrinti::SeriSilme { adet, tarihten } => {
                if zaman_gecerli_mi(tarihten) {
                    format!("seri silme: {adet} kayit, {tarihten} sonrasi")
                } else {
                    "seri silme: gecersiz".to_string()
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Eylem {
    Goruntuleme,
    Duzenleme,
    Ekleme,
    Silme,
    DisaAktarma,
    Giris,
    Cikis,
}

impl Eylem {
    pub fn as_str(self) -> &'static str {
        match self {
            Eylem::Goruntuleme => "goruntuleme",
            Eylem::Duzenleme => "duzenleme",
            Eylem::Ekleme => "ekleme",
            Eylem::Silme => "silme",
            Eylem::DisaAktarma => "disa_aktarma",
            Eylem::Giris => "giris",
            Eylem::Cikis => "cikis",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Cihaz {
    Masaustu,
    Telefon,
}

impl Cihaz {
    pub fn as_str(self) -> &'static str {
        match self {
            Cihaz::Masaustu => "masaustu",
            Cihaz::Telefon => "telefon",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AuditKaydi {
    pub olay_zamani: String,
    pub eylem: String,
    pub varlik: String,
    pub varlik_id: String,
    pub cihaz: String,
    pub ayrinti: Option<String>,
}

fn simdi_utc() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

/// Erişim logu tablosuna bir olay yazar.
///
/// # Hassas veri kuralı
/// `varlik`, `varlik_id` yalnızca kayıt tipini ve kimliğini taşımalı (ör.
/// "client", "42"); `ayrinti` kapalı `Ayrinti` enum'udur — serbest metin
/// kabul edilmez. Seans notu içeriği, danışan adı, arama sorgusu gibi
/// hassas/özel nitelikli veriler bu fonksiyona **asla** parametre olarak
/// geçirilmemelidir.
pub fn kaydet(
    conn: &Connection,
    eylem: Eylem,
    varlik: &str,
    varlik_id: &str,
    cihaz: Cihaz,
    ayrinti: Option<Ayrinti>,
) -> Result<(), rusqlite::Error> {
    let ayrinti = ayrinti.map(|a| a.metin());
    conn.execute(
        "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![simdi_utc(), eylem.as_str(), varlik, varlik_id, cihaz.as_str(), ayrinti],
    )?;
    Ok(())
}

/// En yeni kayıttan en eskiye doğru sıralanmış son `limit` audit kaydını döner.
///
/// Sıralama `id DESC` ile yapılır (`olay_zamani DESC` ile değil), böylece
/// aynı saniye içinde yazılan kayıtların yazılma sırası korunur.
pub fn son_kayitlar(conn: &Connection, limit: i64) -> Result<Vec<AuditKaydi>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti
         FROM audit_log ORDER BY id DESC LIMIT ?1",
    )?;
    let kayitlar = stmt
        .query_map([limit], |r| {
            Ok(AuditKaydi {
                olay_zamani: r.get(0)?,
                eylem: r.get(1)?,
                varlik: r.get(2)?,
                varlik_id: r.get(3)?,
                cihaz: r.get(4)?,
                ayrinti: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(kayitlar)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{db::open_encrypted, schema::migrate};

    fn baglanti() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        (dir, c)
    }

    #[test]
    fn kaydedilen_olay_geri_okunur() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Goruntuleme, "client", "42", Cihaz::Masaustu, None).unwrap();

        let kayitlar = son_kayitlar(&c, 10).unwrap();
        assert_eq!(kayitlar.len(), 1);
        assert_eq!(kayitlar[0].eylem, "goruntuleme");
        assert_eq!(kayitlar[0].varlik, "client");
        assert_eq!(kayitlar[0].varlik_id, "42");
        assert_eq!(kayitlar[0].cihaz, "masaustu");
    }

    #[test]
    fn olay_zamani_iso8601_utc_biciminde() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Giris, "session", "-", Cihaz::Masaustu, None).unwrap();
        let z = &son_kayitlar(&c, 1).unwrap()[0].olay_zamani;
        assert!(z.ends_with('Z'), "zaman UTC olmali: {z}");
        assert_eq!(z.len(), 20, "ornek: 2026-09-07T10:00:00Z");
    }

    #[test]
    fn kayitlar_en_yeniden_eskiye_siralanir() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Giris, "session", "1", Cihaz::Masaustu, None).unwrap();
        kaydet(&c, Eylem::Cikis, "session", "2", Cihaz::Masaustu, None).unwrap();
        let k = son_kayitlar(&c, 10).unwrap();
        assert_eq!(k[0].varlik_id, "2");
    }

    #[test]
    fn her_varyant_beklenen_metni_uretir() {
        assert_eq!(Ayrinti::IlkKurulum.metin(), "ilk kurulum");
        assert_eq!(Ayrinti::Arsivlendi.metin(), "arsivlendi");
        assert_eq!(Ayrinti::Durum("geldi").metin(), "durum: geldi");
        assert_eq!(
            Ayrinti::AralikBaslangici("2026-09-07T00:00".into()).metin(),
            "aralik: 2026-09-07T00:00"
        );
        assert_eq!(
            Ayrinti::SeriSilme { adet: 3, tarihten: "2026-09-21T00:00".into() }.metin(),
            "seri silme: 3 kayit, 2026-09-21T00:00 sonrasi"
        );
    }

    #[test]
    fn aralik_baslangici_bozuk_tarihi_reddeder() {
        // Dogrulanmayan bir String, kapali enum'un kapattigi kapiyi yeniden acar.
        let bozuk = Ayrinti::AralikBaslangici("COK_GIZLI_SEANS_NOTU".into());
        assert_eq!(bozuk.metin(), "aralik: gecersiz", "dogrulanmayan metin loga gecmemeli");
    }

    #[test]
    fn seri_silme_tarihi_de_dogrulanir() {
        let bozuk = Ayrinti::SeriSilme { adet: 1, tarihten: "COK_GIZLI".into() };
        assert!(!bozuk.metin().contains("COK_GIZLI"));
    }

    #[test]
    fn ayrintili_kayit_geri_okunur() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Duzenleme, "client", "7", Cihaz::Masaustu, Some(Ayrinti::Arsivlendi))
            .unwrap();
        assert_eq!(son_kayitlar(&c, 1).unwrap()[0].ayrinti.as_deref(), Some("arsivlendi"));
    }

    #[test]
    fn ayrintisiz_kayit_null_saklar() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Giris, "session", "-", Cihaz::Masaustu, None).unwrap();
        assert_eq!(son_kayitlar(&c, 1).unwrap()[0].ayrinti, None);
    }
}
