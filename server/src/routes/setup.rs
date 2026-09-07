use crate::state::AppState;
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
    if keystore::exists(&s.keystore_yolu()) {
        return (StatusCode::CONFLICT, Json(json!({ "hata": "kurulum zaten yapilmis" })));
    }
    if istek.parola.chars().count() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "hata": "Parola en az 8 karakter olmali." })),
        );
    }

    let kurulum = match keystore::create(&istek.parola, s.kdf) {
        Ok(k) => k,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
        }
    };
    if let Err(e) = keystore::save(&kurulum.keystore, &s.keystore_yolu()) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })));
    }

    let conn = match open_encrypted(&s.db_yolu(), &kurulum.data_key) {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
        }
    };
    if let Err(e) = migrate(&conn) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })));
    }
    let _ = kaydet(&conn, Eylem::Giris, "session", "-", Cihaz::Masaustu, Some("ilk kurulum"));

    s.oturum.lock().unwrap().ac(kurulum.data_key, Instant::now());
    (StatusCode::CREATED, Json(json!({ "kurtarma_kodu": kurulum.recovery_code })))
}
