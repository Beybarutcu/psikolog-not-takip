//! Yedek **alma** uç noktası ve yedek klasörü ayarı.
//!
//! # Neden HTTP, Tauri komutu değil (bağlama kararı)
//!
//! `core::backup`'ın dört `pub fn`'i yazılmış, test edilmiş ve **hiçbir
//! yerden çağrılmıyordu**. Bağlanacağı yer için üç seçenek vardı; HTTP
//! seçildi:
//!
//! 1. **Tauri komutu (IPC).** Bu uygulamada pencere
//!    `WebviewUrl::External("http://127.0.0.1:<port>")` ile açılıyor (bkz.
//!    `src-tauri/src/main.rs`), yani arayüz Tauri'nin kendi protokolüyle
//!    değil, **uzak bir kaynak** olarak yükleniyor; `window.__TAURI__` orada
//!    enjekte edilmez. IPC'yi açmak uzak kaynak için ayrıca yetkilendirme
//!    ve CSP genişletmesi isterdi -- oysa CSP (`lib.rs::CSP_POLITIKASI`)
//!    `tauri.conf.json` ile birebir aynı olmak zorunda ve bu ürünün
//!    değişmezlerinden biri. Yani "yedek almak için" güvenlik yüzeyi
//!    genişletilecekti.
//! 2. **HTTP rotası.** Ürünün bugün 26 veri handler'ı bu kapıdan geçiyor ve
//!    yapısal testler dosya kümesini `server/src/routes/` **dizininden**
//!    türetiyor: bu modül eklendiği anda -- listeye yazılmadan --
//!    `acik_baglanti` kapısı, çıplak `Query` yasağı, ikinci log satırı
//!    yasağı ve özel not ayrımı iddialarının kapsamına girdi. Bir Tauri
//!    komutu bu dört korumanın **hiçbirinin** kapsamına girmezdi.
//! 3. İkisi birden: 2'nin üstüne 1'in maliyeti, kazancı yalnızca yerel
//!    klasör seçici.
//!
//! # Hedef klasörü kullanıcı nasıl seçiyor
//!
//! Tarayıcıda dizin seçtiren bir API yok (`<input webkitdirectory>` dosya
//! listesi verir, klasör YOLU vermez) ve yukarıdaki gerekçeyle Tauri
//! tarafına geçilmedi. Bu yüzden klasör **yolu yazılarak/yapıştırılarak**
//! seçiliyor ve sunucu onu doğruluyor: yol var mı, dizin mi, gerçekten
//! yazılabilir mi (`ayarla_ve_dogrula`). Doğrulama tam da bu yüzden
//! zorunlu: elle yazılan bir yol sessizce yanlış olabilir ve "yedeğim var"
//! sanan bir kullanıcı, yedeği olmayan bir kullanıcıdan daha kötü
//! durumdadır.
//!
//! macOS'ta Finder'da klasöre sağ tıklayıp <kbd>⌥</kbd> basılıyken "…
//! Yol Adı Olarak Kopyala" tam olarak bu yolu verir; arayüz metni bunu
//! söylüyor. Yerel bir klasör seçici (Tauri `dialog` eklentisi + uzak
//! kaynak IPC'si) bilinçli olarak **ertelendi**; ertelemenin bedeli bir
//! yapıştırma işlemi, kazancı ise IPC yüzeyinin kapalı kalması.
//!
//! # Kilit
//!
//! Her handler'ın ilk satırı `guard::acik_baglanti`'dir. Yedek almak
//! danışan verisinin **tamamının** kopyasını üretir; kilitli oturumda
//! yapılamamalıdır. **Geri yükleme** ise bilerek başka bir modüldedir
//! (`routes::restore`) çünkü tam da oturumun açılamadığı durumda
//! çalışmak zorundadır -- gerekçe orada.
//!
//! # Denetim kaydı
//!
//! Bu modül `audit::kaydet` **çağırmaz**; hacim kararını çekirdek verdi
//! (`core::backup::yedek_al_ve_kaydet` -> `DisaAktarma` + `HerCagri`;
//! `core::backup::onceki_dosyalari_kenara_kaldir` -> `Duzenleme` + `HerCagri`,
//! etkisiz cagri hic satir yazmaz).

