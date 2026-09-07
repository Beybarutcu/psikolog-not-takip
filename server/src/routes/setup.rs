use crate::state::{AppState, KeystoreDurumu};
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::store::{
    audit::{kaydet, Cihaz, Eylem},
    db::open_encrypted,
    keystore,
    schema::migrate,
};
use serde::Deserialize;
use serde_json::json;
use std::time::Instant;

#[derive(Deserialize)]
pub struct KurulumIstegi {
    pub parola: String,
}

pub async fn kurulum(
    State(s): State<AppState>,
    Json(istek): Json<KurulumIstegi>,
) -> (StatusCode, Json<serde_json::Value>) {
    // Kurulum kilidi: "var mı?" kontrolü ile diske yazma arasında -- ve tüm
    // fonksiyon boyunca -- tutulur, böylece eş zamanlı iki kurulum isteği
    // (örn. çift tıklama) birbirinin keystore'unu (ve parolasını) ezemez.
    // Bkz. `AppState::kurulum_kilidi` dokümantasyonu; bu kilit `oturum`
    // kilidinden ayrıdır ve fonksiyonun sonunda `oturum` kilidi de alındığı
    // için sıralamaya dikkat edilir (kurulum_kilidi -> oturum, asla tersi).
    let _kurulum_kilidi = s.kurulum_kilidi.lock().unwrap();

    match s.keystore_durumu() {
        KeystoreDurumu::Yok => {}
        KeystoreDurumu::Var(_) => {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "hata": "Kurulum zaten yapılmış." })),
            );
        }
        KeystoreDurumu::Bozuk => {
            // Dosya var ama okunamıyor. Yine de reddediyoruz (ezme riskine
            // karşı koruma doğru davranış), ama mesaj durumu doğru anlatmalı
            // -- "kurulum yapılmamış" değil, "zaten bir dosya var ama bozuk".
            return (
                StatusCode::CONFLICT,
                Json(json!({
                    "hata": "Anahtar dosyası zaten var ancak okunamıyor. Bu dosyayı silmeyin; üzerine kurulum yaparsanız mevcut verilere bir daha erişilemez."
                })),
            );
        }
    }

    if istek.parola.chars().count() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "hata": "Parola en az 8 karakter olmalı." })),
        );
    }

    let kurulum = match keystore::create(&istek.parola, s.kdf) {
        Ok(k) => k,
        Err(e) => {
            eprintln!("kurulum: anahtar oluşturulamadı: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "hata": "Anahtar oluşturulamadı." })),
            );
        }
    };
    if let Err(e) = keystore::save(&kurulum.keystore, &s.keystore_yolu()) {
        eprintln!("kurulum: keystore kaydedilemedi: {e}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "hata": "Anahtar dosyası kaydedilemedi." })),
        );
    }

    let conn = match open_encrypted(&s.db_yolu(), &kurulum.data_key) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("kurulum: veritabanı açılamadı: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "hata": "Veritabanı oluşturulamadı." })),
            );
        }
    };
    if let Err(e) = migrate(&conn) {
        eprintln!("kurulum: göç başarısız: {e}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "hata": "Veritabanı hazırlanamadı." })),
        );
    }

    // Erişim VEREN bir işlem: KVKK gereği erişimin loglanması zorunlu.
    // Audit yazımı başarısız olursa erişim de verilmez (fail-closed) --
    // kaydedemediğimiz bir erişimi vermeyiz. (Karşıt karar için bkz.
    // routes::session::kilitle -- kilitleme her zaman fail-open'dır.)
    if let Err(e) = kaydet(&conn, Eylem::Giris, "session", "-", Cihaz::Masaustu, Some("ilk kurulum")) {
        eprintln!("kurulum: erişim kaydı yazılamadı: {e}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "hata": "Kurulum tamamlanamadı: erişim kaydı oluşturulamadı." })),
        );
    }

    s.oturum.lock().unwrap().ac(kurulum.data_key, Instant::now());
    (StatusCode::CREATED, Json(json!({ "kurtarma_kodu": kurulum.recovery_code })))
}
