use crate::guard::veritabani_hatasi;
use crate::state::{AppState, KeystoreDurumu};
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::crypto::keyring::CryptoError;
use psikolog_core::store::{
    audit::{kaydet, Cihaz, Eylem},
    db::{open_encrypted, open_existing},
    keystore,
    schema::migrate,
};
use serde::Deserialize;
use serde_json::json;
use std::time::Instant;

#[derive(Deserialize)]
pub struct KilitAcIstegi {
    pub parola: Option<String>,
    pub kurtarma_kodu: Option<String>,
}

/// Anahtar kaydı (`keystore.json` içindeki sarmalanmış anahtarlardan biri
/// veya her ikisi) yapısal olarak bozuk bulunduğunda gösterilen mesaj. Hem
/// `KeystoreDurumu::Bozuk` koluna (dosya ayrıştırılamıyor) hem de
/// `CryptoError::Format`/`Kdf`/`Encryption` koluna (dosya ayrıştırılabiliyor
/// ama içerik bozuk) uygulanır -- ikisi de kullanıcı hatası değildir ve
/// kullanıcıyı yanlışlıkla dosyayı silmeye itmemelidir (bkz. Bulgu 1).
const BOZUK_KAYIT_MESAJI: &str = "Anahtar dosyası okunamıyor. Yedekten geri yükleme gerekebilir. Bu dosyayı silmeyin, silerseniz verilerinize bir daha erişilemez.";

pub async fn durum(State(s): State<AppState>) -> Json<serde_json::Value> {
    let (kurulum_gerekli, keystore_bozuk) = match s.keystore_durumu() {
        KeystoreDurumu::Yok => (true, false),
        KeystoreDurumu::Var(_) => (false, false),
        // Dosya var ama okunamıyor: kurulum "gerekli" değildir -- kurulum
        // yapmak (üzerine yazmak) bu durumda veriyi kalıcı olarak yok eder.
        KeystoreDurumu::Bozuk => (false, true),
    };
    let kilitli = s.acik_anahtar().is_none();
    Json(json!({
        "kurulum_gerekli": kurulum_gerekli,
        "kilitli": kilitli,
        "keystore_bozuk": keystore_bozuk,
    }))
}

