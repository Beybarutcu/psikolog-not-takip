//! Danışan (client) deposu — danışan dosyasının tam hâli.
//!
//! Plan 1'de açılan `clients` tablosu Plan 3 Görev 1'de rıza, saklama süresi
//! ve dosya alanlarıyla genişletildi; bu modül o alanların okuma/yazma
//! yoludur.
//!
//! # Hassas veri kuralı (bkz. `store::audit`)
//! Danışan adı, telefonu, doğum tarihi, başvuru nedeni ve risk notu KVKK
//! kapsamında kişisel/özel nitelikli veridir. Bu modüldeki hiçbir fonksiyon
//! bunları `audit::kaydet`'in `ayrinti` alanına yazmaz; `varlik_id` alanına
//! da yalnızca sayısal kimlik yazılır, isim asla yazılmaz. Aynı kural
//! `Debug` çıktısı için de geçerlidir (bkz. `Danisan`'ın elle yazılmış
//! `Debug` uygulaması).
//!
//! # Sütun listesi TEK YERDE: `SUTUNLAR`
//! `SELECT *` kullanılmaz -- sütun sırası değişince `satirdan` sessizce
//! yanlış alanı okurdu. Ama sütunları her sorguya elle yazmak da aynı hatayı
//! üretebilir (bir sorgu güncellenir, diğeri unutulur). Bu yüzden liste tek
//! bir `SUTUNLAR` sabitinde tutulur ve `satirdan` o sırayı okur; her sorgu
//! aynı sabitten üretilir.
//!
//! # Doğrulama: tek kapı, bütün yazma yolları (Plan 2'den devredildi)
//! `ad_soyad` uzunluk sınırı ve telefon doğrulaması Plan 2 Görev 3'te bilerek
//! ertelenmişti. Kural burada konuyor -- ve **kuralı koyarken var olan
//! ihlaller de arandı**: `ad_soyad`/`telefon` yazan İKİ yol var (`ekle` ve
//! yeni gelen `guncelle`), ikisi de aynı doğrulayıcılardan (`ad_dogrula`,
//! `telefon_dogrula`) geçer. Yalnızca `ekle` doğrulansaydı `guncelle` sessiz
//! bir arka kapı olurdu (Plan 2 Görev 7'deki `kilit_ac` düzeltilip `kilitle`
//! unutulması ile aynı hata sınıfı).
//!
//! Doğrulama hataları **birbirinden ayırt edilebilir**: her hata hangi alanın
//! neden reddedildiğini söyler. "Danışan eklenemedi" gibi tek bir genel mesaj
//! kullanıcıya hangi alanı düzelteceğini söylemez -- bu kod tabanında aynı
//! sınıftan bir hata ("her hata parola hatasıdır") dört katmanda ayrı ayrı
//! bulundu.
//!
//! # Yazma + log aynı transaction'da
//! `ekle`, `guncelle` ve `arsivle` veriyi değiştirir; üçü de tabloya
//! yazdıktan hemen sonra `audit::kaydet` çağırır. Bu iki adım
//! `conn.unchecked_transaction()` ile TEK transaction'a alınır -- log yazımı
//! başarısız olursa veri değişikliği de geri alınır, "kayıt eklendi ama
//! loglanmadı" durumu oluşmaz (bkz. `tests` modülündeki `..._audit_basarisiz_...`
//! testleri: bu garanti `audit_log` tablosunu bilerek düşürüp hem pozitif hem
//! negatif yönde test edilir). `Connection::transaction()` (`&mut self`)
//! değil `unchecked_transaction()` (`&self`) kullanılıyor çünkü bu depo
//! fonksiyonlarının imzası (brief'te sabit) `&Connection` alıyor; bu güvenli
//! çünkü bu fonksiyonlar `schema::migrate`'i çağırmıyor, dolayısıyla iç içe
//! transaction riski yok. `getir`/`listele`/`saklama_suresi_dolanlar` salt
//! okunur olduğundan (veri durumu değişmiyor) ayrı transaction gerektirmiyor.
//!
//! # UYARI — iç içe transaction açılamaz
//! `ekle`, `guncelle` ve `arsivle` kendi `unchecked_transaction()`'ını
//! içeride açar. SQLite iç içe transaction'ı desteklemez ("cannot start a
//! transaction within a transaction"): bu üç fonksiyonu **başka bir
//! transaction'ın içinden** (ör. çağıran taraf zaten
//! `conn.unchecked_transaction()` açmışken, veya `schema::migrate` gibi kendi
//! transaction'ını açan başka bir fonksiyonun içinden) çağırmayın. Bu sessiz
//! bir veri bozulması değil, `rusqlite::Error` olarak dönen gürültülü bir
//! hatadır -- ama derleyici yakalamaz.
//!
//! **İstisna:** `son_temasi_tazele` bilerek kendi transaction'ını AÇMAZ ve
//! `Cihaz` almaz; tam da bu yüzden bir çağıranın transaction'ının içinden
//! güvenle çağrılabilir (`appointments::durum_guncelle` böyle kullanır).
//! Gerekçe için bkz. o fonksiyonun dokümantasyonu.

use crate::store::audit::{
    kaydet, Ayrinti, Cihaz, Eylem, LogHacmi, BIRLESTIRME_PENCERESI_DK,
};
use crate::store::zaman::{tarih_coz, tarih_gecerli_mi};
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

/// Saklama süresinin **varsayılan** uzunluğu (yıl). Süresi dolan dosyalar
/// **otomatik silinmez**, yalnızca listelenir (bkz. `saklama_suresi_dolanlar`).
///
/// # 7 nereden geliyor -- ve neden bağlayıcı DEĞİL
/// Bu sayı bir hukuki zorunluluk değildir. Tasarım belgesi (§7 "Yedekleme ve
/// saklama", `docs/superpowers/specs/2026-09-07-psikolog-not-takip-design.md`)
/// şunu söylüyor: Türkiye'de bağlayıcı tek bir süre yoktur -- TPD etik
/// yönetmeliği süre vermez, Sağlık Bakanlığı arşiv düzenlemesinde psikolojik
/// görüşme kartı **5 yıl**, APA ise **7 yıl** önerir. Belge bu yüzden sürenin
/// "sabitlenmemesini", danışan başına ayarlanabilir olmasını ve çocuk
/// danışanlar için "21 yaşına kadar" seçeneğini istiyor.
///
/// Kod bugün bunu karşılamıyor: `clients` tablosunda danışan başına bir
/// saklama süresi alanı YOK, tek kaynak bu sabit. Bu bilinçli bir eksiklik
/// (kapsam), bir tasarım kararı değil -- sayının kaynağı kodda yazılı
/// olmadığı için "7 yıl mevzuat" sanılması riskini bu not kapatıyor.
/// `son_temasi_tazele` süreyi zaten **parametre** olarak alır; danışan başına
/// alan eklendiğinde değişmesi gereken tek yer, bu sabiti geçen çağrı
/// yerleridir (`appointments::son_temasi_isaretle`).
pub const VARSAYILAN_SAKLAMA_YILI: i64 = 7;

/// `ad_soyad` için üst sınır (karakter, bayt değil -- Türkçe harfler çok
/// baytlıdır). Sınırsız bir ad alanı hem arayüzü bozar hem de arama
/// sorgularını yavaşlatır (Plan 2 Görev 3'ten devredilen madde).
pub const AZAMI_AD_UZUNLUGU: usize = 120;

/// Telefon alanının ham uzunluk sınırı (karakter).
pub const AZAMI_TELEFON_UZUNLUGU: usize = 32;

/// `basvuru_nedeni` / `risk_notu` gibi serbest metin alanlarının sınırı.
/// Seans notu DEĞİLDİR: bunlar danışan kartında görünen kısa özetlerdir,
/// uzun anlatım `progress_notes` tablosuna aittir.
pub const AZAMI_SERBEST_METIN_UZUNLUGU: usize = 2000;

