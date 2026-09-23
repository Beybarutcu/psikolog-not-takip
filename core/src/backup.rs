//! Yedekleme: bir yedek **iki dosyadan oluşur** ve ikisi ayrılamaz.
//!
//! `veri.db` SQLCipher ile şifrelidir; onu açan veri anahtarı yalnızca
//! `keystore.json` içinde, parola ve kurtarma koduyla sarmalanmış olarak
//! bulunur. Parola da kurtarma kodu da tek başına bir veritabanını açmaz —
//! ikisi de sadece o dosyadaki sarmalamayı çözer. Dolayısıyla `keystore.json`
//! olmadan alınan bir "yedek" hiçbir koşulda geri yüklenemez; disk bozulursa
//! veri sonsuza kadar kaybolur.
//!
//! Bu modüldeki her işlem bu yüzden çifti bir bütün olarak ele alır:
//! - `yedek_al` ikisini birlikte yazar (`yedek-<damga>.db` +
//!   `yedek-<damga>.keystore.json`),
//! - `yedekleri_listele` yalnızca iki dosyası da yerinde olan yedekleri
//!   döndürür (kullanıcıya geri yüklenemeyecek bir yedek göstermek, felaket
//!   anında yanlış güven verir),
//! - `geri_yukle` **önce** ikisinin de var, açılabilir ve bu uygulamanın
//!   okuyabileceği bir şema sürümünde olduğunu doğrular, ancak ondan sonra
//!   mevcut dosyalara dokunur; yerleştirmenin herhangi bir adımı (şema
//!   göçü dâhil) başarısız olursa **hepsi** geri alınır. Yarım geri yükleme
//!   (yeni veritabanı + eski anahtar dosyası) veriyi hiç geri yüklememekten
//!   daha kötüdür: her ikisi de erişilemez hâle gelir.
//!
//! # "Veri kaybını önleyen özellik, veri kaybının sebebi olmasın"
//!
//! Bu modülün en pahalı hatası buydu: şema sürümü kapısı `migrate`'in
//! içindeydi ve `migrate` **dosyalar yerine konduktan sonra** çalışıyordu.
//! O noktada `veri.db.onceki` çoktan silinmiş oluyordu; daha yeni bir
//! sürümle alınmış bir yedeği eski kuruluma geri yüklemeye çalışan terapist
//! o gün girdiği, henüz yedeklenmemiş seans notlarını **kalıcı olarak**
//! kaybediyor ve uygulama veritabanını artık açamıyordu. Düzeltme iki
//! katmanlı, çünkü ikisi farklı şeyler vaat ediyor:
//!
//! 1. Sürüm kapısı doğrulama adımında, yani **hiçbir dosyaya dokunulmadan**
//!    önce (`YedekIleriSurumlu`).
//! 2. Yerleştirme baştan sona geri alınabilir; göç de yerleştirmenin bir
//!    adımı (`Yerlestirme`, `YedekHazirlanamadi`). Bu, sürüm dışındaki
//!    nedenleri de kapsar.

use crate::crypto::keyring::DataKey;
use crate::store::audit::{kaydet, Cihaz, Eylem, LogHacmi};
use crate::store::db::{open_encrypted, open_existing, DbError};
use crate::store::keystore;
use crate::store::schema;
use rusqlite::backup::Backup;
use rusqlite::ffi::ErrorCode;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const SAKLANAN_YEDEK_SAYISI: usize = 7;
const ONEK: &str = "yedek-";
const UZANTI: &str = "db";
/// Yedek çiftinin anahtar dosyası: `yedek-<damga>.keystore.json`.
const KEYSTORE_UZANTI: &str = "keystore.json";

/// Bir yedek çiftinin hangi parçasının eksik olduğu.
///
/// Hassas hiçbir şey taşımaz (dosya yolu, dosya içeriği, anahtar yok), bu
/// yüzden `Debug` türetilmesi güvenlidir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EksikParca {
    Veritabani,
    Keystore,
    Ikisi,
}

impl std::fmt::Display for EksikParca {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            EksikParca::Veritabani => "kayıt dosyası (.db)",
            EksikParca::Keystore => "anahtar dosyası (.keystore.json)",
            EksikParca::Ikisi => "hem kayıt dosyası hem anahtar dosyası",
        })
    }
}

/// Yedekleme/geri yükleme hataları.
///
/// Varyantlar **bilerek ayrıdır**: "yedek eksik", "yedek bozuk" ve "anahtar
/// dosyası bozuk" birbirinden ayırt edilebilmelidir. Bu projede aynı hata
/// dört ayrı katmanda tekrarlandı — her seferinde sonuç aynıydı: doğru
/// parolaya sahip kullanıcıya sorunun kaynağı yanlış anlatılıyor, o da
/// kurtarılabilir veriyi silmeye/sıfırlamaya girişiyordu.
///
/// Hiçbir varyant ham anahtar, sarmalanmış anahtar veya dosya içeriği
/// taşımaz; `Debug`/`Display` çıktısı loga veya hata mesajına girse bile
/// hassas bir şey sızdırmaz.
#[derive(Debug, thiserror::Error)]
pub enum YedekHatasi {
    #[error("dosya hatasi: {0}")]
    Io(#[from] std::io::Error),
    #[error("yedek dosyasi okunamiyor veya bozuk")]
    BozukYedek,
    #[error("veritabani hatasi: {0}")]
    Db(#[from] DbError),
    #[error("gecersiz tarih damgasi: '{0}' (beklenen bicim: YYYY-AA-GG)")]
    GecersizTarih(String),
    /// Yedek klasöründeki çiftin bir parçası (ya da ikisi birden) yok.
    /// "Bozuk" DEĞİL: dosyalar yerinden oynatılmış/taşınmış olabilir ve
    /// büyük ihtimalle hâlâ bir yerdedir.
    #[error(
        "Bu yedek eksik: {0} bulunamadı. Bir yedek yalnızca iki dosyası \
         birlikteyken geri yüklenebilir; yedek klasörünü kontrol edin. \
         Hiçbir şey değiştirilmedi."
    )]
    YedekEksik(EksikParca),
    /// Yedekteki anahtar dosyası var ama okunamıyor/yapısal olarak geçersiz.
    /// `BozukYedek`'ten ayrı: sorun veritabanında değil, anahtar dosyasında.
    #[error("Yedekteki anahtar dosyası okunamıyor veya bozuk. Hiçbir şey değiştirilmedi.")]
    BozukKeystore,
    /// Yedeği alınacak (yani uygulamanın kendi) anahtar dosyası yok.
    /// Yedek ALINMAZ: yalnızca veritabanını kopyalamak geri yüklenemeyecek
    /// bir yedek üretir ve kullanıcıya sahte bir güvenlik hissi verir.
    #[error("Anahtar dosyası bulunamadığı için yedek alınmadı; anahtarsız yedek geri yüklenemez.")]
    KaynakKeystoreYok,
    /// Uygulamanın anahtar dosyası var ama bozuk; bu hâliyle yedeklenirse
    /// bozukluk yedeğe de kopyalanır.
    #[error("Anahtar dosyası bozuk olduğu için yedek alınmadı; bozuk anahtar yedeklenmez.")]
    KaynakKeystoreBozuk,
    /// Yedek, bu uygulamanın desteklediğinden **daha yeni** bir şema
    /// sürümüyle alınmış (kullanıcı yeni sürümle yedek almış, sonra eski
    /// kuruluma dönmüş ya da bilgisayar değiştirmiş).
    ///
    /// `BozukYedek` DEĞİL -- ve bu ayrım bu modülün en pahalı dersidir:
    /// yedek sapasağlamdır, yalnızca bu kurulum onu okuyamaz. Kullanıcıya
    /// "yedeğiniz bozuk" demek onu o dosyayı silmeye ve yerine bu eski
    /// kurulumdan yeni bir yedek almaya iter; o an elindeki TEK geçerli
    /// kopya yok olur. Mesaj bu yüzden **yol gösterir**: yapılacak şey
    /// uygulamayı güncellemektir.
    ///
    /// Yalnızca iki tam sayı taşır; dosya adı, yol veya danışan verisi yok.
    #[error(
        "Bu yedek, uygulamanın desteklediğinden daha yeni bir sürümle alınmış \
         (yedek: sürüm {yedek}, uygulama: sürüm {uygulama}). Yedeğinizde bir \
         sorun YOK; onu okuyabilmek için uygulamayı güncelleyin. Hiçbir şey \
         değiştirilmedi."
    )]
    YedekIleriSurumlu { yedek: i64, uygulama: i64 },
    /// Yerleştirme başarısız oldu **ve geri alma yarım kaldı**: kenara
    /// alınan dosyalardan en az biri eski yerine konamadı.
    ///
    /// # Neden ayrı bir varyant -- ve neden asıl hatanın YERİNE geçer
    ///
    /// Diğer yerleştirme hataları kullanıcıya "hiçbir veriniz kaybolmadı"
    /// diyor. Geri alma her dosya işlemini `let _ = ...` ile yuttuğu sürece
    /// bu vaat **kanıtsızdı**. En kötü durum eşleşmeyen çifttir: eski
    /// `veri.db` geri konar ama `keystore.json` konamaz (ikisini de aynı
    /// bulut eşitleme istemcisi ya da virüs tarayıcı tutuyor olabilir --
    /// hatalar korelasyonludur) ve geriye bir daha asla açılamayacak bir
    /// çift kalır. Kullanıcı "veriniz kaybolmadı" okur, sonraki açılışta
    /// kilit açılmaz ve modül başlığındaki tuzağa -- yeniden kurulum --
    /// düşer; oysa verisi `.onceki` dosyalarında durmaktadır.
    ///
    /// Bu yüzden yarım geri alma kendi hatasıdır ve asıl hatayı `#[source]`
    /// olarak sarar: kullanıcıya gösterilen cümle artık doğru olmak
    /// zorunda.
    ///
    /// Mesaj yol taşımaz; `.onceki` yalnızca sabit bir **uzantıdır**.
    #[error(
        "Geri yükleme başarısız oldu ve eski dosyalarınız tam olarak yerine \
         konamadı; büyük olasılıkla başka bir program (bulut eşitleme \
         istemcisi, virüs tarayıcı, açık bir yedekleme aracı) dosyaları \
         tutuyor. UYGULAMAYI YENİDEN KURMAYIN -- verileriniz duruyor: veri \
         klasörünüzde `.onceki` uzantılı dosyalardalar. Bu dosyaları \
         SİLMEYİN ve hepsini BİRLİKTE tutun: kayıt dosyası, eşleşen anahtar \
         dosyası olmadan hiçbir koşulda açılamaz. Diğer programları kapatın; \
         uygulama açılabiliyorsa Ayarlar > Yedekleme bölümündeki \"Eski \
         dosyaları kenara kaldır\" eylemini çalıştırıp yeniden deneyin."
    )]
    GeriAlmaYarimKaldi(#[source] Box<YedekHatasi>),
    /// Kenara alınacak adda (`.onceki`) **zaten** bir dosya var; geri
    /// yükleme hiç başlatılmadı.
    ///
    /// # Neden bu kapı var (dal incelemesi M1)
    ///
    /// `Yerlestirme::kenara_al` `fs::rename(veri.db, veri.db.onceki)`
    /// çağırıyor ve POSIX'te (hedef platform macOS) `rename` var olan
    /// hedefi **sessizce üzerine yazar**. Yarım kalmış bir geri almadan
    /// sonra `veri.db.onceki` tam da kullanıcının **asıl verisini** taşır
    /// -- `GeriAlmaYarimKaldi` mesajı onu oraya yönlendiriyor; ikinci bir
    /// geri yükleme denemesi onu yok ederdi.
    ///
    /// Windows'ta `rename` hedef varsa zaten başarısız olur; tuzak
    /// **yalnızca hedef platformda** açıktı. Kapı bu yüzden bir `exists()`
    /// kontrolüdür: iki platformda da aynı, yol gösteren cevabı verir.
    ///
    /// # `.onceki` BAŞARILI bir geri yüklemeden de kalabilir
    ///
    /// Kapı dosyanın nereden geldiğine bakmaz ve bakamaz. Başarılı bir geri
    /// yüklemenin ardından `tamamla()` kenara alınanları silmeye çalışır ama
    /// **silemeyebilir** (salt okunur birim, `uchg` bayrağı, izin/ACL,
    /// dosyayı tutan bir eşitleme istemcisi). O durumda kalan `veri.db.onceki`
    /// bundan sonraki her geçerli geri yüklemeyi kilitlerdi. Çıkış yolu
    /// uygulamanın **içinde**: `onceki_dosyalari_kenara_kaldir` (Ayarlar >
    /// Yedekleme). Hiçbir şey silmez, yalnızca damgalı bir ada taşır.
    ///
    /// Mesaj yol taşımaz; `.onceki` sabit bir **uzantıdır**.
    #[error(
        "Geri yükleme başlatılmadı: veri klasörünüzde `.onceki` uzantılı \
         dosyalar duruyor ve bunlar SİZİN ESKİ VERİNİZ olabilir (önceki bir \
         geri yüklemeden -- başarısız ya da başarılı -- kalmış olabilirler). \
         Üzerlerine yazmamak için işlem durduruldu; hiçbir şey değiştirilmedi. \
         Bu dosyaları SİLMEYİN ve hepsini BİRLİKTE tutun: kayıt dosyası, \
         eşleşen anahtar dosyası olmadan hiçbir koşulda açılamaz. \
         UYGULAMAYI YENİDEN KURMAYIN -- Ayarlar > Yedekleme bölümündeki \
         \"Eski dosyaları kenara kaldır\" eylemini çalıştırın (o eylem \
         hiçbir şey silmez, yalnızca yeniden adlandırır), sonra yeniden \
         deneyin."
    )]
    OncekiDosyaDuruyor,
    /// `onceki_dosyalari_kenara_kaldir` sırasında bir dosya işlemi
    /// başarısız oldu. **Hiçbir şey silinmedi**; en kötü ihtimalle
    /// dosyaların bir kısmı yeni adıyla, kalanı eski adıyla duruyor.
    ///
    /// `YerlestirmeBasarisiz`'dan ayrı: orada cümle "geri yükleme
    /// yapılamadı" diyor ve burada geri yükleme diye bir şey yok. Bu
    /// modülün kuralı, kullanıcıya gösterilen cümlenin **doğru** olması.
    ///
    /// İşletim sistemi metni `#[source]`'ta kalır, mesaja girmez.
    #[error(
        "Eski dosyalar taşınamadı: bir dosya işlemi başarısız oldu. HİÇBİR \
         DOSYA SİLİNMEDİ, verileriniz duruyor. Başka bir program (bulut \
         eşitleme istemcisi, virüs tarayıcı) bu dosyaları tutuyor olabilir; \
         onu kapatıp yeniden deneyin."
    )]
    TemizlikBasarisiz(#[source] std::io::Error),
    /// İstemciden gelen zaman damgası `YYYYAAGG-SSDD` biçiminde değil.
    ///
    /// Damga bir **dosya adına** giriyor; doğrulanmadan geçseydi `../` ya
    /// da bir yol ayıracı taşıyıp yeniden adlandırmayı veri dizininin
    /// dışına çıkarabilirdi. Mesaj gelen dizgiyi **yansıtmaz**.
    #[error("Geçersiz zaman damgası. (Beklenen biçim: YYYYAAGG-SSDD)")]
    GecersizDamga,
    /// Geri yükleme sırasında bir **dosya işlemi** başarısız oldu ve canlı
    /// çift hâlâ yerinde: ya yerleştirmeye hiç başlanmadı (geçici kopyalama
    /// adımı), ya da başlandı ve **eksiksiz** geri alındı.
    ///
    /// # Neden ham `Io`'dan ayrı bir varyant (dal incelemesi I2)
    ///
    /// Bu modülün diğer bütün hata yolları cümleyi **akıbetle** bitirir:
    /// "Hiçbir şey değiştirilmedi.", "yerine geri kondu; hiçbir veriniz
    /// kaybolmadı.", `GeriAlmaYarimKaldi`'nın yönlendirmesi. `Io` yolu
    /// hiçbir şey söylemiyordu: gövde "dosya hatasi: …", kod 500 ve ekran
    /// bunu olduğu gibi basıyordu. Oysa bu, modülün var oluş gerekçesi olan
    /// hata sınıfının ta kendisidir (yedek klasörü bulut eşitlemede, disk
    /// dolu): kullanıcı verisinin akıbetini bilemediği için modül
    /// başlığındaki tuzağa -- yeniden kurulum -- düşebilir.
    ///
    /// Bilgi zaten elde: `yerlestirme_hatasi` geri almanın eksiksiz olup
    /// olmadığını biliyor. Eksiksizse cümle bunu **söylemek zorundadır**.
    ///
    /// Asıl hata `#[source]` olarak taşınır, **mesaja girmez**: `Display`
    /// çıktısı doğrudan HTTP gövdesine yazılıyor ve hem bir işletim sistemi
    /// hata metni (dosya adı/yol) hem de bir SQLite hata dizgisi bu modülün
    /// "hata gövdesi hassas veri taşımaz" kuralının dışından gelir. Teşhis
    /// için `Debug` yeterli (aynı karar `YedekHazirlanamadi`'da verilmişti).
    ///
    /// # Neden `Box<YedekHatasi>`, çıplak `io::Error` değil
    ///
    /// Yerleştirmenin son adımı `open_existing` ve o `YedekHatasi::Db`
    /// üretir -- `Io` ile **tam olarak aynı** boşluk: "veritabani hatasi: …"
    /// de akıbeti söylemiyor (inceleme MINOR). İki hata sınıfını da aynı
    /// kapıdan geçirmek için varyant bir `YedekHatasi` sarıyor; ikinci bir
    /// varyant açmak aynı cümleyi iki yerde tutmak olurdu.
    #[error(
        "Geri yükleme yapılamadı: yerleştirme adımı başarısız oldu (disk dolu \
         olabilir, başka bir program -- bulut eşitleme istemcisi, virüs \
         tarayıcı -- dosyaları tutuyor olabilir ya da veritabanı \
         hazırlanamamış olabilir). Mevcut veritabanınız ve anahtar dosyanız \
         YERİNDE duruyor; hiçbir veriniz kaybolmadı. UYGULAMAYI YENİDEN \
         KURMAYIN -- diğer programları kapatıp (ya da diskte yer açıp) \
         yeniden deneyin."
    )]
    YerlestirmeBasarisiz(#[source] Box<YedekHatasi>),
    /// Yedek geri yüklenebilir görünüyordu ama şema göçü uygulanamadı.
    ///
    /// Bu hata döndüğünde **yerleştirme eksiksiz geri alınmıştır**: mevcut
    /// `veri.db` ve `keystore.json` (ve WAL yan dosyaları) yerine
    /// konmuştur. Geri alma yarım kalsaydı bu varyant değil
    /// `GeriAlmaYarimKaldi` dönerdi -- mesajdaki "hiçbir veriniz
    /// kaybolmadı" cümlesini doğru tutan yapı budur. Gerekçe
    /// `SurumDusuk` kapısıyla aynı sınıf ama daha geneldir -- göç, sürüm
    /// dışındaki nedenlerle de reddedebilir (ör. eksi ücretli randevu
    /// taşıyan eski bir yedek: `MigrateHatasi::UcretKisitiIhlali`).
    ///
    /// Asıl göç hatası `#[source]` olarak taşınır, **mesaja girmez**:
    /// `Display` çıktısı doğrudan HTTP gövdesine yazılıyor ve göç hatasının
    /// metni (SQLite hata dizgileri, `app_meta` içeriği) bu modülün
    /// "hata gövdesi hassas veri taşımaz" kuralının dışında kalan bir
    /// kaynaktan geliyor. Teşhis için `Debug` yeterli.
    #[error(
        "Bu yedek geri yüklenemedi: veritabanı bu uygulama sürümüyle \
         hazırlanamadı. Mevcut veritabanınız ve anahtar dosyanız yerine \
         geri kondu; hiçbir veriniz kaybolmadı."
    )]
    YedekHazirlanamadi(#[source] crate::store::schema::MigrateHatasi),
    /// Dosya işlemi BAŞARILI oldu ama denetim kaydı yazılamadı.
    ///
    /// # Neden işlem geri alınmıyor
    /// `attachments::icerik_getir` "kaydedemediğimiz erişimi vermeyiz"
    /// diyerek fail-closed davranır: orada geri alınacak bir şey yoktur,
    /// içerik döndürülmez ve konu kapanır. Burada durum terstir -- geri
    /// almak, diskteki **geçerli bir yedeği silmek** demektir. Bu ürünün
    /// üçüncü başarı ölçütü "bilgisayar bozulursa veri kaybolmasın"; bir
    /// log satırı yazılamadı diye kullanıcının tek kopyasını yok etmek o
    /// ölçütün doğrudan ihlalidir. (Aynı yön `routes::session::kilitle`'de
    /// de seçilmişti: güvenlik/veri lehine olan eylem, log yazılamasa bile
    /// tamamlanır.)
    ///
    /// Sessiz DEĞİL: hata çağırana döner ve kullanıcı işlemin yapıldığını
    /// ama kayda geçmediğini görür. Yalnızca `&'static str` taşır --
    /// derleme zamanı sabiti, hassas veri taşıyamaz.
    #[error("{0} İşlem geri alınmadı; dosyalar yerinde duruyor.")]
    KayitYazilamadi(&'static str),
}

/// Diskteki bir yedek çifti hakkında **iç** bilgi.
///
/// # `Serialize` BİLEREK YOK (ertelenmiş madde, dal incelemesi)
///
/// Bu tip `serde::Serialize` türetiyordu ve `yol` alanı **mutlak** bir
/// dosya yoludur (`/Users/<ad>/Library/Application Support/...`). Bir HTTP
/// ucundan olduğu gibi döndürülseydi kullanıcının ev dizini -- yani adı --
/// tarayıcıya (ve oradan her yere) giderdi. Türetme kaldırıldı: artık bunu
/// bir yanıt gövdesine koymak **derlenmez**. Rota katmanı yalnızca dosya
/// adı/tarih/boyut taşıyan kendi dar tipini kurar
/// (`server::routes::restore::YedekOzeti`).
///
/// Yorum bir koruma değildir; koruma derleyicidedir. Bu türetmeyi geri
/// eklemek, o korumayı sessizce kaldırmak olur.
#[derive(Debug, Clone)]
pub struct YedekBilgisi {
    /// Yedeğin veritabanı dosyası. Anahtar dosyası için
    /// `keystore_yedek_yolu(&yol)`.
    pub yol: PathBuf,
    pub tarih: String,
    /// Yalnızca veritabanı dosyasının boyutu; anahtar dosyası birkaç yüz
    /// bayttır ve kullanıcıya gösterilen "yedek büyüklüğü" için anlamsızdır.
    pub boyut: u64,
    /// Çiftin anahtar dosyası yerinde mi. `yedekleri_listele` yalnızca `true`
    /// olanları döndürür; alan yine de taşınıyor çünkü `yedekleri_tara`
    /// (ve gelecekte bir "yedeklerinizde sorun var" ekranı) eksik çiftleri de
    /// görebilmeli.
    pub keystore_var: bool,
}

/// Bir yedek veritabanı yolundan çiftin anahtar dosyası yolunu üretir:
/// `.../yedek-2026-09-07.db` -> `.../yedek-2026-09-07.keystore.json`.
pub fn keystore_yedek_yolu(db_yedek_yolu: &Path) -> PathBuf {
    db_yedek_yolu.with_extension(KEYSTORE_UZANTI)
}

/// `s`'nin `YYYY-AA-GG` (ISO 8601 tarih) bicimine uyup uymadigini dogrular.
///
/// Yalnizca bicimi (rakam sayisi ve ayirac konumlari) kontrol eder; takvimsel
/// gecerliligi (ör. 2026-02-30) dogrulamaz - dosya adi siralamasi/rotasyonu
/// icin bu yeterli. Amac, kullanicinin elle koydugu (`yedek-eskiyedegim.db`)
/// veya isletim sisteminin urettigi (`yedek-2026-09-07 (2).db`) dosyalarin
/// rotasyona hic girmemesini saglamak (bkz. Bulgu 2).
fn tarih_bicimi_gecerli_mi(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..10].iter().all(u8::is_ascii_digit)
}

