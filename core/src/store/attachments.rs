//! Ekli dosya deposu — danışan dosyasına iliştirilen belgeler (`attachments`).
//!
//! Dosyalar **veritabanının içinde BLOB olarak** saklanır, diskte ayrı dosya
//! olarak değil (plan global kısıtı): yedek tek bir şifreli dosya olarak
//! kalsın diye. Diskteki ayrı dosyalar hem yedeğin dışında kalır hem de
//! SQLCipher'ın şifrelemesinden çıkar; ikisi de bu ürünün en temel vaadini
//! (tek dosya, tamamı şifreli) bozar.
//!
//! # KRİTİK: Dosya adı erişim loguna ASLA yazılmaz
//!
//! `audit_log` tetikleyicilerle korunur: satır güncellenemez, **silinemez**.
//! Bir dosya adı tek başına sağlık verisi taşır — "mahkeme-raporu.pdf",
//! "psikiyatri-sevk.pdf", "ilac-recetesi.pdf". Plan global kısıtı bunu
//! açıkça yazar: *not içeriği bir yana, not başlığı, şablon adı ve **dosya
//! adı** bile loga girmez.* Bu modül `audit::kaydet`'e yalnızca (eylem,
//! varlık türü, satır kimliği, cihaz) geçirir; `ayrinti` her zaman
//! `None`'dır. `Ayrinti`'ye dosya adı taşıyacak yeni bir varyant
//! **eklenmemiştir ve eklenmemelidir** (bkz. `store::audit` modül başlığı:
//! doğrulanmamış serbest metin taşıyan varyant yasak).
//!
//! Dosya **içeriği** de aynı şekilde loga girmez; `icerik_getir` yalnızca
//! "hangi ek, ne zaman, hangi cihazdan dışa aktarıldı" bilgisini yazar.
//!
//! # KRİTİK: Hacim politikası — bu modülde İKİ farklı karar var
//!
//! `audit::LogHacmi`'nin `Default`'u yoktur; her çağıranın kararı açıkça
//! yazması gerekir (bkz. `store::audit` modül başlığı). Bu modüldeki dört
//! log çağrısının kararı ve gerekçesi:
//!
//! - `ekle` → `HerCagri`. Veriyi **değiştiren** işlem; her yükleme ayrı,
//!   seyrek ve sonradan hesabı verilmesi gereken bir olaydır. Bir dosyanın
//!   danışan dosyasına eklenmesi otomatik kayıt gibi kendini tekrar eden bir
//!   yol değildir — kullanıcı dosya seçer, yükler.
//! - `sil` → `HerCagri`. Aynı gerekçe; üstelik silme, denetim kaydının en
//!   çok ihtiyaç duyulan tarafıdır ("bu belge ne zaman, hangi cihazdan
//!   kaldırıldı").
//! - `icerik_getir` → `HerCagri`. Bu bir **dışa aktarmadır**: dosyanın tam
//!   içeriği veritabanının dışına çıkar. `audit`'in "loglanır" listesi dışa
//!   aktarmayı açıkça sayar. Birleştirilseydi bir seansta yapılan on
//!   indirmenin dokuzu görünmezdi.
//! - `listele` → `OturumBasi(BIRLESTIRME_PENCERESI_DK)`. Bu **gezinmenin yan
//!   etkisi olan tekrarlı bir okumadır**: danışan dosyası ekranı her
//!   mutasyondan sonra ek listesini yeniden çeker ve liste dosya içeriğini
//!   taşımaz. `appointments::aralik_getir` ve `notes::danisan_notlari` ile
//!   aynı sınıf. `varlik_id` yine de **hangi danışanın** listesi olduğunu
//!   taşır (`liste:<client_id>`): sabit bir "liste" kimliği kullanılsaydı
//!   birleştirme, farklı danışanların dosyalarına erişimi tek satırın
//!   arkasına saklardı.
//!
//! Her iki yön de testlerle sabitlenir: `HerCagri` yolları için "aynı
//! birleştirme anahtarına sahip taze bir satır varken bile ikinci satır
//! yazılır", `listele` için hem "30 yenileme tam olarak 1 satır" hem
//! "pencerenin dışındaki eski satır susturmaz". Tek yönlü mutasyon kapsamı
//! bu kod tabanında bir kez zaten sorun oldu (bkz. `notes.rs` modül başlığı).
//!
//! `depolama_durumu`'nun **hiç log yazmaması** da bir karardır ve kendi
//! testiyle (`depolama_durumu_log_yazmaz`) sabitlenir — emsali
//! `appointments::cakisma_kontrolu_log_yazmaz`. Kararı yorumda taşıyıp testini
//! taşımamak, bu modülde bir kez "yeşil ama korumuyor" üretti.
//!
//! # Sınırlar: biri REDDEDER, diğeri UYARIR
//!
//! - Dosya başına `AZAMI_DOSYA_BOYUTU` (**20 MB**) — **reddeder**. Sınırı
//!   aşan dosya veritabanına hiç girmez.
//! - Toplam `TOPLAM_UYARI_ESIGI` (**500 MB**) — **uyarır, engellemez**
//!   (`depolama_durumu`). Aynı karar bu kod tabanında çakışma kontrolünde de
//!   verildi (`appointments::cakisanlari_bul`: "engellemez, yalnızca
//!   döndürür") ve üç katmanda tutarlı tutuldu. Terapistin dosyasını
//!   büyüdüğü için kilitlemek, yazılımın vereceği bir karar değildir; ona
//!   söylemek ise gereklidir.
//!
//! # Hatalar birbirinden ayırt edilebilir
//!
//! Her reddin mesajı **ne olduğunu** söyler: hangi sınır, ne kadar aşıldı,
//! hangi alan. Bu kod tabanında "her hata parola hatasıdır" sınıfından bir
//! bulgu **dört katmanda** ayrı ayrı çıktı; buradaki hâli her başarısızlığa
//! "dosya eklenemedi" demek olurdu. `ekle`nin **on üç** red yolunun her biri
//! `mesajlar_birbirinden_ayirt_edilebilir` testinde kendi anahtar kelimesiyle
//! pinlenir; test ayrıca vaka sayısını da sabitler, çünkü kapsam dışı kalan
//! bir yol sessizce "Dosya eklenemedi."ye dönüşebilir (bu bir kez oldu: yedi
//! yol pinliydi, on bir yol vardı).
//!
//! **Mesajlara dosya adı konmaz.** Hata metinleri sunucu günlüğüne, bir
//! hata izleme aracına veya kullanıcı ekranının dışındaki bir yere düşebilir;
//! dosya adı da tıpkı logda olduğu gibi orada da sağlık verisidir. Sınır
//! mesajları yalnızca sayı ve kapalı kümeden gelen `tur` taşır.
//!
//! # Yazma + log aynı transaction'da
//!
//! `ekle` ve `sil` veriyi değiştirir; ikisi de tabloya yazdıktan hemen sonra
//! log kaydını **aynı** `conn.unchecked_transaction()` içinde yapar ve
//! açıkça `commit()` eder. Log yazımı başarısız olursa dosya da geri alınır:
//! "dosya eklendi ama loglanmadı" durumu oluşmaz. Garanti `audit_log`
//! tablosu kasten düşürülerek test edilir (`..._atomik_...` testleri) —
//! desen `clients.rs`, `appointments.rs` ve `notes.rs` ile birebir aynıdır.
//!
//! # UYARI — iç içe transaction açılamaz
//!
//! `ekle` ve `sil` kendi `unchecked_transaction()`'ını içeride açar. SQLite
//! iç içe transaction'ı desteklemez ("cannot start a transaction within a
//! transaction"): bu iki fonksiyonu **başka bir transaction'ın içinden**
//! çağırmayın. Bu sessiz bir veri bozulması değil, `rusqlite::Error` olarak
//! dönen gürültülü bir hatadır — ama derleyici yakalamaz.

use crate::store::audit::{kaydet, Cihaz, Eylem, LogHacmi, BIRLESTIRME_PENCERESI_DK};
use crate::store::clients::DepoHatasi;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

/// Dosya başına üst sınır: **20 MB** (plan global kısıtı).
///
/// Bu sınır **reddeder**. Değeri `sinir_degerleri_plana_sabitlenmis` testiyle
/// sabittir: göreli testler (`AZAMI_DOSYA_BOYUTU + 1` reddedilir) sınır 200
/// MB'a çıkarılsa da geçmeye devam ederdi — sınırı yükseltmek de en az
/// düşürmek kadar gerçek bir hata modudur (bir e-posta arşivi veya video
/// yedeklemeyi bozacak kadar şişer).
pub const AZAMI_DOSYA_BOYUTU: usize = 20 * 1024 * 1024;

/// Tüm eklerin toplamı için **uyarı** eşiği: 500 MB (plan global kısıtı).
///
/// ENGELLEMEZ. Bkz. modül başlığı — `appointments::cakisanlari_bul` ile aynı
/// ürün kararı: yazılım uyarır, kararı insan verir.
pub const TOPLAM_UYARI_ESIGI: i64 = 500 * 1024 * 1024;

/// Ek dosya türlerinin **kapalı** kümesi.
///
/// `schema.rs` V3'te `attachments.tur` aynı kümeyi `CHECK` ile taşır. Uygulama
/// katmanı doğrulaması veritabanı `CHECK`'inin önüne konur ki geçersiz tür
/// anlaşılır bir `DepoHatasi::GecersizVeri` olarak dönsün, ham SQLite kısıt
/// hatası olarak değil (`notes::GECERLI_SABLONLAR` ile aynı desen).
pub const GECERLI_TURLER: [&str; 3] = ["onam", "test", "diger"];

/// Dosya adı üst sınırı (karakter). Yaygın dosya sistemlerinin 255 baytlık
/// sınırıyla aynı büyüklükte; sınırsız bir ad hem arayüzü bozar hem de ileride
/// dosyayı diske yazacak dışa aktarma yolunu patlatır.
pub const AZAMI_DOSYA_ADI_UZUNLUGU: usize = 255;