/// Telefonun taşıması gereken en az rakam sayısı. Yerel (alan kodsuz)
/// numaralar 7 hanedir; bu eşik "boş olmayan çöp veri"yi (`"yok"`, `"asdf"`,
/// `"-"`) eler ama biçimi katılaştırmaz.
const ASGARI_TELEFON_RAKAMI: usize = 7;

/// En fazla rakam. E.164 üst sınırı 15; dahili hat eki için pay bırakıldı.
const AZAMI_TELEFON_RAKAMI: usize = 20;

/// `clients` sütunlarının TEK tanımı. `satirdan` bu sırayı okur; her sorgu
/// bu sabitten üretilir (bkz. modül başlığı).
const SUTUNLAR: &str = "id, ad_soyad, telefon, durum, dogum_tarihi, basvuru_nedeni, \
     risk_notu, riza_tarihi, riza_dosya_id, son_temas, saklama_bitis";

#[derive(Debug, thiserror::Error)]
pub enum DepoHatasi {
    #[error("kayit bulunamadi")]
    Bulunamadi,
    #[error("gecersiz veri: {0}")]
    GecersizVeri(String),
    #[error("veritabani hatasi: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Danışan (client) kaydı — dosyanın tam hâli.
///
/// `Debug` türetilmiyor: `ad_soyad`, `telefon`, `dogum_tarihi`,
/// `basvuru_nedeni`, `risk_notu`, `riza_tarihi`, `son_temas` ve
/// `saklama_bitis` KVKK kapsamında kişisel/özel nitelikli veridir;
/// türetilmiş `Debug` bunları `{:?}` ile bir hata mesajına veya loga
/// sızdırabilirdi. Bu kod tabanında `derive(Debug)` **dört kez** sızıntı
/// üretti (`DataKey`, `Ayrinti`, `Randevu`, Görev 3'te mutasyonla
/// engellenen). Yine de `Result<Danisan, DepoHatasi>::unwrap_err()` (test
/// yardımcı fonksiyonlarında kullanılıyor) `Ok` tipinin `Debug` olmasını şart
/// koşuyor; bu yüzden `Ayrinti` ile aynı desen izlenip `Debug` ELLE yazılıyor.
///
/// Basılanlar yalnızca `id`, `durum` ve `riza_dosya_id`. Üçü de içerik değil
/// **kimlik/durum** taşır: `riza_dosya_id` `attachments` tablosuna bir satır
/// numarasıdır, `id` ile aynı sınıftadır. Geri kalan her alan -- tarihler
/// dahil -- `<gizli>` basılır: `son_temas` "bu kişi en son ne zaman terapiye
/// geldi", `saklama_bitis` de ondan türetilir; ikisi de sağlık verisidir.
/// `Serialize` ise alanların TAMAMINI taşır ve bu ayrım kasıtlıdır: JSON
/// yanıtı arayüzün kendi verisini gösterebilmesi için gereklidir, `{:?}` ise
/// hata mesajlarına ve stderr'e düşer.
#[derive(Clone, Serialize)]
pub struct Danisan {
    pub id: i64,
    pub ad_soyad: String,
    pub telefon: Option<String>,
    pub durum: String,
    pub dogum_tarihi: Option<String>,
    pub basvuru_nedeni: Option<String>,
    pub risk_notu: Option<String>,
    pub riza_tarihi: Option<String>,
    pub riza_dosya_id: Option<i64>,
    pub son_temas: Option<String>,
    pub saklama_bitis: Option<String>,
}

impl std::fmt::Debug for Danisan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Danisan")
            .field("id", &self.id)
            .field("ad_soyad", &"<gizli>")
            .field("telefon", &"<gizli>")
            .field("durum", &self.durum)
            .field("dogum_tarihi", &"<gizli>")
            .field("basvuru_nedeni", &"<gizli>")
            .field("risk_notu", &"<gizli>")
            .field("riza_tarihi", &"<gizli>")
            .field("riza_dosya_id", &self.riza_dosya_id)
            .field("son_temas", &"<gizli>")
            .field("saklama_bitis", &"<gizli>")
            .finish()
    }
}

#[derive(Clone, Deserialize)]
pub struct YeniDanisan {
    pub ad_soyad: String,
    pub telefon: Option<String>,
}

/// Kısmi güncelleme: yalnızca `Some` olan alanlar yazılır.
///
/// # Burada BİLEREK olmayan alanlar
/// `son_temas` ve `saklama_bitis` bu yapıda YOKTUR. İkisi birbirine bağlı
/// (`saklama_bitis = son_temas + saklama yılı`); birini serbest bir
/// güncelleme yoluyla diğerinden bağımsız yazmak, hiçbir hata vermeden
/// tutarsız bir dosya üretirdi. Tek yazma yolu `son_temasi_tazele`'dir ve o
/// da ikisini birlikte hesaplar. `durum` da yoktur: arşivlemenin tek yolu
/// `arsivle`'dir (log ayrıntısı `Ayrinti::Arsivlendi` orada yazılır).
///
/// # Boş dizgi = alanı temizle
/// Metin/tarih alanları için `Some("")` (veya yalnızca boşluk) `NULL` yazar --
/// arayüzde bir alanı silmenin karşılığı budur. Alanı hiç göndermemek
/// (`None`) ise "dokunma" demektir. İkisi farklı şeylerdir.
///
/// # Sayısal alanın karşılığı: `null`
/// `riza_dosya_id` bir sayıdır; onun için "boş dizgi" diye bir değer yoktur.
/// Kural yine de aynı olmalı, yoksa alan bir kez bağlandığında **koparılamaz**
/// hâle gelirdi (yanlış dosya seçen kullanıcı onu yalnızca başka bir dosyayla
/// DEĞİŞTİREBİLİR, kaldıramazdı). Bu yüzden alan `Option<Option<i64>>`:
/// JSON'da hiç yoksa `None` (dokunma), `null` gelirse `Some(None)` (bağı
/// kopar), sayı gelirse `Some(Some(id))`. Serde varsayılan davranışı bu iki
/// durumu ayırt EDEMEZ (ikisini de `None` yapar), bu yüzden alanın kendi
/// `deserialize_with`'i var.
///
/// Not: bağın koptuğu ikinci bir yol daha var --
/// `attachments::sil` sarkan `riza_dosya_id`'yi aynı transaction'da temizler.
/// O yol *dosyayı da siler*; burası dosyaya dokunmadan yalnızca bağı çözer.
#[derive(Clone, Default, Deserialize)]
#[serde(default)]
pub struct DanisanGuncelleme {
    pub ad_soyad: Option<String>,
    pub telefon: Option<String>,
    pub dogum_tarihi: Option<String>,
    pub basvuru_nedeni: Option<String>,
    pub risk_notu: Option<String>,
    pub riza_tarihi: Option<String>,
    #[serde(default, deserialize_with = "acik_null_ayirt_et")]
    pub riza_dosya_id: Option<Option<i64>>,
}

/// "Alan yok" ile "alan `null`" arasındaki farkı koruyan çözümleyici.
///
/// `Option<Option<i64>>` tek başına yetmez: serde `null` gördüğünde DIŞ
/// `Option`'ı `None` yapar ve alan hiç gönderilmemiş gibi görünür. Burada
/// **iç** `Option` çözümlenip sonuç her hâlükârda `Some(...)` ile sarılıyor;
/// dış `None` yalnızca `#[serde(default)]` yoluyla, yani alan gerçekten
/// yokken oluşabiliyor.
fn acik_null_ayirt_et<'de, D>(cozucu: D) -> Result<Option<Option<i64>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<i64>::deserialize(cozucu).map(Some)
}

fn simdi() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

fn satirdan(r: &rusqlite::Row) -> Result<Danisan, rusqlite::Error> {
    Ok(Danisan {
        id: r.get(0)?,
        ad_soyad: r.get(1)?,
        telefon: r.get(2)?,
        durum: r.get(3)?,
        dogum_tarihi: r.get(4)?,
        basvuru_nedeni: r.get(5)?,
        risk_notu: r.get(6)?,
        riza_tarihi: r.get(7)?,
        riza_dosya_id: r.get(8)?,
        son_temas: r.get(9)?,
        saklama_bitis: r.get(10)?,
    })
}