/// `open_encrypted`/`geri_yukle` dogrulamasindan gelen bir hatayi
/// `YedekHatasi`'ye siniflandirir.
///
/// Yalnizca gercek bozulma gostergeleri `BozukYedek` olur:
/// - `DbError::WrongKey`: dosya bu anahtarla hic acilamiyor (yanlis anahtar
///   veya dosya SQLCipher formatinda degil).
/// - `DbError::Sqlite` icindeki `ErrorCode::DatabaseCorrupt`: butunluk
///   kontrolu (`PRAGMA quick_check`) sayfa duzeyinde bozulma tespit etti.
///
/// Diger her sey (`Io`, kilitli dosya, gecici `Sqlite` hatalari) `Db`
/// olarak gecer - kullaniciya "yedeginiz bozuk" denilip saglam bir yedegin
/// silinmesine yol acilmamali (bkz. Bulgu 3).
fn siniflandir_geri_yukleme_hatasi(e: DbError) -> YedekHatasi {
    match e {
        DbError::WrongKey => YedekHatasi::BozukYedek,
        DbError::Sqlite(rusqlite::Error::SqliteFailure(ref ffi_hata, _))
            if ffi_hata.code == ErrorCode::DatabaseCorrupt =>
        {
            YedekHatasi::BozukYedek
        }
        other => YedekHatasi::Db(other),
    }
}

/// Veritabanını **ve** onu açan anahtar dosyasını birlikte yedekler.
///
/// `keystore_yolu` eksik veya bozuksa yedek **hiç alınmaz**: yalnızca
/// `veri.db`'yi kopyalamak, geri yüklenmesi imkânsız bir dosya üretir ve
/// kullanıcı yedeği olduğunu sanır. Sessizce yarım bir yedek üretmektense
/// hata döndürmek doğrudur.
pub fn yedek_al(
    db_yolu: &Path,
    keystore_yolu: &Path,
    hedef_dizin: &Path,
    damga: &str,
    key: &DataKey,
) -> Result<YedekBilgisi, YedekHatasi> {
    if !tarih_bicimi_gecerli_mi(damga) {
        return Err(YedekHatasi::GecersizTarih(damga.to_string()));
    }

    // Kaynak anahtar dosyasını ÖNCE doğrula: veritabanını kopyalamaya
    // başlamadan önce çiftin ikinci parçasının sağlam olduğunu bilelim.
    if !keystore::exists(keystore_yolu) {
        return Err(YedekHatasi::KaynakKeystoreYok);
    }
    let kaynak_keystore =
        keystore::load(keystore_yolu).map_err(|_| YedekHatasi::KaynakKeystoreBozuk)?;
    if !keystore::yapisal_gecerli_mi(&kaynak_keystore) {
        return Err(YedekHatasi::KaynakKeystoreBozuk);
    }

    std::fs::create_dir_all(hedef_dizin)?;
    let hedef = hedef_dizin.join(format!("{ONEK}{damga}.{UZANTI}"));
    let hedef_keystore = keystore_yedek_yolu(&hedef);

    // Once gecici dosyaya yaz, sonra tasi: yarim kalan kopya yedek gibi
    // gorunmesin. Onceki basarisiz bir denemeden kalmis olabilecek gecici
    // dosyayi ve WAL yan dosyalarini temiz baslamak icin sil.
    let gecici = hedef.with_extension("part");
    let _ = std::fs::remove_file(&gecici);
    for ek in ["part-wal", "part-shm"] {
        let _ = std::fs::remove_file(gecici.with_extension(ek));
    }

    {
        // SQLite Online Backup API: kaynak baglanti acikken (WAL modunda,
        // surmekte olan bir oturumla, henuz checkpoint edilmemis kayitlarla
        // birlikte) bile tutarli ve eksiksiz bir kopya uretir - salt dosya
        // kopyalama WAL'daki en son islenmemis kayitlari atlar (bkz. Bulgu 1).
        //
        // Hedef baglanti da `open_encrypted` ile AYNI anahtarla aciliyor;
        // aksi halde sqlite3_backup sayfalari hedefin sifrelenmemis
        // pager'ina yazar ve yedek duz metin olarak diskte kalir - bu kabul
        // edilemez, bu yuzden hedef de mutlaka keyed olarak aciliyor.
        let kaynak = open_encrypted(db_yolu, key)?;
        let mut hedef_baglanti = open_encrypted(&gecici, key)?;
        let yedekleme = Backup::new(&kaynak, &mut hedef_baglanti).map_err(DbError::from)?;
        yedekleme
            .run_to_completion(100, Duration::from_millis(250), None)
            .map_err(DbError::from)?;
        // `hedef_baglanti` burada scope disina cikip kapanir; gecici dosyaya
        // ait tek baglanti oldugu icin SQLite kapanista otomatik checkpoint
        // yapar ve WAL'i ana dosyaya birlestirir.
    }
    // Checkpoint sonrasi bos/kalinti WAL yan dosyalari kalmis olabilir;
    // rename'den once temizle ki yedek dizininde tek basina dolasan bir
    // '.part-wal' kalmasin.
    for ek in ["part-wal", "part-shm"] {
        let _ = std::fs::remove_file(gecici.with_extension(ek));
    }

    // SIRA ONEMLI: once anahtar dosyasi, sonra veritabani. `yedekleri_listele`
    // bir yedegi ancak IKI dosyasi da yerindeyken gosterdigi icin, yedek tam
    // olarak son rename aninda "gorunur" olur. Ters sirada yazsaydik, iki
    // adim arasinda cakan bir surec anahtarsiz ama listelenebilir bir yedek
    // birakabilirdi. `keystore::save` kendi icinde atomiktir (gecici dosya +
    // rename), bu yuzden burada ayrica .part sarmalamasina gerek yok.
    keystore::save(&kaynak_keystore, &hedef_keystore)?;
    std::fs::rename(&gecici, &hedef)?;

    // Temizlik (eski yedeklerin silinmesi) basarisiz olsa bile bu yedek
    // diskte basariyla olusturuldu; temizlik hatasi yedegin basarisini
    // dusurmemeli (Bulgu 4). En kotu durumda bir eski yedek fazladan
    // diskte kalir - bu veri kaybi degil, aksine ekstra bir kopyadir.
    let _ = eskileri_temizle(hedef_dizin);

    let boyut = std::fs::metadata(&hedef)?.len();
    Ok(YedekBilgisi { yol: hedef, tarih: damga.to_string(), boyut, keystore_var: true })
}

/// Yedek klasöründeki **tüm** `yedek-<tarih>.db` dosyalarını, çiftinin
/// tamam olup olmadığı bilgisiyle birlikte döndürür (en yeni başta).
///
/// `yedekleri_listele`'nin aksine eksik çiftleri de içerir; filtre tek bir
/// yerde (`yedekleri_listele`) uygulansın diye ayrı tutuluyor.
fn yedekleri_tara(hedef_dizin: &Path) -> Result<Vec<YedekBilgisi>, YedekHatasi> {
    if !hedef_dizin.exists() {
        return Ok(Vec::new());
    }
    let mut liste = Vec::new();
    for girdi in std::fs::read_dir(hedef_dizin)? {
        let girdi = girdi?;
        let yol = girdi.path();
        let Some(ad) = yol.file_name().and_then(|s| s.to_str()) else { continue };
        let Some(tarih) = ad.strip_prefix(ONEK).and_then(|s| s.strip_suffix(&format!(".{UZANTI}")))
        else {
            continue;
        };
        if !tarih_bicimi_gecerli_mi(tarih) {
            // Kullanicinin elle koydugu ya da isletim sisteminin urettigi
            // (ör. "yedek-eskiyedegim.db", "yedek-2026-09-07 (2).db") bir
            // dosya listeye alinmaz - dolayisiyla rotasyonla asla silinmez
            // (bkz. Bulgu 2).
            continue;
        }
        liste.push(YedekBilgisi {
            keystore_var: keystore_yedek_yolu(&yol).exists(),
            yol: yol.clone(),
            tarih: tarih.to_string(),
            boyut: girdi.metadata()?.len(),
        });
    }
    // Dosya adindaki tarih ISO oldugu icin metin siralamasi tarih siralamasidir.
    liste.sort_by(|a, b| b.tarih.cmp(&a.tarih));
    Ok(liste)
}

/// Geri yüklenebilir yedekleri döndürür: yalnızca **iki dosyası da** yerinde
/// olanlar (en yeni başta).
///
/// Anahtar dosyası olmayan bir yedek geri yüklenemez. Onu listede göstermek,
/// kullanıcının felaket anında -- yani düzeltme şansının kalmadığı anda --
/// var olmayan bir kurtarma seçeneğine güvenmesi demektir; bu yüzden atlanır.
pub fn yedekleri_listele(hedef_dizin: &Path) -> Result<Vec<YedekBilgisi>, YedekHatasi> {
    Ok(yedekleri_tara(hedef_dizin)?.into_iter().filter(|b| b.keystore_var).collect())
}

/// Rotasyon: en yeni `SAKLANAN_YEDEK_SAYISI` **tam** yedek dışındakileri
/// (çiftin iki dosyasını birden) siler.
///
/// Sayım `yedekleri_listele` üzerinden, yani yalnızca tam çiftler üzerinden
/// yapılır: eksik/elle konmuş dosyalar ne sayıma girer ne de silinir --
/// anlamadığımız bir dosyayı silmek, kullanıcının tek kopyasını yok etme
/// riski taşır (bkz. Bulgu 2).
fn eskileri_temizle(hedef_dizin: &Path) -> Result<(), YedekHatasi> {
    let liste = yedekleri_listele(hedef_dizin)?;
    for eski in liste.iter().skip(SAKLANAN_YEDEK_SAYISI) {
        // Once anahtar dosyasi silinir: aradaki cakmada geriye anahtarsiz
        // (yani listelenmeyen) bir .db kalir, tersi durumda ise sahipsiz bir
        // anahtar dosyasi. Ikisi de zararsiz, ama ilki bir sonraki rotasyonda
        // temizlenmeye aday olmadigi icin bilerek bu sira secildi.
        std::fs::remove_file(keystore_yedek_yolu(&eski.yol))?;
        std::fs::remove_file(&eski.yol)?;
    }
    Ok(())
}

