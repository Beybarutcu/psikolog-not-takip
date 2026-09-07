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
pub struct KilitAcIstegi {
    pub parola: Option<String>,
    pub kurtarma_kodu: Option<String>,
}

pub async fn durum(State(s): State<AppState>) -> Json<serde_json::Value> {
    let kurulum_gerekli = !keystore::exists(&s.keystore_yolu());
    let kilitli = s.acik_anahtar().is_none();
    Json(json!({ "kurulum_gerekli": kurulum_gerekli, "kilitli": kilitli }))
}

pub async fn kilit_ac(
    State(s): State<AppState>,
    Json(istek): Json<KilitAcIstegi>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Ok(ks) = keystore::load(&s.keystore_yolu()) else {
        return (StatusCode::CONFLICT, Json(json!({ "hata": "once kurulum yapilmali" })));
    };

    let sonuc = match (&istek.parola, &istek.kurtarma_kodu) {
        (Some(p), _) => keystore::unlock_with_password(&ks, p),
        (_, Some(k)) => keystore::unlock_with_recovery(&ks, k),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "hata": "parola girilmedi" }))),
    };

    match sonuc {
        Ok(key) => {
            let conn = match open_encrypted(&s.db_yolu(), &key) {
                Ok(c) => c,
                Err(e) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
                }
            };
            let _ = migrate(&conn);
            let _ = kaydet(&conn, Eylem::Giris, "session", "-", Cihaz::Masaustu, None);
            s.oturum.lock().unwrap().ac(key, Instant::now());
            (StatusCode::OK, Json(json!({})))
        }
        Err(_) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "hata": "Parola veya kurtarma kodu hatali." })),
        ),
    }
}

pub async fn kilitle(State(s): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    if let Some(key) = s.acik_anahtar() {
        if let Ok(conn) = open_encrypted(&s.db_yolu(), &key) {
            let _ = kaydet(&conn, Eylem::Cikis, "session", "-", Cihaz::Masaustu, None);
        }
    }
    s.oturum.lock().unwrap().kilitle();
    (StatusCode::OK, Json(json!({})))
}