// --- Doğrulama: tek kapı, her yazma yolu buradan geçer -------------------

/// Ad soyad: boş olamaz, `AZAMI_AD_UZUNLUGU` karakteri aşamaz. Kırpılmış
/// (trim edilmiş) hâli döner.
fn ad_dogrula(ham: &str) -> Result<String, DepoHatasi> {
    let ad = ham.trim();
    if ad.is_empty() {
        return Err(DepoHatasi::GecersizVeri("Danışan adı boş olamaz.".into()));
    }
    if ad.chars().count() > AZAMI_AD_UZUNLUGU {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Danışan adı en fazla {AZAMI_AD_UZUNLUGU} karakter olabilir."
        )));
    }
    Ok(ad.to_string())
}

/// Telefonda kabul edilen karakterler.
///
/// Harfler BİLEREK serbest: "0212 555 12 34 dahili 105" gibi yazımlar
/// geçerli olmalı (brief: "yurt dışı numaraları, dahili hatlar, boşluklu
/// yazımlar"). Çöp veriyi eleyen kural karakter kümesi değil, `telefon_dogrula`
/// içindeki **rakam sayısı** eşiğidir: `"asdfgh"` sıfır rakam taşır ve elenir.
/// Satır sonu/sekme gibi kontrol karakterleri kabul EDİLMEZ (tek satırlık bir
/// form alanına çok satırlı veri yapıştırılması çöp veridir); bu yüzden
/// `is_whitespace()` değil yalnızca boşluk karakteri geçerlidir.
fn telefon_karakteri_mi(c: char) -> bool {
    c.is_ascii_digit() || c.is_alphabetic() || c == ' ' || "+-()/.,".contains(c)
}

/// Telefon: `None` ve boş dizgi `None`'a normalize edilir; dolu bir değer
/// kabaca "telefon numarasına benziyor mu" diye denetlenir.
///
/// Hatalar birbirinden ayırt edilebilir: kullanıcı hangi kuralı çiğnediğini
/// mesajdan okur.
fn telefon_dogrula(ham: Option<&str>) -> Result<Option<String>, DepoHatasi> {
    let Some(t) = ham else { return Ok(None) };
    let t = t.trim();
    if t.is_empty() {
        return Ok(None);
    }
    if t.chars().count() > AZAMI_TELEFON_UZUNLUGU {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Telefon en fazla {AZAMI_TELEFON_UZUNLUGU} karakter olabilir."
        )));
    }
    if let Some(kotu) = t.chars().find(|c| !telefon_karakteri_mi(*c)) {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Telefonda geçersiz karakter var: '{kotu}'. Rakam, harf, boşluk ve + - ( ) / . , kullanılabilir."
        )));
    }
    let rakam = t.chars().filter(|c| c.is_ascii_digit()).count();
    if rakam < ASGARI_TELEFON_RAKAMI {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Telefon en az {ASGARI_TELEFON_RAKAMI} rakam içermeli. Numara yoksa alanı boş bırakın."
        )));
    }
    if rakam > AZAMI_TELEFON_RAKAMI {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Telefon en fazla {AZAMI_TELEFON_RAKAMI} rakam içerebilir."
        )));
    }
    Ok(Some(t.to_string()))
}

/// Serbest metin alanı: boşsa `NULL`, doluysa uzunluk sınırı.
fn serbest_metin_dogrula(alan: &str, ham: &str) -> Result<Value, DepoHatasi> {
    let m = ham.trim();
    if m.is_empty() {
        return Ok(Value::Null);
    }
    if m.chars().count() > AZAMI_SERBEST_METIN_UZUNLUGU {
        return Err(DepoHatasi::GecersizVeri(format!(
            "{alan} en fazla {AZAMI_SERBEST_METIN_UZUNLUGU} karakter olabilir."
        )));
    }
    Ok(Value::Text(m.to_string()))
}

/// Tarih alanı (`YYYY-AA-GG`): boşsa `NULL`, doluysa takvimde var olmalı.
fn tarih_alani_dogrula(alan: &str, ham: &str) -> Result<Value, DepoHatasi> {
    let t = ham.trim();
    if t.is_empty() {
        return Ok(Value::Null);
    }
    if !tarih_gecerli_mi(t) {
        return Err(DepoHatasi::GecersizVeri(format!(
            "{alan} YYYY-AA-GG biçiminde geçerli bir tarih olmalı."
        )));
    }
    Ok(Value::Text(t.to_string()))
}

/// Yeni bir danışan ekler. Ekleme ve erişim logu tek transaction'da yazılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn ekle(conn: &Connection, yeni: &YeniDanisan, cihaz: Cihaz) -> Result<Danisan, DepoHatasi> {
    let ad = ad_dogrula(&yeni.ad_soyad)?;
    let telefon = telefon_dogrula(yeni.telefon.as_deref())?;

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO clients (ad_soyad, telefon, durum, olusturma_zamani)
         VALUES (?1, ?2, 'aktif', ?3)",
        rusqlite::params![ad, telefon, simdi()],
    )?;
    let id = tx.last_insert_rowid();
    kaydet(&tx, Eylem::Ekleme, "client", &id.to_string(), cihaz, None, LogHacmi::HerCagri)?;

    tx.commit()?;

    Ok(Danisan {
        id,
        ad_soyad: ad,
        telefon,
        durum: "aktif".into(),
        dogum_tarihi: None,
        basvuru_nedeni: None,
        risk_notu: None,
        riza_tarihi: None,
        riza_dosya_id: None,
        son_temas: None,
        saklama_bitis: None,
    })
}