/// Bir yedek çiftini (veritabanı + anahtar dosyası) birlikte geri yükler.
///
/// Sıra kesindir: **önce tam doğrulama, sonra yerleştirme.** Doğrulama
/// bitene kadar `db_yolu` ve `keystore_yolu` hiçbir kod yolundan
/// değiştirilmez; yerleştirme sırasında ikinci adım başarısız olursa
/// birincisi geri alınır.
pub fn geri_yukle(
    yedek_yolu: &Path,
    db_yolu: &Path,
    keystore_yolu: &Path,
    key: &DataKey,
) -> Result<(), YedekHatasi> {
    let yedek_keystore_yolu = keystore_yedek_yolu(yedek_yolu);

    // 1) Varlik: "eksik" ile "bozuk" ayri hatalar. Eksik bir dosya buyuk
    //    ihtimalle tasinmis/yanlis klasordedir ve bulunabilir; kullaniciya
    //    "yedeginiz bozuk" demek onu saglam yedegi silmeye itebilir.
    match (yedek_yolu.exists(), yedek_keystore_yolu.exists()) {
        (true, true) => {}
        (false, true) => return Err(YedekHatasi::YedekEksik(EksikParca::Veritabani)),
        (true, false) => return Err(YedekHatasi::YedekEksik(EksikParca::Keystore)),
        (false, false) => return Err(YedekHatasi::YedekEksik(EksikParca::Ikisi)),
    }

    // 2) Yedekteki anahtar dosyasi gercekten acilabiliyor mu. Yalnizca
    //    JSON ayristirmasi yetmez: yarim yazilmis bir `ciphertext_hex`
    //    ayristirmadan gecer ama hicbir parolayla acilmaz.
    let yedek_keystore =
        keystore::load(&yedek_keystore_yolu).map_err(|_| YedekHatasi::BozukKeystore)?;
    if !keystore::yapisal_gecerli_mi(&yedek_keystore) {
        return Err(YedekHatasi::BozukKeystore);
    }

    // 3) Yedekteki veritabani acilabiliyor ve butunlugu saglam mi.
    let dogrulama = open_encrypted(yedek_yolu, key).map_err(siniflandir_geri_yukleme_hatasi)?;

    // `SELECT count(*) FROM sqlite_master` yalnizca sema sayfasini okur;
    // veri sayfalari bozuksa yakalamaz. `PRAGMA quick_check`, `integrity_check`
    // kadar kapsamli olmayan (cross-index dogrulamalarini atlayan) ama tum
    // veri sayfalarini tarayan daha hizli bir kontrol - bir yedek dosyasi
    // icin makul bir sure/kapsamlilik dengesi (bkz. Bulgu 5).
    let sonuc: rusqlite::Result<String> =
        dogrulama.query_row("PRAGMA quick_check", [], |r| r.get(0));
    match sonuc {
        Ok(ref s) if s == "ok" => {}
        Ok(_diger) => return Err(YedekHatasi::BozukYedek),
        Err(e) => return Err(siniflandir_geri_yukleme_hatasi(DbError::Sqlite(e))),
    }

    // 3b) SEMA SURUMU -- ZATEN ACIK olan bu baglantida, YERLESTIRMEDEN ONCE.
    //
    // # Neden burada, `migrate`'in kendi kapisi varken
    // `migrate`'in `SurumDusuk` kapisi dogru kapidir ama YANLIS YERDE
    // duruyordu: `migrate` ancak dosyalar yerine kondUKtan sonra
    // calisabiliyor, o noktada `veri.db.onceki` silinmis oluyordu. Yani veri
    // kaybini onleyen ozellik, veri kaybinin sebebi oluyordu. Kapi buraya
    // alininca reddedilen yedek hicbir dosyaya dokunmadan geri cevrilir.
    //
    // Ikinci katman (asagidaki geri alinabilir yerlestirme) bu kontrolu
    // gereksiz KILMAZ: ikisi farkli seyler vaat eder. Burasi "ileri surumlu
    // yedek hicbir dosyaya DOKUNMADAN reddedilir" der; asagisi "her ihtimale
    // karsi yerlestirme geri alinabilir" der.
    let yedek_surum = schema::okunan_surum(&dogrulama).map_err(|e| match e {
        // Okuma sirasindaki SQLite hatasi bir surum sorunu degil; ayni
        // siniflandirmadan gecsin ki gecici bir hata "bozuk" diye
        // raporlanmasin (bkz. `siniflandir_geri_yukleme_hatasi`).
        schema::MigrateHatasi::Sqlite(e) => siniflandir_geri_yukleme_hatasi(DbError::Sqlite(e)),
        diger => YedekHatasi::YedekHazirlanamadi(diger),
    })?;
    if yedek_surum > schema::CURRENT_VERSION {
        return Err(YedekHatasi::YedekIleriSurumlu {
            yedek: yedek_surum,
            uygulama: schema::CURRENT_VERSION,
        });
    }
    drop(dogrulama);

    // --- Buradan sonrasi yerlestirme; dogrulama bitti. -------------------

    // 4) Once iki dosyayi da HEDEFIN YANINA gecici adlarla kopyala. Riskli
    //    IO (disk dolu, izin hatasi, yarim okuma) burada olur ve bu noktada
    //    mevcut dosyalarin ikisi de hala tamamen yerinde. Ayni dizinde
    //    olduklari icin sonraki rename'ler ayni dosya sistemi icindedir.
    let db_gecici = db_yolu.with_extension("restore");
    let keystore_gecici = keystore_yolu.with_extension("json.restore");
    //    Bu adimdaki hata CANLI CIFTE hic dokunmadan olusur; kullaniciya
    //    gosterilen cumle bunu soylemeli (bkz. `YerlestirmeBasarisiz`), ham
    //    `Io` ("dosya hatasi: ...") akibet hakkinda hicbir sey demiyordu.
    let sar = |e: std::io::Error| {
        YedekHatasi::YerlestirmeBasarisiz(Box::new(YedekHatasi::Io(e)))
    };
    std::fs::copy(yedek_yolu, &db_gecici).map_err(sar)?;
    if let Err(e) = std::fs::copy(&yedek_keystore_yolu, &keystore_gecici) {
        let _ = std::fs::remove_file(&db_gecici);
        return Err(sar(e));
    }

    // 5) Mevcut dosyalari kenara al, yenileri yerine koy ve SON ADIM olarak
    //    gocu calistir. Herhangi bir adim patlarsa o ana kadar yapilan her
    //    sey geri alinir: yarim geri yukleme (yeni db + eski keystore ya da
    //    tersi) her iki dosyayi da kullanilamaz kilar - hic geri
    //    yuklememekten kotudur.
    let mut izle = Yerlestirme::default();
    match yerlestir(&db_gecici, &keystore_gecici, db_yolu, keystore_yolu, key, &mut izle) {
        Ok(()) => {
            // Kenara alinan onceki surumler artik gereksiz.
            //
            // DIKKAT (inceleme IMPORTANT-A): "silinemezlerse sorun degil,
            // yalnizca yer kaplarlar" cumlesi M1'den ONCE dogruydu, ARTIK
            // DEGIL. Silinemeyen bir `veri.db.onceki` (salt okunur birim,
            // `uchg` bayragi, izin/ACL, dosyayi tutan bir esitleme
            // istemcisi) `kenara_al`'in kapisina takilir ve BUNDAN SONRAKI
            // HER GECERLI geri yuklemeyi 409 ile reddettirir. Cikis yolu
            // uygulamanin ICINDE: `onceki_dosyalari_kenara_kaldir`
            // (Ayarlar > Yedekleme) hicbir seyi silmeden damgali bir ada
            // tasir ve kapiyi acar.
            izle.tamamla();
            Ok(())
        }
        Err(e) => {
            // Yerlestirilemeyen gecici dosyalar geride kalmasin: modulun
            // "hata sonrasi kalinti yok" degismezi (bkz.
            // `keystore_eksikse_geri_yukleme_reddedilir_ve_mevcut_veri_korunur`).
            let _ = std::fs::remove_file(&db_gecici);
            let _ = std::fs::remove_file(&keystore_gecici);
            Err(yerlestirme_hatasi(e, izle.geri_al(db_yolu)))
        }
    }
}

/// Yerleştirme hatasını, **geri almanın ne kadarının başarıldığına** göre
/// çağırana dönecek hataya çevirir.
///
/// Ayrı bir fonksiyon çünkü kural tek cümleyle ifade edilebilir olmalı:
/// *geri alma yarım kaldıysa kullanıcıya gösterilen hata bunu söylemek
/// zorundadır.* Asıl hata kaybolmaz, `GeriAlmaYarimKaldi`'nin kaynağı
/// olarak taşınır.
fn yerlestirme_hatasi(asil: YedekHatasi, geri_alma_eksiksiz: bool) -> YedekHatasi {
    if geri_alma_eksiksiz {
        // ARTI YON (dal incelemesi I2): geri alma eksiksizse cumle bunu
        // SOYLEMELI. Diger varyantlar zaten soyluyor (`YedekHazirlanamadi`:
        // "yerine geri kondu; hicbir veriniz kaybolmadi"); ham `Io` ise
        // yalnizca "dosya hatasi: ..." diyordu ve kullanici verisinin
        // yerinde olup olmadigini bilemiyordu.
        // `Db` de `Io` ile AYNI bosluktaydi (inceleme MINOR): yerlestirmenin
        // son adimi `open_existing` ve "veritabani hatasi: ..." da akibeti
        // soylemiyor.
        match asil {
            e @ (YedekHatasi::Io(_) | YedekHatasi::Db(_)) => {
                YedekHatasi::YerlestirmeBasarisiz(Box::new(e))
            }
            diger => diger,
        }
    } else {
        YedekHatasi::GeriAlmaYarimKaldi(Box::new(asil))
    }
}

/// Yerlestirmenin kendisi: kenara alma -> yerine koyma -> goc.
///
/// `geri_yukle`'den AYRI bir fonksiyon olmasinin sebebi tek bir sey: hata
/// yolunda geri alinacaklar TEK yerde (`Yerlestirme`) birikiyor ve geri alma
/// cagrisi da TEK yerde yapiliyor. Onceki bicimde her adimin kendi elle
/// yazilmis temizlik blogu vardi ve yeni bir adim (goc) eklemek, o bloklardan
/// birini atlamak demekti.
///
/// # Neden goc BURADA, `routes::restore`'da degil
///
/// Eski sirada `migrate` rota katmanindaydi ve `geri_yukle` donmus, yani
/// `veri.db.onceki` SILINMIS oluyordu. Goc orada patladiginda (ileri surumlu
/// yedek, eksi ucretli randevu tasiyan eski yedek, ...) kullanicinin o gun
/// girdigi ve henuz yedeklenmemis notlari KALICI olarak yok oluyordu. Goc
/// ancak geri alma mekanizmasiyla AYNI yerde yasarsa "patlarsa eski hali geri
/// gelir" vaat edilebilir; bu yuzden dosya islemleriyle ayni fonksiyondadir.
fn yerlestir(
    db_gecici: &Path,
    keystore_gecici: &Path,
    db_yolu: &Path,
    keystore_yolu: &Path,
    key: &DataKey,
    izle: &mut Yerlestirme,
) -> Result<(), YedekHatasi> {
    izle.kenara_al(db_yolu, db_yolu.with_extension("db.onceki"))?;
    for (ek, onceki_ek) in [("db-wal", "db.onceki-wal"), ("db-shm", "db.onceki-shm")] {
        izle.kenara_al(&db_yolu.with_extension(ek), db_yolu.with_extension(onceki_ek))?;
    }
    izle.kenara_al(keystore_yolu, keystore_yolu.with_extension("json.onceki"))?;

    izle.yerine_koy(db_gecici, db_yolu)?;
    izle.yerine_koy(keystore_gecici, keystore_yolu)?;

    // Goc EN SON: yedek eski bir semayla alinmis olabilir ve uygulama onu
    // guncel semada bekler. Buradaki hata cagirana doner, cagiran da her
    // seyi geri koyar.
    let conn = open_existing(db_yolu, key)?;
    schema::migrate(&conn).map_err(YedekHatasi::YedekHazirlanamadi)?;
    // `conn` burada kapanir; tek baglanti oldugu icin SQLite kapanista
    // checkpoint yapar ve WAL yan dosyalarini kaldirir. (Hata yolunda da
    // kapanir: `?` ile erken donuste yereller yine drop edilir -- Windows'ta
    // acik bir dosya yeniden adlandirilamayacagi icin bu sart.)
    Ok(())
}

/// Yerlestirme sirasinda ne yapildiginin kaydi; geri almayi mumkun kilar.
///
/// # Neden WAL yan dosyalari da KENARA ALINIYOR (silinmiyor)
///
/// `veri.db-wal`, ana dosyaya henuz islenmemis ama COMMIT EDILMIS islemler
/// tasiyabilir -- tam olarak "bugun girilen, henuz yedeklenmemis seans
/// notu". Onceki bicimde bu dosyalar yerlestirmeden hemen sonra SILINIYORDU.
/// Geri yukleme basarili oldugunda bu dogrudur (WAL artik var olmayan bir
/// veritabanina aittir), ama geri alma yolunda eski veritabanini yanindaki
/// WAL'siz haliyle geri koymak, geri almaya calistigimiz veriyi yok ederdi.
/// Bu yuzden siliniyor degil, kenara aliniyorlar.
///
/// Ad SQLite'in kendi kuralina uyar (`veri.db.onceki` -> `veri.db.onceki-wal`)
/// ki kenara alinan cift gerekirse oldugu yerde acilabilsin.
#[derive(Default)]
struct Yerlestirme {
    /// (asil yol, kenara alinmis yol) -- yalnizca GERCEKTEN tasinanlar.
    /// Tasinamayan bir dosya buraya girmez; girseydi geri alma, hic
    /// dokunulmamis bir dosyayi "geri koymaya" calisirdi.
    kenara_alinanlar: Vec<(PathBuf, PathBuf)>,
    /// Yerine GERCEKTEN konmus yeni dosyalar. Geri alma yalnizca bunlari
    /// siler: `yerine_koy` basarisiz olduysa hedefte hala ESKI dosya
    /// duruyor olabilir ve onu silmek tam da onlemeye calistigimiz sey olur.
    yerlestirilenler: Vec<PathBuf>,
}

impl Yerlestirme {
    /// `yol` varsa `hedef` adiyla kenara alir; yoksa sessizce gecer
    /// (bos bir kuruluma geri yukleme gecerli bir senaryodur).
    /// (dal incelemesi M1)
    fn kenara_al(&mut self, yol: &Path, hedef: PathBuf) -> Result<(), YedekHatasi> {
        if !yol.exists() {
            // Hedefte oksuz bir `.onceki` duruyor olabilir; ona DOKUNULMAZ
            // (ne tasinir ne silinir), cunku kullanicinin tek kopyasi
            // olabilir. Burada yapilacak bir sey yok.
            return Ok(());
        }
        // GUVENLIK AGINI EZME: POSIX'te `rename` var olan hedefi SESSIZCE
        // uzerine yazar ve `veri.db.onceki` tam da kullanicinin asil verisi
        // olabilir (bkz. `YedekHatasi::OncekiDosyaDuruyor`). Bu kontrol
        // `rename`'in Windows'taki davranisini butun platformlara tasir --
        // ve hatayi yol gosteren bir cumleye cevirir.
        if hedef.exists() {
            return Err(YedekHatasi::OncekiDosyaDuruyor);
        }
        std::fs::rename(yol, &hedef)?;
        self.kenara_alinanlar.push((yol.to_path_buf(), hedef));
        Ok(())
    }

    fn yerine_koy(&mut self, gecici: &Path, hedef: &Path) -> std::io::Result<()> {
        std::fs::rename(gecici, hedef)?;
        self.yerlestirilenler.push(hedef.to_path_buf());
        Ok(())
    }

    /// Yerlestirmeyi geri alir. **`true` dondurmesi, kenara alinan HER SEYIN
    /// yerine kondugu anlamina gelir**; `false` donerse en az bir dosya
    /// yerine konamadi ve cagiran bunu kullaniciya soylemek zorundadir
    /// (bkz. `YedekHatasi::GeriAlmaYarimKaldi`). Eskiden `()` donuyordu ve
    /// her hata sessizce yutuluyordu -- "hicbir veriniz kaybolmadi" vaadi
    /// bu yuzden kanitsizdi.
    #[must_use]
    fn geri_al(&self, db_yolu: &Path) -> bool {
        let mut eksiksiz = true;
        for yol in &self.yerlestirilenler {
            if !yok_et(yol) {
                eksiksiz = false;
            }
            // WAL yan dosyalarini YALNIZCA yeni veritabani GERCEKTEN yerine
            // konduysa sil.
            //
            // # Kosul neden kritik (gerileme, inceleme CRITICAL-1)
            // Bu silme bir sure KOSULSUZDU ve gerekcesi "eskinin kendi WAL'i
            // `.onceki-wal` adiyla guvende" idi. O varsayim yalnizca kenara
            // alma adimlarina ULASILABILDIYSE dogru. Ilk `kenara_al`
            // patlarsa (ornegin kalinti bir `veri.db.onceki` baska bir
            // program tarafindan tutuluyor ya da bir klasor) hicbir sey
            // tasinmaz, iki liste de BOS kalir -- ve silinen WAL CANLI
            // olanidir: kullanicinin o gun girdigi, commit edilmis ama henuz
            // checkpoint edilmemis notlarini tasiyan dosya. Yeni bir WAL
            // ancak `db_yolu` yerine konduktan SONRA (goc adiminda)
            // olusabilir; kosul tam olarak budur.
            if yol == db_yolu {
                for ek in ["db-wal", "db-shm"] {
                    if !yok_et(&db_yolu.with_extension(ek)) {
                        // Geri konan ESKI veritabaninin yaninda YENI
                        // veritabaninin WAL'i kalirsa cift tutarsizdir.
                        eksiksiz = false;
                    }
                }
            }
        }
        for (yol, hedef) in self.kenara_alinanlar.iter().rev() {
            if std::fs::rename(hedef, yol).is_err() {
                eksiksiz = false;
            }
        }
        eksiksiz
    }

    /// Geri yukleme tamamlandi: kenara alinanlar artik gereksiz.
    ///
    /// Silme BASARISIZ OLABILIR ve bu **sessiz bir yer israfi degildir**
    /// (inceleme IMPORTANT-A): kalan `veri.db.onceki`, `kenara_al`'in
    /// kapisina takilir ve sonraki gecerli geri yuklemeler 409 alir. Hata
    /// burada yine de yutuluyor -- geri yukleme BASARILI oldu ve onu
    /// gerisin geri almak veri kaybi riskini geri getirirdi. Kullaniciya
    /// verilen cikis yolu `onceki_dosyalari_kenara_kaldir`'dir ve
    /// `OncekiDosyaDuruyor` mesaji onu adiyla soyler.
    fn tamamla(&self) {
        for (_, hedef) in &self.kenara_alinanlar {
            let _ = std::fs::remove_file(hedef);
        }
    }
}

/// İstemciden gelen damga **yalnızca** `YYYYAAGG-SSDD` olabilir.
///
/// # Bu bir güvenlik kapısıdır, kozmetik bir kontrol değil
///
/// `damga` doğrudan bir **dosya adına** giriyor
/// (`veri.db.onceki-20260923-1430`). Doğrulanmasaydı `../../` ya da bir yol
/// ayıracı taşıyan bir damga, yeniden adlandırmayı veri dizininin **dışına**
/// çıkarırdı. Beyaz liste (yalnızca rakam ve tek bir `-`) kara listeden
/// daha dardır ve bu yüzden seçildi.
fn damga_gecerli_mi(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 13
        && b[8] == b'-'
        && b[..8].iter().all(u8::is_ascii_digit)
        && b[9..].iter().all(u8::is_ascii_digit)
}

