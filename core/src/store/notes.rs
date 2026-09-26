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
//! *not başına, `BIRLESTIRME_PENCERESI_DK` (5 dakika) uzunluğundaki pencere
//! başına bir satır — otomatik kayıt başına değil.* Bu, "düzenleme oturumu
//! başına bir satır" DEĞİLDİR (Görev 6g düzeltmesi): mekanizma gerçek
//! oturum sınırlarını izlemez, yalnızca ardışık kayıtlar arasındaki süreye
//! bakar — 25 dakikalık kesintisiz bir yazım tek oturum olsa da ~5 satır
//! üretir. Hacim yine kabul edilebilir; yanlış olan yalnızca iddianın
//! kendisiydi.
//!
//! Bu modüldeki **beş** log çağrısının hepsi
//! `LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)` kullanır. Seçim artık
//! derleyicinin zorladığı bir parametredir (bkz. `audit::LogHacmi`), ama
//! *hangi pencere* verildiği hâlâ bir sayıdır; bu yüzden kural iki yönlü
//! testlerle sabitlenir:
//! - **Çok fazla** yönü: 30 ardışık kayıt **tam olarak 1** log satırı üretir
//!   (eşitlik, "en az 1" değil) — pencere `0`'a çekilirse kırılır.
//! - **Çok az** yönü: pencerenin DIŞINDA kalan eski bir satır yeni kaydı
//!   susturmaz (`pencere_disindaki_satir_...` testi) — pencere bir yıla
//!   çıkarılırsa kırılır. Bu yön olmadan "log susturuldu" mutasyonu tek bir
//!   testi bile kırmıyordu.
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
//! O koşul Görev 6h'de gerçekten gerçekleşti (danışan dosyası ekranı da
//! `rizaKaydet`/`ekYukle`/`ekSil` sonrası kendini tazeliyor) ve karar orada
//! YENİDEN VERİLDİ: `clients::getir` yine `HerCagri` kaldı, birleştirmeye
//! GEÇİLMEDİ (bkz. `clients::getir`'in güncel doküman yorumu) -- buradaki
//! (not editörü) ve oradaki (danışan dosyası) tazeleme farklı sınıflardan:
//! biri zamanlayıcı tabanlı otomatik kayıt, diğeri seyrek, bilinçli bir
//! mutasyonun doğrudan sonucu.
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
use crate::store::danisan_seanslari::{onizleme, sablon_baslik_satirlari};
use crate::store::duz_metin::html_duz_metin;
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

/// Varsayılan şablon: henüz notu olmayan bir randevu **Serbest** (başlıksız)
/// açılır. Terapist analitik çalışıyor ve süreç notunu düz anlatı olarak
/// yazıyor; DAP başlıkları her notta silinmek zorunda kalıyordu (tasarım A7,
/// 2026-09-24). Şemadaki sütun varsayılanına dokunulmadı: kod şablonu her
/// zaman açıkça yazıyor, göç gerekmez. İçeriği boş, şablonu DAP olan eski
/// notlar DAP başlıklarıyla açılmaya devam eder.
pub const VARSAYILAN_SABLON: &str = "serbest";

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
///
/// # `seans_zamani` neden var
///
/// `danisan_notlari` listeyi `a.baslangic DESC` ile sıralıyor, yani sıralama
/// anahtarı **seansın tarihi**. Bu alan eklenmeden önce yanıtta o tarih
/// YOKTU: arayüzün elindeki tek tarih `guncelleme_zamani` idi ("son
/// düzenleme") ve ikisi aynı şey değildir — geçen ayki bir seansın notu
/// bugün düzeltilmiş olabilir. Sonuç, ekranda **sırasız görünen** bir
/// listeydi ve panelin var oluş sebebi olan "hangisi son seanstı" sorusu
/// panelden cevaplanamıyordu.
///
/// Değer YETKİLİ KAYNAKTAN okunur: `appointments.baslangic`. Not tablosunda
/// kopyası tutulmaz — randevu başka bir saate taşınırsa kopya bayatlardı.
#[derive(Clone, Serialize)]
pub struct SeansNotu {
    pub appointment_id: i64,
    pub client_id: i64,
    /// Randevunun danışanının adı (`clients.ad_soyad`, randevunun KENDİ
    /// danışanı — notun kopyası değil). Okuma penceresinin başlığı ayrı bir
    /// danışan isteği (ve denetim satırı) istemesin diye (tasarım S5b).
    pub danisan_adi: String,
    /// Notun bağlı olduğu randevunun başlangıcı (`appointments.baslangic`,
    /// yerel naive biçim). Sıralama anahtarının ekrandaki karşılığı.
    pub seans_zamani: String,
    pub sablon: String,
    pub icerik: String,
    /// Sunucunun `duz_metin`'den hesapladığı önizleme (tasarım S5):
    /// `danisan_seanslari::onizleme` — dosya listesindeki `not_ilk_satiri`
    /// ile AYNI fonksiyon. Not satırı yoksa `None`, boş notta `Some("")`.
    pub onizleme: Option<String>,
    pub guncelleme_zamani: String,
}