use crate::guard::{acik_baglanti, govde_coz, ApiHata};
use axum::extract::rejection::JsonRejection;
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::backup::{
    ayarlari_oku, ayarlari_yaz, onceki_dosyalari_kenara_kaldir, yedek_al_ve_kaydet, YedekAyarlari,
};
use psikolog_core::store::audit::Cihaz;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
pub struct YedekIstegi {
    /// Yedeğin tarih damgası — **istemcinin yerel takvim günü**
    /// (`YYYY-AA-GG`).
    ///
    /// Sunucu kendi saatinden türetmiyor; bu, kod tabanının duvar saati
    /// sözleşmesi (`GET /api/saklama-suresi-dolanlar?bugun=` ile aynı
    /// gerekçe): Istanbul UTC+3 iken 00:00–03:00 arasında UTC hâlâ dünkü
    /// tarihtedir ve sunucudan türetilen damga o üç saatte yedeği bir gün
    /// geriye yazar -- yani "bugün yedek alındı mı" sorusu yanlış
    /// yanıtlanır ve 7 günlük dönüşüm kayar.
    ///
    /// Biçim doğrulaması `core::backup::yedek_al`'da (`GecersizTarih`).
    pub damga: String,
    /// Verilirse **önce ayar olarak kaydedilir**, sonra yedek oraya alınır.
    ///
    /// Klasör seçmek ile ilk yedeği almak tek işlem: ayrı bir "ayarla" ucu
    /// olsaydı, klasörünü seçip yedeği almayan bir kullanıcı "yedeğim var"
    /// sanırdı. Verilmezse kayıtlı ayar kullanılır; o da yoksa `400`.
    pub hedef_dizin: Option<String>,
}

/// Kullanıcının yazdığı yolu doğrular ve ayar olarak kaydeder.
///
/// Üç kontrol de gerçek bir hata sınıfını kapatıyor:
/// - **var mı**: yazım hatası (`/Volumes/YEDEKK`) sessizce yeni bir klasör
///   yaratmamalı; `yedek_al` içindeki `create_dir_all` bunu yapardı ve
///   kullanıcı yedeklerini hiç bakmayacağı bir yere yazardı.
/// - **dizin mi**: dosya yolu verilirse `yedek_al` anlaşılmaz bir G/Ç
///   hatası döndürürdü.
/// - **yazılabilir mi**: salt okunur bağlanmış bir USB ya da izinsiz bir
///   klasör, ancak ilk yedek denemesinde ortaya çıkardı. Klasörü seçtiği
///   anda öğrenmek, felaket anında öğrenmekten iyidir.
fn dogrula(ham: &str) -> Result<PathBuf, ApiHata> {
    let yol = Path::new(ham.trim());
    if ham.trim().is_empty() {
        return Err(istek_hatasi("Yedek klasörünün yolunu yazın."));
    }
    if !yol.exists() {
        return Err(istek_hatasi(
            "Bu klasör bulunamadı. Harici disk takılı mı ve yolu doğru yazdınız mı?",
        ));
    }
    if !yol.is_dir() {
        return Err(istek_hatasi("Bu bir klasör değil; yedeklerin yazılacağı klasörü seçin."));
    }
    // Yazma denemesi: izin/salt okunur durumunu ANCAK gerçekten yazarak
    // anlayabiliriz. Deneme dosyası hemen siliniyor.
    let deneme = yol.join(".yedek-yazma-denemesi");
    match std::fs::write(&deneme, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&deneme);
            Ok(yol.to_path_buf())
        }
        Err(_) => Err(istek_hatasi(
            "Bu klasöre yazılamıyor. Salt okunur bir disk ya da izin verilmemiş bir klasör olabilir.",
        )),
    }
}