/// Veri klasöründe duran `.onceki` kalıntılarını **damgalı bir ada taşır**
/// ve kaç dosyanın taşındığını döndürür.
///
/// # Neden bu fonksiyon var (inceleme IMPORTANT-A)
///
/// `Yerlestirme::kenara_al` artık hedefte bir `.onceki` bulursa geri
/// yüklemeyi durduruyor (`OncekiDosyaDuruyor`; kullanıcının tek kopyasını
/// ezmemek için). Ama `.onceki` **başarılı** bir geri yüklemeden de
/// kalabilir: `tamamla()`'nın silmesi başarısız olursa (salt okunur birim,
/// `uchg` bayrağı, izin/ACL, dosyayı tutan bir eşitleme istemcisi) o kalıntı
/// bundan sonraki **her geçerli** geri yüklemeyi kilitler. Kullanıcıyı
/// Finder'a indirip `~/Library` altında dosya taşımaya zorlamak, bu ürünün
/// tam olarak kaçındığı şeydir -- ve orada yapacağı ilk hata dosyayı
/// **silmek** olurdu.
///
/// # ASLA SİLMEZ
///
/// Bu fonksiyonda `remove_file` **yoktur ve olmayacaktır**. Taşınan dosya
/// kullanıcının tek kopyası olabilir; bu modülün birinci kuralı odur.
/// Testi: `kenara_kaldirma_hicbir_dosyayi_silmez`.
///
/// # Adlandırma: damga TABAN ada eklenir
///
/// `veri.db.onceki` -> `veri.db.onceki-<damga>`,
/// `veri.db.onceki-wal` -> `veri.db.onceki-<damga>-wal`. SQLite'ın yan
/// dosya kuralı böylece korunur ve taşınan çift gerekirse olduğu yerde
/// açılabilir (`kenara_al`'ın adlandırma gerekçesiyle aynı).
///
/// # Denetim kaydı
///
/// Etkisiz işlem **loglanmaz** (`store::audit` hacim politikası): taşınacak
/// dosya yoksa `Ok(0)` döner ve tek bir satır bile yazılmaz. Taşındıysa tek
/// bir `duzenleme|backup|<damga>` satırı yazılır (`HerCagri` -- seyrek ve
/// hesabı verilmesi gereken bir bakım işlemi). `varlik_id` damgadır: yol,
/// dosya adı ya da danışan verisi loga girmez.
///
/// Sıra `yedek_al_ve_kaydet` ile aynı: **önce iş, sonra log**; log
/// yazılamazsa dosyalar geri alınmaz (`KayitYazilamadi`).
pub fn onceki_dosyalari_kenara_kaldir(
    conn: &Connection,
    db_yolu: &Path,
    keystore_yolu: &Path,
    damga: &str,
    cihaz: Cihaz,
) -> Result<usize, YedekHatasi> {
    if !damga_gecerli_mi(damga) {
        return Err(YedekHatasi::GecersizDamga);
    }
    let ciftler = [
        (
            db_yolu.with_extension("db.onceki"),
            db_yolu.with_extension(format!("db.onceki-{damga}")),
        ),
        (
            db_yolu.with_extension("db.onceki-wal"),
            db_yolu.with_extension(format!("db.onceki-{damga}-wal")),
        ),
        (
            db_yolu.with_extension("db.onceki-shm"),
            db_yolu.with_extension(format!("db.onceki-{damga}-shm")),
        ),
        (
            keystore_yolu.with_extension("json.onceki"),
            keystore_yolu.with_extension(format!("json.onceki-{damga}")),
        ),
    ];
    let tasinacaklar: Vec<&(PathBuf, PathBuf)> =
        ciftler.iter().filter(|(asil, _)| asil.exists()).collect();
    if tasinacaklar.is_empty() {
        // ETKISIZ ISLEM LOGLANMAZ (bkz. `store::audit` modul basligi).
        return Ok(0);
    }
    // Hicbir hedefin UZERINE YAZILMAZ -- `kenara_al`'daki kapinin aynisi.
    // Ayni dakika icinde iki kez calistirilmak bir kopyayi yok etmemeli.
    for (_, hedef) in &tasinacaklar {
        if hedef.exists() {
            return Err(YedekHatasi::TemizlikBasarisiz(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "hedef ad kullanimda",
            )));
        }
    }
    let mut tasinan = 0usize;
    for (asil, hedef) in &tasinacaklar {
        // SILME YOK: yalnizca yeniden adlandirma. Yarida kalirsa dosyalarin
        // bir kismi yeni, kalani eski adiyla durur -- hicbiri kaybolmaz.
        std::fs::rename(asil, hedef).map_err(YedekHatasi::TemizlikBasarisiz)?;
        tasinan += 1;
    }
    kaydet(conn, Eylem::Duzenleme, VARLIK, damga, cihaz, None, LogHacmi::HerCagri).map_err(
        |_| YedekHatasi::KayitYazilamadi("Eski dosyalar taşındı ama denetim kaydına yazılamadı."),
    )?;
    Ok(tasinan)
}

/// Dosyayi siler; **islem sonunda o yolda dosya kalmadiysa** `true`.
///
/// "Zaten yoktu" basarisizlik DEGILDIR: geri almanin sormak istedigi soru
/// "silebildim mi" degil, "o dosya ortadan kalkti mi". Ayrim onemli, cunku
/// donen deger kullaniciya gosterilecek cumleyi secer.
fn yok_et(yol: &Path) -> bool {
    match std::fs::remove_file(yol) {
        Ok(()) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    }
}

/// Yedeği alır **ve** denetim kaydına yazar.
///
/// # Neden log burada, rota katmanında değil
///
/// Bu kod tabanının kuralı: *"çekirdek hacim kararını verir; rota ikinci bir
/// SİLİNEMEZ satır yazmaz"* ve kural yapısal olarak zorlanıyor
/// (`notlar_api.rs::rota_modulleri_audit_kaydet_cagirmaz`). Yedek alma bir
/// **dışa aktarmadır**: veri şifreli de olsa uygulamanın veri dizininden
/// çıkıp harici bir diske/bulut klasörüne yazılır. Emsal
/// `attachments::icerik_getir` -- tek bir ek indirmesi bile
/// `DisaAktarma` + `LogHacmi::HerCagri` ile yazılıyor, gerekçesi
/// *"birleştirilseydi on indirmenin dokuzu görünmez olurdu"*. Yedek alma
/// ondan da seyrek ve hesabı verilmesi gereken bir işlem; birleştirme
/// penceresi burada anlamsız olurdu.
///
/// `varlik_id` **tarih damgasıdır** (`yedek_al` onu `YYYY-AA-GG` biçimine
/// zorlar). Hedef dizin yolu loga **girmez**: kullanıcının ev dizinini
/// içerebilir ve `audit_log` silinemez.
///
/// Sıra: önce yedek, sonra log -- `icerik_getir` ile aynı ("önce oku, yoksa
/// dön, SONRA logla"): başarısız bir yedek log satırı bırakmaz. Log
/// yazılamazsa yedek **geri alınmaz**, bkz. `YedekHatasi::KayitYazilamadi`.
pub fn yedek_al_ve_kaydet(
    conn: &Connection,
    db_yolu: &Path,
    keystore_yolu: &Path,
    hedef_dizin: &Path,
    damga: &str,
    key: &DataKey,
    cihaz: Cihaz,
) -> Result<YedekBilgisi, YedekHatasi> {
    let bilgi = yedek_al(db_yolu, keystore_yolu, hedef_dizin, damga, key)?;
    kaydet(conn, Eylem::DisaAktarma, VARLIK, damga, cihaz, None, LogHacmi::HerCagri).map_err(
        |_| YedekHatasi::KayitYazilamadi("Yedek alındı ama denetim kaydına yazılamadı."),
    )?;
    Ok(bilgi)
}

/// `audit_log.varlik` değeri -- yedek/geri yükleme satırları için.
/// `routes::restore` geri yükleme satırını yazarken de bunu kullanır, iki
/// kopya sessizce ayrışmasın.
pub const VARLIK: &str = "backup";

/// Verilen damgaya ait **tam** (iki dosyası da yerinde) bir yedek var mı.
///
/// Otomatik günlük yedeğin "bugün zaten alındı mı" sorusunu yanıtlar.
/// `yedekleri_listele` üzerinden çalışır, yani **eksik çift bulunmuş sayılmaz**:
/// anahtar dosyası kaybolmuş bir yedek geri yüklenemez, dolayısıyla o günü
/// "yedeklenmiş" saymak kullanıcıya var olmayan bir güvenlik ağı vaat ederdi.
pub fn gunun_yedegi_var_mi(hedef_dizin: &Path, damga: &str) -> Result<bool, YedekHatasi> {
    Ok(yedekleri_listele(hedef_dizin)?.iter().any(|b| b.tarih == damga))
}

// =====================================================================
// YEDEK AYARLARI -- hedef dizin, DÜZ METİN dosyada
// =====================================================================

/// Yedek ayarlarının dosya adı (uygulamanın veri dizini içinde).
pub const AYAR_DOSYA_ADI: &str = "yedek-ayarlari.json";

/// Kullanıcının seçtiği yedek hedef dizini.
///
/// # Neden şifreli veritabanında DEĞİL
///
/// Bu ayarın okunması gereken en kritik an, veritabanının **açılamadığı**
/// andır: `veri.db` bozuk ya da `keystore.json` okunamıyor ve kullanıcı geri
/// yükleme ekranında "yedeklerim nerede?" sorusunun cevabına muhtaç.
/// `app_meta`'ya yazılsaydı tam da o anda erişilemez olurdu -- yani ayarın
/// tek gerçek işi yapılamazdı.
///
/// Gizlilik dengesi: dosya yalnızca bir **klasör yolu** tutar; danışan
/// verisi, dosya adı, anahtar veya parola taşımaz. Uygulamanın veri dizini
/// yolu zaten `/api/durum` ile (aynı gerekçeyle) bildiriliyor. Yedeklerin
/// kendisi şifrelidir; yolu bilmek onları açmaya yaramaz.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct YedekAyarlari {
    /// `None` = kullanıcı henüz bir klasör seçmedi. Bu durumda otomatik
    /// yedek **alınmaz** (nereye alınacağı bilinmiyor) ve arayüz kalıcı bir
    /// uyarı gösterir.
    pub hedef_dizin: Option<String>,
}

