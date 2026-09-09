//! Seans notu deposu — resmî not (`progress_notes`) ve terapistin özel notu
//! (`private_notes`).
//!
//! # KRİTİK: İki not türü AYRI TABLOLARDA tutulur
//!
//! Özel notlar hiçbir dışa aktarım sorgusuna, hiçbir rapora ve hiçbir liste
//! uç noktasına dahil edilmez. **Bunu sağlayan tek mekanizma ayrı tablo
//! olmasıdır**; bir `WHERE gizli = 0` filtresine güvenilmez — unutulan tek
//! bir sorgu koruma sözünü bozar (bkz. `schema.rs` V3 başlığı, aynı gerekçe).
//!
//! Bu modülde kural şöyle uygulanır:
//! - `danisan_notlari` **yalnızca `progress_notes`** tablosunu sorgular. Özel
//!   notu dışarıda bırakan bir `WHERE` koşulu **yoktur ve olmamalıdır**:
//!   dışlayıcı `WHERE` deseni (kod tabanındaki tek örneği
//!   `appointments::cakisanlari_bul`'daki `durum != 'iptal'`) buraya
//!   kopyalanmaz. Şablon kopyalanır, arkasındaki muhakeme kopyalanmaz —
//!   burada o hatanın bedeli özel notun sızmasıdır.
//! - Özel nota erişen **her** fonksiyonun adında `ozel` geçer
//!   (`ozel_not_getir`, `ozel_not_kaydet`); resmî not fonksiyonlarında
//!   (`not_getir`, `not_kaydet`, `danisan_notlari`) geçmez. İki yolu
//!   karıştırmak isim düzeyinde imkânsızdır.
//!
//! # KRİTİK: Not içeriği erişim loguna ASLA yazılmaz
//!
//! `audit_log` tetikleyicilerle korunur: satır güncellenemez, **silinemez**.
//! Oraya düşen bir not içeriği kalıcıdır. Bu modül `audit`'e yalnızca
//! (eylem, varlık türü, randevu kimliği, cihaz) geçirir; `ayrinti` her zaman
//! `None`'dır. Not içeriği bir yana, **not başlığı ve şablon adı bile**
//! loga girmez — log yalnızca "hangi notu, ne zaman, hangi cihazdan"
//! sorusunu yanıtlar (bkz. `store::audit` modül başlığı).
//!
//! # KRİTİK: Hacim politikası — `HerCagri` DEĞİL, `OturumBasi`
//!
//! Not editörü **2 saniyede bir** otomatik kaydeder. `LogHacmi::HerCagri`
//! kullanılsaydı bir saatlik seans ~1800 **silinemez** log satırı üretirdi ve
//! denetim kaydı okunamaz hâle gelirdi. Kural (`store::audit` modül başlığı):
//! *not başına, düzenleme oturumu başına bir satır — otomatik kayıt başına
//! değil.*
//!
//! Bu modüldeki **beş** log çağrısının hepsi
//! `LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)` kullanır; seçim artık
//! yazılı bir kural değil, derleyicinin zorladığı bir parametredir (bkz.
//! `audit::LogHacmi`). Kural ayrıca testlerle sabitlenir: 30 ardışık kayıt
//! **tam olarak 1** log satırı üretir (eşitlik, "en az 1" değil).
//!
//! Görüntüleme de birleştirilir. `clients::getir` bilerek birleştirilmiyor
//! (her çağrı bir danışan dosyasının açılmasıdır) ama not editörü **kendi
//! kendini yenileyen** bir ekrandır — `clients::getir` doküman yorumunda
//! "Plan 3'te danışan dosyası ekranı kendi kendini yenileyen bir yola
//! dönüşürse bu karar o görevde yeniden verilmeli" denerek bu karar buraya
//! bırakılmıştı. Pencere 5 dakika olduğu için "sabah açtım, öğleden sonra
//! yine açtım" ayrımı korunur; kaybolan şey yalnızca aynı oturumdaki
//! tekrarlı okumadır.
//!
//! Birleştirme **asla** var olan bir satırı silmez veya güncellemez: bu
//! modülde `audit_log` üzerinde `UPDATE`/`DELETE` içeren tek bir SQL ifadesi
//! yoktur (davranışsal kanıt:
//! `not_deposu_audit_log_uzerinde_update_veya_delete_denemez`).
//!
//! # Yazma + log aynı transaction'da
//!
//! `not_kaydet` ve `ozel_not_kaydet` veriyi değiştirir; ikisi de tabloya
//! yazdıktan hemen sonra log kaydını **aynı** `conn.unchecked_transaction()`
//! içinde yapar ve açıkça `commit()` eder. Log yazımı başarısız olursa not
//! da geri alınır: "not kaydedildi ama loglanmadı" durumu oluşmaz. Not
//! editörü 2 saniyede bir yazdığı için kısmi başarısızlık bu katmanda
//! istisna değil, sık karşılaşılacak bir durumdur. Garanti `audit_log`
//! tablosu kasten düşürülerek test edilir (`..._atomik_...` testleri) —
//! desen `clients.rs` ve `appointments.rs` ile birebir aynıdır.
//!
//! # UYARI — iç içe transaction açılamaz
//!
//! `not_kaydet` ve `ozel_not_kaydet` kendi `unchecked_transaction()`'ını
//! içeride açar. SQLite iç içe transaction'ı desteklemez ("cannot start a
//! transaction within a transaction"): bu iki fonksiyonu **başka bir
//! transaction'ın içinden** çağırmayın. Bu sessiz bir veri bozulması değil,
//! `rusqlite::Error` olarak dönen gürültülü bir hatadır — ama derleyici
//! yakalamaz.

use crate::store::audit::{kaydet, Cihaz, Eylem, LogHacmi, BIRLESTIRME_PENCERESI_DK};
use crate::store::clients::DepoHatasi;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