fn istek_hatasi(mesaj: &str) -> ApiHata {
    (StatusCode::BAD_REQUEST, Json(json!({ "hata": mesaj })))
}

/// Yedek alır (`POST /api/yedek`).
///
/// Yanıt **mutlak yol taşımaz**: yalnızca yedeğin dosya adı ve boyutu döner.
/// `core::backup::YedekBilgisi` bu yüzden artık `Serialize` türetmiyor --
/// onu olduğu gibi döndürmek kullanıcının ev dizinini tarayıcıya taşırdı
/// (bkz. o tipin belgesi).
pub async fn al(
    State(s): State<AppState>,
    istek: Result<Json<YedekIstegi>, JsonRejection>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let istek = govde_coz(istek)?;
    let hedef = match &istek.hedef_dizin {
        Some(ham) => {
            let yol = dogrula(ham)?;
            ayarlari_yaz(&s.veri_dizini, &YedekAyarlari { hedef_dizin: Some(ham.trim().into()) })
                .map_err(|_| {
                    istek_hatasi("Yedek klasörü ayarı kaydedilemedi; uygulamanın veri klasörü yazılabilir mi?")
                })?;
            yol
        }
        None => match ayarlari_oku(&s.veri_dizini).hedef_dizin {
            Some(kayitli) => dogrula(&kayitli)?,
            None => return Err(istek_hatasi("Önce yedeklerin yazılacağı klasörü seçin.")),
        },
    };

    // Oturum anahtarı kapıdan AYRI alınır: `acik_baglanti` bağlantı verir,
    // anahtarı vermez. Aradaki pencerede oturum kilitlenmiş olabilir --
    // o zaman yedek alınmaz ve 401 döner (kapının verdiği yanıtla aynı).
    let anahtar = s.acik_anahtar().ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "hata": "Oturum kilitli. Lütfen parolanızı girin." })),
    ))?;

    let bilgi = yedek_al_ve_kaydet(
        &conn,
        &s.db_yolu(),
        &s.keystore_yolu(),
        &hedef,
        &istek.damga,
        &anahtar,
        Cihaz::Masaustu,
    )
    .map_err(yedek_hatasi)?;

    Ok(Json(json!({
        "tarih": bilgi.tarih,
        "boyut": bilgi.boyut,
    })))
}

#[derive(Deserialize)]
pub struct OncekiIstegi {
    /// Taşınan dosyaların adına eklenecek zaman damgası — **istemcinin
    /// yerel saati** (`YYYYAAGG-SSDD`).
    ///
    /// Sunucu kendi saatinden türetmiyor: duvar saati sözleşmesi
    /// (`YedekIstegi::damga` ile aynı gerekçe). Kullanıcı bu adı Finder'da
    /// okuyacak ve "hangisi dünkü" diye soracak; UTC'den türetilen bir ad
    /// Istanbul'da 00:00–03:00 arasında bir gün geriye yazardı.
    ///
    /// Biçim doğrulaması çekirdekte (`GecersizDamga`) ve bir **güvenlik**
    /// kapısıdır: damga bir dosya adına giriyor.
    pub damga: String,
}

/// Veri klasöründe duran `.onceki` kalıntılarını damgalı bir ada taşır
/// (`POST /api/onceki-dosyalari-kaldir`).
///
/// # Neden bir uç nokta gerekti (inceleme IMPORTANT-A)
///
/// `core::backup::Yerlestirme::kenara_al` artık hedefte bir `.onceki`
/// bulursa geri yüklemeyi durduruyor. Kalıntı **başarılı** bir geri
/// yüklemeden de kalabilir (`tamamla()`'nın silmesi başarısız olabilir) ve
/// o durumda bundan sonraki her geçerli geri yükleme `409` alırdı.
/// Kullanıcının tek çıkışı `~/Library` altında elle dosya taşımak olurdu --
/// macOS'ta gizli bir klasör, ve oradaki ilk refleks **silmek**.
///
/// **Hiçbir şey silmez**; karar çekirdekte ve testle sabitlenmiş
/// (`kenara_kaldirma_hicbir_dosyayi_silmez`). Arayüzdeki düğme metni de
/// bunu söyler.
///
/// Kapının **içinde**: taşınan dosyalar danışan verisinin kendisidir.
/// Denetim kaydını çekirdek yazar (bu modül `audit::kaydet` çağırmaz).
pub async fn onceki_dosyalari_kaldir(
    State(s): State<AppState>,
    istek: Result<Json<OncekiIstegi>, JsonRejection>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let istek = govde_coz(istek)?;
    let tasinan = onceki_dosyalari_kenara_kaldir(
        &conn,
        &s.db_yolu(),
        &s.keystore_yolu(),
        &istek.damga,
        Cihaz::Masaustu,
    )
    .map_err(yedek_hatasi)?;
    Ok(Json(json!({ "tasinan": tasinan })))
}

