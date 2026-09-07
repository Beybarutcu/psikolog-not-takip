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
pub struct KilitAcIstegi {
    pub parola: Option<String>,
    pub kurtarma_kodu: Option<String>,
}

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
                Json(json!({
                    "hata": "Anahtar dosyası okunamıyor. Yedekten geri yükleme gerekebilir. Bu dosyayı silmeyin, silerseniz verilerinize bir daha erişilemez."
                })),
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
            let conn = match open_encrypted(&s.db_yolu(), &key) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("kilit-ac: veritabanı açılamadı: {e}");
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "hata": "Veritabanı açılamadı." })),
                    );
                }
            };
            let _ = migrate(&conn);
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
            s.oturum.lock().unwrap().ac(key, Instant::now());
            (StatusCode::OK, Json(json!({})))
        }
        Err(_) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "hata": "Parola veya kurtarma kodu hatalı." })),
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
    s.oturum.lock().unwrap().kilitle();
    (StatusCode::OK, Json(json!({})))
}