impl std::fmt::Debug for SeansNotu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SeansNotu")
            .field("appointment_id", &self.appointment_id)
            .field("client_id", &"<gizli>")
            .field("danisan_adi", &"<gizli>")
            // Seans zamani da `<gizli>`: `client_id` ile ayni muhakeme --
            // "su kisi su saatte terapideydi" bilgisi, notun varligiyla
            // birlesince tek basina bir sizintidir (`Randevu::Debug` de
            // `baslangic`i basmaz).
            .field("seans_zamani", &"<gizli>")
            .field("sablon", &self.sablon)
            .field("icerik", &"<gizli>")
            .field("onizleme", &self.onizleme.as_ref().map(|_| "<gizli>"))
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

/// Randevunun danışanını, başlangıcını ve danışan adını bulur; randevu yoksa
/// `Bulunamadi`.
///
/// Üçü TEK sorguda okunuyor: `SeansNotu::seans_zamani` yetkili kaynaktan
/// (`appointments.baslangic`) gelmeli, `danisan_adi` okuma penceresinin
/// başlığı için ayrı bir danışan isteği (ve denetim satırı) istemesin diye
/// (tasarım S5b) burada gelir; zaten yapılan varlık kontrolü o satırı
/// okuduğu için ikinci bir sorguya gerek yok.
fn randevunun_danisani(
    conn: &Connection,
    appointment_id: i64,
) -> Result<(i64, String, String), DepoHatasi> {
    conn.query_row(
        "SELECT a.client_id, a.baslangic, c.ad_soyad
           FROM appointments a JOIN clients c ON c.id = a.client_id
          WHERE a.id = ?1",
        [appointment_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
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
    let (client_id, seans_zamani, danisan_adi) = randevunun_danisani(conn, appointment_id)?;

    let mevcut = conn
        .query_row(
            "SELECT sablon, icerik, duz_metin, guncelleme_zamani FROM progress_notes WHERE appointment_id = ?1",
            [appointment_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?;

    let basliklar = sablon_baslik_satirlari(conn)?;

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
        Some((sablon, icerik, duz, zaman)) => SeansNotu {
            appointment_id,
            client_id,
            danisan_adi,
            seans_zamani,
            sablon,
            onizleme: Some(onizleme(&duz, &basliklar)),
            icerik,
            guncelleme_zamani: zaman,
        },
        None => SeansNotu {
            appointment_id,
            client_id,
            danisan_adi,
            seans_zamani,
            sablon: VARSAYILAN_SABLON.to_string(),
            icerik: String::new(),
            onizleme: None,
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
    let (client_id, seans_zamani, danisan_adi) = randevunun_danisani(conn, appointment_id)?;
    let zaman = simdi();
    // Duz metin (`html_duz_metin`) AYNI islemde yazilir: log basarisizsa duz
    // metin de geri alinir.
    let duz = html_duz_metin(icerik);
    let basliklar = sablon_baslik_satirlari(conn)?;

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, duz_metin, guncelleme_zamani)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(appointment_id) DO UPDATE SET
             sablon = excluded.sablon,
             icerik = excluded.icerik,
             duz_metin = excluded.duz_metin,
             guncelleme_zamani = excluded.guncelleme_zamani",
        rusqlite::params![appointment_id, client_id, sablon, icerik, duz, zaman],
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
        danisan_adi,
        seans_zamani,
        sablon: sablon.to_string(),
        icerik: icerik.to_string(),
        onizleme: Some(onizleme(&duz, &basliklar)),
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
    let (client_id, _, _) = randevunun_danisani(conn, appointment_id)?;
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
/// # Var olmayan danışan `Bulunamadi` döner — log YAZILMAZ
/// Varlık kontrolü olmadan bu fonksiyon, olmayan her kimlik için ayrı bir
/// birleştirme anahtarı (`liste:<id>`) ürettiğinden **silinemez** bir satır
/// bırakırdı; Görev 7'de rota açılınca yol parametresindeki her sayı kalıcı
/// bir satır basardı. Bu, `audit`'in kendi kuralının ihlalidir: *hiçbir
/// satırı etkilemeyen işlemler loglanırsa dışarıdan tetiklenebilir, sınırsız
/// ve silinemez bir gürültü yolu açılır.* Desen `clients::getir` ve
/// `not_getir`/`randevunun_danisani` ile aynıdır: **önce oku, yoksa dön,
/// sonra logla.**
///
/// # `limit`
/// Doğrudan `LIMIT`'e geçer ve burada **doğrulanmaz**: negatif bir değer
/// (`-1`) SQLite'ta "sınırsız" demektir, yani çağıran taraf sınır koymamış
/// olur. Bu bilinçli: depo katmanı çağıranın limitine karışmaz. Sınırı
/// koymak rotanın işidir (Görev 7).
///
/// # `once`: "bu seanstan ÖNCE" kesmesi
/// `Some(baslangic)` verildiğinde yalnızca **o andan önce başlamış**
/// seansların notları döner (`a.baslangic < ?`). Bu, arayüzdeki "Önceki
/// seans notları" panelinin doğru olabilmesinin tek yoludur: kesme
/// olmadan sorgu danışanın TÜM notlarını en yeniden eskiye veriyordu ve
/// terapist üç ay önceki bir seansı açtığında (takvim hafta hafta geriye
/// gidiyor, olağan bir işlem) sol sütun o seanstan **SONRAKİ** notları
/// "önceki seans notları" başlığı altında gösteriyordu — kullanıcı not
/// yazarken henüz yaşanmamış seansların içeriğini "geçen seansta
/// konuşulan" diye okuyordu.
///
/// Kesme **kesin küçüktür**: aynı `baslangic`'e sahip bir randevu "önce"
/// sayılmaz, dolayısıyla seansın kendi notu bu listeye giremez — çağıran
/// tarafın ayrıca kendi kimliğini elemesine gerek yoktur (arayüz bir
/// zamanlar eliyordu; süzgeç hiçbir zaman bir şey elemedi ve kaldırıldı).
///
/// Aynı dakikaya denk gelen **ikinci** bir randevunun notu da düşer ve bu
/// bilinen bir sınırdır: kayıp SQL seviyesinde olduğu için çağıran taraf
/// "bir fazlasını isteyerek" onu geri getiremez (bir fazlası yalnızca bir
/// tane daha ESKİ not verir). Aynı dakikada iki seans olağan bir durum
/// değil; düzeltmek kesmeyi `<=` yapıp seansın kendi notunu elemeyi
/// çağırana yüklemek olurdu ve o, buradaki güvenceyi bir filtreye
/// devrederdi.
///
/// `None` ise kesme uygulanmaz: danışanın tüm notları (veri raporu bunu
/// istiyor — KVKK md. 11 "elimdeki her şey" demek, "şu tarihe kadarkiler"
/// değil).
///
/// Log: liste görüntülemeleri birleştirilir, ama `varlik_id` **hangi
/// danışanın** listesi olduğunu taşır (`liste:<client_id>`). Sabit bir
/// `"liste"` kimliği kullanılsaydı birleştirme, farklı danışanların
/// dosyalarına erişimi tek satırın arkasına saklardı — `audit`'in
/// "birleştirme farklı bir kaydı gizlemez" kuralının ihlali olurdu.
/// `once` birleştirme anahtarına GİRMEZ: aynı danışanın dosyasına iki
/// farklı kesmeyle bakmak yine aynı dosyaya bakmaktır ve farklı bir kaydı
/// gizlemez.
pub fn danisan_notlari(
    conn: &Connection,
    client_id: i64,
    limit: i64,
    once: Option<&str>,
    cihaz: Cihaz,
) -> Result<Vec<SeansNotu>, DepoHatasi> {
    // Once varlik kontrolu, SONRA log: olmayan bir danisan silinemez bir
    // satir birakmasin (bkz. fonksiyon dokumantasyonu).
    let var: Option<i64> = conn
        .query_row("SELECT id FROM clients WHERE id = ?1", [client_id], |r| r.get(0))
        .optional()?;
    if var.is_none() {
        return Err(DepoHatasi::Bulunamadi);
    }

    let basliklar = sablon_baslik_satirlari(conn)?;

    // `once` NULL ise kesme yok: `?3 IS NULL OR a.baslangic < ?3` tek bir
    // hazir ifadeyle iki durumu da karsilar. Iki ayri SQL dizgesi
    // tutulsaydi, birine eklenen bir duzeltme (ornegin `client_id`'nin
    // `a.` uzerinden okunmasi kurali) otekinde unutulabilirdi.
    let mut stmt = conn.prepare(
        "SELECT p.appointment_id, a.client_id, c.ad_soyad, a.baslangic, p.sablon, p.icerik,
                p.duz_metin, p.guncelleme_zamani
         FROM progress_notes p
         JOIN appointments a ON a.id = p.appointment_id
         JOIN clients c ON c.id = a.client_id
         WHERE a.client_id = ?1 AND (?3 IS NULL OR a.baslangic < ?3)
         ORDER BY a.baslangic DESC, p.appointment_id DESC
         LIMIT ?2",
    )?;
    let notlar = stmt
        .query_map(rusqlite::params![client_id, limit, once], |r| {
            Ok(SeansNotu {
                appointment_id: r.get(0)?,
                client_id: r.get(1)?,
                danisan_adi: r.get(2)?,
                seans_zamani: r.get(3)?,
                sablon: r.get(4)?,
                icerik: r.get(5)?,
                onizleme: Some(onizleme(&r.get::<_, String>(6)?, &basliklar)),
                guncelleme_zamani: r.get(7)?,
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
        assert_eq!(not.sablon, "serbest", "varsayilan sablon Serbest olmali (analitik calisma, tasarim A7)");
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

        let notlar = danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();
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

        let notlar = danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();
        assert_eq!(notlar.len(), 2, "iki notun ikisi de donmeli");
        assert_eq!(notlar[0].icerik, "yeni");
        assert_eq!(notlar[1].icerik, "eski");
    }

    /// Ayni danisana, verilen baslangicla bir randevu ve ona bir not acar.
    fn seansli_not(c: &rusqlite::Connection, cid: i64, baslangic: &str, icerik: &str) -> i64 {
        let saat: i32 = baslangic[11..13].parse().unwrap();
        let r = randevu_olustur(
            c,
            &YeniRandevu {
                client_id: cid,
                baslangic: baslangic.into(),
                bitis: format!("{}{:02}{}", &baslangic[..11], saat + 1, &baslangic[13..]),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();
        not_kaydet(c, r.id, "dap", icerik, Cihaz::Masaustu).unwrap();
        r.id
    }

    #[test]
    fn danisan_notlari_once_verilince_sonraki_seanslari_dondurmez() {
        // Inceleme I2: kesme yokken terapist uc ay onceki bir seansi
        // actiginda sol sutun o seanstan SONRAKI notlari "Onceki seans
        // notlari" basligi altinda gosteriyordu -- kullanici henuz
        // yasanmamis seanslarin icerigini "gecen seansta konusulan" diye
        // okuyordu.
        let (_d, c, cid, _rid) = kurulum();
        seansli_not(&c, cid, "2026-06-01T10:00", "COK ESKI");
        let orta = seansli_not(&c, cid, "2026-07-01T10:00", "ACIK OLAN SEANS");
        seansli_not(&c, cid, "2026-08-01T10:00", "HENUZ YASANMAMIS");

        // On kosul: kesmesiz cagri gercekten SONRAKI notu da veriyor.
        let kesmesiz = danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();
        assert!(
            kesmesiz.iter().any(|n| n.icerik == "HENUZ YASANMAMIS"),
            "on kosul: kesme olmadan sonraki seans da donuyor"
        );

        let kesmeli =
            danisan_notlari(&c, cid, 50, Some("2026-07-01T10:00"), Cihaz::Masaustu).unwrap();
        let icerikler: Vec<&str> = kesmeli.iter().map(|n| n.icerik.as_str()).collect();
        assert!(
            !icerikler.contains(&"HENUZ YASANMAMIS"),
            "kesme sonrasi seanslar listeye giremez: {icerikler:?}"
        );
        // ARTI YON: kesme "her seyi eleyen" bir filtre degil -- gercekten
        // onceki seans donuyor. Bu iddia olmadan `LIMIT 0` de testi gecerdi.
        assert_eq!(icerikler, vec!["COK ESKI"], "onceki seans donmeli");
        // Ve seansin KENDI notu da disarida: kesme `<` (kesin kucuk).
        assert!(!kesmeli.iter().any(|n| n.appointment_id == orta));
    }

    #[test]
    fn danisan_notlari_seans_zamanini_yetkili_kaynaktan_dondurur() {
        // Inceleme I3: liste `a.baslangic DESC` ile geliyordu ama ekranda
        // gorunen tek tarih `guncelleme_zamani` idi ("Son duzenleme").
        // Ikisi farkli nicelikler oldugu icin ekrandaki tarihler sirasiz
        // gorunuyordu; siralama anahtari yanitta YOKTU.
        let (_d, c, cid, _rid) = kurulum();
        let eski = seansli_not(&c, cid, "2026-06-01T10:00", "haziran");
        seansli_not(&c, cid, "2026-08-01T10:00", "agustos");

        let notlar = danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();
        let siralama: Vec<&str> = notlar.iter().map(|n| n.seans_zamani.as_str()).collect();
        assert_eq!(
            siralama,
            // `kurulum()`un randevusunun notu yok, listeye girmez.
            vec!["2026-08-01T10:00", "2026-06-01T10:00"],
            "donen `seans_zamani` listenin gercek siralama anahtari olmali"
        );

        // Yetkili kaynak `appointments.baslangic`: randevu tasininca deger
        // TASINIR. Notta bir kopyasi tutulsaydi bayatlardi.
        // `bitis > baslangic` CHECK'i var; ikisi birlikte tasiniyor.
        c.execute(
            "UPDATE appointments SET baslangic = ?1, bitis = ?2 WHERE id = ?3",
            rusqlite::params!["2026-06-02T09:30", "2026-06-02T10:30", eski],
        )
        .unwrap();
        let sonra = danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();
        let tasinan = sonra.iter().find(|n| n.appointment_id == eski).unwrap();
        assert_eq!(tasinan.seans_zamani, "2026-06-02T09:30");

        // `not_getir` de ayni yetkili kaynagi okur.
        assert_eq!(not_getir(&c, eski, Cihaz::Masaustu).unwrap().seans_zamani, "2026-06-02T09:30");
        // `not_kaydet`in dondurdugu kayit da.
        assert_eq!(
            not_kaydet(&c, eski, "dap", "guncel", Cihaz::Masaustu).unwrap().seans_zamani,
            "2026-06-02T09:30"
        );
    }

    #[test]
    fn danisan_notlari_once_birlestirme_anahtarini_degistirmez() {
        // Ayni danisanin dosyasina iki farkli kesmeyle bakmak yine ayni
        // dosyaya bakmaktir: `once` birlestirme anahtarina girseydi her
        // farkli kesme ayri bir SILINEMEZ satir birakirdi ve panelde hafta
        // hafta gezinmek sinirsiz log gurultusu uretirdi.
        let (_d, c, cid, _rid) = kurulum();
        danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();
        danisan_notlari(&c, cid, 50, Some("2026-07-01T10:00"), Cihaz::Masaustu).unwrap();
        danisan_notlari(&c, cid, 50, Some("2026-08-01T10:00"), Cihaz::Masaustu).unwrap();

        assert_eq!(
            log_sayisi(&c, "goruntuleme", "progress_note", &format!("liste:{cid}")),
            1,
            "farkli kesmeler ayni birlestirme satirinda kalmali"
        );
    }

    #[test]
    fn not_icerigi_erisim_loguna_yazilmaz() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "COK_GIZLI_SEANS_ICERIGI", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "COK_GIZLI_OZEL_NOT", Cihaz::Masaustu).unwrap();
        // Okuma yollari da loga yaziyor; onlar da denetlenmeli.
        not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        ozel_not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();

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
    //
    // IKI YON: asagidaki "otuz ... tam olarak bir satir" testleri logu
    // COGALTAN yonu tutuyor (pencere 0 yapilinca kirilirlar). Onlarin tek
    // basina yakalayamadigi sey SUSTURAN yondur: pencere bir yila
    // cikarilsaydi hicbiri kirilmazdi -- ve terapist bir yil boyunca her gun
    // not duzenlese denetim kaydinda TEK satir kalirdi. O yonu
    // `pencere_disindaki_satir_...` testi tutar.

    /// `dk_once` dakika onceye ait bir log satirini DOGRUDAN yazar
    /// (`audit::tests::eski_satir_ekle` ile ayni desen). `audit_log`'a INSERT
    /// serbesttir; yasak olan UPDATE/DELETE'tir -- var olan bir satirin
    /// zamanini geri almak tetikleyici tarafindan (dogru olarak) reddedilir,
    /// bu yuzden eski satir bastan eski yazilir.
    fn eski_satir_ekle(
        c: &rusqlite::Connection,
        eylem: &str,
        varlik: &str,
        varlik_id: &str,
        dk_once: i64,
    ) {
        let zaman = (OffsetDateTime::now_utc() - time::Duration::minutes(dk_once))
            .replace_nanosecond(0)
            .unwrap()
            .format(&Rfc3339)
            .unwrap();
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti)
             VALUES (?1, ?2, ?3, ?4, 'masaustu', NULL)",
            rusqlite::params![zaman, eylem, varlik, varlik_id],
        )
        .unwrap();
    }

    #[test]
    fn pencere_disindaki_satir_bes_log_yolunun_hicbirini_susturmaz() {
        // BIRLESTIRME PENCERESI ZAMANA BAGLI OLMALI. Pencere `525600`
        // (bir yil) yapilsaydi asagidaki bes yolun hicbiri yeni satir
        // yazmazdi ve denetim kaydi -- KVKK 2018/10'un istedigi kayit --
        // fiilen yok olurdu. Bu testten once o mutasyonu TEK BIR test bile
        // yakalamiyordu: hacim testlerinin hepsi yalnizca "cok fazla"
        // yonunu olcuyordu.
        //
        // Her bes cagri yeri icin pencerenin DISINA (10 dk once) bir satir
        // konur; cagri sonrasi sayinin 2 olmasi beklenir.
        let (_d, c, cid, rid) = kurulum();
        let id = rid.to_string();
        let liste_id = format!("liste:{cid}");

        let yollar: [(&str, &str, &str); 5] = [
            ("goruntuleme", VARLIK_RESMI, id.as_str()),
            ("duzenleme", VARLIK_RESMI, id.as_str()),
            ("goruntuleme", VARLIK_OZEL, id.as_str()),
            ("duzenleme", VARLIK_OZEL, id.as_str()),
            ("goruntuleme", VARLIK_RESMI, liste_id.as_str()),
        ];
        for (eylem, varlik, varlik_id) in yollar {
            eski_satir_ekle(&c, eylem, varlik, varlik_id, 10);
            assert_eq!(
                log_sayisi(&c, eylem, varlik, varlik_id),
                1,
                "on kosul: {eylem}/{varlik}/{varlik_id} icin tek eski satir olmali"
            );
        }

        not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        not_kaydet(&c, rid, "dap", "x", Cihaz::Masaustu).unwrap();
        ozel_not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "y", Cihaz::Masaustu).unwrap();
        danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();

        for (eylem, varlik, varlik_id) in yollar {
            assert_eq!(
                log_sayisi(&c, eylem, varlik, varlik_id),
                2,
                "{eylem}/{varlik}/{varlik_id}: pencere DISINDAKI eski satir yeni kaydi \
                 susturmamali -- pencere zamana bagli olmali"
            );
        }
    }

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
            danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();
        }
        assert_eq!(
            log_sayisi(&c, "goruntuleme", VARLIK_RESMI, &format!("liste:{cid}")),
            1,
            "30 liste yenilemesi tam olarak 1 satir uretmeli"
        );

        danisan_notlari(&c, ikinci.id, 50, None, Cihaz::Masaustu).unwrap();
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
        let duz: String = c
            .query_row("SELECT duz_metin FROM progress_notes WHERE appointment_id = ?1", [rid], |r| r.get(0))
            .unwrap();
        assert_eq!(duz, "ilk hali", "duz metin de ayni islemde geri alinmali");
    }

    #[test]
    fn not_kaydet_duz_metni_ayni_islemde_yazar_ve_onizlemeyi_dondurur() {
        let (_d, c, _cid, rid) = kurulum();
        let ilk = not_kaydet(&c, rid, "dap", "<h2>Veri</h2><p><strong>Kaygı</strong> &amp; uyku</p>", Cihaz::Masaustu)
            .unwrap();
        let duz = |c: &rusqlite::Connection| -> String {
            c.query_row("SELECT duz_metin FROM progress_notes WHERE appointment_id = ?1", [rid], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(duz(&c), "Veri\n\nKaygı & uyku");
        assert_eq!(ilk.onizleme.as_deref(), Some("Kaygı & uyku"));
        assert_eq!(ilk.danisan_adi, "Ayse Yilmaz");
        // UPSERT'in UPDATE dali da duz metni tazeler.
        not_kaydet(&c, rid, "dap", "<p>ikinci hâl</p>", Cihaz::Masaustu).unwrap();
        assert_eq!(duz(&c), "ikinci hâl");
        let okunan = not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        assert_eq!(okunan.onizleme.as_deref(), Some("ikinci hâl"));
        assert_eq!(okunan.danisan_adi, "Ayse Yilmaz");
    }

    #[test]
    fn notu_olmayan_randevunun_onizlemesi_yoktur_bos_notunki_bos_dizgidir() {
        let (_d, c, _cid, rid) = kurulum();
        assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().onizleme, None);
        not_kaydet(&c, rid, "serbest", "", Cihaz::Masaustu).unwrap();
        assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().onizleme, Some(String::new()));
    }

    #[test]
    fn danisan_notlari_danisan_adini_ve_onizlemeyi_tasir() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "serbest", "<p>liste <em>önizlemesi</em></p>", Cihaz::Masaustu).unwrap();
        let liste = danisan_notlari(&c, cid, 10, None, Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].danisan_adi, "Ayse Yilmaz");
        assert_eq!(liste[0].onizleme.as_deref(), Some("liste önizlemesi"));
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

        let notlar = danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();
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
        assert_eq!(danisan_notlari(&c, a_id, 50, None, Cihaz::Masaustu).unwrap().len(), 1);
        assert_eq!(danisan_notlari(&c, b.id, 50, None, Cihaz::Masaustu).unwrap().len(), 0);

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

        let a_notlari = danisan_notlari(&c, a_id, 50, None, Cihaz::Masaustu).unwrap();
        assert!(
            a_notlari.is_empty(),
            "randevu tasindiktan sonra not ESKI danisanin dosyasinda gorunmemeli"
        );

        let b_notlari = danisan_notlari(&c, b.id, 50, None, Cihaz::Masaustu).unwrap();
        assert_eq!(b_notlari.len(), 1, "not YENI danisanin dosyasinda gorunmeli");
        assert_eq!(b_notlari[0].icerik, "COK_GIZLI_SEANS_ICERIGI");
        assert_eq!(
            b_notlari[0].client_id, b.id,
            "donen client_id de yetkili kaynaktan (randevudan) gelmeli"
        );
    }

    #[test]
    fn olmayan_danisanin_not_listesi_bulunamadi_dondurur_ve_log_yazmaz() {
        // `audit`'in kendi kurali: hicbir satiri etkilemeyen islemler
        // loglanirsa disaridan tetiklenebilir, SINIRSIZ ve SILINEMEZ bir
        // gurultu yolu acilir. Her farkli kimlik ayri bir birlestirme
        // anahtari (`liste:<id>`) uretiyordu.
        let (_d, c, _cid, _rid) = kurulum();
        let onceki: i64 =
            c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();

        for yok in [90001, 90002, 90003] {
            assert!(matches!(
                danisan_notlari(&c, yok, 50, None, Cihaz::Masaustu).unwrap_err(),
                DepoHatasi::Bulunamadi
            ));
        }

        let sonraki: i64 =
            c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();
        assert_eq!(sonraki, onceki, "olmayan danisan icin log satiri yazilmamali");
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

        let notlar = danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap();
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
        assert_eq!(danisan_notlari(&c, cid, 50, None, Cihaz::Masaustu).unwrap().len(), 3);
        assert_eq!(danisan_notlari(&c, cid, 2, None, Cihaz::Masaustu).unwrap().len(), 2);
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
        // `appointment_id` zaman damgasindaki rakamlarla KARISMAYAN bir
        // deger secildi: `contains('7')` iddiasi "2026-09-07T10:00:00Z"
        // tarafindan zaten karsilaniyordu ve alanin gorunur kaldigini
        // kanitlamiyordu (totoloji).
        let not = SeansNotu {
            appointment_id: 481_516,
            client_id: 42,
            danisan_adi: "GIZLI_DANISAN_ADI".into(),
            // Seans zamani da hassas: "su kisi su saatte terapideydi".
            // Yil rakamlari `appointment_id` ile karismasin diye 1999.
            seans_zamani: "1999-03-23T19:30".into(),
            sablon: "dap".into(),
            icerik: "COK_GIZLI_SEANS_ICERIGI".into(),
            onizleme: Some("GIZLI_ONIZLEME".into()),
            guncelleme_zamani: "2026-09-07T10:00:00Z".into(),
        };
        let metin = format!("{not:?}");
        assert!(!metin.contains("COK_GIZLI_SEANS_ICERIGI"), "Debug icerigi basmamali: {metin}");
        assert!(!metin.contains("42"), "Debug client_id'yi basmamali: {metin}");
        assert!(!metin.contains("1999"), "Debug seans zamanini basmamali: {metin}");
        assert!(!metin.contains("GIZLI_DANISAN_ADI"), "Debug danisan adini basmamali: {metin}");
        assert!(!metin.contains("GIZLI_ONIZLEME"), "Debug onizlemeyi basmamali: {metin}");
        assert!(metin.contains("<gizli>"));
        assert!(
            metin.contains("appointment_id: 481516"),
            "hata ayiklama icin appointment_id gorunur kalmali: {metin}"
        );

        // Serialize ise TUM alanlari icerir -- ayrim kasitli.
        let json = serde_json::to_string(&not).unwrap();
        assert!(json.contains("COK_GIZLI_SEANS_ICERIGI"), "arayuzun veriye ihtiyaci var");
        assert!(
            json.contains("\"seans_zamani\":\"1999-03-23T19:30\""),
            "arayuz siralama anahtarini ekranda gosterebilmeli: {json}"
        );
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

        let liste = danisan_notlari(&c, _cid, 50, None, Cihaz::Masaustu);
        let metin = format!("{liste:?}");
        assert!(!metin.contains("COK_GIZLI_SEANS_ICERIGI"), "Vec<SeansNotu> Debug'i icerigi basmamali: {metin}");
    }

    /// Modül başlığının hacim iddiası gerçek pencere değeriyle eşleşmeli
    /// (Görev 6g, `store::audit` modülündeki emsalle aynı test). Eskiden
    /// "düzenleme oturumu başına bir satır" diyordu; mekanizma
    /// (`LogHacmi::OturumBasi`) ardışık kayıtlar arasındaki
    /// `BIRLESTIRME_PENCERESI_DK` uzunluğundaki pencereyi izler, gerçek bir
    /// oturum sınırını değil. Yanlış olan iddiaydı, hacim değil.
    #[test]
    fn hacim_iddiasi_dogru_pencere_suresini_soyluyor() {
        let yol = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/store/notes.rs");
        let kaynak = std::fs::read_to_string(&yol)
            .unwrap_or_else(|e| panic!("{} okunamadi: {e}", yol.display()));
        let beklenen = format!("BIRLESTIRME_PENCERESI_DK` ({BIRLESTIRME_PENCERESI_DK} dakika)");
        assert!(
            kaynak.contains(&beklenen),
            "modul basligindaki pencere suresi BIRLESTIRME_PENCERESI_DK ile \
             artik eslesmiyor olabilir (aranan: {beklenen})"
        );
    }
}
