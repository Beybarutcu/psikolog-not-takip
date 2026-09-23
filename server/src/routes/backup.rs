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
//! Tek handler'ın ilk satırı `guard::acik_baglanti`'dir. Yedek almak
//! danışan verisinin **tamamının** kopyasını üretir; kilitli oturumda
//! yapılamamalıdır. **Geri yükleme** ise bilerek başka bir modüldedir
//! (`routes::restore`) çünkü tam da oturumun açılamadığı durumda
//! çalışmak zorundadır -- gerekçe orada.
//!
//! # Denetim kaydı
//!
//! Bu modül `audit::kaydet` **çağırmaz**; hacim kararını çekirdek verdi
//! (`core::backup::yedek_al_ve_kaydet` -> `DisaAktarma` + `HerCagri`).

use crate::guard::{acik_baglanti, govde_coz, ApiHata};
use axum::extract::rejection::JsonRejection;
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::backup::{ayarlari_oku, ayarlari_yaz, yedek_al_ve_kaydet, YedekAyarlari};
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
        Y::GecersizTarih(_) => StatusCode::BAD_REQUEST,
        Y::YedekEksik(_) => StatusCode::NOT_FOUND,
        // 409: sunucu arızası DEĞİL. Yedek de istek de sağlam; bu yedekle bu
        // kurulum bağdaşmıyor (yedek daha yeni bir şemayla alınmış ya da göç
        // uygulanamıyor). 500 dönmek kullanıcıya "uygulama bozuldu" dedirtir
        // ve onu yeniden kurmaya -- yani elindeki tek kopyayı geçersiz
        // kılmaya -- iter; yapması gereken şey mesajda yazıyor.
        Y::YedekIleriSurumlu { .. } | Y::YedekHazirlanamadi(_) => StatusCode::CONFLICT,
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
        Y::GeriAlmaYarimKaldi(_) | Y::YerlestirmeBasarisiz(_) => {
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

    /// Geri yuklemedeki dosya (IO) hatasi kullaniciya verisinin AKIBETINI
    /// soylemeli (dal incelemesi I2). Eskiden ham `YedekHatasi::Io` gecerdi
    /// ve govde yalnizca "dosya hatasi: ..." derdi.
    #[test]
    fn dosya_hatasi_500_doner_ve_govde_akibeti_soyler() {
        use psikolog_core::backup::YedekHatasi as Y;
        let (kod, metin) = cevir(Y::YerlestirmeBasarisiz(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "C:/Users/terapist/AppData/veri.db erisim reddedildi",
        )));
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
