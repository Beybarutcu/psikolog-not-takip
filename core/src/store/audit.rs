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
//!
//! # KRİTİK: Hacim politikası — neyin loglanacağı (Plan 3 Görev 2)
//!
//! `audit_log` tetikleyicilerle korunuyor: satır **güncellenemez,
//! silinemez**. Bu tam olarak KVKK Karar 2018/10'un istediği şeydir — ama
//! aynı özellik gürültünün de kalıcı olması demektir. Not editörü **2
//! saniyede bir** otomatik kaydedecek; "her yazma bir log satırı" deseni bir
//! saatlik seans notunda ~1800 silinemez satır üretir. **Denetlenebilir
//! olmayan bir denetim kaydı, olmayan denetim kaydıyla aynı şeydir.** Bu
//! yüzden hacim bir ayrıntı değil, bir tasarım kısıtıdır ve kural TEK YERDE
//! — burada — yazılıdır; kod tabanındaki her yazma yolu buna uyar.
//!
//! ## Loglanır
//! - Veriyi **değiştiren** ve sonradan hesabı verilmesi gereken işlemler:
//!   oluşturma, düzenleme, silme, arşivleme, dışa aktarma.
//! - **Belirli bir danışanın dosyasına erişim** (`clients::getir`): KVKK'nın
//!   asıl sorusu "kimin dosyası, ne zaman, hangi cihazdan açıldı".
//! - Oturum olayları (giriş/çıkış, ilk kurulum): seyrek ve her biri gerçek
//!   bir olay.
//!
//! ## Loglanmaz
//! - **Gezinmenin yan etkisi olan tekrarlı okumalar**: takvim yenilemesi
//!   (`appointments::aralik_getir`), danışan listesi (`clients::listele`).
//!   Bunlar kullanıcının hangi kaydı gördüğünü değil, hangi ekranda
//!   olduğunu söyler; her mutasyondan sonra ve her hafta değişiminde
//!   yeniden çalışırlar.
//! - **Doğrulama sorguları**: `appointments::cakisanlari_bul`,
//!   `seri_cakisanlari_bul`, `seri_sayisi` — kullanıcıya veri göstermeyen,
//!   form doğrulaması sırasında (her tuş vuruşunda) çalışabilen kontroller
//!   (karar Plan 2 Görev 5'te verildi, testle korunuyor).
//! - **Ara otomatik kayıtlar**: not editörünün 2 saniyelik otomatik kaydı.
//! - **Hiçbir satırı etkilemeyen mutasyonlar**: 0 satır silen bir `DELETE`
//!   olmamış bir işlemdir; loglanırsa dışarıdan tetiklenebilir, sınırsız ve
//!   silinemez bir gürültü yolu açılır.
//!
//! ## Not kayıtları
//! Not başına, **düzenleme oturumu başına bir** satır — otomatik kayıt
//! başına değil. Bunu sağlayan mekanizma `LogHacmi::OturumBasi`'dır.
//!
//! # KRİTİK: Hacim kararı DERLEME ZAMANINDA verilir — `LogHacmi`
//!
//! Bu modülün tek yazma kapısı `kaydet`'tir ve son parametresi
//! `hacim: LogHacmi`'dir. Enum'un `Default`'u **yoktur**, `Option` da
//! değildir: her çağıran, o yazma yolunun hacim politikasının hangi tarafında
//! olduğunu (`HerCagri` mi, `OturumBasi(pencere)` mi) **açıkça** söylemek
//! zorundadır. Daha önce `kaydet` (birleştirmeyen) ve `kaydet_birlestirerek`
//! yan yana `pub` duruyordu; hangisinin kullanılacağı yalnızca **yazılı bir
//! kuraldı** ve yeni bir depo modülü (ekler, arama) yanlışını seçse hiçbir
//! şey uyarmazdı. Artık unutmak mümkün değil, `HerCagri` yazan bir satır ise
//! kod incelemesinde göze görünür.
//!
//! # KRİTİK: Birleştirme bir "yazma" kararıdır, "üzerine yazma" değil
//!
//! Birleştirme (coalescing) **asla** var olan bir satırı silerek veya
//! güncelleyerek yapılmaz. Tetikleyiciler bunu zaten reddeder ve logun tüm
//! değeri değiştirilemezliğidir. `son_kayit_yakin_mi` yalnızca **yazıp
//! yazmamaya** karar verir; bu modülde `audit_log` üzerinde `UPDATE` veya
//! `DELETE` içeren tek bir SQL ifadesi yoktur ve olmamalıdır.