/// Not şablonu kodlarının **kapalı** kümesi.
///
/// `schema.rs` V3'te hem `progress_notes.sablon` hem `templates.kod` aynı
/// kümeyi `CHECK` ile taşır. Kullanıcı şablonların **içeriğini**
/// (başlıklarını) düzenler, yeni bir **tür** eklemez; bu yüzden burada
/// uygulama katmanı doğrulaması veritabanı `CHECK`'inin önüne konur —
/// böylece geçersiz şablon `DepoHatasi::GecersizVeri` olarak (anlaşılır bir
/// mesajla) reddedilir, ham SQLite kısıt hatası olarak değil.
pub const GECERLI_SABLONLAR: [&str; 3] = ["dap", "soap", "serbest"];

/// Varsayılan şablon: henüz notu olmayan bir randevu DAP ile açılır.
pub const VARSAYILAN_SABLON: &str = "dap";

/// `audit_log.varlik` değeri — resmî not.
const VARLIK_RESMI: &str = "progress_note";
/// `audit_log.varlik` değeri — özel not. Resmî nottan **ayrı** bir varlık
/// adıdır: aynı randevunun resmî ve özel notuna erişim log üzerinde
/// birbirinden ayırt edilebilmelidir (ve birleştirme birini diğerinin
/// arkasına saklayamamalıdır).
const VARLIK_OZEL: &str = "private_note";

/// Bir randevuya bağlı **resmî** seans notu.
///
/// `Debug` türetilmiyor. Gerekçe bu kod tabanında üç kez tekrarlanmış bir
/// bulgudur (`crypto::keyring::DataKey`, `audit::Ayrinti`,
/// `appointments::Randevu`): türetilmiş `Debug`, `{:?}` ile bir panik
/// mesajına, bir hata satırına veya bir loga ham içeriği basar. `icerik`
/// KVKK'da **özel nitelikli** kişisel veridir; `client_id` ise bir notun
/// varlığıyla birleştiğinde "42 numaralı danışan terapide" bilgisini verir
/// (`Randevu::Debug` ile aynı muhakeme). İkisi de `<gizli>` basılır.
/// `Serialize` ise arayüz için **tüm** alanları içerir — ayrım kasıtlıdır:
/// arayüzün veriye ihtiyacı var, panik mesajının yok.
#[derive(Clone, Serialize)]
pub struct SeansNotu {
    pub appointment_id: i64,
    pub client_id: i64,
    pub sablon: String,
    pub icerik: String,
    pub guncelleme_zamani: String,
}

impl std::fmt::Debug for SeansNotu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SeansNotu")
            .field("appointment_id", &self.appointment_id)
            .field("client_id", &"<gizli>")
            .field("sablon", &self.sablon)
            .field("icerik", &"<gizli>")
            .field("guncelleme_zamani", &self.guncelleme_zamani)
            .finish()
    }
}

/// Terapistin **yalnızca kendisi için** tuttuğu özel not.
///
/// Dışa aktarıma, rapora ve liste uç noktalarına girmez (bkz. modül
/// başlığı). `Debug` `SeansNotu` ile aynı gerekçeyle elle yazılır ve
/// `icerik` asla basılmaz.
#[derive(Clone, Serialize)]
pub struct OzelNot {
    pub appointment_id: i64,
    pub icerik: String,
    pub guncelleme_zamani: String,
}

impl std::fmt::Debug for OzelNot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OzelNot")
            .field("appointment_id", &self.appointment_id)
            .field("icerik", &"<gizli>")
            .field("guncelleme_zamani", &self.guncelleme_zamani)
            .finish()
    }
}

fn simdi() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

/// Randevunun danışanını bulur; randevu yoksa `Bulunamadi`.
fn randevunun_danisani(conn: &Connection, appointment_id: i64) -> Result<i64, DepoHatasi> {
    conn.query_row("SELECT client_id FROM appointments WHERE id = ?1", [appointment_id], |r| {
        r.get(0)
    })
    .optional()?
    .ok_or(DepoHatasi::Bulunamadi)
}

