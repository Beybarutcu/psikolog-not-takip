use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState};
use tower::ServiceExt;

fn test_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::yeni(dir.path().to_path_buf(), KdfParams { m_cost: 8, t_cost: 1, p_cost: 1 });
    (dir, state)
}

async fn cagir(state: &AppState, method: &str, yol: &str, govde: Option<serde_json::Value>) -> (StatusCode, serde_json::Value) {
    let istek = Request::builder()
        .method(method)
        .uri(yol)
        .header("content-type", "application/json")
        .body(match govde {
            Some(v) => Body::from(v.to_string()),
            None => Body::empty(),
        })
        .unwrap();

    let yanit = router(state.clone()).oneshot(istek).await.unwrap();
    let kod = yanit.status();
    let bytes = yanit.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::json!({}));
    (kod, json)
}

#[tokio::test]
async fn ilk_acilista_kurulum_gerekli_bildirilir() {
    let (_d, s) = test_state();
    let (kod, json) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(json["kurulum_gerekli"], true);
    assert_eq!(json["kilitli"], true);
}

#[tokio::test]
async fn kurulum_kurtarma_kodu_dondurur_ve_oturumu_acar() {
    let (_d, s) = test_state();
    let (kod, json) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    assert_eq!(kod, StatusCode::CREATED);

    let kurtarma = json["kurtarma_kodu"].as_str().unwrap();
    assert_eq!(kurtarma.split('-').count(), 5);

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kurulum_gerekli"], false);
    assert_eq!(durum["kilitli"], false, "kurulum sonrasi oturum acik olmali");
}

#[tokio::test]
async fn ikinci_kurulum_reddedilir() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    let (kod, _) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"baska"}))).await;
    assert_eq!(kod, StatusCode::CONFLICT);
}

#[tokio::test]
async fn dogru_parola_kilidi_acar() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, _) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"gizli123"}))).await;
    assert_eq!(kod, StatusCode::OK);

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kilitli"], false);
}

#[tokio::test]
async fn yanlis_parola_401_dondurur_ve_kilitli_kalir() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"yanlis"}))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json["hata"].as_str().unwrap().contains("hatali"));

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kilitli"], true);
}

#[tokio::test]
async fn kurtarma_koduyla_kilit_acilir() {
    let (_d, s) = test_state();
    let (_, json) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    let kurtarma = json["kurtarma_kodu"].as_str().unwrap().to_string();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, _) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"kurtarma_kodu": kurtarma}))).await;
    assert_eq!(kod, StatusCode::OK);
}

#[tokio::test]
async fn giris_ve_cikis_erisim_loguna_yazilir() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;
    cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"gizli123"}))).await;

    let kayitlar = s.audit_dokumu().unwrap();
    let eylemler: Vec<&str> = kayitlar.iter().map(|k| k.eylem.as_str()).collect();
    assert!(eylemler.contains(&"giris"));
    assert!(eylemler.contains(&"cikis"));
}

// --- Ek testler: kilitli oturumda veri sizmamasi (gorev brief'i disinda, incelemeden gelen kisit) ---

#[tokio::test]
async fn kilitliyken_durum_yaniti_kurtarma_kodu_veya_anahtar_icermez() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(kod, StatusCode::OK);
    // Yanit govdesi yalnizca iki bool alan icermeli, baska hicbir sey degil.
    let alanlar: Vec<&String> = json.as_object().unwrap().keys().collect();
    assert_eq!(alanlar.len(), 2, "durum yaniti beklenenden fazla alan iceriyor: {json}");
    assert!(json.get("kurtarma_kodu").is_none());
    assert!(json.get("parola").is_none());
}

#[tokio::test]
async fn kilitliyken_kilitle_cagirmak_govdede_veri_dondurmez() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    // Zaten kilitliyken tekrar kilitle cagirmak da veri sizdirmamali.
    let (kod, json) = cagir(&s, "POST", "/api/kilitle", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(json, serde_json::json!({}), "kilitle yaniti bos govde disinda bir sey icermemeli");
}

#[tokio::test]
async fn kilitliyken_yanlis_kilit_ac_denemesi_kurtarma_kodu_sizdirmaz() {
    let (_d, s) = test_state();
    let (_, kurulum_json) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    let kurtarma = kurulum_json["kurtarma_kodu"].as_str().unwrap().to_string();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"yanlis"}))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    let govde_metni = json.to_string();
    assert!(!govde_metni.contains(&kurtarma), "hata yaniti kurtarma kodunu icermemeli");
}