pub async fn kilit_ac(
    State(s): State<AppState>,
    Json(istek): Json<KilitAcIstegi>,
) -> (StatusCode, Json<serde_json::Value>) {
    let ks = match s.keystore_durumu() {
        KeystoreDurumu::Yok => {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "hata": "Önce kurulum yapılmalı." })),
            );
        }
        KeystoreDurumu::Bozuk => {
            // "Önce kurulum yapılmalı" DEMİYORUZ: kullanıcı bunu "keystore'u
            // silip yeniden kurayım" diye çözerse, şifreli veritabanı yerinde
            // dururken onu açacak anahtar kaybolur -- kalıcı veri kaybı.
            // Mesaj kullanıcıyı açıkça dosyayı SİLMEMESİ konusunda uyarır.
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "hata": BOZUK_KAYIT_MESAJI })),
            );
        }
        KeystoreDurumu::Var(ks) => ks,
    };

    let sonuc = match (&istek.parola, &istek.kurtarma_kodu) {
        (Some(p), _) => keystore::unlock_with_password(&ks, p),
        (_, Some(k)) => keystore::unlock_with_recovery(&ks, k),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "hata": "Parola girilmedi." }))),
    };

    match sonuc {
        Ok(key) => {
            // `open_encrypted` DEĞİL, `open_existing`: dosya yoksa (kullanıcı
            // `veri.db`'yi yanlışlıkla sildi, senkronizasyon klasörü yuttu,
            // yarım kalmış bir geri yükleme) kilit açma isteği sessizce BOŞ
            // bir veritabanı YARATMAMALI. `open_encrypted` bunu yapardı --
            // doğru parolayla gelen kullanıcı "kilit açıldı" görür, sonra
            // tüm danışanlarının kaybolduğunu fark eder. Tam olarak
            // `guard::acik_baglanti`'nin veri uç noktaları için önlediği
            // durum; giriş kapısı da aynı kuralı izlemeli (bkz. Bulgu 1).
            // Kurulum akışı (`routes::setup::kurulum`) `open_encrypted`
            // kullanmaya DEVAM EDER -- orada dosyayı yaratmak doğrudur.
            let conn = match open_existing(&s.db_yolu(), &key) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("kilit-ac: veritabanı açılamadı: {e}");
                    // `veritabani_hatasi` her `DbError` varyantını -- `DosyaYok`
                    // dahil -- kendi `Display` metniyle gövdeye taşır.
                    // `DosyaYok`'un mesajı kullanıcıyı yedekten geri yüklemeye
                    // yönlendirir, "parolanız hatalı" DEMEZ (bkz. Bulgu 1).
                    return veritabani_hatasi(e);
                }
            };
            // Kurulumdaki (`routes::setup::kurulum`) ile aynı kalıp: göç
            // hatası sessizce yutulup oturum açılmamalı. Bugün zararsız (V1
            // idempotent) ama sonraki planlar `migrate`'i genişletecek --
            // yarıda kalan bir şema göçünü sessizce yutup eksik şemayla
            // oturum açmak, kullanıcıya hiçbir belirti vermeden bozuk bir
            // uygulama durumu bırakır (bkz. Bulgu 2).
            if let Err(e) = migrate(&conn) {
                eprintln!("kilit-ac: göç başarısız: {e}");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "hata": "Veritabanı hazırlanamadı." })),
                );
            }
            // Erişim VEREN bir işlem: audit yazımı başarısız olursa erişim de
            // verilmez (fail-closed) -- bkz. routes::setup::kurulum'daki aynı
            // gerekçe. Kaydedemediğimiz bir erişimi vermeyiz.
            if let Err(e) = kaydet(&conn, Eylem::Giris, "session", "-", Cihaz::Masaustu, None) {
                eprintln!("kilit-ac: erişim kaydı yazılamadı: {e}");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "hata": "Kilit açılamadı: erişim kaydı oluşturulamadı." })),
                );
            }
            s.oturum.lock().unwrap_or_else(|e| e.into_inner()).ac(key, Instant::now());
            (StatusCode::OK, Json(json!({})))
        }
        // "Her hata parola hatasidir" tuzagi: `CryptoError`'in dort varyanti
        // kasitli olarak farkli anlamlar tasir. Yalnizca `WrongSecret`
        // gercekten yanlis parola/kurtarma kodudur. `Format` (bozuk kayit),
        // `Kdf` ve `Encryption` kullanici hatasi degildir -- bunlari da 401
        // "parola hatali" olarak gostermek, dogru parolasini giren bir
        // kullaniciyi "ikisini de kaybettim" sonucuna goturur (bkz. Bulgu 1).
        Err(CryptoError::WrongSecret) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "hata": "Parola veya kurtarma kodu hatalı." })),
        ),
        Err(CryptoError::Format(_) | CryptoError::Kdf(_) | CryptoError::Encryption(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "hata": BOZUK_KAYIT_MESAJI })),
        ),
    }
}

pub async fn kilitle(State(s): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    if let Some(key) = s.acik_anahtar() {
        if let Ok(conn) = open_encrypted(&s.db_yolu(), &key) {
            // Kilitleme erişimi KALDIRAN bir işlemdir: audit yazımı
            // başarısız olsa bile kilitleme HER ZAMAN başarılı olur
            // (fail-open) -- güvenlik lehine bir eylemi engellemek zarar
            // verir. (Karşıt karar -- fail-closed -- için bkz. yukarıdaki
            // `kilit_ac` ve `routes::setup::kurulum`.)
            let _ = kaydet(&conn, Eylem::Cikis, "session", "-", Cihaz::Masaustu, None);
        }
    }
    s.oturum.lock().unwrap_or_else(|e| e.into_inner()).kilitle();
    (StatusCode::OK, Json(json!({})))
}