/// MIME tipi üst sınırı (karakter). Gerçek MIME tipleri çok daha kısadır;
/// bu yalnızca alanın çöp veriyle şişmesini engeller.
pub const AZAMI_MIME_UZUNLUGU: usize = 128;

/// `audit_log.varlik` değeri.
const VARLIK: &str = "attachment";

/// Bir ekin **içeriği hariç** meta bilgisi.
///
/// # İçerik alanı YOKTUR ve eklenmemelidir
/// Bu, `listele` uç noktasının yanlışlıkla tüm PDF'leri JSON olarak
/// göndermesini **yapısal olarak** imkânsız kılar. `WHERE`/`select` düzeyinde
/// bir "içeriği dışarıda bırak" disiplini yeterli olmazdı: unutulan tek bir
/// sorgu 500 MB'lık bir yanıtı ve tam bir sızıntıyı beraberinde getirirdi.
/// İçerik yalnızca `icerik_getir`'in döndürdüğü `EkIcerigi` ile taşınır.
///
/// # `Debug` elle yazılmıştır
/// Bu kod tabanında türetilmiş `Debug` **dört kez** sızıntı üretti
/// (`crypto::keyring::DataKey`, `audit::Ayrinti`, `appointments::Randevu` ve
/// `notes::SeansNotu`'nda mutasyonla engellendi). `dosya_adi` tek başına
/// sağlık verisidir ("mahkeme-raporu.pdf"); `client_id` ise bir ekin
/// varlığıyla birleştiğinde "42 numaralı danışan terapide" bilgisini verir
/// (`Randevu::Debug` ile aynı muhakeme). İkisi de `<gizli>` basılır.
/// `Serialize` ise arayüz için **tüm** alanları içerir — ayrım kasıtlıdır:
/// arayüzün veriye ihtiyacı var, panik mesajının yok.
#[derive(Clone, Serialize)]
pub struct EkBilgisi {
    pub id: i64,
    pub client_id: i64,
    pub dosya_adi: String,
    pub mime: String,
    pub tur: String,
    pub boyut: i64,
    pub eklenme_zamani: String,
}

impl std::fmt::Debug for EkBilgisi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EkBilgisi")
            .field("id", &self.id)
            .field("client_id", &"<gizli>")
            .field("dosya_adi", &"<gizli>")
            .field("mime", &self.mime)
            .field("tur", &self.tur)
            .field("boyut", &self.boyut)
            .field("eklenme_zamani", &self.eklenme_zamani)
            .finish()
    }
}

/// Bir ekin ham içeriği.
///
/// # Neden düz `Vec<u8>` değil
/// Görev tanımı `icerik_getir` için `(EkBilgisi, Vec<u8>)` yazıyordu; tip
/// **bilerek** daraltıldı ve bu sapma burada gerekçelendirilir. `Vec<u8>`'in
/// `Debug`'ı içeriği ondalık bayt dizisi olarak **basar**:
/// `format!("{:?}", sonuc)` bir PDF'in tamamını `[37, 80, 68, 70, ...]` diye
/// döker. İki ayrı zarar: (1) sızıntı — bayt dizisi içeriğin ta kendisidir,
/// (2) kullanılamazlık — 20 MB'lık bir dosya ~80 MB'lık tek satırlık bir
/// panik mesajı üretir. Bu kod tabanının kendi standardı
/// (`notes::hata_yolunda_debug_ciktisi_da_icerigi_basmaz`)
/// `format!("{:?}", ok_sonuc)`'un içerik basmamasını şart koşuyor ve düz
/// `Vec<u8>` bunu **hiçbir şekilde** sağlayamaz.
///
/// Kullanım açısından fark yoktur: `Deref<Target = [u8]>` sayesinde `&*ek`,
/// `ek.len()`, `ek.baytlar()` çalışır ve `PartialEq` ile bayt dizileriyle
/// doğrudan karşılaştırılabilir.
///
/// # UYARI: koruma yalnızca KAZAYLA olan yolu kapatır
/// `&*icerik`, `&icerik[..]`, `baytlar()` ve `into_inner()` ham `&[u8]` /
/// `Vec<u8>` verir; bunların `Debug`'ı **yine** bütün dosyayı ondalık bayt
/// dizisi olarak basar. Newtype'ın kapattığı şey, sarmalayan bir tipin
/// (`Result`, `Option`, `Vec`) türetilmiş `Debug`'ının içeriği kendiliğinden
/// dökmesidir — bilerek ham baytlara inen bir çağrıyı kapatmaz. Dosya
/// içeriğini rotaya/diske taşımak için `into_inner()` kullanan kod, o
/// `Vec<u8>`'i **asla** `{:?}` ile biçimlendirmemelidir (tek bir
/// `tracing::debug!("{:?}", baytlar)` 20 MB'lık tek satırı geri getirir).
#[derive(Clone, PartialEq, Eq)]
pub struct EkIcerigi(Vec<u8>);

impl EkIcerigi {
    pub fn baytlar(&self) -> &[u8] {
        &self.0
    }
    pub fn into_inner(self) -> Vec<u8> {
        self.0
    }
}

impl std::ops::Deref for EkIcerigi {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        &self.0
    }
}

/// Baytları **asla** basmaz; yalnızca uzunluk görünür (bkz. tip belgesi).
impl std::fmt::Debug for EkIcerigi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "EkIcerigi(<gizli, {} bayt>)", self.0.len())
    }
}

impl<const N: usize> PartialEq<&[u8; N]> for EkIcerigi {
    fn eq(&self, other: &&[u8; N]) -> bool {
        self.0.as_slice() == other.as_slice()
    }
}

impl PartialEq<[u8]> for EkIcerigi {
    fn eq(&self, other: &[u8]) -> bool {
        self.0.as_slice() == other
    }
}

/// Toplam ek boyutunun eşiğe göre durumu — **uyarı**, engel değil.
///
/// Yalnızca sayı taşır; hassas veri yoktur, bu yüzden `Debug` türetilebilir.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct DepolamaDurumu {
    /// Tüm eklerin `boyut` toplamı (bayt).
    pub toplam_boyut: i64,
    /// `TOPLAM_UYARI_ESIGI`; arayüz eşiği kendi sabitlemesin diye döndürülür.
    pub esik: i64,
    /// `toplam_boyut > esik`. `true` olması hiçbir işlemi durdurmaz.
    pub uyari: bool,
}

fn simdi() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

/// `SELECT`'lerde kullanılan sütun listesi. **`icerik` bilerek yoktur**:
/// liste ve meta sorguları BLOB'u belleğe hiç almaz.
const META_SUTUNLAR: &str = "id, client_id, dosya_adi, mime, tur, boyut, eklenme_zamani";

fn satirdan(r: &rusqlite::Row<'_>) -> Result<EkBilgisi, rusqlite::Error> {
    Ok(EkBilgisi {
        id: r.get(0)?,
        client_id: r.get(1)?,
        dosya_adi: r.get(2)?,
        mime: r.get(3)?,
        tur: r.get(4)?,
        boyut: r.get(5)?,
        eklenme_zamani: r.get(6)?,
    })
}

/// Bayt sayısını insan okunur MB'a çevirir (hata mesajları için).
fn mb(bayt: usize) -> String {
    format!("{:.1} MB", bayt as f64 / (1024.0 * 1024.0))
}

/// Danışan var mı? Yoksa `Bulunamadi`.
///
/// **Log yazılmadan ÖNCE** çağrılır: var olmayan bir kimlik için log satırı
/// bırakmak, dışarıdan tetiklenebilir, sınırsız ve **silinemez** bir gürültü
/// yolu açar (`audit` modül başlığı; `notes::danisan_notlari`'nda aynı hata
/// bulunup düzeltildi).
fn danisan_var_mi(conn: &Connection, client_id: i64) -> Result<(), DepoHatasi> {
    let var: Option<i64> = conn
        .query_row("SELECT id FROM clients WHERE id = ?1", [client_id], |r| r.get(0))
        .optional()?;
    if var.is_none() {
        return Err(DepoHatasi::Bulunamadi);
    }
    Ok(())
}

/// Görünmez ya da metin yönünü değiştiren karakter mi?
///
/// İkisi de aynı saldırıyı besler: **ad sahteciliği**. `annexe\u{202E}fdp.exe`
/// listede "annexe exe.pdf" gibi görünür (U+202E sonrasını sağdan sola
/// çevirir); sıfır genişlikli karakterler ise iki farklı adı ekranda birebir
/// aynı gösterir. Bu, dosya diske hiç yazılmasa bile bugün geçerli bir
/// zarardır: terapist listede gördüğü uzantıya güvenerek tıklar.
///
/// `is_control()` bunların **hiçbirini** yakalamaz — hepsi `Cf` (format)
/// sınıfındadır, `Cc` (control) değil.
fn ad_sahteciligi_karakteri(c: char) -> bool {
    matches!(c,
        // Sifir genislikli (ZWSP/ZWNJ/ZWJ/ZWNBSP-BOM)
        '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}'
        // Yon isaretleri (LRM/RLM/ALM)
        | '\u{200E}' | '\u{200F}' | '\u{061C}'
        // Gomme ve gecersiz kilma (LRE/RLE/PDF/LRO/RLO)
        | '\u{202A}'..='\u{202E}'
        // Yalitma (LRI/RLI/FSI/PDI)
        | '\u{2066}'..='\u{2069}'
    )
}