/// Danışan dosyasının alanlarını kısmi olarak günceller ve güncel kaydı
/// döndürür. Yalnızca `Some` olan alanlar yazılır.
///
/// # Log: birleştirilmez
/// Bu bir **veriyi değiştiren** işlemdir, dolayısıyla hacim politikasının
/// (bkz. `store::audit` modül başlığı) LOGLANIR tarafındadır. Birleştirme
/// (`LogHacmi::OturumBasi`) burada kullanılmaz: danışan kartı bir "Kaydet"
/// düğmesiyle çalışan form, not editörünün 2 saniyelik otomatik kaydı değil;
/// her çağrı gerçek ve ayrı bir kullanıcı kararıdır. Danışan kartı ileride
/// otomatik kayda dönüşürse bu karar o görevde yeniden verilmeli --
/// mekanizma hazır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (bkz. modül başlığı).
pub fn guncelle(
    conn: &Connection,
    id: i64,
    alan: &DanisanGuncelleme,
    cihaz: Cihaz,
) -> Result<Danisan, DepoHatasi> {
    let mut set: Vec<&str> = Vec::new();
    let mut degerler: Vec<Value> = Vec::new();

    // ad_soyad ve telefon `ekle` ile AYNI doğrulayıcılardan geçer. Bu yol
    // atlanırsa doğrulama kuralının arka kapısı olurdu (bkz. modül başlığı).
    if let Some(ham) = &alan.ad_soyad {
        set.push("ad_soyad = ?");
        degerler.push(Value::Text(ad_dogrula(ham)?));
    }
    if let Some(ham) = &alan.telefon {
        set.push("telefon = ?");
        degerler.push(match telefon_dogrula(Some(ham))? {
            Some(t) => Value::Text(t),
            None => Value::Null,
        });
    }
    if let Some(ham) = &alan.dogum_tarihi {
        set.push("dogum_tarihi = ?");
        degerler.push(tarih_alani_dogrula("Doğum tarihi", ham)?);
    }
    if let Some(ham) = &alan.riza_tarihi {
        set.push("riza_tarihi = ?");
        degerler.push(tarih_alani_dogrula("Rıza tarihi", ham)?);
    }
    if let Some(ham) = &alan.basvuru_nedeni {
        set.push("basvuru_nedeni = ?");
        degerler.push(serbest_metin_dogrula("Başvuru nedeni", ham)?);
    }
    if let Some(ham) = &alan.risk_notu {
        set.push("risk_notu = ?");
        degerler.push(serbest_metin_dogrula("Risk notu", ham)?);
    }
    if let Some(secim) = alan.riza_dosya_id {
        // `Some(None)` = "bağı kopar" (bkz. `DanisanGuncelleme` dokümantasyonu).
        // Dosyanın kendisi silinmez; yalnızca danışan kaydındaki işaret çözülür.
        set.push("riza_dosya_id = ?");
        degerler.push(match secim {
            None => Value::Null,
            Some(dosya_id) => {
                if dosya_id <= 0 {
                    // 0 ve negatif hâlâ HATA: bunlar "temizle" demenin yolu
                    // değil, bir hesaplama/serileştirme kazasının belirtisidir.
                    // Temizlemenin tek açık yolu `null`.
                    return Err(DepoHatasi::GecersizVeri("Rıza dosyası kimliği geçersiz.".into()));
                }
                Value::Integer(dosya_id)
            }
        });
    }

    if set.is_empty() {
        // Hiçbir satırı etkilemeyecek bir mutasyon: ne yazılır ne loglanır
        // (bkz. hacim politikası -- "0 satır etkileyen mutasyon olmamış bir
        // işlemdir"). Sessizce "başarılı" dönmek yerine hata veriyoruz:
        // sessiz başarı, arayüzdeki bir hatayı (boş gövde göndermek)
        // kullanıcıya "kaydedildi" diye gösterirdi.
        return Err(DepoHatasi::GecersizVeri("Güncellenecek alan verilmedi.".into()));
    }

    let sql = format!("UPDATE clients SET {} WHERE id = ?", set.join(", "));
    degerler.push(Value::Integer(id));

    let tx = conn.unchecked_transaction()?;
    let etkilenen = tx.execute(&sql, rusqlite::params_from_iter(degerler.iter()))?;
    if etkilenen == 0 {
        // `tx` burada düşer -> rollback. Var olmayan bir danışan için log da
        // yazılmaz.
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(&tx, Eylem::Duzenleme, "client", &id.to_string(), cihaz, None, LogHacmi::HerCagri)?;

    let guncel =
        tx.query_row(&format!("SELECT {SUTUNLAR} FROM clients WHERE id = ?1"), [id], satirdan)?;

    tx.commit()?;
    Ok(guncel)
}

/// Tek bir danışanı kimliğiyle okur; bu bir "goruntuleme" olayı olarak loglanır.
///
/// # Neden burada birleştirme YOK (Plan 3 Görev 2)
/// "Belirli bir danışanın dosyasına erişim" hacim politikasının **loglanır**
/// tarafındadır (bkz. `store::audit` modül başlığı): KVKK'nın sorduğu asıl
/// soru budur ve her çağrı gerçek bir kullanıcı eylemine (bir danışan
/// dosyasını açmak) karşılık gelir -- `listele` gibi gezinmenin yan etkisi
/// olarak tekrar tekrar çalışan bir yol değildir. Plan 3'te danışan dosyası
/// ekranı kendi kendini yenileyen bir yola dönüşürse bu karar o görevde
/// yeniden verilmeli; mekanizma (`LogHacmi::OturumBasi`) hazır.
pub fn getir(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<Danisan, DepoHatasi> {
    let danisan = conn
        .query_row(&format!("SELECT {SUTUNLAR} FROM clients WHERE id = ?1"), [id], satirdan)
        .optional()?
        .ok_or(DepoHatasi::Bulunamadi)?;

    kaydet(conn, Eylem::Goruntuleme, "client", &id.to_string(), cihaz, None, LogHacmi::HerCagri)?;
    Ok(danisan)
}

/// Danışanları ada göre sıralı listeler. `arsiv_dahil` false ise yalnızca
/// aktif danışanlar döner. Kaç satır dönerse dönsün tek bir "goruntuleme"
/// kaydı üretir -- satır başına ayrı log KVKK amacına aykırı gürültü üretir.
///
/// # Log: birleştirilir (Plan 3 Görev 2 -- ÜÇÜNCÜ ihlal)
/// Bu, `appointments::aralik_getir` ile **aynı sınıftan** bir yoldur:
/// gezinmenin yan etkisi olan tekrarlı okuma. Arayüzde mount'ta ve her
/// danışan eklemesinden sonra çalışıyor; hangi KAYDA erişildiğini değil,
/// hangi ekranda olunduğunu söylüyor. Görev 2 yalnızca takvimi düzeltip
/// burayı bıraksaydı, kural konur konmaz komşu yol tarafından delinirdi
/// (Plan 2 Görev 7'de `kilit_ac` düzeltilip `kilitle` unutulmuştu -- aynı
/// hata sınıfı). Bkz. `store::audit` modül başlığındaki hacim politikası.
pub fn listele(
    conn: &Connection,
    arsiv_dahil: bool,
    cihaz: Cihaz,
) -> Result<Vec<Danisan>, DepoHatasi> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUTUNLAR} FROM clients
         WHERE (?1 = 1 OR durum = 'aktif')
         ORDER BY ad_soyad COLLATE NOCASE"
    ))?;
    let liste = stmt
        .query_map([arsiv_dahil as i64], satirdan)?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Liste tek bir goruntuleme kaydi uretir, satir basina degil -- ve o tek
    // kayit da pencere boyunca birlestirilir. Var olan satira DOKUNULMAZ.
    kaydet(
        conn,
        Eylem::Goruntuleme,
        "client",
        "liste",
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;
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
    kaydet(
        &tx,
        Eylem::Duzenleme,
        "client",
        &id.to_string(),
        cihaz,
        Some(Ayrinti::Arsivlendi),
        LogHacmi::HerCagri,
    )?;

    tx.commit()?;
    Ok(())
}

/// Son temas tarihini yazar ve `saklama_bitis`'i yeniden hesaplar.
///
/// # Neden `Cihaz` almıyor / neden loglamıyor
/// Bu fonksiyon bir **kullanıcı eylemi değildir**: türetilmiş iki defter
/// alanını (son temas ve ondan hesaplanan saklama bitişi) tazeler. Onu
/// tetikleyen gerçek eylem -- randevunun "geldi" olarak işaretlenmesi --
/// `appointments::durum_guncelle` içinde ZATEN loglanır; burada ikinci bir
/// satır yazmak aynı tek eylem için iki silinemez satır demek olurdu (bkz.
/// hacim politikası, `store::audit` modül başlığı; Plan 3 Görev 2'de
/// "Geldi işaretlemek iki satır üretiyor" tam olarak bu hataydı).
///
/// # Kendi transaction'ını AÇMAZ (modül başlığındaki uyarının istisnası)
/// Bilerek düz `conn.execute` kullanır, böylece çağıranın transaction'ının
/// içinden çağrılabilir -- `durum_guncelle` "randevu durumu + son temas + log"
/// üçlüsünü TEK transaction'da yazabilsin diye. Kendi transaction'ını açsaydı
/// SQLite "cannot start a transaction within a transaction" derdi.
pub fn son_temasi_tazele(
    conn: &Connection,
    client_id: i64,
    tarih: &str,
    saklama_yili: i64,
) -> Result<(), DepoHatasi> {
    // 29 Subat + N yil gibi var olmayan tarihler icin gunu ayin son gunune cek.
    let bitis = yil_ekle(tarih, saklama_yili)?;
    let etkilenen = conn.execute(
        "UPDATE clients SET son_temas = ?1, saklama_bitis = ?2 WHERE id = ?3",
        rusqlite::params![tarih, bitis, client_id],
    )?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    Ok(())
}