/// Ayarları okur. Dosya yoksa **ya da bozuksa** varsayılanı (hedef dizin
/// seçilmemiş) döndürür; hata yaymaz.
///
/// Bozuk bir ayar dosyası yüzünden uygulamanın açılmaması ya da geri yükleme
/// ekranının çalışmaması kabul edilemez: bu dosya bir kolaylıktır, verinin
/// kendisi değil. En kötü durumda kullanıcı klasörü yeniden seçer.
pub fn ayarlari_oku(veri_dizini: &Path) -> YedekAyarlari {
    std::fs::read(veri_dizini.join(AYAR_DOSYA_ADI))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Ayarları **atomik** yazar (geçici dosya + rename), `keystore::save` ile
/// aynı desen: yarım yazılmış bir JSON, bir sonraki açılışta ayarı sessizce
/// sıfırlardı.
pub fn ayarlari_yaz(veri_dizini: &Path, ayar: &YedekAyarlari) -> std::io::Result<()> {
    std::fs::create_dir_all(veri_dizini)?;
    let yol = veri_dizini.join(AYAR_DOSYA_ADI);
    let gecici = yol.with_extension("json.tmp");
    std::fs::write(&gecici, serde_json::to_vec_pretty(ayar)?)?;
    std::fs::rename(&gecici, &yol)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::{generate_data_key, DataKey, KdfParams};
    use crate::store::{db::open_encrypted, keystore, schema::migrate};
    use std::path::{Path, PathBuf};

    /// Test icin gercek bir kurulum uretir: diskte bir `keystore.json` ve onun
    /// sarmaladigi anahtarla acilmis bir `veri.db`. Uygulamadaki iliski
    /// birebir budur - anahtar dosyasi olmadan veritabani acilamaz.
    struct Ortam {
        _dir: tempfile::TempDir,
        kok: PathBuf,
        hedef: PathBuf,
        db: PathBuf,
        keystore_yolu: PathBuf,
        key: DataKey,
        keystore: keystore::Keystore,
    }

    fn kur(parola: &str) -> Ortam {
        let dir = tempfile::tempdir().unwrap();
        let kok = dir.path().to_path_buf();
        let kurulum = keystore::create(parola, KdfParams::test_fast()).unwrap();
        let keystore_yolu = kok.join("keystore.json");
        keystore::save(&kurulum.keystore, &keystore_yolu).unwrap();
        let key = kurulum.data_key.clone();
        let db = ornek_db(&kok, &key);
        Ortam {
            _dir: dir,
            hedef: kok.join("yedekler"),
            kok,
            db,
            keystore_yolu,
            key,
            keystore: kurulum.keystore,
        }
    }

    fn ornek_db(dir: &Path, key: &DataKey) -> PathBuf {
        let yol = dir.join("veri.db");
        let c = open_encrypted(&yol, key).unwrap();
        migrate(&c).unwrap();
        c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse');").unwrap();
        drop(c);
        yol
    }

    /// Anahtar dosyasinin icerigiyle ilgilenmeyen testler icin: gecerli bir
    /// keystore diske yazar ve yolunu doner.
    fn sahte_keystore(dir: &Path) -> PathBuf {
        let yol = dir.join("keystore.json");
        let kurulum = keystore::create("parola123", KdfParams::test_fast()).unwrap();
        keystore::save(&kurulum.keystore, &yol).unwrap();
        yol
    }

    #[test]
    fn yedek_alinir_ve_ayni_anahtarla_acilir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        let bilgi = yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();
        assert!(bilgi.yol.exists());
        assert!(bilgi.boyut > 0);

        let c = open_encrypted(&bilgi.yol, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    #[test]
    fn yediden_fazla_yedek_birikmez_en_eski_silinir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        for gun in 1..=10 {
            yedek_al(&db, &ks, &hedef, &format!("2026-09-{gun:02}"), &key).unwrap();
        }

        let liste = yedekleri_listele(&hedef).unwrap();
        assert_eq!(liste.len(), SAKLANAN_YEDEK_SAYISI);
        assert_eq!(liste[0].tarih, "2026-09-10", "en yeni basta olmali");
        assert_eq!(liste[6].tarih, "2026-09-04", "8 gun oncesi silinmis olmali");
        // Rotasyon cifti bir butun olarak silmeli; sahipsiz anahtar dosyasi
        // kalmamali.
        for gun in 1..=3 {
            let kalinti = hedef.join(format!("yedek-2026-09-{gun:02}.keystore.json"));
            assert!(!kalinti.exists(), "rotasyonda anahtar dosyasi da silinmeli: {kalinti:?}");
        }
    }

    #[test]
    fn ayni_gun_iki_kez_yedek_alinca_tek_dosya_kalir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();
        yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();
        assert_eq!(yedekleri_listele(&hedef).unwrap().len(), 1);
    }

    #[test]
    fn bozuk_yedek_geri_yuklenmez_ve_mevcut_veri_korunur() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        std::fs::write(&bilgi.yol, b"bu bir veritabani degil").unwrap();
        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::BozukYedek), "gelen: {hata:?}");

        // Mevcut veritabani bozulmamis olmali.
        let c = open_encrypted(&o.db, &o.key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    #[test]
    fn geri_yukleme_veriyi_yedekteki_haline_dondurur() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        {
            let c = open_encrypted(&o.db, &o.key).unwrap();
            c.execute("UPDATE t SET ad='Degistirildi'", []).unwrap();
        }

        geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap();

        let c = open_encrypted(&o.db, &o.key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    // --- Bulgu 1: WAL yan dosyalari yedege girmiyor ---------------------

    #[test]
    fn acik_baglanti_varken_yazilan_veri_yedege_dahil_olur() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = d.path().join("veri.db");
        let ks = sahte_keystore(d.path());

        let c = open_encrypted(&db, &key).unwrap();
        migrate(&c).unwrap();
        c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse');").unwrap();
        // BILEREK KAPATMIYORUZ: uygulama oturum boyunca baglantiyi acik
        // tutar; son yazilan kayitlar WAL dosyasinda kalabilir ve henuz
        // ana .db dosyasina checkpoint edilmemis olabilir.

        let bilgi = yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();

        let dogrulama = open_encrypted(&bilgi.yol, &key).unwrap();
        let ad: String = dogrulama.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(
            ad, "Ayse",
            "acik baglanti varken yazilan veri yedekte olmali (WAL kaybi yasanmamali)"
        );

        drop(dogrulama);
        drop(c);
    }

    #[test]
    fn yedek_dosyasinda_duz_metin_bulunmaz() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = d.path().join("veri.db");
        let ks = sahte_keystore(d.path());
        {
            let c = open_encrypted(&db, &key).unwrap();
            migrate(&c).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('GIZLI_DANISAN_ADI');")
                .unwrap();
        }

        let bilgi = yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();

        let bytes = std::fs::read(&bilgi.yol).unwrap();
        assert!(
            !bytes.windows(17).any(|w| w == b"GIZLI_DANISAN_ADI"),
            "yedek dosyasinda duz metin bulundu"
        );
        assert!(&bytes[..15] != b"SQLite format 3", "yedek sifrelenmemis");
    }

    // --- Bulgu 2: beklenmeyen dosyalar sessizce silinebiliyor -----------

    #[test]
    fn elle_konan_gecersiz_isimli_dosya_rotasyonda_silinmez() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        std::fs::create_dir_all(&hedef).unwrap();
        let elle_konan = hedef.join("yedek-eskiyedegim.db");
        std::fs::write(&elle_konan, b"kullanicinin elle koydugu eski yedek").unwrap();
        let windows_kopyasi = hedef.join("yedek-2026-09-07 (2).db");
        std::fs::write(&windows_kopyasi, b"windows kopyalama sonucu uretilen dosya").unwrap();

        for gun in 1..=10 {
            yedek_al(&db, &ks, &hedef, &format!("2026-09-{gun:02}"), &key).unwrap();
        }

        assert!(elle_konan.exists(), "kullanicinin elle koydugu yedek silinmemeli");
        assert!(windows_kopyasi.exists(), "gecersiz bicimli dosya silinmemeli");

        let liste = yedekleri_listele(&hedef).unwrap();
        assert_eq!(
            liste.len(),
            SAKLANAN_YEDEK_SAYISI,
            "gecersiz bicimli dosyalar listeye/rotasyona hic girmemeli"
        );
        assert!(liste.iter().all(|b| b.tarih != "eskiyedegim" && b.tarih != "2026-09-07 (2)"));
    }

    #[test]
    fn gecersiz_bicimli_damga_ile_yedek_alinamaz() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        let hata = yedek_al(&db, &ks, &hedef, "eskiyedegim", &key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::GecersizTarih(_)));

        let hata2 = yedek_al(&db, &ks, &hedef, "2026-09-07 (2)", &key).unwrap_err();
        assert!(matches!(hata2, YedekHatasi::GecersizTarih(_)));
    }

    // --- Bulgu 3: her acma hatasi "bozuk yedek" olarak raporlaniyor -----

    #[test]
    fn kalici_olmayan_io_hatasi_bozukyedek_olarak_raporlanmaz() {
        let io_hata = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "erisim engellendi");
        let sonuc = siniflandir_geri_yukleme_hatasi(DbError::Io(io_hata));
        assert!(
            matches!(sonuc, YedekHatasi::Db(DbError::Io(_))),
            "beklenen Db(Io), gelen: {sonuc:?}"
        );
    }

    #[test]
    fn gecici_sqlite_hatasi_bozukyedek_olarak_raporlanmaz() {
        // Ã¶r. dosya kilitli (SQLITE_BUSY) - bu "bozuk" degil, gecici bir durum.
        let sahte_ffi_hata = rusqlite::ffi::Error { code: ErrorCode::DatabaseBusy, extended_code: 5 };
        let sonuc = siniflandir_geri_yukleme_hatasi(DbError::Sqlite(rusqlite::Error::SqliteFailure(
            sahte_ffi_hata,
            None,
        )));
        assert!(
            matches!(sonuc, YedekHatasi::Db(DbError::Sqlite(_))),
            "beklenen Db(Sqlite), gelen: {sonuc:?}"
        );
    }

    #[test]
    fn wrongkey_bozukyedek_olarak_raporlanir() {
        let sonuc = siniflandir_geri_yukleme_hatasi(DbError::WrongKey);
        assert!(matches!(sonuc, YedekHatasi::BozukYedek), "beklenen BozukYedek, gelen: {sonuc:?}");
    }

    // --- Bulgu 5: butunluk kontrolu yuzeysel -----------------------------

    #[test]
    fn veri_sayfasi_bozuk_yedek_quick_check_ile_yakalanir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = d.path().join("veri.db");
        let ks = sahte_keystore(d.path());
        {
            let c = open_encrypted(&db, &key).unwrap();
            migrate(&c).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT);").unwrap();
            let mut stmt = c.prepare("INSERT INTO t VALUES (?1)").unwrap();
            // Sema sayfasinin (page 1) disinda en az bir veri sayfasi daha
            // olusturacak kadar veri yaz; boylece bozacagimiz bayt semaya
            // degil bir veri sayfasina denk gelsin (open_encrypted sadece
            // sema sayfasini okur, bu yuzden acilis basarili olmali).
            for i in 0..500 {
                stmt.execute([format!("satir-{i}-{}", "x".repeat(50))]).unwrap();
            }
        }
        let bilgi = yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();

        let mut bytes = std::fs::read(&bilgi.yol).unwrap();
        let uzunluk = bytes.len();
        assert!(uzunluk > 8192, "test icin en az iki sayfalik veri gerekiyor, uzunluk={uzunluk}");
        // Dosyanin son 200 baytini boz: sema (ilk sayfa) saglam kalsin, son
        // veri sayfalari bozulsun.
        for b in bytes.iter_mut().skip(uzunluk - 200) {
            *b ^= 0xFF;
        }
        std::fs::write(&bilgi.yol, &bytes).unwrap();

        let hata = geri_yukle(&bilgi.yol, &db, &ks, &key).unwrap_err();
        assert!(
            matches!(hata, YedekHatasi::BozukYedek),
            "beklenen BozukYedek (quick_check veri sayfasi bozuklugunu yakalamali), gelen: {hata:?}"
        );
    }

    // --- Gorev 12: yedek = veritabani + anahtar dosyasi ------------------

    #[test]
    fn yedek_hem_veritabanini_hem_keystore_u_icerir() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        assert_eq!(bilgi.yol, o.hedef.join("yedek-2026-09-07.db"));
        assert!(bilgi.yol.exists(), "yedek veritabani yazilmali");

        let yedek_ks = o.hedef.join("yedek-2026-09-07.keystore.json");
        assert_eq!(keystore_yedek_yolu(&bilgi.yol), yedek_ks);
        assert!(yedek_ks.exists(), "yedek anahtar dosyasi da yazilmali");
        assert!(bilgi.keystore_var);

        // Yedekteki anahtar dosyasi gercekten kullanilabilir olmali: ayni
        // parola onu acmali ve ayni veri anahtarini vermeli.
        let okunan = keystore::load(&yedek_ks).unwrap();
        let acilan = keystore::unlock_with_password(&okunan, "parola123").unwrap();
        assert_eq!(acilan.as_ref(), o.key.as_ref());
    }

    #[test]
    fn keystore_eksikse_geri_yukleme_reddedilir_ve_mevcut_veri_korunur() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        let db_once = std::fs::read(&o.db).unwrap();
        let ks_once = std::fs::read(&o.keystore_yolu).unwrap();

        std::fs::remove_file(keystore_yedek_yolu(&bilgi.yol)).unwrap();

        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(
            matches!(hata, YedekHatasi::YedekEksik(EksikParca::Keystore)),
            "eksik dosya 'bozuk' diye raporlanmamali; gelen: {hata:?}"
        );

        assert_eq!(std::fs::read(&o.db).unwrap(), db_once, "mevcut veritabani degismemeli");
        assert_eq!(
            std::fs::read(&o.keystore_yolu).unwrap(),
            ks_once,
            "mevcut anahtar dosyasi degismemeli"
        );
        // Yarim geri yuklemeden kalan bir kalinti da olmamali.
        assert!(!o.db.with_extension("restore").exists());
        assert!(!o.keystore_yolu.with_extension("json.restore").exists());
    }

    #[test]
    fn veritabani_eksikse_geri_yukleme_reddedilir() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        let db_once = std::fs::read(&o.db).unwrap();
        let ks_once = std::fs::read(&o.keystore_yolu).unwrap();

        std::fs::remove_file(&bilgi.yol).unwrap();

        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::YedekEksik(EksikParca::Veritabani)), "gelen: {hata:?}");

        assert_eq!(std::fs::read(&o.db).unwrap(), db_once);
        assert_eq!(std::fs::read(&o.keystore_yolu).unwrap(), ks_once);
    }

    #[test]
    fn ikisi_de_eksikse_ayri_bir_hata_doner() {
        let o = kur("parola123");
        let yok = o.hedef.join("yedek-2026-01-01.db");
        let hata = geri_yukle(&yok, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::YedekEksik(EksikParca::Ikisi)), "gelen: {hata:?}");
    }

    #[test]
    fn yedekteki_bozuk_keystore_eksikten_ayirt_edilir() {
        // "Eksik" ile "bozuk" ayni hata olmamali: birinde dosya baska bir
        // yerdedir ve bulunabilir, digerinde dosya kurtarilamaz. Ikisini
        // birlestirmek kullaniciyi yanlis yone iter.
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        std::fs::write(keystore_yedek_yolu(&bilgi.yol), b"{ bu gecerli json degil").unwrap();
        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::BozukKeystore), "gelen: {hata:?}");

        // JSON gecerli ama sarmalama yarim: `load` bunu yakalayamaz,
        // yapisal dogrulama yakalamali.
        let mut ks = keystore::load(&o.keystore_yolu).unwrap();
        ks.password.ciphertext_hex.truncate(4);
        keystore::save(&ks, &keystore_yedek_yolu(&bilgi.yol)).unwrap();
        let hata2 = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata2, YedekHatasi::BozukKeystore), "gelen: {hata2:?}");
    }

    #[test]
    fn eksik_ciftli_yedekler_listede_gorunmez() {
        let o = kur("parola123");
        for gun in 1..=3 {
            yedek_al(&o.db, &o.keystore_yolu, &o.hedef, &format!("2026-09-{gun:02}"), &o.key)
                .unwrap();
        }
        assert_eq!(yedekleri_listele(&o.hedef).unwrap().len(), 3);

        // Ortadaki yedegin anahtar dosyasini kaybet.
        std::fs::remove_file(o.hedef.join("yedek-2026-09-02.keystore.json")).unwrap();

        let liste = yedekleri_listele(&o.hedef).unwrap();
        assert_eq!(liste.len(), 2, "anahtarsiz yedek listelenmemeli");
        assert!(
            liste.iter().all(|b| b.tarih != "2026-09-02"),
            "geri yuklenemeyecek yedek kullaniciya gosterilmemeli"
        );
        assert!(liste.iter().all(|b| b.keystore_var));

        // Dosya hala diskte: listeden gizlemek, silmek demek degil.
        assert!(o.hedef.join("yedek-2026-09-02.db").exists());
        // Ham tarama onu eksik olarak gormeli.
        let tarama = yedekleri_tara(&o.hedef).unwrap();
        assert_eq!(tarama.len(), 3);
        assert!(tarama.iter().any(|b| b.tarih == "2026-09-02" && !b.keystore_var));
    }

    #[test]
    fn geri_yukleme_ikisini_birlikte_yerine_koyar() {
        // BU TESTIN VARLIK SEBEBI: dosyanin kopyalanmis olmasi degil, geri
        // yuklenen CIFTIN birlikte calistigi kanitlanmali.
        let o = kur("eski-parola");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        // Parolayi degistir: DISKTEKI anahtar dosyasi degisir.
        let yeni_keystore =
            keystore::change_password(&o.keystore, "eski-parola", "yeni-parola").unwrap();
        keystore::save(&yeni_keystore, &o.keystore_yolu).unwrap();

        // On kosul: artik eski parola diskteki dosyayi ACMIYOR.
        let diskteki = keystore::load(&o.keystore_yolu).unwrap();
        assert!(
            keystore::unlock_with_password(&diskteki, "eski-parola").is_err(),
            "on kosul: parola degisimi diskteki anahtar dosyasini gercekten degistirmis olmali"
        );
        assert!(keystore::unlock_with_password(&diskteki, "yeni-parola").is_ok());

        // Veriyi de degistir ki geri yuklemenin db'yi de tasidigini gorelim.
        {
            let c = open_encrypted(&o.db, &o.key).unwrap();
            c.execute("UPDATE t SET ad='Degistirildi'", []).unwrap();
        }

        geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap();

        // KANIT: ESKI parola yeniden calisiyor - demek ki keystore da geri
        // yuklendi, yalnizca db kopyalanmadi.
        let geri_yuklenen = keystore::load(&o.keystore_yolu).unwrap();
        let acilan = keystore::unlock_with_password(&geri_yuklenen, "eski-parola")
            .expect("geri yuklenen anahtar dosyasi ESKI parolayla acilmali");
        assert_eq!(acilan.as_ref(), o.key.as_ref(), "ayni veri anahtari gelmeli");

        // Ve o anahtarla geri yuklenen veritabani gercekten aciliyor.
        let c = open_encrypted(&o.db, &acilan).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse", "veritabani da yedekteki haline donmeli");

        // Cift birlikte geri geldi: parola degisikligi de geri alinmis olmali.
        assert!(keystore::unlock_with_password(&geri_yuklenen, "yeni-parola").is_err());
    }

    #[test]
    fn yedek_keystore_dosyasinda_ham_anahtar_bulunmaz() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        let icerik = std::fs::read(keystore_yedek_yolu(&bilgi.yol)).unwrap();
        let anahtar_hex = hex::encode(o.key.as_ref());
        let metin = String::from_utf8_lossy(&icerik);
        assert!(!metin.contains(&anahtar_hex), "yedekteki anahtar dosyasinda duz anahtar bulundu");
        assert!(
            !icerik.windows(32).any(|w| w == o.key.as_ref()),
            "yedekteki anahtar dosyasinda ham anahtar baytlari bulundu"
        );
    }

    #[test]
    fn keystore_yoksa_yedek_alinmaz() {
        // Anahtarsiz alinan bir "yedek" geri yuklenemez; sessizce yarim
        // yedek uretmektense hata dondurmek dogrudur.
        let d = tempfile::tempdir().unwrap();
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let yok = d.path().join("keystore.json");
        let hedef = d.path().join("yedekler");

        let hata = yedek_al(&db, &yok, &hedef, "2026-09-07", &key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::KaynakKeystoreYok), "gelen: {hata:?}");
        assert!(!hedef.join("yedek-2026-09-07.db").exists(), "yarim yedek birakilmamali");
    }

    #[test]
    fn bozuk_keystore_ile_yedek_alinmaz() {
        let o = kur("parola123");
        std::fs::write(&o.keystore_yolu, b"bu json degil").unwrap();

        let hata = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::KaynakKeystoreBozuk), "gelen: {hata:?}");
        assert!(!o.hedef.join("yedek-2026-09-07.db").exists());
    }

    // --- Urune baglama: denetim kaydi, gunluk yedek, ayarlar ------------

    /// Oturumun veritabanindaki log satirlarini `eylem|varlik|varlik_id`
    /// olarak dondurur.
    fn log_satirlari(c: &rusqlite::Connection) -> Vec<String> {
        crate::store::audit::son_kayitlar(c, 200)
            .unwrap()
            .into_iter()
            .map(|k| format!("{}|{}|{}", k.eylem, k.varlik, k.varlik_id))
            .collect()
    }

    #[test]
    fn yedek_alma_denetim_kaydina_tam_bir_satir_yazar() {
        let o = kur("parola123");
        let c = open_encrypted(&o.db, &o.key).unwrap();
        let once = log_satirlari(&c).len();

        yedek_al_ve_kaydet(
            &c,
            &o.db,
            &o.keystore_yolu,
            &o.hedef,
            "2026-09-07",
            &o.key,
            crate::store::audit::Cihaz::Masaustu,
        )
        .unwrap();

        let sonra = log_satirlari(&c);
        assert_eq!(sonra.len(), once + 1, "TAM OLARAK bir satir eklenmeli");
        assert!(
            sonra.contains(&"disa_aktarma|backup|2026-09-07".to_string()),
            "yedek alma silinemez kayitta gorunmeli -- {sonra:?}"
        );
    }

    #[test]
    fn ard_arda_iki_yedek_iki_satir_yazar() {
        // `attachments::icerik_getir` ile ayni gerekce: birlestirilseydi iki
        // yedekten biri gorunmez olurdu. `LogHacmi::HerCagri` secimini
        // KANITLAYAN test budur.
        //
        // AYNI DAMGA bilerek: birlestirme anahtari
        // `(eylem, varlik, varlik_id, cihaz)` dortlusudur ve `varlik_id`
        // damgadir. Iki FARKLI gunle olculseydi `OturumBasi(5)` mutasyonu
        // hayatta kalirdi -- iki farkli `varlik_id` zaten birlesmez.
        // "Simdi yedek al"a ayni gun iki kez basmak gercek bir kullanici
        // eylemi (ornegin dosyalari harici diske kopyalamadan once) ve
        // ikisi de hesabi verilmesi gereken birer disa aktarmadir.
        let o = kur("parola123");
        let c = open_encrypted(&o.db, &o.key).unwrap();
        let once = log_satirlari(&c).len();

        for _ in 0..2 {
            yedek_al_ve_kaydet(
                &c,
                &o.db,
                &o.keystore_yolu,
                &o.hedef,
                "2026-09-07",
                &o.key,
                crate::store::audit::Cihaz::Masaustu,
            )
            .unwrap();
        }

        let sonra = log_satirlari(&c);
        assert_eq!(sonra.len(), once + 2, "her yedek ayri satir yazmali -- {sonra:?}");
        assert_eq!(
            sonra.iter().filter(|s| *s == "disa_aktarma|backup|2026-09-07").count(),
            2
        );
    }

    #[test]
    fn basarisiz_yedek_log_satiri_birakmaz() {
        // `seriyi_sil` dersi: olmamis bir islem silinemez loga gurultu
        // dusurmemeli. Anahtar dosyasi yoksa yedek HIC alinmaz.
        let o = kur("parola123");
        let c = open_encrypted(&o.db, &o.key).unwrap();
        let once = log_satirlari(&c).len();

        let yok = o.kok.join("olmayan-keystore.json");
        let hata = yedek_al_ve_kaydet(
            &c,
            &o.db,
            &yok,
            &o.hedef,
            "2026-09-07",
            &o.key,
            crate::store::audit::Cihaz::Masaustu,
        )
        .unwrap_err();
        assert!(matches!(hata, YedekHatasi::KaynakKeystoreYok), "gelen: {hata:?}");
        assert_eq!(log_satirlari(&c).len(), once, "basarisiz yedek log yazmamali");
    }

    #[test]
    fn log_yazilamazsa_yedek_geri_alinmaz_ama_hata_doner() {
        // Karar: fail-OPEN, ama SESSIZ DEGIL (bkz. `YedekHatasi::KayitYazilamadi`).
        //
        // `attachments::icerik_getir` fail-closed davranir cunku orada geri
        // alinacak bir sey yoktur -- icerik dondurulmez, konu kapanir.
        // Burada geri almak, diskteki GECERLI BIR YEDEGI silmek demektir ve
        // bu urunun ucuncu basari olcutu "bilgisayar bozulursa veri
        // kaybolmasin". Bir log satiri yazilamadi diye kullanicinin tek
        // kopyasini yok etmek o olcutun dogrudan ihlali olurdu.
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        // `audit_log` tablosu OLMAYAN bir baglanti: `kaydet` basarisiz olur.
        let semasiz = open_encrypted(&d.path().join("semasiz.db"), &key).unwrap();
        assert!(
            crate::store::audit::kaydet(
                &semasiz,
                crate::store::audit::Eylem::DisaAktarma,
                VARLIK,
                "2026-09-07",
                crate::store::audit::Cihaz::Masaustu,
                None,
                crate::store::audit::LogHacmi::HerCagri,
            )
            .is_err(),
            "on kosul: bu baglantiya log yazilamiyor olmali"
        );

        let hata = yedek_al_ve_kaydet(
            &semasiz,
            &db,
            &ks,
            &hedef,
            "2026-09-07",
            &key,
            crate::store::audit::Cihaz::Masaustu,
        )
        .unwrap_err();

        // SESSIZ DEGIL: cagirana hata donuyor.
        assert!(matches!(hata, YedekHatasi::KayitYazilamadi(_)), "gelen: {hata:?}");
        assert!(hata.to_string().contains("geri alınmadı"), "mesaj ne OLMADIGINI da soylemeli");

        // GERI ALINMADI: cift diskte ve gercekten geri yuklenebilir.
        let yedek = hedef.join("yedek-2026-09-07.db");
        assert!(yedek.exists(), "yedek silinmemeli -- log hatasi veriyi yok etmemeli");
        assert!(keystore_yedek_yolu(&yedek).exists(), "cift eksiksiz kalmali");
        assert_eq!(yedekleri_listele(&hedef).unwrap().len(), 1, "yedek listelenebilir olmali");
    }

    #[test]
    fn yedek_log_satiri_hedef_dizin_yolunu_tasimaz() {
        // Hedef dizin kullanicinin ev dizinini (dolayisiyla ADINI) icerebilir
        // ve `audit_log` SILINEMEZ. Yol loga girmemeli.
        let o = kur("parola123");
        let c = open_encrypted(&o.db, &o.key).unwrap();
        yedek_al_ve_kaydet(
            &c,
            &o.db,
            &o.keystore_yolu,
            &o.hedef,
            "2026-09-07",
            &o.key,
            crate::store::audit::Cihaz::Masaustu,
        )
        .unwrap();

        let kayit = crate::store::audit::son_kayitlar(&c, 1).unwrap().remove(0);
        let tumu = format!("{}|{}|{}|{:?}", kayit.eylem, kayit.varlik, kayit.varlik_id, kayit.ayrinti);
        let hedef_metni = o.hedef.display().to_string();
        assert!(!tumu.contains(&hedef_metni), "hedef dizin yolu loga girmis: {tumu}");
        assert!(
            !tumu.contains(&o.kok.display().to_string()),
            "veri dizini yolu loga girmis: {tumu}"
        );
    }

    #[test]
    fn gunun_yedegi_var_mi_tam_cifti_arar() {
        let o = kur("parola123");
        assert!(!gunun_yedegi_var_mi(&o.hedef, "2026-09-07").unwrap(), "on kosul: yedek yok");

        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();
        assert!(gunun_yedegi_var_mi(&o.hedef, "2026-09-07").unwrap());
        assert!(
            !gunun_yedegi_var_mi(&o.hedef, "2026-09-08").unwrap(),
            "baska bir gun yedeklenmis sayilmamali"
        );

        // EKSIK CIFT "yedeklenmis" SAYILMAMALI: geri yuklenemeyecek bir yedek,
        // o gunu guvende gostererek yenisinin alinmasini engellerdi.
        std::fs::remove_file(keystore_yedek_yolu(&bilgi.yol)).unwrap();
        assert!(
            !gunun_yedegi_var_mi(&o.hedef, "2026-09-07").unwrap(),
            "anahtarsiz yedek o gunu 'yedeklenmis' saymamali"
        );
    }

    #[test]
    fn ayarlar_diske_yazilip_geri_okunur() {
        let d = tempfile::tempdir().unwrap();
        assert!(ayarlari_oku(d.path()).hedef_dizin.is_none(), "on kosul: ayar yok");

        ayarlari_yaz(d.path(), &YedekAyarlari { hedef_dizin: Some("/Volumes/YEDEK".into()) })
            .unwrap();
        assert_eq!(ayarlari_oku(d.path()).hedef_dizin.as_deref(), Some("/Volumes/YEDEK"));
    }

    #[test]
    fn bozuk_ayar_dosyasi_varsayilana_duser_ve_patlamaz() {
        // Bu dosya bir kolayliktir, verinin kendisi degil: bozuksa uygulama
        // acilmali ve geri yukleme ekrani calismali. En kotu durumda kullanici
        // klasoru yeniden secer.
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join(AYAR_DOSYA_ADI), b"{ bu json degil").unwrap();
        assert!(ayarlari_oku(d.path()).hedef_dizin.is_none());
    }

    #[test]
    fn ayar_dosyasi_gecici_kalinti_birakmaz() {
        let d = tempfile::tempdir().unwrap();
        ayarlari_yaz(d.path(), &YedekAyarlari { hedef_dizin: Some("/tmp/y".into()) }).unwrap();
        assert!(
            !d.path().join("yedek-ayarlari.json.tmp").exists(),
            "atomik yazma gecici dosya birakmamali"
        );
    }

    #[test]
    fn geri_yukleme_bos_bir_kuruluma_da_yapilabilir() {
        // Disk degisti senaryosu: yedek klasoru var, uygulama veri dizini bos.
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        let yeni_kok = o.kok.join("yeni-bilgisayar");
        std::fs::create_dir_all(&yeni_kok).unwrap();
        let yeni_db = yeni_kok.join("veri.db");
        let yeni_ks = yeni_kok.join("keystore.json");

        geri_yukle(&bilgi.yol, &yeni_db, &yeni_ks, &o.key).unwrap();

        let okunan = keystore::load(&yeni_ks).unwrap();
        let acilan = keystore::unlock_with_password(&okunan, "parola123").unwrap();
        let c = open_encrypted(&yeni_db, &acilan).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    // =================================================================
    // Plan 7 / Gorev 1: geri yukleme canli veritabanini YOK ETMESIN
    //
    // Bu bolumdeki testlerin ortak senaryosu su: terapist o gun seans
    // notlari girmis, henuz yedek almamis ve eski/uyumsuz bir yedegi geri
    // yuklemeyi deniyor. Eski davranista dosyalar once yerlestiriliyor,
    // `migrate` sonra patliyordu -- o noktada `veri.db.onceki` silinmis
    // oluyor ve o gunun notlari KALICI olarak kayboluyordu.
    // =================================================================

    /// Bir yedek dosyasinin `schema_version` damgasini degistirir.
    ///
    /// YEDEGIN KENDISINI degistirir, uygulamanin veritabanini degil --
    /// "daha yeni bir surumle alinmis yedek" durumunu uretmenin tek yolu bu.
    fn yedek_surumunu_ayarla(yedek_yolu: &Path, key: &DataKey, deger: i64) {
        {
            let c = open_encrypted(yedek_yolu, key).unwrap();
            c.execute(
                "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version', ?1)
                 ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger",
                [deger.to_string()],
            )
            .unwrap();
        }
        // Yedek TEK dosya olarak gecerli olmali: kapanista checkpoint edilen
        // WAL yan dosyalari geride kalmasin.
        for ek in ["db-wal", "db-shm"] {
            let _ = std::fs::remove_file(yedek_yolu.with_extension(ek));
        }
    }

    /// Mevcut veritabanina "bugun girilmis, henuz yedeklenmemis" bir kayit
    /// yazar ve (db, keystore) ikilisinin ham iceriklerini dondurur.
    ///
    /// # Neden veri DEGISTIRILIYOR
    /// "Mevcut dosyalar degismedi" iddiasi, dosyalar zaten yedektekiyle ayni
    /// olsaydi islem oncesi durumla tatmin olurdu -- yani yerlestirme
    /// GERCEKTEN olsa bile test yesil kalirdi
    /// (`docs/test-yesil-ama-korumuyor.md`, 6. bicim). Canli veriyi yedekten
    /// farklilastirmak iddiayi anlamli kilar: yerlestirme olsaydi `t.ad`
    /// 'Ayse'ye donerdi.
    const BUGUNUN_NOTU: &str = "Bugun girilen ve henuz yedeklenmemis not";

    fn canliyi_farklilastir_ve_oku(o: &Ortam) -> (Vec<u8>, Vec<u8>) {
        {
            let c = open_encrypted(&o.db, &o.key).unwrap();
            c.execute("UPDATE t SET ad = ?1", [BUGUNUN_NOTU]).unwrap();
        }
        (std::fs::read(&o.db).unwrap(), std::fs::read(&o.keystore_yolu).unwrap())
    }

    /// Reddedilen bir geri yuklemeden sonra mevcut ciftin ICERIGININ ve
    /// okunabilirliginin korundugunu, geride kalinti kalmadigini dogrular.
    fn canli_cift_bozulmadi(o: &Ortam, db_once: &[u8], ks_once: &[u8]) {
        assert_eq!(std::fs::read(&o.db).unwrap(), db_once, "mevcut veritabani degismemeli");
        assert_eq!(
            std::fs::read(&o.keystore_yolu).unwrap(),
            ks_once,
            "mevcut anahtar dosyasi degismemeli"
        );
        // Bayt esitligi yetmez: dosya hala ACILABILIR ve o gunun kaydi
        // OKUNABILIR olmali.
        let c = open_encrypted(&o.db, &o.key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, BUGUNUN_NOTU, "o gun girilen kayit yok olmamali");
        drop(c);

        for kalinti in [
            o.db.with_extension("db.onceki"),
            o.db.with_extension("db.onceki-wal"),
            o.db.with_extension("db.onceki-shm"),
            o.db.with_extension("restore"),
            o.keystore_yolu.with_extension("json.onceki"),
            o.keystore_yolu.with_extension("json.restore"),
        ] {
            assert!(!kalinti.exists(), "geri yukleme kalinti birakmamali: {kalinti:?}");
        }
    }

    #[test]
    fn ileri_surumlu_yedek_yerlestirmeden_once_reddedilir() {
        use crate::store::schema::CURRENT_VERSION;

        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        // Yedek, bu uygulamanin bildiginden BIR SURUM yeni.
        let ileri = CURRENT_VERSION + 1;
        yedek_surumunu_ayarla(&bilgi.yol, &o.key, ileri);

        let (db_once, ks_once) = canliyi_farklilastir_ve_oku(&o);
        assert_ne!(
            db_once,
            std::fs::read(&bilgi.yol).unwrap(),
            "on kosul: canli veritabani yedekten farkli olmali, yoksa \
             'degismedi' iddiasi hicbir sey olcmez"
        );

        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();

        // (c) Ayri bir varyant: "bozuk" DEGIL.
        assert!(
            matches!(
                hata,
                YedekHatasi::YedekIleriSurumlu { yedek, uygulama }
                    if yedek == ileri && uygulama == CURRENT_VERSION
            ),
            "gelen: {hata:?}"
        );
        let mesaj = hata.to_string();
        assert!(
            !mesaj.to_lowercase().contains("bozuk"),
            "saglam bir yedek 'bozuk' diye anlatilmamali: {mesaj}"
        );
        assert!(mesaj.contains("güncelle"), "mesaj ne yapilacagini soylemeli: {mesaj}");

        // (a)+(b) Geri yukleme reddedildi ve mevcut cift DOKUNULMADAN durdu.
        canli_cift_bozulmadi(&o, &db_once, &ks_once);
    }

    /// Eksi ucretli bir randevu tasiyan, V4 ONCESI damgali bir yedek uretir
    /// ve yolunu doner. `migrate` bunu `UcretKisitiIhlali` ile reddeder.
    ///
    /// # Neden bu tetikleyici (inceleme MINOR-5)
    /// Ilk bicimde yedek "damga 4 ama `tags` tablosu zaten var" durumuna
    /// sokuluyordu; o durum URETIMDE OLUSAMAZ -- `migrate` tek transaction,
    /// yarim uygulanmis bir goc diske hic yazilmaz
    /// (`docs/test-yesil-ama-korumuyor.md`, 11. bicim). Bu tetikleyici
    /// ULASILABILIR: eksi ucret kuralı V4'e kadar yalnizca uygulama
    /// katmanindaydi, yani V4 oncesi bir yedek gercekten eksi ucretli bir
    /// randevu tasiyor olabilir. Ayrica `v4_uygula`'nin gercek reddetme
    /// yolunu olcer.
    fn eksi_ucretli_v3_yedegi(o: &Ortam, damga: &str) -> PathBuf {
        let kaynak = o.kok.join("eksi-ucretli.db");
        {
            let c = open_encrypted(&kaynak, &o.key).unwrap();
            migrate(&c).unwrap();

            // V5'i ve V4'u geri sar: `appointments` V2'deki -- yani ucret
            // CHECK'i OLMAYAN -- haline donsun, damga 3 olsun.
            //
            // CHECK'i `PRAGMA ignore_check_constraints` ile atlatmak
            // YETMEZDI: `quick_check` CHECK ihlallerini de raporluyor, yani
            // boyle bir yedek daha dogrulama adiminda `BozukYedek` olurdu.
            // Zaten uretimdeki durum da tam olarak budur: eksi ucretli satir,
            // kisitin HIC OLMADIGI bir semada yazilmistir.
            //
            // Tablo tanimi V4 oncesinin tarihsel metnidir; `schema.rs`'teki
            // V2 ile ayrismasi bu testi sessizce etkisizlestirmez, goc zaten
            // ucret sutununa bakiyor.
            c.pragma_update(None, "foreign_keys", "OFF").unwrap();
            c.execute_batch(
                "DROP TRIGGER progress_note_tags_temizle_kullanilmayan;
                 DROP TABLE progress_note_tags;
                 DROP TABLE tags;
                 DROP TABLE appointments;
                 CREATE TABLE appointments (
                     id                INTEGER PRIMARY KEY AUTOINCREMENT,
                     client_id         INTEGER NOT NULL REFERENCES clients(id),
                     baslangic         TEXT NOT NULL,
                     bitis             TEXT NOT NULL,
                     durum             TEXT NOT NULL DEFAULT 'planlandi',
                     ucret             INTEGER,
                     odendi            INTEGER NOT NULL DEFAULT 0,
                     seri_id           TEXT,
                     olusturma_zamani  TEXT NOT NULL,
                     guncelleme_zamani TEXT NOT NULL,
                     CHECK (durum IN ('planlandi','geldi','gelmedi','iptal')),
                     CHECK (bitis > baslangic)
                 );
                 CREATE INDEX ix_app_baslangic ON appointments(baslangic);
                 CREATE INDEX ix_app_client ON appointments(client_id);
                 CREATE INDEX ix_app_seri ON appointments(seri_id);
                 UPDATE app_meta SET deger='3' WHERE anahtar='schema_version';",
            )
            .unwrap();
            c.pragma_update(None, "foreign_keys", "ON").unwrap();

            c.execute_batch(
                "INSERT INTO clients (ad_soyad, durum, olusturma_zamani)
                 VALUES ('Ayse Yilmaz', 'aktif', '2026-09-01 09:00');

                 INSERT INTO appointments
                     (client_id, baslangic, bitis, durum, ucret, odendi,
                      olusturma_zamani, guncelleme_zamani)
                 VALUES (1, '2026-09-05 10:00', '2026-09-05 10:50', 'geldi', -100, 0,
                         '2026-09-01 09:05', '2026-09-01 09:05');",
            )
            .unwrap();
        }
        yedek_al(&kaynak, &o.keystore_yolu, &o.hedef, damga, &o.key).unwrap().yol
    }

    #[test]
    fn migrate_baska_bir_nedenle_patlarsa_eski_dosyalar_geri_konur() {
        use crate::store::schema::{okunan_surum, MigrateHatasi};

        let o = kur("parola123");
        let yedek = eksi_ucretli_v3_yedegi(&o, "2026-09-07");

        // ON KOSUL: yedek surum kapisindan GECER (3 <= CURRENT_VERSION), yani
        // bu test birinci katmani degil IKINCI katmani (geri alinabilir
        // yerlestirme) olcer.
        {
            let c = open_encrypted(&yedek, &o.key).unwrap();
            assert_eq!(okunan_surum(&c).unwrap(), 3, "on kosul: surum kapisindan gecmeli");
        }

        let (db_once, ks_once) = canliyi_farklilastir_ve_oku(&o);

        let hata = geri_yukle(&yedek, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(
            matches!(
                hata,
                YedekHatasi::YedekHazirlanamadi(MigrateHatasi::UcretKisitiIhlali { adet: 1 })
            ),
            "gelen: {hata:?}"
        );
        assert!(
            hata.to_string().contains("kaybolmadı"),
            "mesaj veri kaybi olmadigini soylemeli: {hata}"
        );

        canli_cift_bozulmadi(&o, &db_once, &ks_once);
    }

    // --- WAL yan dosyalari: cokme sonrasi islenmemis kayitlar -----------
    //
    // Bu uc testin ortak on kosulu su: `veri.db-wal` ICINDE ana dosyaya
    // HENUZ ISLENMEMIS, commit edilmis bir kayit var. Bu olmadan WAL'i
    // silmekle kenara almak arasinda hicbir gozlemlenebilir fark yoktur ve
    // "WAL korunuyor" iddiasi bos doner (inceleme IMPORTANT-3: WAL kenara
    // almayi eski silme davranisina ceviren mutasyon 36/36 YESIL kalmisti).

    /// Uygulamanin **cokerek** kapandigi durumu taklit eder: `veri.db`'nin
    /// yaninda, icerigi ana dosyaya henuz islenmemis canli bir `-wal` birakir.
    ///
    /// SQLite son baglanti kapanirken checkpoint yapip WAL'i siler; bu yuzden
    /// cift baglanti ACIKKEN kopyalanip kapanistan SONRA geri konuyor.
    /// Sonuc: ana dosyada 'Ayse', WAL'da o gunun kaydi.
    fn canli_wal_birak(o: &Ortam) {
        let wal = o.db.with_extension("db-wal");
        let (db_kopya, wal_kopya) = {
            let c = open_encrypted(&o.db, &o.key).unwrap();
            c.execute("UPDATE t SET ad = ?1", [BUGUNUN_NOTU]).unwrap();
            (std::fs::read(&o.db).unwrap(), std::fs::read(&wal).unwrap())
        };
        std::fs::write(&o.db, &db_kopya).unwrap();
        std::fs::write(&wal, &wal_kopya).unwrap();
        // `-shm` yalnizca bir paylasim indeksidir; SQLite onu WAL'dan
        // yeniden kurar. Kalintisi tutarsizlik uretmesin diye siliniyor.
        let _ = std::fs::remove_file(o.db.with_extension("db-shm"));
    }

    /// `db` (ve verilirse `wal`) dosyalarini AYRI bir klasore kopyalayip
    /// oradan `t.ad` degerini okur.
    ///
    /// Asil dosyalar ACILMAZ: onlari acmak SQLite'in checkpoint yapip WAL'i
    /// silmesine yol acar, yani olcmek istedigimiz kurulumu olcerken bozardi.
    fn kopyadan_oku(hedef_dizin: &Path, db: &Path, wal: Option<&Path>, key: &DataKey) -> String {
        std::fs::create_dir_all(hedef_dizin).unwrap();
        let k_db = hedef_dizin.join("kontrol.db");
        std::fs::copy(db, &k_db).unwrap();
        if let Some(w) = wal {
            std::fs::copy(w, k_db.with_extension("db-wal")).unwrap();
        }
        let c = open_encrypted(&k_db, key).unwrap();
        c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap()
    }

    /// ON KOSUL kaniti: WAL gercekten YUK TASIYOR.
    ///
    /// Cift birlikte o gunun kaydini veriyor, WAL'siz ana dosya VERMIYOR. Bu
    /// iddia olmadan "WAL korundu" testleri, WAL bos olsa da yesil kalirdi.
    fn wal_yuk_tasiyor(o: &Ortam, etiket: &str) {
        let wal = o.db.with_extension("db-wal");
        assert!(wal.exists(), "{etiket}: on kosul: canli bir WAL olmali");
        assert_eq!(
            kopyadan_oku(&o.kok.join(format!("k-{etiket}-cift")), &o.db, Some(&wal), &o.key),
            BUGUNUN_NOTU,
            "{etiket}: on kosul: cift birlikte o gunun kaydini vermeli"
        );
        assert_eq!(
            kopyadan_oku(&o.kok.join(format!("k-{etiket}-tek")), &o.db, None, &o.key),
            "Ayse",
            "{etiket}: on kosul: kayit ANA DOSYADA degil, WAL'da olmali -- \
             yoksa WAL'i silmenin hicbir etkisi olmaz ve test bos doner"
        );
    }

    #[test]
    fn migrate_patlarsa_islenmemis_wal_kaydi_da_geri_gelir() {
        // Senaryo: terapist uygulamayi cokerterek kapatmis; o gun girdigi
        // notlar `veri.db-wal`'da, henuz ana dosyaya islenmemis. Uyumsuz bir
        // yedegi geri yuklemeyi deniyor.
        let o = kur("parola123");
        let yedek = eksi_ucretli_v3_yedegi(&o, "2026-09-07");
        canli_wal_birak(&o);
        wal_yuk_tasiyor(&o, "goc");

        let wal = o.db.with_extension("db-wal");
        let wal_once = std::fs::read(&wal).unwrap();
        let db_once = std::fs::read(&o.db).unwrap();

        let hata = geri_yukle(&yedek, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::YedekHazirlanamadi(_)), "gelen: {hata:?}");

        assert_eq!(std::fs::read(&o.db).unwrap(), db_once, "ana dosya geri gelmeli");
        assert!(wal.exists(), "WAL yan dosyasi geri konmali -- silinmemeli");
        assert_eq!(std::fs::read(&wal).unwrap(), wal_once, "WAL icerigi degismemeli");
        assert_eq!(
            kopyadan_oku(&o.kok.join("k-goc-sonra"), &o.db, Some(&wal), &o.key),
            BUGUNUN_NOTU,
            "islenmemis WAL kaydi geri yuklemenin reddinden sonra da okunabilmeli"
        );
    }

    #[test]
    fn kenara_alma_patlarsa_canli_wal_silinmez() {
        // INCELEME CRITICAL-1'in senaryosu. Yarida kalmis bir geri yuklemeden
        // artakalan (ya da bir esitleme aracinin urettigi) bir
        // `veri.db.onceki` girdisi yuzunden ILK kenara alma adimi patlar.
        // O noktada hicbir dosya tasinmamistir; geri alma CANLI yan dosyalara
        // DOKUNMAMALIDIR.
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();
        canli_wal_birak(&o);
        wal_yuk_tasiyor(&o, "kenara");

        // Kenara almayi durduracak bir engel: hedef adda ZATEN bir sey var
        // (burada bir KLASOR; uretimde yarim kalmis bir geri almadan artan
        // `.onceki` dosyasi ya da bir esitleme aracinin urettigi kalinti).
        // M1'den once bu bir `rename` hatasiydi; artik `kenara_al`'in
        // acik kapisi devreye giriyor (bkz. `OncekiDosyaDuruyor`).
        std::fs::create_dir_all(o.db.with_extension("db.onceki")).unwrap();

        let wal = o.db.with_extension("db-wal");
        let wal_once = std::fs::read(&wal).unwrap();
        let db_once = std::fs::read(&o.db).unwrap();

        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        // Hicbir sey tasinmadi; cumle akibeti soylemek zorunda (I2 + M1).
        assert!(matches!(hata, YedekHatasi::OncekiDosyaDuruyor), "gelen: {hata:?}");
        assert!(
            hata.to_string().contains("değiştirilmedi"),
            "mesaj hicbir seyin degismedigini soylemeli: {hata}"
        );

        assert_eq!(std::fs::read(&o.db).unwrap(), db_once, "canli veritabani degismemeli");
        assert!(wal.exists(), "CANLI WAL SILINMEMELI -- o gunun notlari orada");
        assert_eq!(std::fs::read(&wal).unwrap(), wal_once, "canli WAL icerigi degismemeli");
        assert_eq!(
            kopyadan_oku(&o.kok.join("k-kenara-sonra"), &o.db, Some(&wal), &o.key),
            BUGUNUN_NOTU,
            "hicbir sey tasinmadan basarisiz olan geri yukleme, o gunun \
             kaydini yok etmemeli"
        );
    }

    /// `.onceki` GUVENLIK AGI ikinci bir geri yuklemede EZILMEMELI
    /// (dal incelemesi M1).
    ///
    /// Senaryo: bir geri yukleme yarida kaldi, geri alma da yarim kaldi ve
    /// kullaniciya "verileriniz `.onceki` uzantili dosyalarda" dendi. O
    /// dosya artik kullanicinin TEK kopyasidir. Ikinci bir geri yukleme
    /// denemesi `fs::rename(veri.db, veri.db.onceki)` cagiriyor; POSIX'te
    /// (hedef platform macOS) rename var olan hedefi SESSIZCE uzerine yazar
    /// ve o tek kopya yok olur.
    ///
    /// # ORTAMA BAGLILIK (3. bicim) -- hangi iddia hangi platformda yuk tasiyor
    ///
    /// Bu gelistirme makinesi Windows ve orada `rename` hedef varsa ZATEN
    /// basarisiz olur; yani "icerik degismedi" iddiasi burada korumayi
    /// kaldiran bir mutasyonda bile YESIL kalir. Mutasyonu bu makinede
    /// yakalayan sey VARYANT iddiasidir (`OncekiDosyaDuruyor` yerine bir
    /// `Io` gelir). Hedef platformda (macOS) yuku tasiyan ise "icerik
    /// degismedi" iddiasidir. Ikisi birlikte yazildi; biri silinirse test
    /// bir platformda korumayi birakir.
    #[test]
    fn ikinci_geri_yukleme_onceki_dosyadaki_tek_kopyayi_ezmez() {
        const TEK_KOPYA: &[u8] = b"kullanicinin TEK kopyasi -- yarim geri almadan kaldi";

        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        // Yarim kalmis bir geri almadan artan durum: `.onceki` kullanicinin
        // verisini tasiyor ve `veri.db` (yok edilemedigi icin) hala yerinde.
        let onceki = o.db.with_extension("db.onceki");
        std::fs::write(&onceki, TEK_KOPYA).unwrap();

        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::OncekiDosyaDuruyor), "gelen: {hata:?}");

        assert_eq!(
            std::fs::read(&onceki).unwrap(),
            TEK_KOPYA,
            "`.onceki` kullanicinin TEK kopyasi olabilir; uzerine YAZILMAMALI"
        );

        let mesaj = hata.to_string();
        assert!(
            mesaj.contains(".onceki"),
            "mesaj hangi dosyaya bakilacagini soylemeli: {mesaj}"
        );
        assert!(
            mesaj.contains("YENİDEN KURMAYIN"),
            "modul basligindaki tuzak burada da yasaklanmali: {mesaj}"
        );
        assert!(
            mesaj.contains("değiştirilmedi"),
            "islem hic baslamadi; cumle bunu soylemeli: {mesaj}"
        );
        // Mesaj yol/dosya adi tasimamali (hassas veri: ev dizini).
        assert!(!mesaj.contains(&o.kok.display().to_string()), "mesaj yol tasimamali: {mesaj}");
    }

    /// EKSI YON: kapi HER `.onceki` gorunce degil, yalnizca gercekten
    /// UZERINE YAZILACAKKEN kapanmali. Canli dosya yoksa (bos bir kuruluma
    /// geri yukleme) kenara alinacak bir sey de yoktur; oksuz `.onceki`'ye
    /// DOKUNULMAZ ve geri yukleme calisir.
    ///
    /// Bu iddia olmadan "her seyi reddeden" bir uygulama da usttekiyle ayni
    /// testi gecerdi (7. bicim).
    #[test]
    fn oksuz_onceki_canli_dosya_yokken_geri_yuklemeyi_engellemez() {
        const OKSUZ: &[u8] = b"oksuz kalinti";

        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        // Bos kurulum: canli cift yok, ama bir `.onceki` kalintisi var.
        let yeni_db = o.kok.join("yeni/veri.db");
        let yeni_ks = o.kok.join("yeni/keystore.json");
        std::fs::create_dir_all(o.kok.join("yeni")).unwrap();
        let oksuz = yeni_db.with_extension("db.onceki");
        std::fs::write(&oksuz, OKSUZ).unwrap();

        geri_yukle(&bilgi.yol, &yeni_db, &yeni_ks, &o.key).unwrap();

        assert!(yeni_db.exists() && yeni_ks.exists(), "geri yukleme tamamlanmali");
        assert_eq!(
            std::fs::read(&oksuz).unwrap(),
            OKSUZ,
            "oksuz `.onceki` ne silinmeli ne de degistirilmeli"
        );
    }

    // --- `.onceki` kalintisi ve ondan CIKIS YOLU (inceleme IMPORTANT-A) --

    /// Kalintinin **ureyebildigini** kanitlar: `tamamla()` silemeyebilir.
    ///
    /// Bu on kosul olmadan asagidaki senaryo "uretimde ulasilamayan bir
    /// durumu test etmek" olurdu (11. bicim). Uretimdeki gercek sebepler
    /// salt okunur birim, `uchg` bayragi, izin/ACL ya da dosyayi tutan bir
    /// esitleme istemcisi; burada tasinabilir bir taklit (klasor)
    /// kullaniliyor -- `remove_file` bir klasoru iki isletim sisteminde de
    /// silemez.
    #[test]
    fn tamamla_silemedigi_kalintiyi_birakir() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("veri.db");
        let onceki = d.path().join("veri.db.onceki");
        std::fs::create_dir_all(&onceki).unwrap();

        let izle = Yerlestirme {
            kenara_alinanlar: vec![(db.clone(), onceki.clone())],
            yerlestirilenler: Vec::new(),
        };
        izle.tamamla();

        assert!(
            onceki.exists(),
            "temizlik basarisiz olabilir -- `.onceki` kalintisi URETILEBILIR bir durum"
        );
    }

    /// (a) + (b) + (c) tek hikaye: basarili bir geri yuklemenin ardindan
    /// temizlik patlarsa sonraki gecerli geri yukleme KILITLENIR, ve
    /// uygulama icindeki eylem o kilidi **hicbir sey silmeden** acar.
    ///
    /// Kilit gercek bir risk: kapi `.onceki`'nin NEREDEN geldigine bakmaz
    /// ve bakamaz. M1'den once "silinemezse sorun degil, yalnizca yer
    /// kaplar" deniyordu; artik yer degil, GERI YUKLEME kaybediliyordu.
    #[test]
    fn kalinti_sonraki_geri_yuklemeyi_kilitler_ve_eylem_kilidi_acar() {
        const TEK_KOPYA: &[u8] = b"kullanicinin eski verisi -- temizlik silemedi";
        const DAMGA: &str = "20260923-1430";

        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        // 1) BASARILI geri yukleme. `tamamla()` kenara alinani siler.
        geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap();
        let onceki = o.db.with_extension("db.onceki");
        assert!(!onceki.exists(), "on kosul: basarili geri yukleme kalinti birakmamali");

        // 2) Temizligin PATLADIGI son durum (yukaridaki
        //    `tamamla_silemedigi_kalintiyi_birakir` bunun uretilebilir
        //    oldugunu kanitliyor): kalinti diskte duruyor.
        std::fs::write(&onceki, TEK_KOPYA).unwrap();

        // 3) (a) Sonraki GECERLI geri yukleme artik kilitli.
        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::OncekiDosyaDuruyor), "gelen: {hata:?}");
        assert!(
            hata.to_string().contains("kenara kaldır"),
            "mesaj cikis yolunu ADIYLA soylemeli: {hata}"
        );

        // 4) Uygulama icindeki eylem.
        let c = open_encrypted(&o.db, &o.key).unwrap();
        let tasinan = onceki_dosyalari_kenara_kaldir(
            &c,
            &o.db,
            &o.keystore_yolu,
            DAMGA,
            crate::store::audit::Cihaz::Masaustu,
        )
        .unwrap();
        drop(c);
        assert_eq!(tasinan, 1);

        // 5) (c) SILINMEDI: icerik damgali adda birebir duruyor.
        let yeni = o.db.with_extension(format!("db.onceki-{DAMGA}"));
        assert_eq!(
            std::fs::read(&yeni).unwrap(),
            TEK_KOPYA,
            "tasinan dosya kullanicinin tek kopyasi olabilir; icerigi degismemeli"
        );
        assert!(!onceki.exists(), "eski ad bosalmali ki kapi acilsin");

        // 6) (b) AYNI geri yukleme artik basarili.
        geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap();
        assert_eq!(
            std::fs::read(&yeni).unwrap(),
            TEK_KOPYA,
            "yeni geri yukleme, kenara kaldirilmis kopyaya DOKUNMAMALI"
        );
    }

    /// (c) Eylem **hicbir dosyayi silmez** -- dort kalinti da, yan
    /// dosyalariyla birlikte, icerigi bozulmadan yeni adlarina tasinir.
    ///
    /// Adlandirma SQLite yan dosya kuralina uyar (damga TABAN ada eklenir)
    /// ki tasinan cift gerekirse oldugu yerde acilabilsin.
    #[test]
    fn kenara_kaldirma_hicbir_dosyayi_silmez() {
        const DAMGA: &str = "20260923-1430";
        let o = kur("parola123");

        let kalintilar = [
            (o.db.with_extension("db.onceki"), b"DB-KOPYASI".to_vec()),
            (o.db.with_extension("db.onceki-wal"), b"WAL-KOPYASI".to_vec()),
            (o.db.with_extension("db.onceki-shm"), b"SHM-KOPYASI".to_vec()),
            (o.keystore_yolu.with_extension("json.onceki"), b"ANAHTAR-KOPYASI".to_vec()),
        ];
        for (yol, icerik) in &kalintilar {
            std::fs::write(yol, icerik).unwrap();
        }
        let once_adet = std::fs::read_dir(&o.kok).unwrap().count();

        let c = open_encrypted(&o.db, &o.key).unwrap();
        let tasinan = onceki_dosyalari_kenara_kaldir(
            &c,
            &o.db,
            &o.keystore_yolu,
            DAMGA,
            crate::store::audit::Cihaz::Masaustu,
        )
        .unwrap();
        drop(c);
        assert_eq!(tasinan, 4);

        let yeni_adlar = [
            (o.db.with_extension(format!("db.onceki-{DAMGA}")), &kalintilar[0].1),
            (o.db.with_extension(format!("db.onceki-{DAMGA}-wal")), &kalintilar[1].1),
            (o.db.with_extension(format!("db.onceki-{DAMGA}-shm")), &kalintilar[2].1),
            (o.keystore_yolu.with_extension(format!("json.onceki-{DAMGA}")), &kalintilar[3].1),
        ];
        for (yol, beklenen) in &yeni_adlar {
            assert_eq!(&std::fs::read(yol).unwrap(), *beklenen, "{yol:?} icerigi degismemeli");
        }
        for (eski, _) in &kalintilar {
            assert!(!eski.exists(), "{eski:?} eski adiyla kalmamali");
        }
        // SAYI: bir dosya bile EKSILMEDI. "Sil" mutasyonunu yakalayan asil
        // iddia bu -- icerik iddialari yalnizca tasinanlara bakar.
        assert_eq!(
            std::fs::read_dir(&o.kok).unwrap().count(),
            once_adet,
            "eylem HICBIR dosyayi silmemeli; yalnizca yeniden adlandirir"
        );
    }

    /// (d) Denetim kaydi: **tek** satir, dogru hacim, hassas veri yok --
    /// ve etkisiz cagri hic satir yazmaz.
    #[test]
    fn kenara_kaldirma_tek_satir_yazar_ve_hassas_veri_tasimaz() {
        use crate::store::audit::{son_kayitlar, Cihaz};
        const DAMGA: &str = "20260923-1430";

        let o = kur("parola123");
        let c = open_encrypted(&o.db, &o.key).unwrap();
        let sayi = |c: &Connection| -> i64 {
            c.query_row("SELECT count(*) FROM audit_log", [], |r| r.get(0)).unwrap()
        };

        // ETKISIZ ISLEM LOGLANMAZ: tasinacak dosya yok -> tek satir bile yok.
        let once = sayi(&c);
        assert_eq!(
            onceki_dosyalari_kenara_kaldir(&c, &o.db, &o.keystore_yolu, DAMGA, Cihaz::Masaustu)
                .unwrap(),
            0
        );
        assert_eq!(sayi(&c), once, "etkisiz cagri silinemez bir satir birakmamali");

        // Iki dosya tasiniyor ama TEK satir yazilmali: ortada TEK bir
        // kullanici eylemi var (`audit` modul basligindaki cascade karari).
        std::fs::write(o.db.with_extension("db.onceki"), b"GIZLI-VERI").unwrap();
        std::fs::write(o.keystore_yolu.with_extension("json.onceki"), b"GIZLI-ANAHTAR").unwrap();
        assert_eq!(
            onceki_dosyalari_kenara_kaldir(&c, &o.db, &o.keystore_yolu, DAMGA, Cihaz::Masaustu)
                .unwrap(),
            2
        );
        assert_eq!(sayi(&c), once + 1, "iki dosya tasindi ama TEK satir yazilmali");

        let kayit = son_kayitlar(&c, 1).unwrap().remove(0);
        assert_eq!(kayit.eylem, "duzenleme");
        assert_eq!(kayit.varlik, VARLIK, "yeni bir `varlik` turu ACILMADI");
        assert_eq!(kayit.varlik_id, DAMGA);
        let tumu =
            format!("{}|{}|{}|{:?}", kayit.eylem, kayit.varlik, kayit.varlik_id, kayit.ayrinti);
        assert!(!tumu.contains(&o.kok.display().to_string()), "veri dizini yolu loga girdi: {tumu}");
        for gizli in ["veri.db", "keystore", "onceki", "GIZLI"] {
            assert!(!tumu.contains(gizli), "dosya adi/icerik loga girdi ({gizli}): {tumu}");
        }
    }

    /// Damga bir **dosya adina** giriyor: dogrulanmazsa yeniden adlandirma
    /// veri dizininin DISINA cikabilirdi.
    #[test]
    fn gecersiz_damga_reddedilir_ve_hicbir_dosya_oynatilmaz() {
        use crate::store::audit::Cihaz;
        let o = kur("parola123");
        let onceki = o.db.with_extension("db.onceki");
        std::fs::write(&onceki, b"KALINTI").unwrap();
        let c = open_encrypted(&o.db, &o.key).unwrap();

        for kotu in ["../../kacis", "2026-09-23", "20260923-143", "20260923_1430", "", "/mutlak"] {
            let hata =
                onceki_dosyalari_kenara_kaldir(&c, &o.db, &o.keystore_yolu, kotu, Cihaz::Masaustu)
                    .unwrap_err();
            assert!(matches!(hata, YedekHatasi::GecersizDamga), "`{kotu}` gecmemeliydi: {hata:?}");
            // Mesaj gelen dizgiyi YANSITMAMALI (girdi yansitma sinifi).
            assert!(!hata.to_string().contains(kotu) || kotu.is_empty(), "{hata}");
        }
        assert_eq!(std::fs::read(&onceki).unwrap(), b"KALINTI", "hicbir dosya oynatilmamali");

        // ARTI YON: gecerli bir damga GECMELI -- yoksa "her seyi reddeden"
        // bir dogrulayici da yukaridaki dongunun hepsini gecerdi (7. bicim).
        assert_eq!(
            onceki_dosyalari_kenara_kaldir(
                &c,
                &o.db,
                &o.keystore_yolu,
                "20260923-1430",
                Cihaz::Masaustu
            )
            .unwrap(),
            1
        );
    }

    /// Ayni damgayla ikinci kez calistirmak, ilk taşımanın sonucunu
    /// EZMEMELI (cift tik / iki kez tiklama).
    #[test]
    fn ayni_damgayla_ikinci_calistirma_ilk_kopyayi_ezmez() {
        use crate::store::audit::Cihaz;
        const DAMGA: &str = "20260923-1430";
        let o = kur("parola123");
        let c = open_encrypted(&o.db, &o.key).unwrap();

        std::fs::write(o.db.with_extension("db.onceki"), b"BIRINCI").unwrap();
        onceki_dosyalari_kenara_kaldir(&c, &o.db, &o.keystore_yolu, DAMGA, Cihaz::Masaustu)
            .unwrap();
        // Ayni dakika icinde yeni bir kalinti olustu.
        std::fs::write(o.db.with_extension("db.onceki"), b"IKINCI").unwrap();

        let hata =
            onceki_dosyalari_kenara_kaldir(&c, &o.db, &o.keystore_yolu, DAMGA, Cihaz::Masaustu)
                .unwrap_err();
        assert!(matches!(hata, YedekHatasi::TemizlikBasarisiz(_)), "gelen: {hata:?}");
        assert!(hata.to_string().contains("SİLİNMEDİ"), "{hata}");
        assert_eq!(
            std::fs::read(o.db.with_extension(format!("db.onceki-{DAMGA}"))).unwrap(),
            b"BIRINCI",
            "ilk tasinan kopya EZILMEMELI"
        );
        assert_eq!(
            std::fs::read(o.db.with_extension("db.onceki")).unwrap(),
            b"IKINCI",
            "ikinci kalinti da yerinde durmali"
        );
    }

    /// Kullaniciya gosterilen iki mesaj, tek kopyasini SILMEYE yol
    /// acmamali (inceleme IMPORTANT-B).
    ///
    /// Eski hallerinde hicbiri "SILMEYIN" demiyordu; verilen emir "veri
    /// klasorunun DISINA tasiyin" idi ve macOS'ta Cop Kutusu'na suruklemek
    /// o emri harfiyen yerine getirir.
    #[test]
    fn onceki_dosya_mesajlari_silmeyi_yasaklar_ve_birlikte_tutmayi_soyler() {
        let mesajlar = [
            YedekHatasi::OncekiDosyaDuruyor.to_string(),
            YedekHatasi::GeriAlmaYarimKaldi(Box::new(YedekHatasi::BozukYedek)).to_string(),
        ];
        for mesaj in &mesajlar {
            assert!(mesaj.contains("SİLMEYİN"), "mesaj silmeyi acikca yasaklamali: {mesaj}");
            assert!(
                mesaj.contains("BİRLİKTE"),
                "cift ayrilirsa kayit dosyasi bir daha acilamaz; mesaj bunu soylemeli: {mesaj}"
            );
            assert!(
                mesaj.contains("anahtar dosyası"),
                "neden birlikte tutulacagi yazmali: {mesaj}"
            );
            assert!(mesaj.contains("YENİDEN KURMAYIN"), "{mesaj}");
            // Kullaniciya artik "klasore in" DENMIYOR: uygulama icindeki
            // eylem o ihtiyaci kaldirdi (inceleme IMPORTANT-A/B).
            assert!(
                mesaj.contains("kenara kaldır"),
                "mesaj uygulama icindeki cikis yolunu ADIYLA soylemeli: {mesaj}"
            );
            assert!(
                !mesaj.contains("dışına taşıyın"),
                "klasore inme emri kaldirilmaliydi: {mesaj}"
            );
        }
    }

    // --- Geri almanin KENDISI: tam mi, yarim mi -------------------------

    #[test]
    fn geri_alma_yarim_kalirsa_bunu_bildirir() {
        // `geri_al`'in sozlesmesi: `true` = kenara alinan HER SEY yerine
        // kondu. Cagiran bu degere gore kullaniciya gosterilecek cumleyi
        // seciyor; `()` donduren eski bicimde "hicbir veriniz kaybolmadi"
        // vaadi KANITSIZDI (inceleme IMPORTANT-2).
        let d = tempfile::tempdir().unwrap();

        // (1) Her sey yerine konabiliyor -> true.
        let tam_dizin = d.path().join("tam");
        std::fs::create_dir_all(&tam_dizin).unwrap();
        let db = tam_dizin.join("veri.db");
        let onceki = tam_dizin.join("veri.db.onceki");
        std::fs::write(&db, b"yerlestirilen yeni dosya").unwrap();
        std::fs::write(&onceki, b"kullanicinin eski verisi").unwrap();
        let tam = Yerlestirme {
            kenara_alinanlar: vec![(db.clone(), onceki.clone())],
            yerlestirilenler: vec![db.clone()],
        };
        assert!(tam.geri_al(&db), "her sey yerine konabildiginde true donmeli");
        assert_eq!(std::fs::read(&db).unwrap(), b"kullanicinin eski verisi");

        // (2) Hedef baska bir sey tarafindan tutuluyor (burada: bir KLASOR;
        //     uretimde bir bulut esitleme istemcisi ya da virus tarayici).
        //     Ne silinebilir ne de uzerine rename edilebilir -> false.
        let yarim_dizin = d.path().join("yarim");
        std::fs::create_dir_all(&yarim_dizin).unwrap();
        let tutulan = yarim_dizin.join("keystore.json");
        std::fs::create_dir_all(&tutulan).unwrap();
        let tutulan_onceki = yarim_dizin.join("keystore.json.onceki");
        std::fs::write(&tutulan_onceki, b"kullanicinin anahtar dosyasi").unwrap();
        let yarim = Yerlestirme {
            kenara_alinanlar: vec![(tutulan.clone(), tutulan_onceki.clone())],
            yerlestirilenler: vec![tutulan.clone()],
        };
        assert!(
            !yarim.geri_al(&yarim_dizin.join("veri.db")),
            "yerine konamayan bir dosya varsa false donmeli"
        );
        assert!(
            tutulan_onceki.exists(),
            "geri konamayan dosya DISKTE durmali -- kullanicinin verisi orada"
        );
    }

    #[test]
    fn yarim_geri_alma_kullaniciya_yeniden_kurdurmamali() {
        // `yerlestirme_hatasi`'nin tek isi: geri alma yarim kaldiysa
        // gosterilecek cumleyi degistirmek. "Hicbir veriniz kaybolmadi" diyen
        // bir mesaj, eslesmeyen bir cift kalmisken kullaniciyi yeniden
        // kuruluma -- yani modul basligindaki tuzaga -- iter.
        let asil = YedekHatasi::YedekHazirlanamadi(
            crate::store::schema::MigrateHatasi::UcretKisitiIhlali { adet: 1 },
        );
        let eksiksiz = yerlestirme_hatasi(asil, true);
        assert!(matches!(eksiksiz, YedekHatasi::YedekHazirlanamadi(_)));
        assert!(eksiksiz.to_string().contains("kaybolmadı"));

        let asil2 = YedekHatasi::YedekHazirlanamadi(
            crate::store::schema::MigrateHatasi::UcretKisitiIhlali { adet: 1 },
        );
        let yarim = yerlestirme_hatasi(asil2, false);
        assert!(matches!(yarim, YedekHatasi::GeriAlmaYarimKaldi(_)), "gelen: {yarim:?}");
        let mesaj = yarim.to_string();
        assert!(
            !mesaj.contains("kaybolmadı"),
            "yarim geri almada 'hicbir veriniz kaybolmadi' DENMEMELI: {mesaj}"
        );
        assert!(
            mesaj.contains("YENİDEN KURMAYIN"),
            "mesaj en yikici hamleyi acikca yasaklamali: {mesaj}"
        );
        assert!(mesaj.contains(".onceki"), "mesaj verinin nerede oldugunu soylemeli: {mesaj}");
        // Asil hata kaybolmamali: teshis `#[source]` zincirinde.
        use std::error::Error;
        assert!(yarim.source().is_some(), "asil hata kaynak olarak tasinmali");
    }

    /// **ARTI YON** (dal incelemesi I2): yukaridaki test yalnizca "yarim
    /// geri almada akibet vaadi VERILMEMELI" diyordu; "eksiksiz geri almada
    /// akibet SOYLENMELI" yonu bir dosya (IO) hatasi icin olculmuyordu ve
    /// gercekten de soylenmiyordu -- govde "dosya hatasi: ..." + 500'du.
    #[test]
    fn dosya_hatasi_eksiksiz_geri_almada_verinin_yerinde_oldugunu_soyler() {
        let io_hatasi = || {
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "/Users/terapist/Library/veri.db erisim reddedildi",
            )
        };

        let eksiksiz = yerlestirme_hatasi(YedekHatasi::Io(io_hatasi()), true);
        assert!(matches!(eksiksiz, YedekHatasi::YerlestirmeBasarisiz(_)), "gelen: {eksiksiz:?}");
        let mesaj = eksiksiz.to_string();
        assert!(
            mesaj.contains("kaybolmadı") && mesaj.contains("YERİNDE"),
            "eksiksiz geri almada mesaj verinin yerinde oldugunu SOYLEMELI: {mesaj}"
        );
        assert!(
            mesaj.contains("YENİDEN KURMAYIN"),
            "modulun var olus gerekcesi olan tuzak burada da yasaklanmali: {mesaj}"
        );
        // Hassas veri sizmasin: isletim sistemi metni `#[source]`'ta kalir.
        assert!(
            !mesaj.contains("terapist") && !mesaj.contains("veri.db"),
            "mesaj yol/dosya adi tasimamali: {mesaj}"
        );
        use std::error::Error;
        assert!(eksiksiz.source().is_some(), "teshis icin asil IO hatasi kaynakta durmali");

        // EKSI YON: ayni hata, geri alma YARIM kaldiysa akibet vaadi
        // verilmemeli -- iki yol birbirine karismamali.
        let yarim = yerlestirme_hatasi(YedekHatasi::Io(io_hatasi()), false);
        assert!(matches!(yarim, YedekHatasi::GeriAlmaYarimKaldi(_)), "gelen: {yarim:?}");
        assert!(
            !yarim.to_string().contains("kaybolmadı"),
            "yarim geri almada akibet vaadi verilmemeli: {yarim}"
        );
    }

    /// Davranissal es: gecici kopyalama adimi patladiginda (disk dolu, izin
    /// hatasi, dosyayi tutan bir program) kullanici hem verisinin yerinde
    /// oldugunu okur hem de canli cift gercekten bozulmamistir.
    ///
    /// Engel olarak ayni adda bir KLASOR kullaniliyor: `kenara_alma_patlarsa_
    /// canli_wal_silinmez` ile ayni teknik -- uretimdeki gercek sebep (bulut
    /// esitleme istemcisi, virus tarayici, dolu disk) her iki isletim
    /// sisteminde de ayni hata sinifini uretir, klasor ise tasinabilir bir
    /// taklittir.
    #[test]
    fn gecici_kopya_patlarsa_canli_cift_durur_ve_akibet_soylenir() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();
        let (db_once, ks_once) = canliyi_farklilastir_ve_oku(&o);

        // `geri_yukle` gecici kopyayi buraya yazmak istiyor.
        let engel = o.db.with_extension("restore");
        std::fs::create_dir_all(&engel).unwrap();

        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::YerlestirmeBasarisiz(_)), "gelen: {hata:?}");
        let mesaj = hata.to_string();
        assert!(
            mesaj.contains("kaybolmadı") && mesaj.contains("YERİNDE"),
            "kullanici verisinin akibetini okuyabilmeli: {mesaj}"
        );

        assert_eq!(std::fs::read(&o.db).unwrap(), db_once, "canli veritabani degismemeli");
        assert_eq!(
            std::fs::read(&o.keystore_yolu).unwrap(),
            ks_once,
            "canli anahtar dosyasi degismemeli"
        );
        let c = open_encrypted(&o.db, &o.key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, BUGUNUN_NOTU, "o gun girilen kayit okunabilir kalmali");
    }

    /// V4 semali, DOLU bir veritabani kurar (danisan + randevu + resmi not +
    /// ozel not + ek) ve yolunu doner.
    ///
    /// Once `migrate` ile V5'e cikilip sonra V5'in urettigi nesneler
    /// dusuruluyor ve damga 4'e cekiliyor. Gerekce: V1-V4 betikleri
    /// `schema.rs`'te ozeldir; onlari buraya kopyalamak, goc metinlerinin iki
    /// yerde yasamasi ve sessizce ayrismasi demek olurdu. Sonuc durum
    /// gercekten V4'tur: V4'un tum tablolari var, V5'in hicbiri yok.
    fn v4_dolu_veritabani(dir: &Path, key: &DataKey) -> PathBuf {
        let yol = dir.join("v4-veri.db");
        {
            let c = open_encrypted(&yol, key).unwrap();
            migrate(&c).unwrap();
            c.execute_batch(
                "INSERT INTO clients (ad_soyad, telefon, durum, olusturma_zamani)
                 VALUES ('Ayse Yilmaz', '05001112233', 'aktif', '2026-09-01 09:00');

                 INSERT INTO appointments
                     (client_id, baslangic, bitis, durum, ucret, odendi,
                      olusturma_zamani, guncelleme_zamani)
                 VALUES (1, '2026-09-05 10:00', '2026-09-05 10:50', 'geldi', 75000, 1,
                         '2026-09-01 09:05', '2026-09-05 11:00');

                 INSERT INTO progress_notes
                     (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
                 VALUES (1, 1, 'dap', 'Resmi not govdesi', '2026-09-05 11:05');

                 INSERT INTO private_notes
                     (appointment_id, client_id, icerik, guncelleme_zamani)
                 VALUES (1, 1, 'Ozel not govdesi', '2026-09-05 11:06');

                 INSERT INTO attachments
                     (client_id, dosya_adi, mime, tur, boyut, icerik, eklenme_zamani)
                 VALUES (1, 'onam.pdf', 'application/pdf', 'onam', 5,
                         x'0102030405', '2026-09-01 09:10');",
            )
            .unwrap();

            // V5'i GERI AL: damga 4, V5 nesneleri yok.
            c.execute_batch(
                "DROP TRIGGER progress_note_tags_temizle_kullanilmayan;
                 DROP TABLE progress_note_tags;
                 DROP TABLE tags;
                 UPDATE app_meta SET deger='4' WHERE anahtar='schema_version';",
            )
            .unwrap();
        }
        for ek in ["db-wal", "db-shm"] {
            let _ = std::fs::remove_file(yol.with_extension(ek));
        }
        yol
    }

    #[test]
    fn geri_yukleme_eski_semali_yedegi_gocten_gecirir() {
        use crate::store::schema::{okunan_surum, CURRENT_VERSION};

        // BU TESTIN VARLIK SEBEBI: "geri yukleme gocten gecer" degismezinin
        // hicbir testi yoktu. Goc cagrisi silinse eski semali bir yedek
        // sessizce yerine konur, uygulama V5 tablolarini (etiketler) arar ve
        // kullanici bunu kendi hatasi sanardi.
        let o = kur("parola123");
        let v4 = v4_dolu_veritabani(&o.kok, &o.key);
        let bilgi = yedek_al(&v4, &o.keystore_yolu, &o.hedef, "2026-09-08", &o.key).unwrap();

        // ON KOSUL: yedek gercekten V4 semali ve V5 tablolari YOK.
        {
            let c = open_encrypted(&bilgi.yol, &o.key).unwrap();
            assert_eq!(okunan_surum(&c).unwrap(), 4, "on kosul: yedek V4 semali olmali");
            let tags_var: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='tags'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(tags_var, 0, "on kosul: yedekte V5 tablolari olmamali");
        }

        geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap();

        let c = open_encrypted(&o.db, &o.key).unwrap();

        // 1) Goc KOSTU.
        assert_eq!(
            okunan_surum(&c).unwrap(),
            CURRENT_VERSION,
            "geri yuklenen veritabani guncel semaya yukseltilmis olmali"
        );
        for tablo in ["tags", "progress_note_tags"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [tablo],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "V5 tablosu '{tablo}' goc sonrasi olusmali");
        }

        // 2) Veri BIREBIR ayni: goc hicbir kaydi degistirmemeli.
        let (ad, tel): (String, String) = c
            .query_row("SELECT ad_soyad, telefon FROM clients WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((ad.as_str(), tel.as_str()), ("Ayse Yilmaz", "05001112233"));

        let (bas, durum, ucret): (String, String, i64) = c
            .query_row("SELECT baslangic, durum, ucret FROM appointments WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((bas.as_str(), durum.as_str(), ucret), ("2026-09-05 10:00", "geldi", 75000));

        let resmi: String =
            c.query_row("SELECT icerik FROM progress_notes WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(resmi, "Resmi not govdesi");

        let ozel: String =
            c.query_row("SELECT icerik FROM private_notes WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(ozel, "Ozel not govdesi");

        let (dosya_adi, icerik): (String, Vec<u8>) = c
            .query_row("SELECT dosya_adi, icerik FROM attachments WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(dosya_adi, "onam.pdf");
        assert_eq!(icerik, vec![1u8, 2, 3, 4, 5], "ek icerigi birebir korunmali");
    }
}