/// Dosya adını doğrular ve `trim`'lenmiş hâlini döndürür.
///
/// Ad kullanıcıdan gelir ve ileride iki tehlikeli yere gider: HTTP
/// `Content-Disposition` başlığı (Görev 6'nın indirme rotası) ve olası bir
/// diske yazma. Bu yüzden yol ayıracı ve denetim karakteri burada, tek kapıda
/// reddedilir — her reddin kendi mesajı vardır.
///
/// Ayrıca **görünen ad ile gerçek ad** arasında fark yaratan karakterler de
/// reddedilir (bkz. `ad_sahteciligi_karakteri`): bu red diske yazmaya değil,
/// bugün ekranda gösterilen listeye dayanır.
fn dosya_adi_dogrula(ham: &str) -> Result<String, DepoHatasi> {
    let ad = ham.trim();
    if ad.is_empty() {
        return Err(DepoHatasi::GecersizVeri("Dosya adı boş olamaz.".into()));
    }
    if ad.chars().count() > AZAMI_DOSYA_ADI_UZUNLUGU {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Dosya adı çok uzun: {} karakter, üst sınır {AZAMI_DOSYA_ADI_UZUNLUGU}.",
            ad.chars().count()
        )));
    }
    // Ham adin KENDISI mesaja konmaz (bkz. modul basligi): dosya adi saglik
    // verisidir, hata metinleri ise ekranin disina dusebilir.
    if ad.contains('/') || ad.contains('\\') {
        return Err(DepoHatasi::GecersizVeri("Dosya adı yol ayıracı içeremez.".into()));
    }
    if ad == "." || ad == ".." {
        return Err(DepoHatasi::GecersizVeri("Dosya adı geçerli bir ad olmalı.".into()));
    }
    if ad.chars().any(|c| c.is_control() || c == '"') {
        return Err(DepoHatasi::GecersizVeri(
            "Dosya adı denetim karakteri veya tırnak içeremez.".into(),
        ));
    }
    if ad.chars().any(ad_sahteciligi_karakteri) {
        return Err(DepoHatasi::GecersizVeri(
            "Dosya adı görünmez veya metin yönünü değiştiren karakter içeremez.".into(),
        ));
    }
    Ok(ad.to_string())
}

/// MIME tipini doğrular ve `trim`'lenmiş hâlini döndürür.
///
/// Üç red yolu da ileride `Content-Type` başlığına konulacak bir değeri
/// hedefler:
/// - **Uzunluk**: alanın çöp veriyle şişmesini engeller; bir MIME tipi 128
///   karakteri aşmaz.
/// - **Denetim karakteri**: `Content-Type` başlığına **CRLF enjeksiyonunu**
///   engelleyen tek kontrol budur (`application/pdf\r\nX-Baska: ...` başlık
///   bölmesi demektir). Görev 7'nin indirme rotası bu değeri doğrudan başlığa
///   koyacak.
/// - **Biçim**: `tip/alttip`. Bu olmadan `x` gibi anlamsız bir değer geçer ve
///   tarayıcıya bozuk bir `Content-Type` gider.
fn mime_dogrula(ham: &str) -> Result<String, DepoHatasi> {
    let m = ham.trim();
    if m.is_empty() {
        return Err(DepoHatasi::GecersizVeri("Dosya türü (MIME) boş olamaz.".into()));
    }
    if m.chars().count() > AZAMI_MIME_UZUNLUGU {
        return Err(DepoHatasi::GecersizVeri(format!(
            "MIME tipi çok uzun: {} karakter, üst sınır {AZAMI_MIME_UZUNLUGU}.",
            m.chars().count()
        )));
    }
    if m.chars().any(|c| c.is_control()) {
        return Err(DepoHatasi::GecersizVeri("MIME tipi denetim karakteri içeremez.".into()));
    }
    // `charset` gibi parametreler (`text/plain; charset=utf-8`) mesru MIME
    // sozdizimidir ve elenmez; elenen sey ayirac tasimayan ya da bos parcali
    // degerlerdir.
    let bicimli = match m.split_once('/') {
        Some((tip, alttip)) => !tip.is_empty() && !alttip.is_empty() && !alttip.contains('/'),
        None => false,
    };
    if !bicimli {
        return Err(DepoHatasi::GecersizVeri(
            "MIME tipi 'tip/alttip' biçiminde olmalı.".into(),
        ));
    }
    Ok(m.to_string())
}

/// Bir dosyayı danışanın dosyasına ekler (BLOB olarak veritabanına).
///
/// Doğrulamalar: dosya adı, MIME, kapalı tür kümesi, boş içerik ve
/// `AZAMI_DOSYA_BOYUTU`. Her reddin **ayrı ve açıklayıcı** bir mesajı vardır;
/// hiçbiri dosya adını taşımaz.
///
/// Yazma ve log **tek transaction**'da yapılır; log başarısız olursa dosya da
/// geri alınır.
///
/// `TOPLAM_UYARI_ESIGI` burada **kontrol edilmez**: eşik uyarıdır, engel
/// değil (bkz. `depolama_durumu` ve modül başlığı).
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar — bunu zaten açık
/// bir transaction'ın içinden çağırmayın (bkz. modül başlığındaki uyarı).
pub fn ekle(
    conn: &Connection,
    client_id: i64,
    dosya_adi: &str,
    mime: &str,
    tur: &str,
    icerik: &[u8],
    cihaz: Cihaz,
) -> Result<EkBilgisi, DepoHatasi> {
    let ad = dosya_adi_dogrula(dosya_adi)?;
    let mime = mime_dogrula(mime)?;

    if !GECERLI_TURLER.contains(&tur) {
        // `tur` kapali bir kumeden gelir, kullanici metni degildir; mesajda
        // gostermek hem guvenli hem de duzeltilebilir bir hata verir.
        return Err(DepoHatasi::GecersizVeri(format!(
            "Geçersiz dosya türü: {tur}. Geçerli türler: {}.",
            GECERLI_TURLER.join(", ")
        )));
    }
    if icerik.is_empty() {
        return Err(DepoHatasi::GecersizVeri("Dosya boş: 0 bayt.".into()));
    }
    if icerik.len() > AZAMI_DOSYA_BOYUTU {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Dosya çok büyük: {} bayt ({}); üst sınır {} bayt ({}).",
            icerik.len(),
            mb(icerik.len()),
            AZAMI_DOSYA_BOYUTU,
            mb(AZAMI_DOSYA_BOYUTU)
        )));
    }

    // Once varlik kontrolu, SONRA yazma/log: olmayan bir danisan icin ne satir
    // ne de silinemez bir log kaydi birakilir.
    danisan_var_mi(conn, client_id)?;

    let zaman = simdi();
    let boyut = icerik.len() as i64;

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO attachments (client_id, dosya_adi, mime, tur, boyut, icerik, eklenme_zamani)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![client_id, ad, mime, tur, boyut, icerik, zaman],
    )?;
    let id = tx.last_insert_rowid();

    // Dosya adi ve icerigi loga GIRMEZ; yalnizca satir kimligi.
    kaydet(&tx, Eylem::Ekleme, VARLIK, &id.to_string(), cihaz, None, LogHacmi::HerCagri)?;

    tx.commit()?;

    Ok(EkBilgisi {
        id,
        client_id,
        dosya_adi: ad,
        mime,
        tur: tur.to_string(),
        boyut,
        eklenme_zamani: zaman,
    })
}

/// Bir danışanın eklerini en yeniden en eskiye listeler.
///
/// # DİKKAT: bu sorgu `icerik` sütununu SEÇMEZ
/// Liste yolu BLOB'ları belleğe hiç almaz (`META_SUTUNLAR`) ve dönen tip
/// (`EkBilgisi`) içerik alanı taşımaz — koruma hem sorgu hem tip düzeyinde,
/// yapısaldır.
///
/// Var olmayan danışan `Bulunamadi` döner ve **log yazılmaz**.
///
/// Log: gezinme kaynaklı tekrarlı okuma → birleştirilir; `varlik_id` hangi
/// danışanın listesi olduğunu taşır (bkz. modül başlığı).
pub fn listele(
    conn: &Connection,
    client_id: i64,
    cihaz: Cihaz,
) -> Result<Vec<EkBilgisi>, DepoHatasi> {
    danisan_var_mi(conn, client_id)?;

    let mut stmt = conn.prepare(&format!(
        "SELECT {META_SUTUNLAR} FROM attachments
         WHERE client_id = ?1
         ORDER BY eklenme_zamani DESC, id DESC"
    ))?;
    let liste = stmt.query_map([client_id], satirdan)?.collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK,
        &format!("liste:{client_id}"),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;
    Ok(liste)
}

/// Bir ekin meta bilgisini **ve içeriğini** okur.
///
/// Bu bir **dışa aktarmadır** (`Eylem::DisaAktarma`) ve `LogHacmi::HerCagri`
/// ile loglanır: her indirme ayrı bir olaydır (bkz. modül başlığı). Var
/// olmayan kimlik `Bulunamadi` döner ve log yazılmaz.
///
/// Dönen içerik `EkIcerigi`'dir, düz `Vec<u8>` değil — gerekçe o tipin
/// belgesinde: `Vec<u8>`'in `Debug`'ı dosyanın tamamını basar.
pub fn icerik_getir(
    conn: &Connection,
    id: i64,
    cihaz: Cihaz,
) -> Result<(EkBilgisi, EkIcerigi), DepoHatasi> {
    let satir = conn
        .query_row(
            &format!("SELECT {META_SUTUNLAR}, icerik FROM attachments WHERE id = ?1"),
            [id],
            |r| Ok((satirdan(r)?, r.get::<_, Vec<u8>>(7)?)),
        )
        .optional()?;

    let (bilgi, icerik) = match satir {
        Some(x) => x,
        // Once oku, yoksa don, SONRA logla.
        None => return Err(DepoHatasi::Bulunamadi),
    };

    kaydet(conn, Eylem::DisaAktarma, VARLIK, &id.to_string(), cihaz, None, LogHacmi::HerCagri)?;

    Ok((bilgi, EkIcerigi(icerik)))
}