/// `YYYY-AA-GG` tarihine `yil` yıl ekler.
///
/// 2024-02-29 + 7 yıl = "2031-02-29" diye bir gün YOKTUR. Bu durumda gün ayın
/// son gününe çekilir (2031-02-28) -- hesap patlamak yerine hukuken doğru
/// olanı yapar: saklama süresi bir gün erken değil, ayın sonunda biter.
fn yil_ekle(tarih: &str, yil: i64) -> Result<String, DepoHatasi> {
    let hata = || DepoHatasi::GecersizVeri("Son temas tarihi YYYY-AA-GG biçiminde olmalı.".into());
    // Önce biçim (10 karakter, YYYY-AA-GG), sonra çözümleme. Sıra önemli:
    // `tarih_coz` tek başına `"2026-09-07T14:00"` gibi 16 karakterlik bir
    // duvar saati damgasını da kabul ederdi (ilk 10 karakteri ayrıştırıp
    // gerisini yok sayarak) -- iki biçimin karışması sessiz bir hata olurdu.
    if !tarih_gecerli_mi(tarih) {
        return Err(hata());
    }
    let d = tarih_coz(tarih).ok_or_else(hata)?;

    let hedef_yil = d.year() + i32::try_from(yil).map_err(|_| hata())?;
    // `days_in_year_month` time 0.3.37'de kullanımdan kaldırıldı; yerine
    // `days_in_month(month, year)` geldi (argüman sırası da ters).
    let son_gun = time::util::days_in_month(d.month(), hedef_yil);
    let gun = d.day().min(son_gun);

    let hedef = time::Date::from_calendar_date(hedef_yil, d.month(), gun).map_err(|_| hata())?;
    Ok(format!("{:04}-{:02}-{:02}", hedef.year(), hedef.month() as u8, hedef.day()))
}