/// Bir randevunun resmî seans notunu okur. **Not yoksa boş bir not döner**,
/// hata değil: editör açılırken "kayıt bulunamadı" göstermek anlamsızdır.
///
/// Log: `goruntuleme` / `progress_note` / randevu kimliği, birleştirilerek
/// (bkz. modül başlığı). İçerik loga **yazılmaz**.
pub fn not_getir(
    conn: &Connection,
    appointment_id: i64,
    cihaz: Cihaz,
) -> Result<SeansNotu, DepoHatasi> {
    let client_id = randevunun_danisani(conn, appointment_id)?;

    let mevcut = conn
        .query_row(
            "SELECT sablon, icerik, guncelleme_zamani FROM progress_notes WHERE appointment_id = ?1",
            [appointment_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .optional()?;

    // Log yalnizca HANGI notun goruntulendigini tutar; icerik ASLA loglanmaz.
    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK_RESMI,
        &appointment_id.to_string(),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;

    Ok(match mevcut {
        Some((sablon, icerik, zaman)) => {
            SeansNotu { appointment_id, client_id, sablon, icerik, guncelleme_zamani: zaman }
        }
        None => SeansNotu {
            appointment_id,
            client_id,
            sablon: VARSAYILAN_SABLON.to_string(),
            icerik: String::new(),
            guncelleme_zamani: simdi(),
        },
    })
}

/// Resmî seans notunu yazar (upsert: randevu başına tek not — kural
/// `progress_notes.appointment_id` UNIQUE ile veritabanı seviyesinde).
///
/// Yazma ve log **tek transaction**'da yapılır; log başarısız olursa not da
/// geri alınır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar — bunu zaten açık
/// bir transaction'ın içinden çağırmayın (bkz. modül başlığındaki uyarı).
pub fn not_kaydet(
    conn: &Connection,
    appointment_id: i64,
    sablon: &str,
    icerik: &str,
    cihaz: Cihaz,
) -> Result<SeansNotu, DepoHatasi> {
    if !GECERLI_SABLONLAR.contains(&sablon) {
        // Sablon adi loga girmez; yalnizca cagirana donen hata mesajinda yer alir.
        return Err(DepoHatasi::GecersizVeri(format!("Geçersiz not şablonu: {sablon}")));
    }
    let client_id = randevunun_danisani(conn, appointment_id)?;
    let zaman = simdi();

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(appointment_id) DO UPDATE SET
             sablon = excluded.sablon,
             icerik = excluded.icerik,
             guncelleme_zamani = excluded.guncelleme_zamani",
        rusqlite::params![appointment_id, client_id, sablon, icerik, zaman],
    )?;

    // Otomatik kayit basina DEGIL, duzenleme oturumu basina bir satir.
    kaydet(
        &tx,
        Eylem::Duzenleme,
        VARLIK_RESMI,
        &appointment_id.to_string(),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;

    tx.commit()?;

    Ok(SeansNotu {
        appointment_id,
        client_id,
        sablon: sablon.to_string(),
        icerik: icerik.to_string(),
        guncelleme_zamani: zaman,
    })
}

/// Terapistin özel notunu okur. Not yoksa boş bir not döner, hata değil.
///
/// Yalnızca `private_notes` tablosuna bakar; `progress_notes`'a hiç
/// dokunmaz.
pub fn ozel_not_getir(
    conn: &Connection,
    appointment_id: i64,
    cihaz: Cihaz,
) -> Result<OzelNot, DepoHatasi> {
    randevunun_danisani(conn, appointment_id)?;

    let mevcut = conn
        .query_row(
            "SELECT icerik, guncelleme_zamani FROM private_notes WHERE appointment_id = ?1",
            [appointment_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?;

    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK_OZEL,
        &appointment_id.to_string(),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;

    Ok(match mevcut {
        Some((icerik, zaman)) => OzelNot { appointment_id, icerik, guncelleme_zamani: zaman },
        None => OzelNot { appointment_id, icerik: String::new(), guncelleme_zamani: simdi() },
    })
}

/// Terapistin özel notunu yazar (upsert). Yalnızca `private_notes`
/// tablosuna yazar — özel notun resmî not tablosuna düşmesi mümkün değildir.
///
/// Yazma ve log **tek transaction**'da yapılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar — bunu zaten açık
/// bir transaction'ın içinden çağırmayın (bkz. modül başlığındaki uyarı).
pub fn ozel_not_kaydet(
    conn: &Connection,
    appointment_id: i64,
    icerik: &str,
    cihaz: Cihaz,
) -> Result<OzelNot, DepoHatasi> {
    let client_id = randevunun_danisani(conn, appointment_id)?;
    let zaman = simdi();

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO private_notes (appointment_id, client_id, icerik, guncelleme_zamani)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(appointment_id) DO UPDATE SET
             icerik = excluded.icerik,
             guncelleme_zamani = excluded.guncelleme_zamani",
        rusqlite::params![appointment_id, client_id, icerik, zaman],
    )?;

    kaydet(
        &tx,
        Eylem::Duzenleme,
        VARLIK_OZEL,
        &appointment_id.to_string(),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;

    tx.commit()?;

    Ok(OzelNot { appointment_id, icerik: icerik.to_string(), guncelleme_zamani: zaman })
}

/// Bir danışanın **resmî** seans notlarını en yeniden en eskiye listeler.
///
/// # DİKKAT: bu sorgu YALNIZCA `progress_notes` okur
/// `private_notes` tablosuna ne `JOIN`'lenir ne `UNION`'lanır. Özel notun
/// dışarıda kalması bir `WHERE` koşulunun değil, **sorgunun hangi tabloya
/// baktığının** sonucudur — dışlayıcı filtre deseni (bkz. modül başlığı)
/// bilinçli olarak kullanılmaz.
///
/// # KRİTİK: danışan filtresi `appointments`'tan okunur, notun kopyasından değil
/// `progress_notes.client_id` **denormalize bir kopyadır**; yetkili kaynak
/// randevunun kendisidir (`appointments.client_id`). `appointments::guncelle`
/// bir randevuyu başka bir danışana taşıyabilir (arayüzde `RandevuPaneli`
/// danışan seçimini düzenlenebilir tutar ve `client_id`'yi PUT eder) ve o yol
/// `progress_notes.client_id`'ye **dokunmaz** — üretim kodunda o sütunu
/// güncelleyen hiçbir şey yoktur. Filtre kopyadan yapılsaydı "randevuyu
/// yanlış danışana girmişim, düzelteyim" gibi tamamen olağan bir eylemden
/// sonra **B'nin seans notunun tam içeriği A'nın dosyasında listelenir**,
/// B'nin dosyasında kaybolurdu; hem de sessizce. Ayrı tablo garantisi
/// resmî/özel ekseninde koruyor, bu delik **danışan ekseninde**ydi.
///
/// Bu yüzden hem `WHERE` hem dönen `client_id` `a.` (randevu) üzerinden
/// okunur. Aynı kural özel not listesi eklenirse de geçerlidir. Testle
/// korunur: `randevu_baska_danisana_tasininca_not_da_tasinir`.
///
/// # `limit`
/// Doğrudan `LIMIT`'e geçer ve burada **doğrulanmaz**: negatif bir değer
/// (`-1`) SQLite'ta "sınırsız" demektir, yani çağıran taraf sınır koymamış
/// olur. Bu bilinçli: depo katmanı çağıranın limitine karışmaz. Sınırı
/// koymak rotanın işidir (Görev 7).
///
/// Log: liste görüntülemeleri birleştirilir, ama `varlik_id` **hangi
/// danışanın** listesi olduğunu taşır (`liste:<client_id>`). Sabit bir
/// `"liste"` kimliği kullanılsaydı birleştirme, farklı danışanların
/// dosyalarına erişimi tek satırın arkasına saklardı — `audit`'in
/// "birleştirme farklı bir kaydı gizlemez" kuralının ihlali olurdu.
pub fn danisan_notlari(
    conn: &Connection,
    client_id: i64,
    limit: i64,
    cihaz: Cihaz,
) -> Result<Vec<SeansNotu>, DepoHatasi> {
    let mut stmt = conn.prepare(
        "SELECT p.appointment_id, a.client_id, p.sablon, p.icerik, p.guncelleme_zamani
         FROM progress_notes p
         JOIN appointments a ON a.id = p.appointment_id
         WHERE a.client_id = ?1
         ORDER BY a.baslangic DESC, p.appointment_id DESC
         LIMIT ?2",
    )?;
    let notlar = stmt
        .query_map(rusqlite::params![client_id, limit], |r| {
            Ok(SeansNotu {
                appointment_id: r.get(0)?,
                client_id: r.get(1)?,
                sablon: r.get(2)?,
                icerik: r.get(3)?,
                guncelleme_zamani: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK_RESMI,
        &format!("liste:{client_id}"),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;
    Ok(notlar)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        appointments::{
            guncelle as randevu_guncelle, olustur as randevu_olustur, RandevuGuncelleme,
            YeniRandevu,
        },
        audit::son_kayitlar,
        clients::{ekle as danisan_ekle, YeniDanisan},
        db::open_encrypted,
        schema::migrate,
    };

    fn kurulum() -> (tempfile::TempDir, rusqlite::Connection, i64, i64) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        let d = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ayse Yilmaz".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        let r = randevu_olustur(
            &c,
            &YeniRandevu {
                client_id: d.id,
                baslangic: "2026-09-07T14:00".into(),
                bitis: "2026-09-07T15:00".into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();
        (dir, c, d.id, r.id)
    }

    /// Belirli bir (eylem, varlik, varlik_id) ucluSU icin log satiri sayisi.
    /// Kurulumun (danisan ekleme, randevu ekleme) urettigi satirlari
    /// disarida birakmak icin daraltilmis sayim sart.
    fn log_sayisi(
        c: &rusqlite::Connection,
        eylem: &str,
        varlik: &str,
        varlik_id: &str,
    ) -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM audit_log
              WHERE eylem = ?1 AND varlik = ?2 AND varlik_id = ?3",
            [eylem, varlik, varlik_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    // --- Brief'in dokuz testi -------------------------------------------

    #[test]
    fn olmayan_not_bos_olarak_doner_hata_degil() {
        let (_d, c, _cid, rid) = kurulum();
        let not = not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        assert_eq!(not.icerik, "");
        assert_eq!(not.sablon, "dap", "varsayilan sablon DAP olmali");
    }

    #[test]
    fn not_kaydedilir_ve_geri_okunur() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "Danisan bugun daha iyiydi.", Cihaz::Masaustu).unwrap();
        let not = not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        assert_eq!(not.icerik, "Danisan bugun daha iyiydi.");
    }

    #[test]
    fn ikinci_kayit_ustune_yazar_yeni_satir_acmaz() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "ilk", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, rid, "dap", "ikinci", Cihaz::Masaustu).unwrap();

        let sayi: i64 =
            c.query_row("SELECT count(*) FROM progress_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 1);
        assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().icerik, "ikinci");
    }

    #[test]
    fn gecersiz_sablon_reddedilir() {
        let (_d, c, _cid, rid) = kurulum();
        let hata = not_kaydet(&c, rid, "benim_sablonum", "x", Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));

        // Reddedilen cagri HICBIR sey yazmamali: ne not, ne log satiri.
        let sayi: i64 =
            c.query_row("SELECT count(*) FROM progress_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 0, "gecersiz sablon hicbir not satiri birakmamali");
        assert_eq!(
            log_sayisi(&c, "duzenleme", VARLIK_RESMI, &rid.to_string()),
            0,
            "reddedilen kayit log satiri uretmemeli"
        );
    }

    #[test]
    fn ozel_not_resmi_nottan_bagimsiz_saklanir() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "resmi icerik", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "kendi hipotezim", Cihaz::Masaustu).unwrap();

        assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().icerik, "resmi icerik");
        assert_eq!(ozel_not_getir(&c, rid, Cihaz::Masaustu).unwrap().icerik, "kendi hipotezim");
    }

    #[test]
    fn danisan_notlari_yalnizca_resmi_notlari_dondurur() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "resmi icerik", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "GIZLI_HIPOTEZ", Cihaz::Masaustu).unwrap();

        let notlar = danisan_notlari(&c, cid, 50, Cihaz::Masaustu).unwrap();
        assert_eq!(notlar.len(), 1);
        // len == 1 iddiasinin bos vektorle tatmin edilmesi mumkun degil; ustelik
        // donen TEK satirin resmi not oldugunu da acikca dogruluyoruz. Bu ikisi
        // olmadan asagidaki "GIZLI_HIPOTEZ yok" iddiasi bos liste tarafindan
        // tatmin edilirdi -- totoloji.
        assert_eq!(notlar[0].icerik, "resmi icerik");
        assert!(
            !notlar.iter().any(|n| n.icerik.contains("GIZLI_HIPOTEZ")),
            "ozel not danisan not listesine sizmamali"
        );
    }

    #[test]
    fn danisan_notlari_en_yeniden_eskiye_siralanir() {
        let (_d, c, cid, rid1) = kurulum();
        let r2 = randevu_olustur(
            &c,
            &YeniRandevu {
                client_id: cid,
                baslangic: "2026-09-14T14:00".into(),
                bitis: "2026-09-14T15:00".into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();

        not_kaydet(&c, rid1, "dap", "eski", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, r2.id, "dap", "yeni", Cihaz::Masaustu).unwrap();

        let notlar = danisan_notlari(&c, cid, 50, Cihaz::Masaustu).unwrap();
        assert_eq!(notlar.len(), 2, "iki notun ikisi de donmeli");
        assert_eq!(notlar[0].icerik, "yeni");
        assert_eq!(notlar[1].icerik, "eski");
    }

    #[test]
    fn not_icerigi_erisim_loguna_yazilmaz() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "COK_GIZLI_SEANS_ICERIGI", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "COK_GIZLI_OZEL_NOT", Cihaz::Masaustu).unwrap();
        // Okuma yollari da loga yaziyor; onlar da denetlenmeli.
        not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        ozel_not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        danisan_notlari(&c, cid, 50, Cihaz::Masaustu).unwrap();

        let kayitlar = son_kayitlar(&c, 100).unwrap();
        assert!(!kayitlar.is_empty(), "on kosul: denetlenecek log satiri olmali");
        for kayit in kayitlar {
            let hepsi =
                format!("{} {} {} {:?}", kayit.eylem, kayit.varlik, kayit.varlik_id, kayit.ayrinti);
            assert!(!hepsi.contains("COK_GIZLI"), "not icerigi loga sizmis: {hepsi}");
        }
    }

    #[test]
    fn ozel_not_erisimi_ayri_varlik_adiyla_loglanir() {
        let (_d, c, _cid, rid) = kurulum();
        ozel_not_kaydet(&c, rid, "x", Cihaz::Masaustu).unwrap();
        let varliklar: Vec<String> =
            son_kayitlar(&c, 20).unwrap().into_iter().map(|k| k.varlik).collect();
        assert!(varliklar.contains(&"private_note".to_string()));
        assert!(
            !varliklar.contains(&"progress_note".to_string()),
            "ozel not yazmak resmi not varligi adina log yazmamali"
        );
    }

    // --- Hacim politikasi (Plan 3 Gorev 2 kurali) -----------------------
    //
    // Bu testler SAYAR ve TAM ESITLIK iddia eder ("en az 1" degil). Sebep:
    // `LogHacmi::OturumBasi` yerine `HerCagri` secilseydi "en az 1" testi
    // yine gecerdi.

    #[test]
    fn otuz_otomatik_kayit_tam_olarak_bir_log_satiri_uretir() {
        let (_d, c, _cid, rid) = kurulum();
        let id = rid.to_string();
        assert_eq!(
            log_sayisi(&c, "duzenleme", VARLIK_RESMI, &id),
            0,
            "on kosul: henuz not kaydedilmedi"
        );

        // Not editoru 2 saniyede bir yazar: bir dakikalik yazma 30 cagridir.
        for i in 0..30 {
            not_kaydet(&c, rid, "dap", &format!("taslak {i}"), Cihaz::Masaustu).unwrap();
        }

        assert_eq!(
            log_sayisi(&c, "duzenleme", VARLIK_RESMI, &id),
            1,
            "30 otomatik kayit TAM OLARAK 1 log satiri uretmeli"
        );
        // Not yine de her seferinde gercekten yazildi.
        assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().icerik, "taslak 29");
    }

    #[test]
    fn ozel_notun_otuz_otomatik_kaydi_tam_olarak_bir_log_satiri_uretir() {
        let (_d, c, _cid, rid) = kurulum();
        let id = rid.to_string();
        for i in 0..30 {
            ozel_not_kaydet(&c, rid, &format!("hipotez {i}"), Cihaz::Masaustu).unwrap();
        }
        assert_eq!(
            log_sayisi(&c, "duzenleme", VARLIK_OZEL, &id),
            1,
            "ozel not da ayni hacim kuralina uymali"
        );
        assert_eq!(ozel_not_getir(&c, rid, Cihaz::Masaustu).unwrap().icerik, "hipotez 29");
    }

    #[test]
    fn otuz_not_goruntulemesi_tam_olarak_bir_log_satiri_uretir() {
        let (_d, c, _cid, rid) = kurulum();
        let id = rid.to_string();
        for _ in 0..30 {
            not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        }
        assert_eq!(log_sayisi(&c, "goruntuleme", VARLIK_RESMI, &id), 1);
    }

    #[test]
    fn birlestirme_resmi_ve_ozel_notu_birbirinin_arkasina_saklamaz() {
        // Ayni randevu, ayni pencere, ayni eylem -- ama farkli varlik.
        // Birlestirme bunlari birlestirseydi ozel nota erisim, resmi nota
        // erisimin arkasinda gorunmez olurdu.
        let (_d, c, _cid, rid) = kurulum();
        let id = rid.to_string();
        for _ in 0..10 {
            not_kaydet(&c, rid, "dap", "resmi", Cihaz::Masaustu).unwrap();
            ozel_not_kaydet(&c, rid, "ozel", Cihaz::Masaustu).unwrap();
        }
        assert_eq!(log_sayisi(&c, "duzenleme", VARLIK_RESMI, &id), 1);
        assert_eq!(log_sayisi(&c, "duzenleme", VARLIK_OZEL, &id), 1);
    }

    #[test]
    fn birlestirme_goruntuleme_ile_duzenlemeyi_birbirine_karistirmaz() {
        let (_d, c, _cid, rid) = kurulum();
        let id = rid.to_string();
        for _ in 0..10 {
            not_kaydet(&c, rid, "dap", "x", Cihaz::Masaustu).unwrap();
            not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        }
        assert_eq!(log_sayisi(&c, "duzenleme", VARLIK_RESMI, &id), 1);
        assert_eq!(log_sayisi(&c, "goruntuleme", VARLIK_RESMI, &id), 1);
    }

    #[test]
    fn birlestirme_farkli_bir_randevunun_notunu_gizlemez() {
        let (_d, c, cid, rid1) = kurulum();
        let r2 = randevu_olustur(
            &c,
            &YeniRandevu {
                client_id: cid,
                baslangic: "2026-09-14T14:00".into(),
                bitis: "2026-09-14T15:00".into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();

        for _ in 0..10 {
            not_kaydet(&c, rid1, "dap", "a", Cihaz::Masaustu).unwrap();
            not_kaydet(&c, r2.id, "dap", "b", Cihaz::Masaustu).unwrap();
        }
        assert_eq!(log_sayisi(&c, "duzenleme", VARLIK_RESMI, &rid1.to_string()), 1);
        assert_eq!(log_sayisi(&c, "duzenleme", VARLIK_RESMI, &r2.id.to_string()), 1);
    }

    #[test]
    fn not_listesi_birlestirilir_ama_farkli_danisani_gizlemez() {
        // `varlik_id` sabit "liste" olsaydi ikinci danisanin dosyasina
        // erisim birincinin arkasina saklanirdi.
        let (_d, c, cid, _rid) = kurulum();
        let ikinci = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Mehmet Demir".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();

        for _ in 0..30 {
            danisan_notlari(&c, cid, 50, Cihaz::Masaustu).unwrap();
        }
        assert_eq!(
            log_sayisi(&c, "goruntuleme", VARLIK_RESMI, &format!("liste:{cid}")),
            1,
            "30 liste yenilemesi tam olarak 1 satir uretmeli"
        );

        danisan_notlari(&c, ikinci.id, 50, Cihaz::Masaustu).unwrap();
        assert_eq!(
            log_sayisi(&c, "goruntuleme", VARLIK_RESMI, &format!("liste:{}", ikinci.id)),
            1,
            "farkli danisanin listesi ayri satir yazmali"
        );
    }

    #[test]
    fn not_deposu_audit_log_uzerinde_update_veya_delete_denemez() {
        // Tetikleyiciler her UPDATE/DELETE'i ABORT ile reddeder; bu test
        // birlestirmenin bunlara HIC basvurmadigini davranissal kanitlar.
        let (_d, c, _cid, rid) = kurulum();

        // On kosul: tetikleyiciler gercekten aktif.
        assert!(c.execute("UPDATE audit_log SET eylem='silme'", []).is_err());
        assert!(c.execute("DELETE FROM audit_log", []).is_err());

        for _ in 0..30 {
            not_kaydet(&c, rid, "dap", "x", Cihaz::Masaustu)
                .expect("not kaydi hicbir UPDATE/DELETE denememeli");
            ozel_not_kaydet(&c, rid, "y", Cihaz::Masaustu)
                .expect("ozel not kaydi hicbir UPDATE/DELETE denememeli");
            not_getir(&c, rid, Cihaz::Masaustu).unwrap();
            ozel_not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        }
    }

    // --- Atomiklik (yazma + log tek transaction) ------------------------
    //
    // `audit_log` tablosunu kasten dusururuz: log yazimi basarisiz olur.
    // Transaction yoksa not satiri kalici olurdu -- tam da onlemek
    // istedigimiz "not kaydedildi ama loglanmadi" durumu.

    #[test]
    fn not_kaydi_audit_basarisiz_olursa_geri_alinir() {
        let (_d, c, _cid, rid) = kurulum();
        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = not_kaydet(&c, rid, "dap", "kayip olmamali", Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken not_kaydet Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        let sayi: i64 =
            c.query_row("SELECT count(*) FROM progress_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 0, "log basarisiz oldugunda not satiri kalici yazilmamali");
    }

    #[test]
    fn not_guncellemesi_audit_basarisiz_olursa_eski_icerik_korunur() {
        // Sadece INSERT degil, UPSERT'in UPDATE dali da geri alinmali.
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "ilk hali", Cihaz::Masaustu).unwrap();

        c.execute("DROP TABLE audit_log", []).unwrap();
        assert!(not_kaydet(&c, rid, "soap", "ikinci hali", Cihaz::Masaustu).is_err());

        let (sablon, icerik): (String, String) = c
            .query_row("SELECT sablon, icerik FROM progress_notes WHERE appointment_id = ?1", [rid], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(icerik, "ilk hali", "log basarisiz oldugunda guncelleme geri alinmali");
        assert_eq!(sablon, "dap");
    }

    #[test]
    fn ozel_not_kaydi_audit_basarisiz_olursa_geri_alinir() {
        let (_d, c, _cid, rid) = kurulum();
        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = ozel_not_kaydet(&c, rid, "kayip olmamali", Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken ozel_not_kaydet Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        let sayi: i64 =
            c.query_row("SELECT count(*) FROM private_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 0, "log basarisiz oldugunda ozel not satiri kalici yazilmamali");
    }

    // --- Ayri tablo garantisi -------------------------------------------

    #[test]
    fn ozel_not_resmi_not_tablosuna_hic_yazilmaz() {
        let (_d, c, _cid, rid) = kurulum();
        // Once bir RESMI not yaz: bu satir olmadan asagidaki "izi yok"
        // iddiasi bos tablo tarafindan tatmin edilirdi (totoloji).
        not_kaydet(&c, rid, "dap", "resmi kayit", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "GIZLI_HIPOTEZ", Cihaz::Masaustu).unwrap();

        let resmi: i64 =
            c.query_row("SELECT count(*) FROM progress_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(resmi, 1, "resmi tabloda yalnizca resmi not olmali");

        let sizinti: i64 = c
            .query_row(
                "SELECT count(*) FROM progress_notes WHERE icerik LIKE '%GIZLI_HIPOTEZ%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sizinti, 0, "ozel not icerigi resmi not tablosunda gecmemeli");
    }

    #[test]
    fn resmi_not_ozel_not_tablosuna_hic_yazilmaz() {
        let (_d, c, _cid, rid) = kurulum();
        ozel_not_kaydet(&c, rid, "ozel kayit", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, rid, "dap", "RESMI_ICERIK", Cihaz::Masaustu).unwrap();

        let ozel: i64 =
            c.query_row("SELECT count(*) FROM private_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(ozel, 1);
        let sizinti: i64 = c
            .query_row(
                "SELECT count(*) FROM private_notes WHERE icerik LIKE '%RESMI_ICERIK%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sizinti, 0);
    }

    #[test]
    fn danisan_notlari_ozel_notu_olan_ama_resmi_notu_olmayan_seansi_dondurmez() {
        // Kritik sinir durumu: bir seansta YALNIZCA ozel not varsa liste
        // BOS donmeli. `danisan_notlari` private_notes'a bakacak sekilde
        // bozulursa (JOIN/UNION) bu test kirilir.
        let (_d, c, cid, rid) = kurulum();
        ozel_not_kaydet(&c, rid, "GIZLI_HIPOTEZ", Cihaz::Masaustu).unwrap();

        let notlar = danisan_notlari(&c, cid, 50, Cihaz::Masaustu).unwrap();
        assert!(notlar.is_empty(), "yalnizca ozel not varken resmi not listesi bos olmali");
    }

    #[test]
    fn randevu_baska_danisana_tasininca_not_da_tasinir() {
        // "Randevuyu yanlis danisana girmisim, duzelteyim" -- tamamen
        // olagan bir eylem; arayuzde `RandevuPaneli` danisan secimini
        // duzenlenebilir tutuyor ve `client_id`'yi PUT ediyor.
        //
        // `progress_notes.client_id` denormalize bir KOPYADIR ve
        // `appointments::guncelle` ona DOKUNMAZ (uretim kodunda o sutunu
        // guncelleyen hicbir sey yok). Filtre kopyadan yapilirsa B'nin
        // seans notunun tam icerigi A'nin dosyasinda listelenir, B'nin
        // dosyasinda kaybolur -- sessizce.
        let (_d, c, a_id, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "COK_GIZLI_SEANS_ICERIGI", Cihaz::Masaustu).unwrap();

        let b = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Mehmet Demir".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();

        // On kosul: not su anda A'nin dosyasinda.
        assert_eq!(danisan_notlari(&c, a_id, 50, Cihaz::Masaustu).unwrap().len(), 1);
        assert_eq!(danisan_notlari(&c, b.id, 50, Cihaz::Masaustu).unwrap().len(), 0);

        randevu_guncelle(
            &c,
            rid,
            &RandevuGuncelleme {
                client_id: b.id,
                baslangic: "2026-09-07T14:00".into(),
                bitis: "2026-09-07T15:00".into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();

        // Denormalize kopya GERCEKTEN eskimis olmali -- yoksa bu test
        // yetkili kaynagi degil, tesadufen tutan bir kopyayi dogrularrdi.
        let kopya: i64 = c
            .query_row("SELECT client_id FROM progress_notes WHERE appointment_id = ?1", [rid], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kopya, a_id, "on kosul: denormalize kopya eskimis kalmali");

        let a_notlari = danisan_notlari(&c, a_id, 50, Cihaz::Masaustu).unwrap();
        assert!(
            a_notlari.is_empty(),
            "randevu tasindiktan sonra not ESKI danisanin dosyasinda gorunmemeli"
        );

        let b_notlari = danisan_notlari(&c, b.id, 50, Cihaz::Masaustu).unwrap();
        assert_eq!(b_notlari.len(), 1, "not YENI danisanin dosyasinda gorunmeli");
        assert_eq!(b_notlari[0].icerik, "COK_GIZLI_SEANS_ICERIGI");
        assert_eq!(
            b_notlari[0].client_id, b.id,
            "donen client_id de yetkili kaynaktan (randevudan) gelmeli"
        );
    }

    #[test]
    fn danisan_notlari_baska_danisanin_notunu_dondurmez() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "birinci danisan", Cihaz::Masaustu).unwrap();

        let ikinci = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Mehmet Demir".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        let r2 = randevu_olustur(
            &c,
            &YeniRandevu {
                client_id: ikinci.id,
                baslangic: "2026-09-08T14:00".into(),
                bitis: "2026-09-08T15:00".into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();
        not_kaydet(&c, r2.id, "dap", "ikinci danisan", Cihaz::Masaustu).unwrap();

        let notlar = danisan_notlari(&c, cid, 50, Cihaz::Masaustu).unwrap();
        assert_eq!(notlar.len(), 1);
        assert_eq!(notlar[0].icerik, "birinci danisan");
    }

    #[test]
    fn danisan_notlari_limiti_uygular() {
        let (_d, c, cid, rid1) = kurulum();
        for gun in ["2026-09-14", "2026-09-21"] {
            randevu_olustur(
                &c,
                &YeniRandevu {
                    client_id: cid,
                    baslangic: format!("{gun}T14:00"),
                    bitis: format!("{gun}T15:00"),
                    ucret: None,
                },
                Cihaz::Masaustu,
            )
            .unwrap();
        }
        for rid in [rid1, rid1 + 1, rid1 + 2] {
            not_kaydet(&c, rid, "dap", &format!("not {rid}"), Cihaz::Masaustu).unwrap();
        }
        assert_eq!(danisan_notlari(&c, cid, 50, Cihaz::Masaustu).unwrap().len(), 3);
        assert_eq!(danisan_notlari(&c, cid, 2, Cihaz::Masaustu).unwrap().len(), 2);
    }

    // --- Sablon kapali kumesi -------------------------------------------

    #[test]
    fn gecerli_sablonlarin_hepsi_kabul_edilir() {
        let (_d, c, _cid, rid) = kurulum();
        for sablon in GECERLI_SABLONLAR {
            not_kaydet(&c, rid, sablon, "x", Cihaz::Masaustu)
                .unwrap_or_else(|e| panic!("{sablon} kabul edilmeliydi: {e}"));
            assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().sablon, sablon);
        }
    }

    #[test]
    fn sablon_kumesi_veritabani_check_kisitiyla_ayni() {
        // Uygulama katmanindaki kapali kume ile `progress_notes.sablon`
        // CHECK'i ayrisirsa, uygulamada gecerli sayilan bir sablon
        // veritabaninda ham SQLite hatasina donusurdu. Her gecerli kodun
        // dogrudan SQL ile de yazilabildigini dogrula.
        let (_d, c, _cid, rid) = kurulum();
        for sablon in GECERLI_SABLONLAR {
            c.execute(
                "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
                 VALUES (?1, 1, ?2, 'x', 'z')
                 ON CONFLICT(appointment_id) DO UPDATE SET sablon = excluded.sablon",
                rusqlite::params![rid, sablon],
            )
            .unwrap_or_else(|e| panic!("{sablon} CHECK tarafindan reddedildi: {e}"));
        }
        // Ve kume gercekten KAPALI: uydurma bir kod veritabaninca reddedilir.
        assert!(c
            .execute(
                "UPDATE progress_notes SET sablon='uydurma' WHERE appointment_id = ?1",
                [rid]
            )
            .is_err());
    }

    // --- Bulunamayan randevu ---------------------------------------------

    #[test]
    fn olmayan_randevunun_notu_bulunamadi_dondurur() {
        let (_d, c, _cid, _rid) = kurulum();
        assert!(matches!(not_getir(&c, 9999, Cihaz::Masaustu).unwrap_err(), DepoHatasi::Bulunamadi));
        assert!(matches!(
            not_kaydet(&c, 9999, "dap", "x", Cihaz::Masaustu).unwrap_err(),
            DepoHatasi::Bulunamadi
        ));
        assert!(matches!(
            ozel_not_getir(&c, 9999, Cihaz::Masaustu).unwrap_err(),
            DepoHatasi::Bulunamadi
        ));
        assert!(matches!(
            ozel_not_kaydet(&c, 9999, "x", Cihaz::Masaustu).unwrap_err(),
            DepoHatasi::Bulunamadi
        ));
    }

    // --- Debug ciktisi ---------------------------------------------------

    #[test]
    fn seans_notu_debug_ciktisi_icerigi_basmaz() {
        // Bu kod tabaninda turetilmis `Debug` UC kez sizinti uretti
        // (`DataKey`, `Ayrinti`, `Randevu`). `{:?}` bir panik mesajina veya
        // loga dusebilir; seans notu icerigi KVKK'da ozel nitelikli veridir.
        let not = SeansNotu {
            appointment_id: 7,
            client_id: 42,
            sablon: "dap".into(),
            icerik: "COK_GIZLI_SEANS_ICERIGI".into(),
            guncelleme_zamani: "2026-09-07T10:00:00Z".into(),
        };
        let metin = format!("{not:?}");
        assert!(!metin.contains("COK_GIZLI_SEANS_ICERIGI"), "Debug icerigi basmamali: {metin}");
        assert!(!metin.contains("42"), "Debug client_id'yi basmamali: {metin}");
        assert!(metin.contains("<gizli>"));
        assert!(metin.contains('7'), "hata ayiklama icin appointment_id gorunur kalmali");

        // Serialize ise TUM alanlari icerir -- ayrim kasitli.
        let json = serde_json::to_string(&not).unwrap();
        assert!(json.contains("COK_GIZLI_SEANS_ICERIGI"), "arayuzun veriye ihtiyaci var");
    }

    #[test]
    fn ozel_not_debug_ciktisi_icerigi_basmaz() {
        let not = OzelNot {
            appointment_id: 7,
            icerik: "COK_GIZLI_OZEL_NOT".into(),
            guncelleme_zamani: "2026-09-07T10:00:00Z".into(),
        };
        let metin = format!("{not:?}");
        assert!(!metin.contains("COK_GIZLI_OZEL_NOT"), "Debug icerigi basmamali: {metin}");
        assert!(metin.contains("<gizli>"));

        let json = serde_json::to_string(&not).unwrap();
        assert!(json.contains("COK_GIZLI_OZEL_NOT"));
    }

    #[test]
    fn hata_yolunda_debug_ciktisi_da_icerigi_basmaz() {
        // Gercek sizinti yolu: `unwrap()`/`expect()` panik mesajinda
        // `Result<SeansNotu, _>`'nun Debug'ini basar.
        let (_d, c, _cid, rid) = kurulum();
        let sonuc = not_kaydet(&c, rid, "dap", "COK_GIZLI_SEANS_ICERIGI", Cihaz::Masaustu);
        let metin = format!("{sonuc:?}");
        assert!(!metin.contains("COK_GIZLI_SEANS_ICERIGI"), "Result Debug'i icerigi basmamali: {metin}");

        let ozel = ozel_not_kaydet(&c, rid, "COK_GIZLI_OZEL_NOT", Cihaz::Masaustu);
        let metin = format!("{ozel:?}");
        assert!(!metin.contains("COK_GIZLI_OZEL_NOT"), "Result Debug'i icerigi basmamali: {metin}");

        let liste = danisan_notlari(&c, _cid, 50, Cihaz::Masaustu);
        let metin = format!("{liste:?}");
        assert!(!metin.contains("COK_GIZLI_SEANS_ICERIGI"), "Vec<SeansNotu> Debug'i icerigi basmamali: {metin}");
    }
}