/// Bir eki kalıcı olarak siler.
///
/// # `clients.riza_dosya_id` de temizlenir — ve bu AYRI bir log satırı ÜRETMEZ
/// `riza_dosya_id` bir `attachments` satırına işaret eden, yabancı anahtarla
/// zorlanmayan bir kimliktir. Silinen ek oraya işaret ediyorsa alan boşa
/// çıkarılır; aksi hâlde danışan kartı var olmayan bir belgeyi gösterirdi.
/// Bu, `clients::son_temasi_tazele` ile aynı sınıftan bir **türetilmiş defter
/// alanı tazelemesidir**: onu tetikleyen gerçek kullanıcı eylemi (ekin
/// silinmesi) zaten burada loglanır, ikinci bir satır aynı tek eylem için iki
/// silinemez kayıt demek olurdu (bkz. `audit` hacim politikası). `riza_tarihi`
/// **korunur**: rızanın alındığı gerçeği dosyanın silinmesiyle ortadan
/// kalkmaz.
///
/// Silme ve log **tek transaction**'da yapılır; ikisi de ya olur ya olmaz.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar — bunu zaten açık
/// bir transaction'ın içinden çağırmayın (bkz. modül başlığındaki uyarı).
pub fn sil(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi> {
    let tx = conn.unchecked_transaction()?;

    let etkilenen = tx.execute("DELETE FROM attachments WHERE id = ?1", [id])?;
    if etkilenen == 0 {
        // `tx` burada duser -> rollback. Hicbir satiri etkilemeyen bir silme
        // olmamis bir islemdir ve loglanmaz.
        return Err(DepoHatasi::Bulunamadi);
    }

    tx.execute("UPDATE clients SET riza_dosya_id = NULL WHERE riza_dosya_id = ?1", [id])?;

    kaydet(&tx, Eylem::Silme, VARLIK, &id.to_string(), cihaz, None, LogHacmi::HerCagri)?;

    tx.commit()?;
    Ok(())
}

/// Toplam ek boyutunu ve uyarı eşiğinin aşılıp aşılmadığını döndürür.
///
/// **Engellemez.** `uyari == true` iken `ekle` çalışmaya devam eder; karar
/// kullanıcınındır (bkz. modül başlığı, `appointments::cakisanlari_bul` ile
/// aynı ürün kararı).
///
/// Erişim logu YAZMAZ: kullanıcıya veri göstermeyen, bir sayıdan ibaret durum
/// sorgusudur ve her ekran yenilemesinde çalışabilir — `cakisanlari_bul` ile
/// aynı sınıf (bkz. `audit` "loglanmaz: doğrulama sorguları").
///
/// `boyut` sütunu toplanır, BLOB'lar okunmaz.
pub fn depolama_durumu(conn: &Connection) -> Result<DepolamaDurumu, DepoHatasi> {
    let toplam: i64 = conn
        .query_row("SELECT COALESCE(SUM(boyut), 0) FROM attachments", [], |r| r.get(0))?;
    Ok(DepolamaDurumu {
        toplam_boyut: toplam,
        esik: TOPLAM_UYARI_ESIGI,
        uyari: toplam > TOPLAM_UYARI_ESIGI,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        audit::son_kayitlar,
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

    /// Belirli bir (eylem, varlik, varlik_id) uclusu icin log satiri sayisi.
    /// Kurulumun (danisan ekleme) urettigi satirlari disarida birakmak icin
    /// daraltilmis sayim sart.
    fn log_sayisi(c: &rusqlite::Connection, eylem: &str, varlik: &str, varlik_id: &str) -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM audit_log
              WHERE eylem = ?1 AND varlik = ?2 AND varlik_id = ?3",
            [eylem, varlik, varlik_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// `dk_once` dakika onceye ait bir log satirini DOGRUDAN yazar
    /// (`notes::tests::eski_satir_ekle` ile ayni desen). `audit_log`'a INSERT
    /// serbesttir; yasak olan UPDATE/DELETE'tir.
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

    /// Gercek BLOB yazmadan toplam boyutu sisirir: `boyut` sutununa buyuk bir
    /// deger, `icerik`'e tek bayt. 500 MB'lik gercek veri yazmak testi
    /// dakikalarca surdururdu; olculen sey zaten `SUM(boyut)`.
    fn sahte_boyutlu_satir(c: &rusqlite::Connection, client_id: i64, boyut: i64) {
        c.execute(
            "INSERT INTO attachments (client_id, dosya_adi, mime, tur, boyut, icerik, eklenme_zamani)
             VALUES (?1, 'x.bin', 'application/octet-stream', 'diger', ?2, X'00', '2026-01-01T00:00:00Z')",
            rusqlite::params![client_id, boyut],
        )
        .unwrap();
    }

    /// Belirtilen `dosya_adi` ve `eklenme_zamani` ile DOGRUDAN satir yazar.
    ///
    /// `ekle` zaman damgasini `simdi()`'den alir ve `simdi()` saniyeye
    /// yuvarlar: ayni testte arka arkaya yapilan iki `ekle` cagrisi cogu zaman
    /// AYNI `eklenme_zamani`'ni uretir. Siralamanin BIRINCIL anahtarini olcen
    /// bir testin bunu kullanmasi, testi fiilen ikincil anahtara
    /// (`id DESC`) indirger -- bkz. `listele_en_yeniden_eskiye_siralar`.
    fn sahte_zamanli_satir(
        c: &rusqlite::Connection,
        client_id: i64,
        dosya_adi: &str,
        eklenme_zamani: &str,
    ) {
        c.execute(
            "INSERT INTO attachments (client_id, dosya_adi, mime, tur, boyut, icerik, eklenme_zamani)
             VALUES (?1, ?2, 'application/pdf', 'diger', 1, X'00', ?3)",
            rusqlite::params![client_id, dosya_adi, eklenme_zamani],
        )
        .unwrap();
    }

    // --- Brief'in yedi testi ---------------------------------------------

    #[test]
    fn dosya_eklenir_ve_icerigi_geri_okunur() {
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "onam.pdf", "application/pdf", "onam", b"PDF-icerik", Cihaz::Masaustu)
            .unwrap();
        assert_eq!(ek.boyut, 10);

        let (bilgi, icerik) = icerik_getir(&c, ek.id, Cihaz::Masaustu).unwrap();
        assert_eq!(icerik, b"PDF-icerik");
        // Meta bilgi de dogru dondu: `assert_eq!(icerik, ...)` tek basina
        // bilginin bos/yanlis olmasini yakalamazdi.
        assert_eq!(bilgi.id, ek.id);
        assert_eq!(bilgi.dosya_adi, "onam.pdf");
        assert_eq!(bilgi.tur, "onam");
        assert_eq!(bilgi.boyut, 10);
    }

    #[test]
    fn listeleme_dosya_icerigini_dondurmez() {
        let (_d, c, cid) = kurulum();
        ekle(&c, cid, "onam.pdf", "application/pdf", "onam", b"GIZLI_ICERIK", Cihaz::Masaustu)
            .unwrap();

        let liste = listele(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(liste.len(), 1, "on kosul: liste bos olmamali, yoksa iddia totoloji olur");
        let json = serde_json::to_string(&liste).unwrap();
        assert!(!json.contains("GIZLI_ICERIK"), "liste icerik tasimamali");
        assert!(json.contains("onam.pdf"));
    }

    #[test]
    fn azami_boyut_asilirsa_reddedilir() {
        let (_d, c, cid) = kurulum();
        let buyuk = vec![0u8; AZAMI_DOSYA_BOYUTU + 1];
        let hata =
            ekle(&c, cid, "buyuk.bin", "application/octet-stream", "diger", &buyuk, Cihaz::Masaustu)
                .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));

        // Reddedilen cagri HICBIR sey yazmamali.
        let sayi: i64 =
            c.query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 0);
    }

    #[test]
    fn bos_dosya_reddedilir() {
        let (_d, c, cid) = kurulum();
        assert!(ekle(&c, cid, "bos.pdf", "application/pdf", "onam", b"", Cihaz::Masaustu).is_err());
    }

    #[test]
    fn gecersiz_tur_reddedilir() {
        let (_d, c, cid) = kurulum();
        assert!(ekle(&c, cid, "x.pdf", "application/pdf", "baska_tur", b"x", Cihaz::Masaustu)
            .is_err());
    }

    #[test]
    fn silinen_dosya_listede_cikmaz_ve_loglanir() {
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "x.pdf", "application/pdf", "diger", b"x", Cihaz::Masaustu).unwrap();
        sil(&c, ek.id, Cihaz::Masaustu).unwrap();

        assert!(listele(&c, cid, Cihaz::Masaustu).unwrap().is_empty());
        let eylemler: Vec<String> =
            son_kayitlar(&c, 20).unwrap().into_iter().map(|k| k.eylem).collect();
        assert!(eylemler.contains(&"silme".to_string()));
    }

    #[test]
    fn dosya_icerigi_erisim_loguna_yazilmaz() {
        let (_d, c, cid) = kurulum();
        let ek = ekle(
            &c,
            cid,
            "COK_GIZLI_DOSYA_ADI.pdf",
            "application/pdf",
            "onam",
            b"COK_GIZLI_ICERIK",
            Cihaz::Masaustu,
        )
        .unwrap();
        // Okuma yollari da loga yaziyor; onlar da denetlenmeli.
        listele(&c, cid, Cihaz::Masaustu).unwrap();
        icerik_getir(&c, ek.id, Cihaz::Masaustu).unwrap();
        sil(&c, ek.id, Cihaz::Masaustu).unwrap();

        let kayitlar = son_kayitlar(&c, 50).unwrap();
        assert!(!kayitlar.is_empty(), "on kosul: denetlenecek log satiri olmali");
        for kayit in kayitlar {
            let hepsi =
                format!("{} {} {} {:?}", kayit.eylem, kayit.varlik, kayit.varlik_id, kayit.ayrinti);
            assert!(!hepsi.contains("COK_GIZLI"), "dosya icerigi/adi loga sizmis: {hepsi}");
        }
    }

    // --- Sinirlar: IKI YON ------------------------------------------------
    //
    // Yalnizca "asan reddedilir" testi yazilsaydi, HER SEYI reddeden bir
    // uygulama da testi gecerdi. Ve iki test de sinira GORELI oldugundan
    // sinirin 200 MB'a cikarilmasini hicbiri yakalamazdi -- o yuzden ayrica
    // sabit degeri de pinliyoruz.

    #[test]
    fn sinirin_tam_uzerindeki_dosya_kabul_edilir() {
        let (_d, c, cid) = kurulum();
        let tam = vec![7u8; AZAMI_DOSYA_BOYUTU];
        let ek =
            ekle(&c, cid, "tam.bin", "application/octet-stream", "diger", &tam, Cihaz::Masaustu)
                .unwrap_or_else(|e| panic!("sinirin TAM uzerindeki dosya kabul edilmeliydi: {e}"));
        assert_eq!(ek.boyut, AZAMI_DOSYA_BOYUTU as i64);

        // Ve gercekten bozulmadan geri okunuyor.
        let (_b, icerik) = icerik_getir(&c, ek.id, Cihaz::Masaustu).unwrap();
        assert_eq!(icerik.len(), AZAMI_DOSYA_BOYUTU);
        assert_eq!(icerik.baytlar()[AZAMI_DOSYA_BOYUTU - 1], 7);
    }

    #[test]
    fn kucuk_dosyalar_kabul_edilir() {
        // "Her seyi reddet" mutasyonuna karsi ucuz ve dogrudan kanit.
        let (_d, c, cid) = kurulum();
        for (ad, tur) in [("a.pdf", "onam"), ("b.pdf", "test"), ("c.bin", "diger")] {
            ekle(&c, cid, ad, "application/pdf", tur, b"kucuk", Cihaz::Masaustu)
                .unwrap_or_else(|e| panic!("{ad} kabul edilmeliydi: {e}"));
        }
        assert_eq!(listele(&c, cid, Cihaz::Masaustu).unwrap().len(), 3);
    }

    #[test]
    fn sinir_degerleri_plana_sabitlenmis() {
        // Bu test bilerek "totolojik gorunur" ama degildir: yukaridaki iki
        // sinir testi de sabite GORELI yazilmistir, dolayisiyla siniri 200
        // MB'a cikaran bir mutasyonu ikisi de yakalamaz. Plan global kisiti
        // sayilari acikca soyluyor (20 MB / 500 MB); mutasyon burada kirilir.
        assert_eq!(AZAMI_DOSYA_BOYUTU, 20 * 1024 * 1024, "plan: dosya basina 20 MB");
        assert_eq!(TOPLAM_UYARI_ESIGI, 500 * 1024 * 1024, "plan: toplam uyari esigi 500 MB");
    }

    #[test]
    fn boyut_hatasi_ne_oldugunu_soyler() {
        let (_d, c, cid) = kurulum();
        let buyuk = vec![0u8; AZAMI_DOSYA_BOYUTU + 1];
        let hata =
            ekle(&c, cid, "buyuk.bin", "application/octet-stream", "diger", &buyuk, Cihaz::Masaustu)
                .unwrap_err();
        let mesaj = hata.to_string();
        assert!(mesaj.contains(&(AZAMI_DOSYA_BOYUTU + 1).to_string()), "gercek boyut: {mesaj}");
        assert!(mesaj.contains(&AZAMI_DOSYA_BOYUTU.to_string()), "sinir: {mesaj}");
        assert!(mesaj.contains("20.0 MB"), "insan okunur biçim: {mesaj}");
        // Dosya adi hata metnine GIRMEZ (bkz. modul basligi).
        assert!(!mesaj.contains("buyuk.bin"), "hata mesaji dosya adi tasimamali: {mesaj}");
    }

    #[test]
    fn mesajlar_birbirinden_ayirt_edilebilir() {
        // "Her hata dosya eklenemedi" sinifi bu kod tabaninda DORT katmanda
        // bulundu. `ekle`nin ON UC ayri red yolunun on uc ayri mesaji olmali.
        //
        // Bu testin onceki hali yalnizca YEDI yolu pinliyordu (yorumu da
        // "yedi" diyordu, oysa o gun bile on bir yol vardi). Kapsanmayan
        // dortunu -- nokta adi, addaki denetim karakteri, uzun MIME, MIME'daki
        // denetim karakteri -- hep birden "Dosya eklenemedi. (A/B/C/D)" yapan
        // mutasyon paketi YESIL biraktiriyordu; `guard::depo_hatasi` bu metni
        // dogrudan HTTP govdesine koydugu icin kullanici etkisi gercek.
        //
        // YALNIZCA ikili farklilik yetmez: bu testin ilk halinde tek bir
        // mesaji "Dosya eklenemedi." yapan mutasyon HAYATTA KALDI -- cunku o
        // mesaj da digerlerinden farkliydi. Bu yuzden her vaka ayrica KENDI
        // sebebini adlandirmak zorunda: mesaj hangi alanin neden reddedildigini
        // soylemezse kullanici neyi duzeltecegini bilemez.
        let (_d, c, cid) = kurulum();
        let buyuk = vec![0u8; AZAMI_DOSYA_BOYUTU + 1];
        let uzun_ad = format!("{}.pdf", "a".repeat(AZAMI_DOSYA_ADI_UZUNLUGU));
        // Bicim gecerli kalsin ki uzunluk yolu olculsun, bicim yolu degil.
        let uzun_mime = format!("application/{}", "a".repeat(AZAMI_MIME_UZUNLUGU));
        // (vaka adi, hata, mesajda GECMESI gereken anahtar kelimeler)
        let denemeler: Vec<(&str, DepoHatasi, Vec<&str>)> = vec![
            (
                "bos ad",
                ekle(&c, cid, "   ", "application/pdf", "onam", b"x", Cihaz::Masaustu).unwrap_err(),
                vec!["Dosya adı", "boş"],
            ),
            (
                "uzun ad",
                ekle(&c, cid, &uzun_ad, "application/pdf", "onam", b"x", Cihaz::Masaustu)
                    .unwrap_err(),
                vec!["Dosya adı", "uzun", "255"],
            ),
            (
                "yol ayiraci",
                ekle(&c, cid, "../gizli.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu)
                    .unwrap_err(),
                vec!["Dosya adı", "yol ayıracı"],
            ),
            (
                "nokta adi",
                ekle(&c, cid, "..", "application/pdf", "onam", b"x", Cihaz::Masaustu).unwrap_err(),
                vec!["Dosya adı", "geçerli"],
            ),
            (
                "addaki denetim karakteri",
                ekle(&c, cid, "a\nb.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu)
                    .unwrap_err(),
                vec!["Dosya adı", "denetim karakteri"],
            ),
            (
                "addaki yon degistiren karakter",
                ekle(&c, cid, "annexe\u{202E}fdp.exe", "application/pdf", "onam", b"x", Cihaz::Masaustu)
                    .unwrap_err(),
                vec!["Dosya adı", "yön"],
            ),
            (
                "bos mime",
                ekle(&c, cid, "a.pdf", "  ", "onam", b"x", Cihaz::Masaustu).unwrap_err(),
                vec!["MIME", "boş"],
            ),
            (
                "uzun mime",
                ekle(&c, cid, "a.pdf", &uzun_mime, "onam", b"x", Cihaz::Masaustu).unwrap_err(),
                vec!["MIME", "uzun", "128"],
            ),
            (
                "mime denetim karakteri",
                ekle(
                    &c,
                    cid,
                    "a.pdf",
                    "application/pdf\r\nX-Enjekte: 1",
                    "onam",
                    b"x",
                    Cihaz::Masaustu,
                )
                .unwrap_err(),
                vec!["MIME", "denetim karakteri"],
            ),
            (
                "bicimsiz mime",
                ekle(&c, cid, "a.pdf", "x", "onam", b"x", Cihaz::Masaustu).unwrap_err(),
                vec!["MIME", "tip/alttip"],
            ),
            (
                "gecersiz tur",
                ekle(&c, cid, "a.pdf", "application/pdf", "baska", b"x", Cihaz::Masaustu)
                    .unwrap_err(),
                vec!["tür", "baska", "onam", "test", "diger"],
            ),
            (
                "bos icerik",
                ekle(&c, cid, "a.pdf", "application/pdf", "onam", b"", Cihaz::Masaustu)
                    .unwrap_err(),
                vec!["Dosya boş", "0 bayt"],
            ),
            (
                "cok buyuk",
                ekle(&c, cid, "a.bin", "application/pdf", "onam", &buyuk, Cihaz::Masaustu)
                    .unwrap_err(),
                vec!["büyük", "20971521", "20971520"],
            ),
        ];

        assert_eq!(
            denemeler.len(),
            13,
            "`ekle`nin HER red yolu burada olmali: yeni bir red eklendiginde bu \
             sayi da, vaka da guncellenmeli (kapsam disi kalan yol sessizce \
             'Dosya eklenemedi.'ye donusebilir)"
        );

        for (vaka, hata, anahtarlar) in &denemeler {
            let mesaj = hata.to_string();
            for anahtar in anahtarlar {
                assert!(
                    mesaj.contains(anahtar),
                    "'{vaka}' mesaji '{anahtar}' gecirmeli, ne oldugunu soylemeli: {mesaj}"
                );
            }
        }

        let mesajlar: Vec<String> = denemeler.iter().map(|(_, h, _)| h.to_string()).collect();
        for (i, (ad_i, _, _)) in denemeler.iter().enumerate() {
            for (j, (ad_j, _, _)) in denemeler.iter().enumerate().skip(i + 1) {
                assert_ne!(
                    mesajlar[i], mesajlar[j],
                    "'{ad_i}' ve '{ad_j}' ayni mesaji veriyor: {}",
                    mesajlar[i]
                );
            }
        }
        // Ve hicbiri dosya adini tasimiyor.
        for m in &mesajlar {
            assert!(!m.contains("gizli.pdf"), "hata mesaji dosya adi tasimamali: {m}");
        }
    }

    #[test]
    fn yol_ayiraci_ve_denetim_karakteri_reddedilir() {
        let (_d, c, cid) = kurulum();
        for kotu in ["../../etc/passwd", "a\\b.pdf", "a\nb.pdf", "sa\"yfa.pdf", ".", ".."] {
            assert!(
                ekle(&c, cid, kotu, "application/pdf", "onam", b"x", Cihaz::Masaustu).is_err(),
                "{kotu:?} reddedilmeliydi"
            );
        }
        // Ama olagan bir Turkce dosya adi kabul edilir -- dogrulayici asiri
        // genis degil.
        let ek = ekle(&c, cid, " Onam Formu (imzalı).pdf ", "application/pdf", "onam", b"x", Cihaz::Masaustu)
            .unwrap();
        assert_eq!(ek.dosya_adi, "Onam Formu (imzalı).pdf", "ad trim edilmeli");
    }

    #[test]
    fn ad_sahteciligi_karakterleri_reddedilir() {
        // Klasik ad sahteciligi: U+202E (RLO) sonrasini sagdan sola cevirir,
        // "annexe<RLO>fdp.exe" listede "annexe exe.pdf" gibi gorunur.
        // Sifir genislikli karakterler ise iki farkli adi ekranda birebir ayni
        // gosterir. Ikisi de `is_control()` ile YAKALANMAZ (`Cf`, `Cc` degil):
        // bu yuzden ayri bir dogrulayici var.
        //
        // Zarar dosyanin diske yazilmasini beklemez -- terapist bugun listede
        // gordugu uzantiya guvenerek tiklar.
        let (_d, c, cid) = kurulum();
        for kotu in [
            "annexe\u{202E}fdp.exe", // RLO
            "rapor\u{202D}.pdf",     // LRO
            "rapor\u{202B}.pdf",     // RLE
            "rapor\u{2067}.pdf",     // RLI
            "onam\u{200B}.pdf",      // ZWSP
            "onam\u{200D}.pdf",      // ZWJ
            "\u{FEFF}onam.pdf",      // BOM / ZWNBSP
            "onam\u{200F}.pdf",      // RLM
        ] {
            let hata =
                ekle(&c, cid, kotu, "application/pdf", "onam", b"x", Cihaz::Masaustu).unwrap_err();
            assert!(
                matches!(hata, DepoHatasi::GecersizVeri(_)),
                "{kotu:?} ad sahteciligi olarak reddedilmeliydi"
            );
        }

        // Ve dogrulayici asiri genis degil: Turkce harfler, emoji ve tire
        // tasiyan olagan adlar hala kabul edilir.
        for iyi in ["Onam Formu şĞİı.pdf", "2026-mahkeme-raporu.pdf", "özet 📄.pdf"] {
            ekle(&c, cid, iyi, "application/pdf", "onam", b"x", Cihaz::Masaustu)
                .unwrap_or_else(|e| panic!("{iyi:?} kabul edilmeliydi: {e}"));
        }
    }

    #[test]
    fn mime_uzunluk_denetim_karakteri_ve_bicim_dogrulanir() {
        // Bu uc dogrulayicinin UCU DE hicbir testte calismiyordu: uzunluk ve
        // denetim karakteri bloklari TAMAMEN silinince paket yesil kaliyordu.
        // Denetim karakteri kontrolu, Gorev 7'nin indirme rotasinda
        // `Content-Type` basligina CRLF ENJEKSIYONUNU engelleyen tek seydir.
        let (_d, c, cid) = kurulum();
        let uzun = format!("application/{}", "a".repeat(AZAMI_MIME_UZUNLUGU));
        assert!(uzun.chars().count() > AZAMI_MIME_UZUNLUGU, "on kosul: gercekten sinir asilmali");

        for kotu in [
            uzun.as_str(),
            "application/pdf\r\nX-Enjekte: 1", // baslik bolmesi
            "application/pdf\nSet-Cookie: a=b",
            "application/\u{0}pdf",
            "x",                // bicimsiz
            "application",      // alttip yok
            "application/",     // bos alttip
            "/pdf",             // bos tip
            "application/a/b",  // fazla ayirac
        ] {
            let hata = ekle(&c, cid, "a.pdf", kotu, "onam", b"x", Cihaz::Masaustu).unwrap_err();
            assert!(matches!(hata, DepoHatasi::GecersizVeri(_)), "{kotu:?} reddedilmeliydi");
        }

        // Sinirin TAM uzerindeki MIME kabul edilir -- "her seyi reddet"
        // mutasyonuna karsi ikinci yon.
        let tam = format!("application/{}", "a".repeat(AZAMI_MIME_UZUNLUGU - "application/".len()));
        assert_eq!(tam.chars().count(), AZAMI_MIME_UZUNLUGU, "on kosul");
        let ek = ekle(&c, cid, "tam.bin", &tam, "diger", b"x", Cihaz::Masaustu)
            .unwrap_or_else(|e| panic!("sinirin TAM uzerindeki MIME kabul edilmeliydi: {e}"));
        assert_eq!(ek.mime, tam);

        // Ve olagan MIME tipleri de gecer.
        for iyi in ["application/pdf", "image/png", "text/plain"] {
            ekle(&c, cid, "b.bin", iyi, "diger", b"x", Cihaz::Masaustu)
                .unwrap_or_else(|e| panic!("{iyi} kabul edilmeliydi: {e}"));
        }
    }

    // --- Toplam uyari esigi: UYARIR, ENGELLEMEZ ---------------------------

    #[test]
    fn esik_altinda_uyari_yok() {
        let (_d, c, cid) = kurulum();
        ekle(&c, cid, "a.pdf", "application/pdf", "onam", b"12345", Cihaz::Masaustu).unwrap();
        let durum = depolama_durumu(&c).unwrap();
        assert_eq!(durum.toplam_boyut, 5);
        assert_eq!(durum.esik, TOPLAM_UYARI_ESIGI);
        assert!(!durum.uyari, "esigin cok altinda uyari olmamali");
    }

    #[test]
    fn esik_asilinca_uyarilir_ama_ekleme_engellenmez() {
        // Cakisma kontroluyle ayni urun karari: yazilim uyarir, kararı insan
        // verir. Yalnizca `uyari == true` test edilseydi, esigi asinca
        // eklemeyi REDDEDEN bir mutasyon fark edilmezdi.
        let (_d, c, cid) = kurulum();
        sahte_boyutlu_satir(&c, cid, TOPLAM_UYARI_ESIGI + 1);

        let durum = depolama_durumu(&c).unwrap();
        assert!(durum.uyari, "esik asildiginda uyari verilmeli");

        let ek = ekle(&c, cid, "yeni.pdf", "application/pdf", "diger", b"hala eklenebilir", Cihaz::Masaustu)
            .unwrap_or_else(|e| panic!("esik ENGELLEMEMELI: {e}"));
        assert_eq!(ek.boyut, 16);
        assert_eq!(listele(&c, cid, Cihaz::Masaustu).unwrap().len(), 2);
    }

    #[test]
    fn esik_tam_uzerinde_uyari_yok_bir_bayt_ustunde_var() {
        // Esigin hangi yonde "asildigi" sayildigi da bir karardir.
        let (_d, c, cid) = kurulum();
        sahte_boyutlu_satir(&c, cid, TOPLAM_UYARI_ESIGI);
        assert!(!depolama_durumu(&c).unwrap().uyari, "tam esikte henuz asilmis sayilmaz");

        sahte_boyutlu_satir(&c, cid, 1);
        assert!(depolama_durumu(&c).unwrap().uyari, "bir bayt ustunde uyari olmali");
    }

    #[test]
    fn depolama_durumu_log_yazmaz() {
        // Emsal: `appointments::cakisma_kontrolu_log_yazmaz`. Karar modul
        // basliginda yaziliydi ("Erisim logu YAZMAZ") ama testi yoktu;
        // `depolama_durumu`'na bir `kaydet(...)` ekleyen mutasyon tum paketi
        // yesil biraktiriyordu. Bu, her ekran yenilemesinde calisabilecek bir
        // durum sorgusudur: buraya dusen bir log satiri SILINEMEZ gurultudur.
        let (_d, c, cid) = kurulum();
        ekle(&c, cid, "a.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu).unwrap();

        let once: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();
        assert!(once > 0, "on kosul: sayilacak bir log tablosu olmali");
        // Tek cagri degil BES: `OturumBasi` ile birlestiren bir mutasyon bile
        // ilk cagrida bir satir yazardi ve burada yakalanir.
        for _ in 0..5 {
            depolama_durumu(&c).unwrap();
        }
        let sonra: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();

        assert_eq!(once, sonra, "depolama_durumu audit_log'a kayit yazmamali");
    }

    #[test]
    fn bos_veritabaninda_toplam_sifir() {
        let (_d, c, _cid) = kurulum();
        let durum = depolama_durumu(&c).unwrap();
        assert_eq!(durum.toplam_boyut, 0, "SUM(NULL) degil COALESCE(...,0) donmeli");
        assert!(!durum.uyari);
    }

    // --- Hacim politikasi: HerCagri yonu ----------------------------------
    //
    // `ekle`/`sil`/`icerik_getir` her satirin KENDI kimligiyle loglandigi
    // icin, birlestirme anahtari zaten her cagrida farkli olur; bu yuzden
    // "iki ekleme iki satir uretir" testi `OturumBasi` mutasyonunu YAKALAMAZ
    // (totoloji). Anahtari sabit tutan bir kurulum sart: ya ayni kimlige
    // ikinci kez erisilir (`icerik_getir`), ya da pencerenin ICINDE ayni
    // anahtarla sahte bir satir onceden konur.

    #[test]
    fn ayni_ekin_her_indirmesi_ayri_log_satiri_yazar() {
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "a.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu).unwrap();
        for _ in 0..5 {
            icerik_getir(&c, ek.id, Cihaz::Masaustu).unwrap();
        }
        assert_eq!(
            log_sayisi(&c, "disa_aktarma", VARLIK, &ek.id.to_string()),
            5,
            "disa aktarma birlestirilmemeli: her indirme ayri bir olaydir"
        );
    }

    #[test]
    fn ekleme_penceredeki_taze_satira_ragmen_yeni_satir_yazar() {
        let (_d, c, cid) = kurulum();
        let ilk = ekle(&c, cid, "a.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu).unwrap();
        // Bir sonraki ekin kimligi: AUTOINCREMENT.
        let sonraki = ilk.id + 1;
        eski_satir_ekle(&c, "ekleme", VARLIK, &sonraki.to_string(), 0);
        assert_eq!(log_sayisi(&c, "ekleme", VARLIK, &sonraki.to_string()), 1, "on kosul");

        let ikinci =
            ekle(&c, cid, "b.pdf", "application/pdf", "onam", b"y", Cihaz::Masaustu).unwrap();
        assert_eq!(ikinci.id, sonraki, "on kosul: kimlik tahmini tutmali");
        assert_eq!(
            log_sayisi(&c, "ekleme", VARLIK, &sonraki.to_string()),
            2,
            "ekleme HerCagri olmali: pencere icindeki satir onu susturmamali"
        );
    }

    #[test]
    fn silme_penceredeki_taze_satira_ragmen_yeni_satir_yazar() {
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "a.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu).unwrap();
        eski_satir_ekle(&c, "silme", VARLIK, &ek.id.to_string(), 0);
        assert_eq!(log_sayisi(&c, "silme", VARLIK, &ek.id.to_string()), 1, "on kosul");

        sil(&c, ek.id, Cihaz::Masaustu).unwrap();
        assert_eq!(
            log_sayisi(&c, "silme", VARLIK, &ek.id.to_string()),
            2,
            "silme HerCagri olmali: pencere icindeki satir onu susturmamali"
        );
    }

    // --- Hacim politikasi: OturumBasi yonu (listele) ----------------------

    #[test]
    fn otuz_listeleme_tam_olarak_bir_log_satiri_uretir() {
        let (_d, c, cid) = kurulum();
        let liste_id = format!("liste:{cid}");
        assert_eq!(log_sayisi(&c, "goruntuleme", VARLIK, &liste_id), 0, "on kosul");

        for _ in 0..30 {
            listele(&c, cid, Cihaz::Masaustu).unwrap();
        }
        assert_eq!(
            log_sayisi(&c, "goruntuleme", VARLIK, &liste_id),
            1,
            "gezinme kaynakli 30 yenileme TAM OLARAK 1 satir uretmeli"
        );
    }

    #[test]
    fn pencere_disindaki_satir_listelemeyi_susturmaz() {
        // SUSTURAN yon. Pencere bir yila cikarilsaydi bu test kirilir; onsuz
        // "log yok olmus" mutasyonunu hicbir test yakalamazdi.
        let (_d, c, cid) = kurulum();
        let liste_id = format!("liste:{cid}");
        eski_satir_ekle(&c, "goruntuleme", VARLIK, &liste_id, 10);
        assert_eq!(log_sayisi(&c, "goruntuleme", VARLIK, &liste_id), 1, "on kosul");

        listele(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(
            log_sayisi(&c, "goruntuleme", VARLIK, &liste_id),
            2,
            "pencere DISINDAKI eski satir yeni kaydi susturmamali"
        );
    }

    #[test]
    fn liste_birlestirmesi_farkli_danisani_gizlemez() {
        let (_d, c, cid) = kurulum();
        let ikinci = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Mehmet Demir".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();

        for _ in 0..10 {
            listele(&c, cid, Cihaz::Masaustu).unwrap();
        }
        listele(&c, ikinci.id, Cihaz::Masaustu).unwrap();

        assert_eq!(log_sayisi(&c, "goruntuleme", VARLIK, &format!("liste:{cid}")), 1);
        assert_eq!(
            log_sayisi(&c, "goruntuleme", VARLIK, &format!("liste:{}", ikinci.id)),
            1,
            "farkli danisanin listesi ayri satir yazmali"
        );
    }

    #[test]
    fn ek_deposu_audit_log_uzerinde_update_veya_delete_denemez() {
        let (_d, c, cid) = kurulum();
        // On kosul: tetikleyiciler gercekten aktif.
        assert!(c.execute("UPDATE audit_log SET eylem='silme'", []).is_err());
        assert!(c.execute("DELETE FROM audit_log", []).is_err());

        for i in 0..10 {
            let ek = ekle(&c, cid, &format!("a{i}.pdf"), "application/pdf", "onam", b"x", Cihaz::Masaustu)
                .expect("ekleme hicbir UPDATE/DELETE denememeli");
            listele(&c, cid, Cihaz::Masaustu).unwrap();
            icerik_getir(&c, ek.id, Cihaz::Masaustu).unwrap();
            sil(&c, ek.id, Cihaz::Masaustu).expect("silme hicbir UPDATE/DELETE denememeli");
        }
    }

    // --- Atomiklik (yazma + log tek transaction) --------------------------

    #[test]
    fn ekleme_audit_basarisiz_olursa_geri_alinir() {
        let (_d, c, cid) = kurulum();
        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = ekle(&c, cid, "a.pdf", "application/pdf", "onam", b"kayip olmali", Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken ekle Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        let sayi: i64 =
            c.query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 0, "log basarisiz oldugunda dosya satiri kalici yazilmamali");
    }

    #[test]
    fn silme_audit_basarisiz_olursa_geri_alinir() {
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "a.pdf", "application/pdf", "onam", b"kalmali", Cihaz::Masaustu)
            .unwrap();
        c.execute("DROP TABLE audit_log", []).unwrap();

        assert!(sil(&c, ek.id, Cihaz::Masaustu).is_err(), "audit_log yokken sil Err donmeli");

        let sayi: i64 =
            c.query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 1, "log basarisiz oldugunda silme geri alinmali");
    }

    #[test]
    fn silme_audit_basarisiz_olursa_riza_baglantisi_da_geri_alinir() {
        // Ayni transaction'in ikinci yazmasi: `clients.riza_dosya_id`.
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "onam.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu)
            .unwrap();
        c.execute("UPDATE clients SET riza_dosya_id = ?1 WHERE id = ?2", [ek.id, cid]).unwrap();

        c.execute("DROP TABLE audit_log", []).unwrap();
        assert!(sil(&c, ek.id, Cihaz::Masaustu).is_err());

        let baglanti: Option<i64> = c
            .query_row("SELECT riza_dosya_id FROM clients WHERE id = ?1", [cid], |r| r.get(0))
            .unwrap();
        assert_eq!(baglanti, Some(ek.id), "geri alinmis silmede riza baglantisi korunmali");
    }

    // --- Silme yan etkisi: sarkan riza baglantisi -------------------------

    #[test]
    fn silinen_onam_dosyasi_riza_baglantisini_temizler() {
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "onam.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu)
            .unwrap();
        c.execute(
            "UPDATE clients SET riza_dosya_id = ?1, riza_tarihi = '2026-01-05' WHERE id = ?2",
            [ek.id, cid],
        )
        .unwrap();

        sil(&c, ek.id, Cihaz::Masaustu).unwrap();

        let (baglanti, tarih): (Option<i64>, Option<String>) = c
            .query_row("SELECT riza_dosya_id, riza_tarihi FROM clients WHERE id = ?1", [cid], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(baglanti, None, "silinen dosyaya isaret eden baglanti kalmamali");
        assert_eq!(
            tarih.as_deref(),
            Some("2026-01-05"),
            "rizanin ALINDIGI gercegi dosya silinince kaybolmaz"
        );
    }

    #[test]
    fn silme_baska_danisanin_riza_baglantisina_dokunmaz() {
        let (_d, c, cid) = kurulum();
        let ikinci = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Mehmet Demir".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        let a = ekle(&c, cid, "a.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu).unwrap();
        let b = ekle(&c, ikinci.id, "b.pdf", "application/pdf", "onam", b"y", Cihaz::Masaustu)
            .unwrap();
        c.execute("UPDATE clients SET riza_dosya_id = ?1 WHERE id = ?2", [a.id, cid]).unwrap();
        c.execute("UPDATE clients SET riza_dosya_id = ?1 WHERE id = ?2", [b.id, ikinci.id])
            .unwrap();

        sil(&c, a.id, Cihaz::Masaustu).unwrap();

        let kalan: Option<i64> = c
            .query_row("SELECT riza_dosya_id FROM clients WHERE id = ?1", [ikinci.id], |r| r.get(0))
            .unwrap();
        assert_eq!(kalan, Some(b.id), "yalnizca silinen eke isaret eden baglanti temizlenmeli");
    }

    #[test]
    fn silme_tek_log_satiri_yazar_riza_temizligi_ikinci_satir_uretmez() {
        // `clients::son_temasi_tazele` ile ayni kural: turetilmis defter alani
        // tazelemesi ayri bir log satiri uretmez -- tek eylem, tek satir.
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "onam.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu)
            .unwrap();
        c.execute("UPDATE clients SET riza_dosya_id = ?1 WHERE id = ?2", [ek.id, cid]).unwrap();

        let once: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();
        sil(&c, ek.id, Cihaz::Masaustu).unwrap();
        let sonra: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();

        assert_eq!(sonra - once, 1, "tek silme eylemi TAM OLARAK bir satir yazmali");
        assert_eq!(log_sayisi(&c, "silme", VARLIK, &ek.id.to_string()), 1);
        assert_eq!(
            log_sayisi(&c, "duzenleme", "client", &cid.to_string()),
            0,
            "riza baglantisi temizligi client duzenlemesi olarak loglanmamali"
        );
    }

    // --- Bulunamayan kayitlar: hata + log YAZILMAZ ------------------------

    #[test]
    fn olmayan_danisana_ekleme_bulunamadi_dondurur_ve_log_yazmaz() {
        let (_d, c, _cid) = kurulum();
        let once: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();

        for yok in [90001, 90002, 90003] {
            assert!(matches!(
                ekle(&c, yok, "a.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu)
                    .unwrap_err(),
                DepoHatasi::Bulunamadi
            ));
        }

        let sonra: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();
        assert_eq!(sonra, once, "olmayan danisan icin log satiri yazilmamali");
        let sayi: i64 =
            c.query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 0);
    }

    #[test]
    fn olmayan_danisanin_listesi_bulunamadi_dondurur_ve_log_yazmaz() {
        let (_d, c, _cid) = kurulum();
        let once: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();

        for yok in [90001, 90002, 90003] {
            assert!(matches!(
                listele(&c, yok, Cihaz::Masaustu).unwrap_err(),
                DepoHatasi::Bulunamadi
            ));
        }

        let sonra: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();
        assert_eq!(sonra, once, "olmayan danisan icin log satiri yazilmamali");
    }

    #[test]
    fn olmayan_ekin_icerigi_ve_silmesi_bulunamadi_dondurur_ve_log_yazmaz() {
        let (_d, c, _cid) = kurulum();
        let once: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();

        for yok in [90001, 90002, 90003] {
            assert!(matches!(
                icerik_getir(&c, yok, Cihaz::Masaustu).unwrap_err(),
                DepoHatasi::Bulunamadi
            ));
            assert!(matches!(sil(&c, yok, Cihaz::Masaustu).unwrap_err(), DepoHatasi::Bulunamadi));
        }

        let sonra: i64 = c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap();
        assert_eq!(sonra, once, "olmayan ek icin log satiri yazilmamali");
    }

    // --- Listeleme davranisi ----------------------------------------------

    #[test]
    fn listele_baska_danisanin_ekini_dondurmez() {
        let (_d, c, cid) = kurulum();
        let ikinci = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Mehmet Demir".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        ekle(&c, cid, "benim.pdf", "application/pdf", "onam", b"x", Cihaz::Masaustu).unwrap();
        ekle(&c, ikinci.id, "digeri.pdf", "application/pdf", "onam", b"y", Cihaz::Masaustu)
            .unwrap();

        let liste = listele(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].dosya_adi, "benim.pdf");
    }

    #[test]
    fn listele_en_yeniden_eskiye_siralar() {
        // BIRINCIL siralama anahtari: `eklenme_zamani DESC`.
        //
        // Bu testin ilk hali iki eki `ekle` ile, ayni saniye icinde
        // yaziyordu; `simdi()` saniyeye yuvarladigi icin iki satirin
        // `eklenme_zamani`'si ESIT oluyordu ve test fiilen yalnizca ikincil
        // anahtari (`id DESC`) olcuyordu -- `DESC` -> `ASC` mutasyonu
        // hayatta kaliyordu. Simdi satirlar DOGRUDAN, AYRIK zamanlarla
        // yaziliyor ve zaman sirasi ile kimlik sirasi KASTEN ters: eski
        // dosya BUYUK kimlige sahip, boylece `id DESC` tek basina dogru
        // cevabi veremiyor.
        //
        // Somut zarar: mutasyon altinda liste ["2019-onam.pdf",
        // "2026-mahkeme.pdf"] doner -- danisan dosyasi ekraninda 2019 onam
        // formu bugunku mahkeme raporunun ustunde gorunur.
        let (_d, c, cid) = kurulum();
        sahte_zamanli_satir(&c, cid, "2026-mahkeme.pdf", "2026-09-07T10:00:00Z");
        sahte_zamanli_satir(&c, cid, "2019-onam.pdf", "2019-03-01T08:00:00Z");

        let liste = listele(&c, cid, Cihaz::Masaustu).unwrap();
        let adlar: Vec<&str> = liste.iter().map(|e| e.dosya_adi.as_str()).collect();
        assert_eq!(
            adlar,
            ["2026-mahkeme.pdf", "2019-onam.pdf"],
            "en YENI eklenen once gelmeli; kimlik sirasi bunu belirlememeli"
        );
    }

    #[test]
    fn ayni_anda_eklenen_ekler_kimlige_gore_siralanir() {
        // IKINCIL anahtar: `id DESC`. `eklenme_zamani` saniyeye yuvarlandigi
        // icin ayni saniyede eklenen iki dosya gercekten esit zamana sahiptir;
        // sira o zaman kimlikten gelmeli, yoksa liste ayni veriyle her
        // yenilemede farkli gorunebilir.
        let (_d, c, cid) = kurulum();
        sahte_zamanli_satir(&c, cid, "once.pdf", "2026-09-07T10:00:00Z");
        sahte_zamanli_satir(&c, cid, "sonra.pdf", "2026-09-07T10:00:00Z");

        let liste = listele(&c, cid, Cihaz::Masaustu).unwrap();
        let adlar: Vec<&str> = liste.iter().map(|e| e.dosya_adi.as_str()).collect();
        assert_eq!(adlar, ["sonra.pdf", "once.pdf"], "esit zamanda buyuk kimlik once gelmeli");
    }

    #[test]
    fn ekle_ile_yazilan_ekler_de_en_yeniden_eskiye_gelir() {
        // Uctan uca yon: gercek `ekle` yolu da dogru sirayi uretmeli.
        // (Zamanlar esit oldugundan burayi belirleyen ikincil anahtardir --
        // birincil anahtari olcen test yukaridadir.)
        let (_d, c, cid) = kurulum();
        ekle(&c, cid, "eski.pdf", "application/pdf", "onam", b"1", Cihaz::Masaustu).unwrap();
        ekle(&c, cid, "yeni.pdf", "application/pdf", "onam", b"2", Cihaz::Masaustu).unwrap();

        let liste = listele(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].dosya_adi, "yeni.pdf", "en son eklenen once gelmeli");
        assert_eq!(liste[1].dosya_adi, "eski.pdf");
    }

    #[test]
    fn tur_kumesi_veritabani_check_kisitiyla_ayni() {
        // Uygulama katmanindaki kapali kume ile `attachments.tur` CHECK'i
        // ayrisirsa, uygulamada gecerli sayilan bir tur veritabaninda ham
        // SQLite hatasina donusurdu.
        let (_d, c, cid) = kurulum();
        for tur in GECERLI_TURLER {
            ekle(&c, cid, &format!("{tur}.pdf"), "application/pdf", tur, b"x", Cihaz::Masaustu)
                .unwrap_or_else(|e| panic!("{tur} kabul edilmeliydi: {e}"));
        }
        // Ve kume gercekten KAPALI: uydurma bir tur veritabanınca reddedilir.
        assert!(c.execute("UPDATE attachments SET tur='uydurma'", []).is_err());
    }

    // --- Debug ciktisi -----------------------------------------------------

    #[test]
    fn ek_bilgisi_debug_ciktisi_dosya_adini_basmaz() {
        let bilgi = EkBilgisi {
            id: 481_516,
            client_id: 2342,
            dosya_adi: "mahkeme-raporu.pdf".into(),
            mime: "application/pdf".into(),
            tur: "diger".into(),
            boyut: 1234,
            eklenme_zamani: "2026-09-07T10:00:00Z".into(),
        };
        let metin = format!("{bilgi:?}");
        assert!(!metin.contains("mahkeme-raporu"), "Debug dosya adini basmamali: {metin}");
        assert!(!metin.contains("2342"), "Debug client_id'yi basmamali: {metin}");
        assert!(metin.contains("<gizli>"));
        assert!(
            metin.contains("id: 481516"),
            "hata ayiklama icin satir kimligi gorunur kalmali: {metin}"
        );

        // Serialize ise TUM alanlari icerir -- ayrim kasitli, arayuzun
        // dosya adina ihtiyaci var.
        let json = serde_json::to_string(&bilgi).unwrap();
        assert!(json.contains("mahkeme-raporu.pdf"));
        assert!(json.contains("2342"));
    }

    #[test]
    fn ek_icerigi_debug_ciktisi_baytlari_basmaz() {
        // 20 MB'lik bir bayt dizisi panik mesajinda hem sizinti hem
        // kullanilamazlik demektir.
        let icerik = EkIcerigi(b"COK_GIZLI_ICERIK".to_vec());
        let metin = format!("{icerik:?}");
        assert!(!metin.contains("COK_GIZLI"), "Debug icerigi basmamali: {metin}");
        // Duz `Vec<u8>` olsaydi cikti "[67, 79, 75, ...]" olurdu: ondalik
        // bayt dizisi de icerigin ta kendisidir.
        assert!(!metin.contains("67, 79, 75"), "Debug baytlari basmamali: {metin}");
        assert_eq!(metin, "EkIcerigi(<gizli, 16 bayt>)");
    }

    #[test]
    fn hata_yolunda_debug_ciktisi_da_icerigi_basmaz() {
        // Gercek sizinti yolu: `unwrap()`/`expect()` panik mesajinda ve
        // `{:?}` ile Result/Vec/Option sarmallarinin Debug'i basilir.
        let (_d, c, cid) = kurulum();
        let ek = ekle(
            &c,
            cid,
            "COK_GIZLI_DOSYA_ADI.pdf",
            "application/pdf",
            "onam",
            b"COK_GIZLI_ICERIK",
            Cihaz::Masaustu,
        )
        .unwrap();

        let ekleme = ekle(&c, cid, "COK_GIZLI_DOSYA_ADI.pdf", "application/pdf", "onam", b"COK_GIZLI_ICERIK", Cihaz::Masaustu);
        let metin = format!("{ekleme:?}");
        assert!(!metin.contains("COK_GIZLI"), "Result<EkBilgisi> Debug'i sizdirmamali: {metin}");

        let getirme = icerik_getir(&c, ek.id, Cihaz::Masaustu);
        let metin = format!("{getirme:?}");
        assert!(!metin.contains("COK_GIZLI"), "Result<(EkBilgisi, EkIcerigi)> sizdirmamali: {metin}");
        assert!(!metin.contains("67, 79, 75"), "ham baytlar basilmamali: {metin}");

        let liste = listele(&c, cid, Cihaz::Masaustu);
        let metin = format!("{liste:?}");
        assert!(!metin.contains("COK_GIZLI"), "Vec<EkBilgisi> Debug'i sizdirmamali: {metin}");

        let secenek = Some(listele(&c, cid, Cihaz::Masaustu).unwrap());
        let metin = format!("{secenek:?}");
        assert!(!metin.contains("COK_GIZLI"), "Option sarmali da sizdirmamali: {metin}");
    }
}