/// Saklama süresi `bugun` itibarıyla dolmuş danışanları listeler.
///
/// **SİLME YOK.** Bu fonksiyon yalnızca listeler; imha kararı her zaman
/// insanındır (plan genelindeki bağlayıcı kısıt). Arşivlenmiş danışanlar da
/// listeye dahildir -- saklama süresi dolanların çoğu zaten arşivdedir.
///
/// # Log: birleştirilmez (`listele`'den farklı)
/// `listele` gezinmenin yan etkisi olan tekrarlı bir okuma olduğu için
/// birleştiriliyor. Bu sorgu ise bir **uyum/denetim ekranıdır**: kullanıcı
/// "hangi dosyaların saklama süresi doldu" diye bilerek sorar, seyrek çalışır
/// ve KVKK açısından sorulan sorunun ta kendisidir -- kimin ne zaman bu
/// listeye baktığı loglanması gereken bilgidir. Bu ekran ileride kendi
/// kendini yenileyen bir yola dönüşürse karar yeniden verilmeli; mekanizma
/// (`LogHacmi::OturumBasi`) hazır -- `getir` için de aynı not var.
///
/// # `bugun` neden doğrulanıyor
/// Karşılaştırma SQL'de **sözlükseldir** (`saklama_bitis <= ?1`): sütun
/// `TEXT` ve `YYYY-AA-GG` biçimi sıralı olduğu için bu doğru çalışır --
/// **ama yalnızca `bugun` da aynı biçimdeyse**. `"2026-9-7"` (tek haneli ay)
/// geçilirse `'9' > '1'` olduğundan `"2026-12-31"` de listeye girer;
/// `"2026-09-07T00:00"` geçilirse 10 karakterden uzun olduğu için sınır
/// kayar. İkisi de hata vermeden YANLIŞ bir imha listesi üretirdi -- KVKK'nın
/// sorduğu sorunun cevabı sessizce bozulurdu. Kardeşi `yil_ekle` aynı
/// gerekçeyle biçimi önce doğruluyor; burada da aynısı yapılır.
pub fn saklama_suresi_dolanlar(
    conn: &Connection,
    bugun: &str,
    cihaz: Cihaz,
) -> Result<Vec<Danisan>, DepoHatasi> {
    if !tarih_gecerli_mi(bugun) {
        return Err(DepoHatasi::GecersizVeri(
            "Saklama listesi tarihi YYYY-AA-GG biçiminde geçerli bir gün olmalı.".into(),
        ));
    }

    let mut stmt = conn.prepare(&format!(
        "SELECT {SUTUNLAR} FROM clients
         WHERE saklama_bitis IS NOT NULL AND saklama_bitis <= ?1
         ORDER BY saklama_bitis"
    ))?;
    let liste = stmt.query_map([bugun], satirdan)?.collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    kaydet(conn, Eylem::Goruntuleme, "client", "saklama_listesi", cihaz, None, LogHacmi::HerCagri)?;
    Ok(liste)
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

    #[test]
    fn danisan_listesi_tekrar_cagrilinca_goruntuleme_satiri_birikmez() {
        // Plan 3 Gorev 2'de bulunan UCUNCU ihlal: `listele` de
        // `aralik_getir` ile ayni sinifta (gezinmenin yan etkisi olan
        // tekrarli okuma). Sayan test: 30 cagri TAM OLARAK 1 satir.
        let (_d, c) = baglanti();
        ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();

        let goruntuleme = |c: &rusqlite::Connection| -> i64 {
            c.query_row(
                "SELECT COUNT(*) FROM audit_log WHERE eylem='goruntuleme' AND varlik='client'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(goruntuleme(&c), 0, "on kosul: henuz liste cagrilmadi");

        for _ in 0..30 {
            assert_eq!(listele(&c, false, Cihaz::Masaustu).unwrap().len(), 1);
        }

        assert_eq!(
            goruntuleme(&c),
            1,
            "30 danisan listesi yenilemesi tam olarak 1 goruntuleme satiri uretmeli"
        );
    }

    #[test]
    fn danisan_dosyasina_erisim_birlestirilmez() {
        // `getir` kuralin LOGLANIR tarafinda: her cagri bir danisan
        // dosyasinin acilmasidir. `listele` birlestirilirken bunun
        // birlestirilmedigini acikca kanitla -- aksi halde "liste
        // birlestirildi, dosya erisimi de sessizce birlestirildi" gibi bir
        // yan etki fark edilmeden gecebilirdi.
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();

        for _ in 0..3 {
            getir(&c, d.id, Cihaz::Masaustu).unwrap();
        }

        let sayi: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM audit_log
                  WHERE eylem='goruntuleme' AND varlik='client' AND varlik_id=?1",
                [d.id.to_string()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sayi, 3, "danisan dosyasina her erisim ayri satir yazmali");
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

    // --- Plan 2'den devredilen madde 1: ad/telefon dogrulamasi ----------

    #[test]
    fn gecerli_telefonlar_kabul_edilir() {
        // Bu test reddetme testlerinin ikizidir: "gecersiz telefon
        // reddedilir" tek basina, HER SEYI reddeden bir dogrulayiciyla da
        // gecerdi (bkz. "test yesil ama korumuyor" sinifi). Bicim BILEREK
        // katı degil: yurt disi numaralari, dahili hatlar ve bosluklu
        // yazimlar gecmeli.
        let (_d, c) = baglanti();
        for t in [
            "05321112233",
            "0532 111 22 33",
            "+90 (212) 555 12 34",
            "+1 415-555-0132",
            "0212 555 12 34 / 105",
            "0212 555 12 34 dahili 105",
            "+44 20 7946 0958",
        ] {
            let d = ekle(
                &c,
                &YeniDanisan { ad_soyad: "Ayse".into(), telefon: Some(t.to_string()) },
                Cihaz::Masaustu,
            )
            .unwrap_or_else(|e| panic!("gecerli telefon reddedildi: {t:?} -> {e}"));
            assert_eq!(d.telefon.as_deref(), Some(t), "telefon oldugu gibi saklanmali");
        }
    }

    #[test]
    fn bos_olmayan_cop_telefon_sessizce_kabul_edilmez() {
        let (_d, c) = baglanti();
        for t in ["asdfgh", "yok", "-", "bilinmiyor", "12345", "0212\n555 12 34", "😀😀😀😀😀😀😀"] {
            let sonuc = ekle(
                &c,
                &YeniDanisan { ad_soyad: "Ayse".into(), telefon: Some(t.to_string()) },
                Cihaz::Masaustu,
            );
            assert!(
                matches!(sonuc, Err(DepoHatasi::GecersizVeri(_))),
                "cop telefon kabul edildi: {t:?}"
            );
        }
    }

    #[test]
    fn bos_telefon_none_olarak_normalize_edilir() {
        // Bos birakmak bir HATA degil: telefonu olmayan danisan olabilir.
        let (_d, c) = baglanti();
        let d = ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ayse".into(), telefon: Some("   ".into()) },
            Cihaz::Masaustu,
        )
        .unwrap();
        assert_eq!(d.telefon, None);
        assert_eq!(getir(&c, d.id, Cihaz::Masaustu).unwrap().telefon, None);
    }

    #[test]
    fn cok_uzun_ad_reddedilir_sinirdaki_ad_kabul_edilir() {
        let (_d, c) = baglanti();
        // Turkce harf: cok baytli. Sinir KARAKTER cinsindendir; bayt
        // sayilsaydi 120 Turkce harflik gecerli bir ad reddedilirdi.
        let tam_sinir: String = "ş".repeat(AZAMI_AD_UZUNLUGU);
        assert!(
            ekle(&c, &yeni(&tam_sinir), Cihaz::Masaustu).is_ok(),
            "sinirdaki ad kabul edilmeli"
        );

        let bir_fazla: String = "ş".repeat(AZAMI_AD_UZUNLUGU + 1);
        let hata = ekle(&c, &yeni(&bir_fazla), Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn dogrulama_hatalari_hangi_alanin_yanlis_oldugunu_soyler() {
        // Bu projede tekrar eden hata sinifi: "her hata parola hatasidir".
        // Burada karsiligi: kullanici telefonu yanlis yazdiginda "danisan
        // eklenemedi" demek. Iki hata mesaji AYNI OLMAMALI ve her biri kendi
        // alanini adlandirmali.
        let (_d, c) = baglanti();

        let ad_hatasi = ekle(&c, &yeni(&"a".repeat(AZAMI_AD_UZUNLUGU + 1)), Cihaz::Masaustu)
            .unwrap_err()
            .to_string();
        let telefon_hatasi = ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ayse".into(), telefon: Some("asdf".into()) },
            Cihaz::Masaustu,
        )
        .unwrap_err()
        .to_string();
        let bos_ad_hatasi = ekle(&c, &yeni("  "), Cihaz::Masaustu).unwrap_err().to_string();

        assert!(ad_hatasi.contains("adı"), "ad hatasi alani adlandirmali: {ad_hatasi}");
        assert!(
            telefon_hatasi.contains("Telefon"),
            "telefon hatasi alani adlandirmali: {telefon_hatasi}"
        );
        assert_ne!(ad_hatasi, telefon_hatasi, "iki farkli alan ayni hatayi vermemeli");
        assert_ne!(ad_hatasi, bos_ad_hatasi, "uzunluk hatasi ile bos hatasi ayrilmali");
    }

    #[test]
    fn guncelle_de_ayni_dogrulamadan_gecer() {
        // "Bir kural koyunca ZATEN VAR OLAN ihlallerini de ara": ad/telefon
        // yazan IKI yol var. Yalnizca `ekle` dogrulansaydi `guncelle` sessiz
        // bir arka kapi olurdu (Plan 2 Gorev 7: `kilit_ac` duzeltildi,
        // komsusu `kilitle` ayni hatayi tasiyordu).
        let (_d, c) = baglanti();
        let d = ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ayse".into(), telefon: Some("05321112233".into()) },
            Cihaz::Masaustu,
        )
        .unwrap();

        for bozuk in [
            DanisanGuncelleme { telefon: Some("asdfgh".into()), ..Default::default() },
            DanisanGuncelleme { ad_soyad: Some("  ".into()), ..Default::default() },
            DanisanGuncelleme {
                ad_soyad: Some("a".repeat(AZAMI_AD_UZUNLUGU + 1)),
                ..Default::default()
            },
            DanisanGuncelleme { dogum_tarihi: Some("30.05.1990".into()), ..Default::default() },
            DanisanGuncelleme { riza_tarihi: Some("2026-02-30".into()), ..Default::default() },
        ] {
            assert!(
                matches!(guncelle(&c, d.id, &bozuk, Cihaz::Masaustu), Err(DepoHatasi::GecersizVeri(_))),
                "guncelle gecersiz veriyi kabul etti"
            );
        }

        // Reddeden dogrulayici her seyi reddediyor olmasin: gecerli bir
        // guncelleme gecmeli VE kayit bozulmamis olmali.
        let iyi = DanisanGuncelleme {
            telefon: Some("+90 212 555 12 34".into()),
            dogum_tarihi: Some("1990-05-30".into()),
            ..Default::default()
        };
        let guncel = guncelle(&c, d.id, &iyi, Cihaz::Masaustu).unwrap();
        assert_eq!(guncel.telefon.as_deref(), Some("+90 212 555 12 34"));
        assert_eq!(guncel.dogum_tarihi.as_deref(), Some("1990-05-30"));

        let diskteki = getir(&c, d.id, Cihaz::Masaustu).unwrap();
        assert_eq!(
            diskteki.telefon.as_deref(),
            Some("+90 212 555 12 34"),
            "reddedilen guncellemeler kayda hicbir sey yazmamis olmali"
        );
    }

    #[test]
    fn reddedilen_guncelleme_kaydi_degistirmez_ve_loglamaz() {
        let (_d, c) = baglanti();
        let d = ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ayse".into(), telefon: Some("05321112233".into()) },
            Cihaz::Masaustu,
        )
        .unwrap();
        let duzenleme = |c: &rusqlite::Connection| -> i64 {
            c.query_row(
                "SELECT COUNT(*) FROM audit_log WHERE eylem='duzenleme' AND varlik='client'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(duzenleme(&c), 0, "on kosul: henuz duzenleme yok");

        let bozuk = DanisanGuncelleme { telefon: Some("asdfgh".into()), ..Default::default() };
        assert!(guncelle(&c, d.id, &bozuk, Cihaz::Masaustu).is_err());

        assert_eq!(
            getir(&c, d.id, Cihaz::Masaustu).unwrap().telefon.as_deref(),
            Some("05321112233"),
            "reddedilen guncelleme telefonu degistirmemeli"
        );
        assert_eq!(duzenleme(&c), 0, "reddedilen guncelleme log satiri birakmamali");
    }

    // --- Danışan dosyasının tam hâli ------------------------------------

    #[test]
    fn danisan_alanlari_guncellenir() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();

        let g = DanisanGuncelleme {
            basvuru_nedeni: Some("Kaygi".into()),
            risk_notu: Some("Yok".into()),
            ..Default::default()
        };
        let guncel = guncelle(&c, d.id, &g, Cihaz::Masaustu).unwrap();

        assert_eq!(guncel.basvuru_nedeni.as_deref(), Some("Kaygi"));
        assert_eq!(guncel.ad_soyad, "Ayse", "verilmeyen alanlar degismemeli");
    }

    #[test]
    fn riza_tarihi_ve_dosyasi_kaydedilir() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        let g = DanisanGuncelleme { riza_tarihi: Some("2026-09-07".into()), ..Default::default() };
        let guncel = guncelle(&c, d.id, &g, Cihaz::Masaustu).unwrap();
        assert_eq!(guncel.riza_tarihi.as_deref(), Some("2026-09-07"));
    }

    #[test]
    fn riza_dosyasi_bagi_koparilabilir_ve_gonderilmezse_korunur() {
        // Bag bir kez kurulduktan sonra KOPARILAMIYORDU: `None` "dokunma"
        // demek oldugu icin kullanici dosyayi yalnizca BASKA bir dosyayla
        // degistirebiliyor, kaldiramiyordu. Metin alanlarinda bos dizgi ne ise
        // sayisal alanda `null` odur.
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();

        let bagli = guncelle(
            &c,
            d.id,
            &DanisanGuncelleme {
                riza_dosya_id: Some(Some(42)),
                riza_tarihi: Some("2026-09-07".into()),
                ..Default::default()
            },
            Cihaz::Masaustu,
        )
        .unwrap();
        assert_eq!(bagli.riza_dosya_id, Some(42));

        // ARTI YON: alan hic gonderilmezse bag DURMALI. Bu olmadan "her
        // guncellemede temizle" diyen bir uygulama da alttaki testi gecerdi.
        let dokunulmamis = guncelle(
            &c,
            d.id,
            &DanisanGuncelleme { risk_notu: Some("Dusuk".into()), ..Default::default() },
            Cihaz::Masaustu,
        )
        .unwrap();
        assert_eq!(dokunulmamis.riza_dosya_id, Some(42), "gonderilmeyen alana dokunulmamali");

        let kopuk = guncelle(
            &c,
            d.id,
            &DanisanGuncelleme { riza_dosya_id: Some(None), ..Default::default() },
            Cihaz::Masaustu,
        )
        .unwrap();
        assert_eq!(kopuk.riza_dosya_id, None, "acik null bagi koparmali");
        assert_eq!(
            kopuk.riza_tarihi.as_deref(),
            Some("2026-09-07"),
            "dosya bagini koparmak riza TARIHINI silmemeli"
        );
    }

    #[test]
    fn riza_dosyasi_kimliginde_sifir_ve_negatif_hala_hatadir() {
        // Temizlemenin yolu `null`; 0/negatif bir kazanin belirtisidir ve
        // sessizce "temizle" diye yorumlanmamalidir.
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        for kotu in [0, -1] {
            let hata = guncelle(
                &c,
                d.id,
                &DanisanGuncelleme { riza_dosya_id: Some(Some(kotu)), ..Default::default() },
                Cihaz::Masaustu,
            )
            .unwrap_err();
            assert!(matches!(hata, DepoHatasi::GecersizVeri(_)), "{kotu} reddedilmeliydi");
        }
    }

    #[test]
    fn json_alanin_yoklugu_ile_null_birbirinden_ayrilir() {
        // Ayrimi tasiyan yer serde katmani: varsayilan `Option<Option<_>>`
        // davranisi `null`'i da `None` yapardi ve "kopar" istegi sessizce
        // "dokunma"ya donusurdu -- API'den bakildiginda dosya bir turlu
        // kaldirilamazdi. Bu yuzden cozumleme testle sabitleniyor.
        let yok: DanisanGuncelleme = serde_json::from_str(r#"{"risk_notu":"x"}"#).unwrap();
        assert_eq!(yok.riza_dosya_id, None, "alan yoksa: dokunma");

        let bos: DanisanGuncelleme = serde_json::from_str(r#"{"riza_dosya_id":null}"#).unwrap();
        assert_eq!(bos.riza_dosya_id, Some(None), "acik null: kopar");

        let dolu: DanisanGuncelleme = serde_json::from_str(r#"{"riza_dosya_id":7}"#).unwrap();
        assert_eq!(dolu.riza_dosya_id, Some(Some(7)), "sayi: bagla");
    }

    #[test]
    fn bos_deger_alani_temizler_alan_gonderilmezse_dokunulmaz() {
        // "Alani gonderme" (None) ile "alani bosalt" (Some("")) FARKLI
        // seylerdir; ikisi karisirsa kullanici bir alani silemez ya da
        // dokunmadigi alan silinir.
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        guncelle(
            &c,
            d.id,
            &DanisanGuncelleme {
                basvuru_nedeni: Some("Kaygi".into()),
                risk_notu: Some("Dusuk".into()),
                ..Default::default()
            },
            Cihaz::Masaustu,
        )
        .unwrap();

        let guncel = guncelle(
            &c,
            d.id,
            &DanisanGuncelleme { basvuru_nedeni: Some("   ".into()), ..Default::default() },
            Cihaz::Masaustu,
        )
        .unwrap();
        assert_eq!(guncel.basvuru_nedeni, None, "bos deger alani temizlemeli");
        assert_eq!(
            guncel.risk_notu.as_deref(),
            Some("Dusuk"),
            "gonderilmeyen alana dokunulmamali"
        );
    }

    #[test]
    fn bos_guncelleme_hata_dondurur_ve_log_yazmaz() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        let once = son_kayitlar(&c, 100).unwrap().len();

        let hata = guncelle(&c, d.id, &DanisanGuncelleme::default(), Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
        assert_eq!(
            son_kayitlar(&c, 100).unwrap().len(),
            once,
            "hicbir satiri etkilemeyen mutasyon log yazmamali"
        );
    }

    #[test]
    fn olmayan_danisanin_guncellenmesi_bulunamadi_dondurur_ve_loglamaz() {
        let (_d, c) = baglanti();
        let once = son_kayitlar(&c, 100).unwrap().len();
        let g = DanisanGuncelleme { risk_notu: Some("x".into()), ..Default::default() };
        assert!(matches!(guncelle(&c, 999, &g, Cihaz::Masaustu), Err(DepoHatasi::Bulunamadi)));
        assert_eq!(son_kayitlar(&c, 100).unwrap().len(), once, "0 satirlik UPDATE loglanmamali");
    }

    #[test]
    fn guncelleme_loglanir() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        let g = DanisanGuncelleme { risk_notu: Some("Dusuk".into()), ..Default::default() };
        guncelle(&c, d.id, &g, Cihaz::Masaustu).unwrap();

        let sayi: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM audit_log
                  WHERE eylem='duzenleme' AND varlik='client' AND varlik_id=?1",
                [d.id.to_string()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sayi, 1, "veriyi degistiren islem loglanmali");
    }

    #[test]
    fn guncelle_audit_basarisiz_olursa_yazma_geri_alinir() {
        // `ekle`/`arsivle` ile ayni mutasyon kaniti: audit_log dusurulunce
        // veri degisikligi de geri alinmali.
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        c.execute("DROP TABLE audit_log", []).unwrap();

        let g = DanisanGuncelleme { risk_notu: Some("SIZAN_NOT".into()), ..Default::default() };
        let sonuc = guncelle(&c, d.id, &g, Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken guncelle Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        let risk: Option<String> = c
            .query_row("SELECT risk_notu FROM clients WHERE id = ?1", [d.id], |r| r.get(0))
            .unwrap();
        assert_eq!(risk, None, "audit log basarisiz oldugunda guncelleme geri alinmali");
    }

    #[test]
    fn danisan_debug_ciktisi_hassas_alanlari_sizdirmaz() {
        // `derive(Debug)` bu kod tabaninda DORT kez sizinti uretti. Yeni
        // alanlar eklendiginde ayni tuzak yeniden acilir: bu test `{:?}`
        // ciktisini FIILEN uretip icinde hicbir hassas degerin gecmedigini
        // dogrular -- gozle "Debug elle yazilmis" demekle yetinmez.
        let (_d, c) = baglanti();
        let d = ekle(
            &c,
            &YeniDanisan {
                ad_soyad: "GIZLI_AD_SOYAD".into(),
                telefon: Some("0532 111 22 33".into()),
            },
            Cihaz::Masaustu,
        )
        .unwrap();
        guncelle(
            &c,
            d.id,
            &DanisanGuncelleme {
                dogum_tarihi: Some("1990-05-30".into()),
                basvuru_nedeni: Some("GIZLI_BASVURU_NEDENI".into()),
                risk_notu: Some("GIZLI_RISK_NOTU".into()),
                riza_tarihi: Some("2026-09-07".into()),
                riza_dosya_id: Some(Some(42)),
                ..Default::default()
            },
            Cihaz::Masaustu,
        )
        .unwrap();
        son_temasi_tazele(&c, d.id, "2026-09-07", VARSAYILAN_SAKLAMA_YILI).unwrap();

        let dolu = getir(&c, d.id, Cihaz::Masaustu).unwrap();
        let cikti = format!("{dolu:?}");

        for gizli in [
            "GIZLI_AD_SOYAD",
            "0532 111 22 33",
            "1990-05-30",
            "GIZLI_BASVURU_NEDENI",
            "GIZLI_RISK_NOTU",
            "2026-09-07",
            "2033-09-07",
        ] {
            assert!(!cikti.contains(gizli), "Debug ciktisi {gizli} sizdirdi: {cikti}");
        }
        // Hassas olmayanlar gorunur kalmali -- yoksa Debug hic ise yaramaz.
        assert!(cikti.contains(&dolu.id.to_string()));
        assert!(cikti.contains("aktif"));

        // Serialize AYRIMI kasitlidir: JSON alanlarin tamamini tasir.
        let json = serde_json::to_string(&dolu).unwrap();
        assert!(json.contains("GIZLI_AD_SOYAD"), "JSON yanit alanlari tasimali");
    }

    // --- Saklama süresi -------------------------------------------------

    #[test]
    fn son_temas_saklama_bitisini_yeniden_hesaplar() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();

        son_temasi_tazele(&c, d.id, "2026-09-07", VARSAYILAN_SAKLAMA_YILI).unwrap();

        let guncel = getir(&c, d.id, Cihaz::Masaustu).unwrap();
        assert_eq!(guncel.son_temas.as_deref(), Some("2026-09-07"));
        assert_eq!(guncel.saklama_bitis.as_deref(), Some("2033-09-07"), "7 yil sonrasi");
    }

    #[test]
    fn saklama_suresi_dolanlar_listelenir() {
        let (_d, c) = baglanti();
        let eski = ekle(&c, &yeni("Eski"), Cihaz::Masaustu).unwrap();
        let yeni_d = ekle(&c, &yeni("Yeni"), Cihaz::Masaustu).unwrap();

        son_temasi_tazele(&c, eski.id, "2015-01-01", VARSAYILAN_SAKLAMA_YILI).unwrap();
        son_temasi_tazele(&c, yeni_d.id, "2026-01-01", VARSAYILAN_SAKLAMA_YILI).unwrap();

        let dolanlar = saklama_suresi_dolanlar(&c, "2026-09-07", Cihaz::Masaustu).unwrap();
        assert_eq!(dolanlar.len(), 1);
        assert_eq!(dolanlar[0].ad_soyad, "Eski");
    }

    #[test]
    fn saklama_listesi_bozuk_bicimli_bugunu_reddeder() {
        // Karsilastirma SQL'de SOZLUKSEL: `"2026-9-7"` gecilirse `'9' > '1'`
        // oldugundan `"2026-12-31"` de "suresi dolmus" sayilirdi;
        // `"2026-09-07T00:00"` gecilirse sinir kayardi. Ikisi de HATA VERMEDEN
        // yanlis bir imha listesi uretirdi.
        let (_d, c) = baglanti();
        let gec = ekle(&c, &yeni("Gec"), Cihaz::Masaustu).unwrap();
        son_temasi_tazele(&c, gec.id, "2019-12-31", VARSAYILAN_SAKLAMA_YILI).unwrap(); // -> 2026-12-31

        for kotu in ["2026-9-7", "2026-09-07T00:00", "2026-02-30", "", "bugun"] {
            let hata = saklama_suresi_dolanlar(&c, kotu, Cihaz::Masaustu).unwrap_err();
            assert!(matches!(hata, DepoHatasi::GecersizVeri(_)), "{kotu} reddedilmeliydi");
        }

        // ARTI YON: dogru bicimli bir gun HALA calismali -- her sey reddeden
        // bir uygulama ustteki dongunun tamamini gecerdi.
        let dolanlar = saklama_suresi_dolanlar(&c, "2026-09-07", Cihaz::Masaustu).unwrap();
        assert!(dolanlar.is_empty(), "2026-12-31 bitisli dosya 2026-09-07'de dolmamis olmali");
        let dolanlar = saklama_suresi_dolanlar(&c, "2027-01-01", Cihaz::Masaustu).unwrap();
        assert_eq!(dolanlar.len(), 1, "bitisten sonraki gun listeye girmeli");
    }

    #[test]
    fn son_temasi_olmayan_danisan_saklama_listesine_girmez() {
        // `saklama_bitis IS NULL` olanlar (hic temas kaydi olmayan yeni
        // danisanlar) "suresi dolmus" sayilmamali. `<= bugun` kosulu tek
        // basina NULL'lari zaten eler ama bu davranis testle sabitleniyor:
        // aksi hali her yeni danisani imha listesine sokardi.
        let (_d, c) = baglanti();
        ekle(&c, &yeni("Temassiz"), Cihaz::Masaustu).unwrap();
        assert!(saklama_suresi_dolanlar(&c, "2099-01-01", Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn saklama_suresi_dolan_danisan_otomatik_silinmez() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Eski"), Cihaz::Masaustu).unwrap();
        son_temasi_tazele(&c, d.id, "2015-01-01", VARSAYILAN_SAKLAMA_YILI).unwrap();

        saklama_suresi_dolanlar(&c, "2026-09-07", Cihaz::Masaustu).unwrap();

        let sayi: i64 = c.query_row("SELECT count(*) FROM clients", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 1, "listeleme silme yapmamali");
    }

    #[test]
    fn artik_yil_29_subat_saklama_hesabinda_patlamaz() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        son_temasi_tazele(&c, d.id, "2024-02-29", VARSAYILAN_SAKLAMA_YILI).unwrap();
        let guncel = getir(&c, d.id, Cihaz::Masaustu).unwrap();
        assert!(guncel.saklama_bitis.is_some(), "29 Subat + 7 yil hesaplanabilmeli");
        // 2031-02-29 diye bir gun YOKTUR; gun ayin son gunune cekilir.
        assert_eq!(guncel.saklama_bitis.as_deref(), Some("2031-02-28"));
    }

    #[test]
    fn artik_yildan_artik_yila_gun_korunur() {
        // Kenar durumun ters yonu: hedef yil da artik yilsa 29 Subat
        // KIRPILMAMALI. Yalnizca "hep 28'e cek" diyen bir uygulama ustteki
        // testi gecer ama bunu gecmez.
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        son_temasi_tazele(&c, d.id, "2024-02-29", 4).unwrap();
        assert_eq!(
            getir(&c, d.id, Cihaz::Masaustu).unwrap().saklama_bitis.as_deref(),
            Some("2028-02-29")
        );
    }

    #[test]
    fn gecersiz_son_temas_tarihi_reddedilir_ve_kaydi_bozmaz() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        son_temasi_tazele(&c, d.id, "2026-01-01", VARSAYILAN_SAKLAMA_YILI).unwrap();

        for bozuk in ["07.09.2026", "2026-02-30", "2026-09-07T14:00", "", "dun"] {
            assert!(
                matches!(
                    son_temasi_tazele(&c, d.id, bozuk, VARSAYILAN_SAKLAMA_YILI),
                    Err(DepoHatasi::GecersizVeri(_))
                ),
                "gecersiz tarih kabul edildi: {bozuk:?}"
            );
        }

        let guncel = getir(&c, d.id, Cihaz::Masaustu).unwrap();
        assert_eq!(guncel.son_temas.as_deref(), Some("2026-01-01"), "eski deger korunmali");
        assert_eq!(guncel.saklama_bitis.as_deref(), Some("2033-01-01"));
    }

    #[test]
    fn olmayan_danisanin_son_temasi_tazelenemez() {
        let (_d, c) = baglanti();
        assert!(matches!(
            son_temasi_tazele(&c, 999, "2026-09-07", VARSAYILAN_SAKLAMA_YILI),
            Err(DepoHatasi::Bulunamadi)
        ));
    }

    #[test]
    fn saklama_listesi_arsivlenmis_danisani_da_kapsar() {
        // Suresi dolan dosyalarin cogu zaten arsivdedir; `listele`nin aktif
        // suzgeci buraya kopyalanirsa imha listesi bosalir ve KVKK sorusu
        // cevapsiz kalir.
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Eski"), Cihaz::Masaustu).unwrap();
        son_temasi_tazele(&c, d.id, "2015-01-01", VARSAYILAN_SAKLAMA_YILI).unwrap();
        arsivle(&c, d.id, Cihaz::Masaustu).unwrap();

        let dolanlar = saklama_suresi_dolanlar(&c, "2026-09-07", Cihaz::Masaustu).unwrap();
        assert_eq!(dolanlar.len(), 1);
        assert_eq!(dolanlar[0].durum, "arsiv");
    }
}