use crate::store::zaman::zaman_gecerli_mi;
use rusqlite::Connection;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

/// `audit_log.ayrinti` alanına yazılabilecek kapalı değer kümesi.
///
/// Bkz. modül başlığı: hassas veri kuralı burada derleyici tarafından
/// zorlanır. Yeni varyant eklerken doğrulanmamış serbest metin taşımamaya
/// dikkat edin.
#[derive(Clone)]
pub enum Ayrinti {
    IlkKurulum,
    Arsivlendi,
    Durum(&'static str),
    AralikBaslangici(String),
    SeriSilme { adet: usize, tarihten: String },
}

/// Ham `String` alanlarini ASLA basmaz. Turetilmis `Debug` yerine elle
/// yazilmistir: `metin()` tek dogrulanmis yazma yolu olsa da, turetilmis
/// `Debug` doğrulamadan gecip ham dizgiyi basardi (bkz. modul basligi ve
/// `crypto::keyring::DataKey` icin ayni sinif bulgu). Varyant adi (ve
/// hassas olmayan sayisal alanlar) yeterlidir.
impl std::fmt::Debug for Ayrinti {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Ayrinti::IlkKurulum => write!(f, "Ayrinti::IlkKurulum"),
            Ayrinti::Arsivlendi => write!(f, "Ayrinti::Arsivlendi"),
            Ayrinti::Durum(_) => write!(f, "Ayrinti::Durum(<gizli>)"),
            Ayrinti::AralikBaslangici(_) => write!(f, "Ayrinti::AralikBaslangici(<gizli>)"),
            Ayrinti::SeriSilme { adet, .. } => f
                .debug_struct("Ayrinti::SeriSilme")
                .field("adet", adet)
                .field("tarihten", &"<gizli>")
                .finish(),
        }
    }
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

/// Bir yazma yolunun hacim politikası — bkz. modül başlığı.
///
/// `kaydet`'in son parametresidir ve **atlanamaz**: `Default` uygulanmaz,
/// `Option` değildir. Amaç, "birleştirmeli mi birleştirmesiz mi" kararını
/// yazılı bir kuraldan derleyicinin zorladığı bir seçime taşımaktır.
#[derive(Debug, Clone, Copy)]
pub enum LogHacmi {
    /// Her çağrı ayrı bir satır yazar. Veriyi **değiştiren** ve sonradan
    /// hesabı verilmesi gereken işlemler ile seyrek, gerçek kullanıcı
    /// eylemleri (danışan dosyası açmak, giriş/çıkış) buradadır.
    HerCagri,
    /// Aynı `(eylem, varlik, varlik_id)` üçlüsü için verilen dakika
    /// penceresinde **en fazla bir** satır. Kendi kendini yenileyen ekranlar
    /// ve otomatik kayıt yolları buradadır; pencere için
    /// `BIRLESTIRME_PENCERESI_DK` kullanın.
    OturumBasi(i64),
}

/// `audit_log`'a satırı fiilen yazan tek yer. `kaydet` dışından
/// çağrılamaz — hacim kararını atlayan bir yazma yolu olmamalı.
fn yaz(
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

/// Erişim logu tablosuna bir olay yazar. Hacim politikası `hacim` ile
/// **açıkça** seçilir (bkz. `LogHacmi` ve modül başlığı).
///
/// Dönen `bool`, satırın gerçekten yazılıp yazılmadığını söyler:
/// `LogHacmi::HerCagri` her zaman `true` döner, `OturumBasi` ise pencere
/// içinde zaten bir satır varsa `false`.
///
/// # Var olan satıra dokunulmaz
/// `OturumBasi`'nın "birleştirme" dediği şey, ikinci yazmadan VAZGEÇMEKtir.
/// Var olan satırın `olay_zamani`'si ilk yazımdaki değerde kalır, `id`'si
/// değişmez. Bu bilinçlidir: log değiştirilemez olduğu için değerlidir
/// (bkz. modül başlığı ve `birlestirme_var_olan_satiri_degistirmez` testi).
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
    hacim: LogHacmi,
) -> Result<bool, rusqlite::Error> {
    if let LogHacmi::OturumBasi(pencere_dk) = hacim {
        if son_kayit_yakin_mi(conn, eylem, varlik, varlik_id, pencere_dk)? {
            return Ok(false);
        }
    }
    yaz(conn, eylem, varlik, varlik_id, cihaz, ayrinti)?;
    Ok(true)
}