/// Bağlama kararının **koşulu** — bkz. modül başlığı ve `tests`.
///
/// Karar ("HTTP rotası, Tauri komutu değil") boşlukta verilmedi: pencere
/// `WebviewUrl::External` ile açıldığı için `window.__TAURI__` enjekte
/// edilmiyor ve IPC'yi açmak CSP'yi genişletmeyi gerektirirdi. Bu dizgi
/// `src-tauri/src/main.rs`'te aranıyor; oradan kalkarsa karar da yeniden
/// gözden geçirilmelidir.
#[cfg(test)]
const PENCERE_KOSULU: &str = "WebviewUrl::External";

/// `YedekHatasi`'yi HTTP'ye çevirir — **varyantları düzleştirmeden**.
///
/// Metinler çekirdekten geliyor ve olduğu gibi gövdeye taşınıyor: "eksik" ≠
/// "bozuk" ≠ "yanlış anahtar" ayrımı bu ürünün en pahalı hata sınıfının
/// (doğru parolalı kullanıcıya "parolanız yanlış" demek) panzehiri. Durum
/// kodu bu ayrımı taşımaz; **gövdedeki metin** taşır (aynı karar
/// `guard::veritabani_hatasi`'nda da verildi).
pub(crate) fn yedek_hatasi(e: psikolog_core::backup::YedekHatasi) -> ApiHata {
    use psikolog_core::backup::YedekHatasi as Y;
    let kod = match e {
        Y::GecersizTarih(_) | Y::GecersizDamga => StatusCode::BAD_REQUEST,
        Y::YedekEksik(_) => StatusCode::NOT_FOUND,
        // 409: sunucu arızası DEĞİL. Yedek de istek de sağlam; bu yedekle bu
        // kurulum bağdaşmıyor (yedek daha yeni bir şemayla alınmış ya da göç
        // uygulanamıyor). 500 dönmek kullanıcıya "uygulama bozuldu" dedirtir
        // ve onu yeniden kurmaya -- yani elindeki tek kopyayı geçersiz
        // kılmaya -- iter; yapması gereken şey mesajda yazıyor.
        // 409, aynı gerekçe (dal incelemesi M1): sunucu arızası değil, bir
        // ÖN KOŞUL çatışması. Veri klasöründe öksüz `.onceki` dosyalar
        // duruyor ve onlar kullanıcının eski verisi olabilir; yapılacak şey
        // mesajda yazıyor. 500 dönmek "uygulama bozuldu" dedirtir ve
        // kullanıcıyı yeniden kurmaya iter -- bu modülün tam da önlediği şey.
        Y::YedekIleriSurumlu { .. } | Y::YedekHazirlanamadi(_) | Y::OncekiDosyaDuruyor => {
            StatusCode::CONFLICT
        }
        // 500: bu gerçekten sunucu/çevre tarafı bir sorun (dosyalar başka
        // bir program tarafından tutuluyor) ve 409'un aksine kullanıcının
        // hemen müdahale etmesi gerekiyor -- gövdedeki metin ne yapacağını
        // söylüyor.
        //
        // Bu iki kol davranışsal olarak `_` ile aynı; **kasıtlı** olarak
        // ayrı yazılıyorlar ki 500 kararı bu varyantlar için bilinçli
        // görünsün. Kolların gerçekten 500 döndüğünü ölçen testler:
        // `tests::yarim_geri_alma_500_doner` ve
        // `tests::dosya_hatasi_500_doner_ve_govde_akibeti_soyler` -- yoksa
        // `_`'a düşen sessiz bir değişiklik fark edilmezdi.
        Y::GeriAlmaYarimKaldi(_) | Y::YerlestirmeBasarisiz(_) | Y::TemizlikBasarisiz(_) => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (kod, Json(json!({ "hata": e.to_string() })))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **Koşullu kararın tetikleyicisi ÇALIŞTIRILABİLİR olmalı.**
    ///
    /// # Neden bu test var
    ///
    /// Modül başlığındaki bağlama kararı ("HTTP rotası, Tauri komutu
    /// değil") bir **koşula** dayanıyor: pencere
    /// `WebviewUrl::External("http://127.0.0.1:<port>")` ile açılıyor, yani
    /// arayüz uzak bir kaynak olarak yükleniyor ve `window.__TAURI__` orada
    /// enjekte edilmiyor. Koşul düşerse gerekçe de düşer.
    ///
    /// Bu kod tabanında aynı sınıftan bir hata zaten bulundu: bağlantı ömrü
    /// kararının koşulu ("ekler yazma yoluna girerse") gerçekleşti, ölçüm
    /// tekrarlanmadı ve kimse fark etmedi -- çünkü tetikleyici bir koruma
    /// değil, bir **cümleydi**. Düzeltme oradaki
    /// `guard::tests::ekler_yazma_yolundaysa_olcum_blob_senaryosunu_da_icermeli`
    /// ile aynı yöntem: koşulun kendisi de çalıştırılabilir olmalı.
    ///
    /// İki yön de kırılabilir: Tauri kabuğu kendi protokolüne (ya da
    /// `WebviewUrl::App`'e) geçerse (1) kırılır ve karar metni yeniden
    /// yazılmaya zorlanır; modül başlığından gerekçe silinirse (2) kırılır.
    #[test]
    fn baglama_kararinin_kosulu_hala_gecerli_mi() {
        let main_rs = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src-tauri/src/main.rs");
        let kaynak = std::fs::read_to_string(&main_rs)
            .unwrap_or_else(|e| panic!("{} okunamadi: {e}", main_rs.display()));
        // Yorumlar kuralin KENDISINDEN bahsedebilir (kardes yapisal
        // testlerle ayni eleme).
        let kod: String = kaynak
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        // (1) KOSUL: bugun DOGRU. Pencere uzak bir kaynak yukluyor.
        assert!(
            kod.contains(PENCERE_KOSULU),
            "Tauri kabugu artik `{PENCERE_KOSULU}` kullanmiyor: arayuz Tauri'nin kendi \
             protokoluyle yukleniyor olabilir ve `window.__TAURI__` erisilebilir hale \
             gelmis olabilir. Yedekleme icin verilen 'HTTP rotasi, Tauri komutu degil' \
             karari (bkz. modul basligi) yeniden gozden gecirilmeli -- ozellikle yerel \
             klasor secici artik maliyetsiz olabilir."
        );

        // (2) YUKUMLULUK: kosul dogruysa gerekce bu modulun BASLIGINDA
        // yazili olmali. Dosyanin TAMAMI degil, yalnizca `//!` blogu
        // taranir: yukaridaki sabit (`PENCERE_KOSULU`) dosyada zaten
        // geciyor ve tam dosya taramasi kendi kendini dogrulayan bir
        // TOTOLOJI olurdu -- gerekce basliktan tumuyle silinse bile test
        // gecerdi.
        let bu_baslik: String = include_str!("backup.rs")
            .lines()
            .take_while(|l| l.starts_with("//!"))
            .collect::<Vec<_>>()
            .join("\n");
        // Sinir gercekten tuttu mu: baslik bu testin KENDISINI kapsamamali.
        assert!(
            !bu_baslik.contains("fn baglama_kararinin_kosulu"),
            "modul basligi ayiklanamadi (sinir kaydi); tarama totolojiye donusurdu"
        );
        assert!(
            bu_baslik.contains(PENCERE_KOSULU),
            "`routes::backup` modul basligi baglama kararinin kosulunu artik anlatmiyor"
        );
    }

    /// `yedek_hatasi`'nin durum kodu + govde metnini birlikte okur.
    fn cevir(e: psikolog_core::backup::YedekHatasi) -> (StatusCode, String) {
        let (kod, govde) = yedek_hatasi(e);
        let metin = govde.0["hata"].as_str().expect("govdede `hata` metni olmali").to_string();
        (kod, metin)
    }

    /// Yarim geri almanin **durum kodu** hicbir testle olculmuyordu (dal
    /// incelemesi I2, bedava iyilestirme): kol `_ => 500` ile ayni oldugu
    /// icin onu silen bir mutasyon tamamen gorunmezdi. Cekirdek tarafindaki
    /// esi `backup::tests::yarim_geri_alma_kullaniciya_yeniden_kurdurmamali`
    /// yalnizca METNI olcuyor.
    #[test]
    fn yarim_geri_alma_500_doner() {
        use psikolog_core::backup::YedekHatasi as Y;
        let (kod, metin) = cevir(Y::GeriAlmaYarimKaldi(Box::new(Y::BozukYedek)));
        assert_eq!(
            kod,
            StatusCode::INTERNAL_SERVER_ERROR,
            "yarim geri alma cevre kaynakli bir arizadir ve kullanicinin HEMEN \
             mudahale etmesi gerekir; 409 (\"bu yedek bu kurulumla bagdasmiyor\") \
             yanlis sinifa sokardi"
        );
        assert!(metin.contains("YENİDEN KURMAYIN"), "{metin}");
        assert!(metin.contains(".onceki"), "mesaj verinin nerede oldugunu soylemeli: {metin}");
    }

    /// Oksuz bir `.onceki` yuzunden durdurulan geri yukleme 409 donmeli
    /// (dal incelemesi M1): kullanicinin yapacagi bir sey var ve 500
    /// "uygulama bozuldu" izlenimi verip onu yeniden kuruluma iterdi.
    #[test]
    fn onceki_dosya_duruyorsa_409_doner() {
        use psikolog_core::backup::YedekHatasi as Y;
        let (kod, metin) = cevir(Y::OncekiDosyaDuruyor);
        assert_eq!(kod, StatusCode::CONFLICT, "sunucu arizasi degil, on kosul catismasi");
        assert!(metin.contains(".onceki"), "govde hangi dosyaya bakilacagini soylemeli: {metin}");
        assert!(metin.contains("değiştirilmedi"), "{metin}");
    }

    /// Geri yuklemedeki dosya (IO) hatasi kullaniciya verisinin AKIBETINI
    /// soylemeli (dal incelemesi I2). Eskiden ham `YedekHatasi::Io` gecerdi
    /// ve govde yalnizca "dosya hatasi: ..." derdi.
    #[test]
    fn dosya_hatasi_500_doner_ve_govde_akibeti_soyler() {
        use psikolog_core::backup::YedekHatasi as Y;
        let (kod, metin) = cevir(Y::YerlestirmeBasarisiz(Box::new(Y::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "C:/Users/terapist/AppData/veri.db erisim reddedildi",
        )))));
        assert_eq!(kod, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(
            metin.contains("kaybolmadı") && metin.contains("YERİNDE"),
            "govde verinin yerinde oldugunu soylemeli: {metin}"
        );
        // Hassas veri sizmasin: isletim sistemi hata metni (yol, dosya adi)
        // `#[source]` zincirinde kalir, GOVDEYE girmez.
        assert!(
            !metin.contains("terapist") && !metin.contains("veri.db"),
            "govde dosya yolu/adi tasimamali: {metin}"
        );
    }
}