/// Birleştirme penceresinin varsayılan uzunluğu (dakika).
///
/// Bir düzenleme oturumu boyunca (2 saniyede bir otomatik kayıt) tek satır
/// üretmek için yeterince uzun; "sabah açtım, öğleden sonra yine açtım"
/// ayrımını koruyacak kadar kısa. 5 dakika ayrıca `session`'ın boşta kalma
/// kilidiyle (`VARSAYILAN_KILIT_SURESI_SN = 300`) aynı büyüklüktedir: oturum
/// kilitlenip yeniden açıldığında zaten yeni bir `giris` satırı yazılır ve
/// sonraki erişim de yeni bir satır alır.
pub const BIRLESTIRME_PENCERESI_DK: i64 = 5;

/// `pencere_dk` dakika öncesinin duvar-üstü UTC damgası. `simdi_utc()` ile
/// **aynı biçimi** üretir (RFC3339, saniye çözünürlüğü, `Z` ekli, 20
/// karakter): `olay_zamani` sütunu bu biçimde saklandığı için sabit uzunluklu
/// ISO8601-UTC dizgilerinde sözlüksel karşılaştırma = kronolojik
/// karşılaştırmadır, ayrıştırmaya gerek yoktur.
fn pencere_esigi(pencere_dk: i64) -> String {
    (OffsetDateTime::now_utc() - time::Duration::minutes(pencere_dk))
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

/// Aynı `(eylem, varlik, varlik_id)` üçlüsü için son `pencere_dk` dakika
/// içinde YAZILMIŞ bir kayıt var mı?
///
/// Birleştirme kararını veren **tek** fonksiyon budur. Yalnızca OKUR:
/// `audit_log` üzerinde hiçbir `UPDATE`/`DELETE` çalıştırmaz, çalıştıramaz
/// (bkz. modül başlığı — birleştirme "yazma" kararıdır, "üzerine yazma"
/// değil; tetikleyiciler de bunu zaten reddeder).
///
/// Eşleşme üçlünün TAMAMI üzerinden yapılır: farklı bir not (`varlik_id`),
/// farklı bir varlık türü (`varlik`) veya farklı bir eylem (`eylem`) asla
/// birbirini gizlemez — bir notun 30 otomatik kaydı tek satıra inerken aynı
/// pencerede o notun SİLİNMESİ ayrı bir satır yazar.
///
/// Karşılaştırma **kesin** (`>`) eşiktir: `pencere_dk = 0` "birleştirme yok"
/// anlamına gelir (eşik = şimdi; şimdi yazılmış bir satır bile pencerenin
/// İÇİNDE sayılmaz), negatif bir değer de aynı şekilde her çağrıda yazar.
pub fn son_kayit_yakin_mi(
    conn: &Connection,
    eylem: Eylem,
    varlik: &str,
    varlik_id: &str,
    pencere_dk: i64,
) -> Result<bool, rusqlite::Error> {
    let esik = pencere_esigi(pencere_dk);
    let var: i64 = conn.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM audit_log
              WHERE eylem = ?1 AND varlik = ?2 AND varlik_id = ?3 AND olay_zamani > ?4
         )",
        rusqlite::params![eylem.as_str(), varlik, varlik_id, esik],
        |r| r.get(0),
    )?;
    Ok(var != 0)
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
        kaydet(&c, Eylem::Goruntuleme, "client", "42", Cihaz::Masaustu, None, LogHacmi::HerCagri).unwrap();

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
        kaydet(&c, Eylem::Giris, "session", "-", Cihaz::Masaustu, None, LogHacmi::HerCagri).unwrap();
        let z = &son_kayitlar(&c, 1).unwrap()[0].olay_zamani;
        assert!(z.ends_with('Z'), "zaman UTC olmali: {z}");
        assert_eq!(z.len(), 20, "ornek: 2026-09-07T10:00:00Z");
    }

    #[test]
    fn kayitlar_en_yeniden_eskiye_siralanir() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Giris, "session", "1", Cihaz::Masaustu, None, LogHacmi::HerCagri).unwrap();
        kaydet(&c, Eylem::Cikis, "session", "2", Cihaz::Masaustu, None, LogHacmi::HerCagri).unwrap();
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
    fn ayrinti_debug_ciktisi_ham_dizgiyi_icermez() {
        // Bulgu: turetilmis `Debug`, `metin()`'in yaptigi bicim
        // dogrulamasini atlayip ham dizgiyi basardi. Elle yazilan `Debug`
        // artik ham `String` alanlarini hic yazdirmiyor; bu test hem
        // `AralikBaslangici` hem `SeriSilme` icin bunu dogrular.
        let aralik = Ayrinti::AralikBaslangici("COK_GIZLI_SEANS_NOTU".into());
        let debug_metni = format!("{aralik:?}");
        assert!(
            !debug_metni.contains("COK_GIZLI_SEANS_NOTU"),
            "Debug ciktisi ham dizgiyi icermemeli: {debug_metni}"
        );

        let seri = Ayrinti::SeriSilme { adet: 3, tarihten: "COK_GIZLI_TARIH".into() };
        let debug_metni = format!("{seri:?}");
        assert!(
            !debug_metni.contains("COK_GIZLI_TARIH"),
            "Debug ciktisi ham dizgiyi icermemeli: {debug_metni}"
        );
    }

    #[test]
    fn ayrintili_kayit_geri_okunur() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Duzenleme, "client", "7", Cihaz::Masaustu, Some(Ayrinti::Arsivlendi), LogHacmi::HerCagri)
            .unwrap();
        assert_eq!(son_kayitlar(&c, 1).unwrap()[0].ayrinti.as_deref(), Some("arsivlendi"));
    }

    #[test]
    fn ayrintisiz_kayit_null_saklar() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Giris, "session", "-", Cihaz::Masaustu, None, LogHacmi::HerCagri).unwrap();
        assert_eq!(son_kayitlar(&c, 1).unwrap()[0].ayrinti, None);
    }

    // --- Plan 3 Gorev 2: hacim politikasi / birlestirme ------------------
    //
    // Bu testler kurali KANITLAR, varligini degil: hepsi SAYAR ve TAM
    // ESITLIK iddia eder ("en az 1" degil). Sebep: birlestirme yanlis
    // uygulanirsa (ornegin hic birlestirmezse) "en az 1" testi yine gecerdi
    // -- bu kod tabaninda alti kez tekrarlanan "test yesil ama hicbir sey
    // korumuyor" hata sinifi.

    fn log_sayisi(c: &rusqlite::Connection) -> i64 {
        c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap()
    }

    /// `dk_once` dakika onceye ait bir log satirini DOGRUDAN (kaydet'i
    /// kullanmadan) yazar. `audit_log`'a INSERT serbesttir; yasak olan
    /// UPDATE/DELETE'tir. Pencerenin gercekten ZAMANA bagli oldugunu
    /// kanitlamak icin gerekiyor: var olan bir satirin zamanini geri almak
    /// (UPDATE) tetikleyici tarafindan -- dogru olarak -- reddedilir.
    fn eski_satir_ekle(
        c: &rusqlite::Connection,
        eylem: Eylem,
        varlik: &str,
        varlik_id: &str,
        dk_once: i64,
    ) -> String {
        let zaman = pencere_esigi(dk_once);
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti)
             VALUES (?1, ?2, ?3, ?4, 'masaustu', NULL)",
            rusqlite::params![zaman, eylem.as_str(), varlik, varlik_id],
        )
        .unwrap();
        zaman
    }

    #[test]
    fn otuz_otomatik_kayit_tam_olarak_bir_satir_uretir() {
        // Not editorunun 2 saniyelik otomatik kaydi: bir dakikalik yazma
        // 30 cagri demektir. Sonuc TAM OLARAK 1 satir olmali.
        let (_d, c) = baglanti();
        assert_eq!(log_sayisi(&c), 0, "on kosul: log bos baslamali");

        let mut yazilan = 0;
        for _ in 0..30 {
            if kaydet(
                &c,
                Eylem::Duzenleme,
                "note",
                "5",
                Cihaz::Masaustu,
                None,
                LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
            )
            .unwrap()
            {
                yazilan += 1;
            }
        }

        assert_eq!(yazilan, 1, "30 cagridan yalnizca ILKI yazmali");
        assert_eq!(log_sayisi(&c), 1, "30 otomatik kayit tam olarak 1 satir uretmeli");
    }

    #[test]
    fn birlestirme_var_olan_satiri_degistirmez() {
        // Logun tum degeri degistirilemezliginde. Birlestirme "uzerine
        // yazma" degil, "yazmama" karari oldugu icin pencere icindeki 30
        // cagridan sonra AYAKTA KALAN satir hala ILK yazmanin satiridir:
        // ayni id, ayni olay_zamani.
        let (_d, c) = baglanti();
        let ilk_zaman = eski_satir_ekle(&c, Eylem::Duzenleme, "note", "5", 2);
        let ilk_id: i64 = c.query_row("SELECT id FROM audit_log", [], |r| r.get(0)).unwrap();

        for _ in 0..30 {
            kaydet(
                &c,
                Eylem::Duzenleme,
                "note",
                "5",
                Cihaz::Masaustu,
                None,
                LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
            )
            .unwrap();
        }

        assert_eq!(log_sayisi(&c), 1, "pencere icinde yeni satir olusmamali");
        let (id, zaman): (i64, String) = c
            .query_row("SELECT id, olay_zamani FROM audit_log", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(id, ilk_id, "ayakta kalan satir ILK satir olmali (yeni satir degil)");
        assert_eq!(
            zaman, ilk_zaman,
            "var olan satirin zaman degeri ilk yazimdaki degerde kalmali"
        );
    }

    #[test]
    fn pencere_gectikten_sonra_yeni_satir_yazilir() {
        // Birlestirme logu TAMAMEN susturmuyor: pencere gecince erisim
        // yeniden gorunur olur. Aksi halde "denetlenebilir olmayan log"
        // sorununu "hic olmayan log" ile degistirmis olurduk.
        let (_d, c) = baglanti();
        let eski_zaman = eski_satir_ekle(&c, Eylem::Duzenleme, "note", "5", 10);

        assert!(
            !son_kayit_yakin_mi(&c, Eylem::Duzenleme, "note", "5", BIRLESTIRME_PENCERESI_DK)
                .unwrap(),
            "10 dakika onceki satir 5 dakikalik pencerenin DISINDA olmali"
        );
        assert!(
            son_kayit_yakin_mi(&c, Eylem::Duzenleme, "note", "5", 15).unwrap(),
            "ayni satir 15 dakikalik pencerenin ICINDE olmali -- esik gercekten zamana bagli"
        );

        let yazildi = kaydet(
            &c,
            Eylem::Duzenleme,
            "note",
            "5",
            Cihaz::Masaustu,
            None,
            LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
        )
        .unwrap();

        assert!(yazildi, "pencere gectikten sonra yeni satir yazilmali");
        assert_eq!(log_sayisi(&c), 2, "eski satir korunur, yenisi eklenir");
        let eski_hala_var: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE olay_zamani = ?1",
                [&eski_zaman],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(eski_hala_var, 1, "eski satir silinmemis/degismemis olmali");
    }

    #[test]
    fn birlestirme_farkli_bir_notu_gizlemez() {
        let (_d, c) = baglanti();
        for _ in 0..30 {
            kaydet(&c, Eylem::Duzenleme, "note", "5", Cihaz::Masaustu, None, LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)).unwrap();
        }
        assert_eq!(log_sayisi(&c), 1);

        // AYNI pencere icinde BASKA bir nota yazmak ayri satir uretmeli.
        let yazildi = kaydet(&c, Eylem::Duzenleme, "note", "6", Cihaz::Masaustu, None, LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)).unwrap();
        assert!(yazildi, "farkli bir not ayri satir yazmali");
        assert_eq!(log_sayisi(&c), 2);
    }

    #[test]
    fn birlestirme_farkli_bir_eylemi_gizlemez() {
        let (_d, c) = baglanti();
        for _ in 0..30 {
            kaydet(&c, Eylem::Duzenleme, "note", "5", Cihaz::Masaustu, None, LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)).unwrap();
        }
        assert_eq!(log_sayisi(&c), 1);

        // AYNI notta AYNI pencere icinde SILME ayri satir uretmeli --
        // yoksa birlestirme, hesabi verilmesi gereken bir islemi orterdi.
        let yazildi = kaydet(&c, Eylem::Silme, "note", "5", Cihaz::Masaustu, None, LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)).unwrap();
        assert!(yazildi, "ayni notta farkli eylem ayri satir yazmali");
        assert_eq!(log_sayisi(&c), 2);

        let eylemler: Vec<String> =
            son_kayitlar(&c, 10).unwrap().into_iter().map(|k| k.eylem).collect();
        assert!(eylemler.contains(&"silme".to_string()));
        assert!(eylemler.contains(&"duzenleme".to_string()));
    }

    #[test]
    fn birlestirme_farkli_bir_varligi_gizlemez() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Duzenleme, "note", "5", Cihaz::Masaustu, None, LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)).unwrap();
        // Ayni id, farkli varlik turu: "5 numarali not" ile "5 numarali
        // randevu" ayni sey degildir.
        let yazildi = kaydet(&c, Eylem::Duzenleme, "appointment", "5", Cihaz::Masaustu, None, LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)).unwrap();
        assert!(yazildi);
        assert_eq!(log_sayisi(&c), 2);
    }

    #[test]
    fn sifir_pencere_hicbir_seyi_birlestirmez() {
        // `pencere_dk = 0` "birlestirme yok" demektir: esik tam olarak
        // SIMDI'dir ve karsilastirma kesin (`>`) oldugu icin ayni saniyede
        // yazilmis bir satir bile pencerenin icinde sayilmaz. Bu, kesin
        // esik davranisinin sinir testi.
        let (_d, c) = baglanti();
        for _ in 0..5 {
            assert!(
                kaydet(&c, Eylem::Duzenleme, "note", "5", Cihaz::Masaustu, None, LogHacmi::OturumBasi(0))
                    .unwrap(),
                "pencere 0 iken her cagri yazmali"
            );
        }
        assert_eq!(log_sayisi(&c), 5);
    }

    #[test]
    fn bos_logda_ilk_kayit_her_zaman_yazilir() {
        let (_d, c) = baglanti();
        assert!(
            !son_kayit_yakin_mi(&c, Eylem::Duzenleme, "note", "5", BIRLESTIRME_PENCERESI_DK)
                .unwrap(),
            "hic kayit yokken 'yakin kayit var' denemez"
        );
        assert!(kaydet(&c, Eylem::Duzenleme, "note", "5", Cihaz::Masaustu, None, LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)).unwrap());
        assert_eq!(log_sayisi(&c), 1);
    }

    #[test]
    fn birlestirme_asla_update_veya_delete_denemez() {
        // Tetikleyiciler her UPDATE/DELETE'i ABORT ile reddeder. Bu test,
        // birlestirmenin bunlara HIC basvurmadigini davranissal olarak
        // kanitlar: eger `LogHacmi::OturumBasi` var olan satiri
        // guncellemeye/silmeye calissaydi cagri Err donerdi.
        let (_d, c) = baglanti();
        eski_satir_ekle(&c, Eylem::Duzenleme, "note", "5", 1);

        // On kosul: tetikleyiciler gercekten aktif.
        assert!(c.execute("UPDATE audit_log SET eylem='silme'", []).is_err());
        assert!(c.execute("DELETE FROM audit_log", []).is_err());

        for _ in 0..30 {
            kaydet(&c, Eylem::Duzenleme, "note", "5", Cihaz::Masaustu, None, LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK))
                .expect("birlestirme hicbir UPDATE/DELETE denememeli");
        }
        assert_eq!(log_sayisi(&c), 1);
    }
}
