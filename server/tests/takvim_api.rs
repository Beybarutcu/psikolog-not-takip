use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::guard::acik_baglanti_ile;
use psikolog_server::{router, AppState};
use serde_json::json;
use std::time::{Duration, Instant};
use tower::ServiceExt;

fn test_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::yeni(dir.path().to_path_buf(), KdfParams { m_cost: 8, t_cost: 1, p_cost: 1 });
    (dir, state)
}

async fn cagir(
    state: &AppState,
    method: &str,
    yol: &str,
    govde: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
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

async fn kurulu_state() -> (tempfile::TempDir, AppState) {
    let (dir, state) = test_state();
    cagir(&state, "POST", "/api/kurulum", Some(json!({"parola":"gizliparola"}))).await;
    (dir, state)
}

// Bulgu 4: `json.get("danisanlar").is_none()` totolojikti -- basarili yanit
// govdesi cIPLAK bir dizidir, bir nesne degil, bu yuzden `get()` bir dizi
// uzerinde ZATEN hep `None` doner; veri gercekten sizsa bile bu assertion
// hicbir zaman patlamazdi. Asagidaki testler bilinen bir kayit (danisan/
// randevu) onceden UNLOCKED durumdayken olusturup, kilitliyken donen
// govdenin (a) bir dizi OLMADIGINI ve (b) o bilinen kaydin adini/ID'sini
// ICERMEDIGINI dogruluyor -- gercekten anlamli bir sizinti kontrolu.

#[tokio::test]
async fn kilitliyken_danisan_listesi_401_doner() {
    let (_d, s) = kurulu_state().await;
    cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Gizli Danisan"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(!json.is_array(), "basarili yanit govdesi dizidir, kilitliyken olmamali");
    assert!(
        !json.to_string().contains("Gizli Danisan"),
        "kilitliyken bilinen bir danisan adi govdede olmamali: {json}"
    );
}

#[tokio::test]
async fn kilitliyken_randevu_listesi_401_doner() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Gizli Danisan"}))).await;
    cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) =
        cagir(&s, "GET", "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None)
            .await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(!json.is_array(), "basarili yanit govdesi dizidir, kilitliyken olmamali");
    assert!(
        !json.to_string().contains("Gizli Danisan"),
        "kilitliyken bilinen bir danisan adi govdede olmamali: {json}"
    );
}

// Bulgu 3: yalnizca GET /api/danisanlar ve GET /api/randevular kapsanmisti.
// Koruma yapisal (hepsi `acik_baglanti`'yi ilk satirda cagiriyor) ama
// kapsanmamis bir uc nokta ileride yanlislikla `acik_baglanti` cagirmadan
// yazilabilir ve hicbir test bunu yakalamaz. Kalan bes uc nokta icin de
// kilitli-oturum testi: her biri 401 donmeli VE -- Bulgu 4'teki hatayi
// tekrarlamamak icin -- islem gercekten UYGULANMAMIS olmali. Bunu, kilitliyken
// istegi yapip sonra DOGRU parolayla tekrar kilit acarak ve depoyu okuyarak
// dogruluyoruz (yalnizca govde sekline degil, gercek veri durumuna bakiyoruz).

#[tokio::test]
async fn kilitliyken_danisan_olusturma_401_doner_ve_kaydetmez() {
    let (_d, s) = kurulu_state().await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) =
        cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Gizli Danisan"}))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("id").is_none(), "kilitliyken olusturma basarili gibi id donmemeli");
    assert!(
        !json.to_string().contains("Gizli Danisan"),
        "kilitliyken bilinen bir danisan adi govdede olmamali: {json}"
    );

    cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
    let (_, liste) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(
        liste.as_array().unwrap().len(),
        0,
        "kilitliyken yapilan olusturma istegi kalici olarak kaydedilmemis olmali"
    );
}

#[tokio::test]
async fn kilitliyken_randevu_olusturma_401_doner_ve_kaydetmez() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(!json.is_array(), "basarili yanit govdesi dizidir, kilitliyken olmamali");

    cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(
        hafta.as_array().unwrap().len(),
        0,
        "kilitliyken yapilan olusturma istegi kalici olarak kaydedilmemis olmali"
    );
}

#[tokio::test]
async fn kilitliyken_randevu_durum_guncelleme_401_doner_ve_degistirmez() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}"), Some(json!({"durum":"geldi"}))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("hata").is_some());

    cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(
        hafta[0]["durum"], "planlandi",
        "kilitliyken yapilan durum guncellemesi uygulanmamis olmali"
    );
}

#[tokio::test]
async fn kilitliyken_randevu_silme_401_doner_ve_silmez() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "DELETE", &format!("/api/randevular/{id}"), None).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("hata").is_some());

    cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(
        hafta.as_array().unwrap().len(),
        1,
        "kilitliyken yapilan silme istegi uygulanmamis olmali"
    );
}

// Dal incelemesi C1: alan guncelleme ucu (`PUT /api/randevular/{id}`) da
// diger dokuz rota gibi `acik_baglanti` kapisindan gecmeli. Yalnizca 401
// degil, guncellemenin UYGULANMAMIS oldugu da dogrulanir (Bulgu 4 dersi:
// govde sekline degil gercek veri durumuna bak).
#[tokio::test]
async fn kilitliyken_randevu_guncelleme_401_doner_ve_degistirmez() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "ucret": 45000
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "PUT", &format!("/api/randevular/{id}"), Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T16:00", "bitis": "2026-09-07T17:00",
        "ucret": 50000
    }))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("id").is_none(), "kilitliyken guncelleme kaydi dondurmemeli");

    cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(hafta.as_array().unwrap().len(), 1);
    assert_eq!(
        hafta[0]["baslangic"], "2026-09-07T14:00",
        "kilitliyken yapilan guncelleme uygulanmamis olmali"
    );
    assert_eq!(hafta[0]["ucret"], 45000, "kilitliyken ucret degismemis olmali");
}

#[tokio::test]
async fn kilitliyken_cakisma_401_doner() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Gizli Danisan"}))).await;
    cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(
        &s, "GET",
        "/api/cakisma?baslangic=2026-09-07T14:30&bitis=2026-09-07T15:30", None,
    ).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    // I2 ile bu ucun basarili yaniti da bir NESNE oldugu icin `!is_array()`
    // artik totolojik olurdu (Bulgu 4'un ayni sinifi): basarili yanitin
    // AYIRT EDICI alanina bakiliyor.
    assert!(
        json.get("cakisanlar").is_none(),
        "kilitliyken basarili yanitin alanlari donmemeli: {json}"
    );
    assert!(
        !json.to_string().contains("Gizli Danisan"),
        "kilitliyken bilinen bir danisan adi govdede olmamali: {json}"
    );
}

#[tokio::test]
async fn danisan_eklenir_ve_listelenir() {
    let (_d, s) = kurulu_state().await;
    let (kod, olusan) =
        cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse Yilmaz"}))).await;
    assert_eq!(kod, StatusCode::CREATED);
    assert!(olusan["id"].as_i64().unwrap() > 0);

    let (_, liste) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn randevu_olusturulur_ve_hafta_sorgusunda_gorunur() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();

    let (kod, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00", "ucret": 45000
    }))).await;
    assert_eq!(kod, StatusCode::CREATED);
    assert_eq!(olusan.as_array().unwrap().len(), 1, "tek randevu bile dizi doner");

    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(hafta.as_array().unwrap().len(), 1);
    assert_eq!(hafta[0]["danisan_adi"], "Ayse");
}

#[tokio::test]
async fn tekrar_sayisi_verilince_seri_olusur() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;

    let (kod, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "tekrar_sayisi": 4
    }))).await;
    assert_eq!(kod, StatusCode::CREATED);
    assert_eq!(olusan.as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn gecersiz_tarih_400_doner() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;

    let (kod, json) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "07.09.2026 14:00", "bitis": "07.09.2026 15:00"
    }))).await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("Tarih"));
}

#[tokio::test]
async fn durum_guncellenir() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();

    let (kod, _) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}"), Some(json!({"durum":"geldi"}))).await;
    assert_eq!(kod, StatusCode::OK);

    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(hafta[0]["durum"], "geldi");
}

// Dal incelemesi C1: mevcut bir randevunun ucretini degistirmek KOPYA
// uretmemeli. En onemli assertion "ucret 50000 oldu" degil, "hafta hala
// TEK randevu iceriyor".
#[tokio::test]
async fn randevu_guncellenir_ve_kopya_uretmez() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "ucret": 45000
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();

    let (kod, guncel) = cagir(&s, "PUT", &format!("/api/randevular/{id}"), Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "ucret": 50000
    }))).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(guncel["id"].as_i64().unwrap(), id, "ayni kayit donmeli");

    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(
        hafta.as_array().unwrap().len(),
        1,
        "guncelleme KOPYA uretmemeli (dal incelemesi C1)"
    );
    assert_eq!(hafta[0]["ucret"], 50000);
}

// PATCH sozlesmesi PUT eklendikten sonra da AYNEN calisiyor: govdesi
// `{durum}` olan bir PATCH hala yalnizca durumu degistirir ve diger
// alanlara dokunmaz.
#[tokio::test]
async fn put_eklendikten_sonra_patch_durum_sozlesmesi_degismez() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "ucret": 45000
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();

    let (kod, _) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}"), Some(json!({"durum":"geldi"}))).await;
    assert_eq!(kod, StatusCode::OK);

    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(hafta[0]["durum"], "geldi");
    assert_eq!(hafta[0]["ucret"], 45000, "PATCH yalnizca durumu degistirmeli");
    assert_eq!(hafta[0]["baslangic"], "2026-09-07T14:00");
}

#[tokio::test]
async fn guncellemede_gecersiz_veri_400_doner() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();

    let (kod, json) = cagir(&s, "PUT", &format!("/api/randevular/{id}"), Some(json!({
        "client_id": cid, "baslangic": "07.09.2026 14:00", "bitis": "07.09.2026 15:00"
    }))).await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("Tarih"));
}

#[tokio::test]
async fn olmayan_randevunun_guncellenmesi_404_doner() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;

    let (kod, _) = cagir(&s, "PUT", "/api/randevular/9999", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cakisma_ucu_cakisanlari_dondurur() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;

    let (kod, sonuc) = cagir(
        &s, "GET",
        "/api/cakisma?baslangic=2026-09-07T14:30&bitis=2026-09-07T15:30", None,
    ).await;
    assert_eq!(kod, StatusCode::OK);
    // Dal incelemesi I2: yanit artik ciplak dizi degil, hafta sayisini da
    // tasiyan bir nesne (gerekce icin bkz. routes::appointments::cakisma).
    assert_eq!(sonuc["cakisanlar"].as_array().unwrap().len(), 1);
    assert_eq!(sonuc["cakisan_hafta_sayisi"], 1);
    assert_eq!(sonuc["kontrol_edilen_hafta"], 1);
}

// Dal incelemesi I2: seri kurarken cakisma kontrolu TUM haftalari
// kapsamali. Once tekrar_sayisi'siz cagri ILK HAFTAYI TEMIZ gorur (eski
// davranis), sonra tekrar_sayisi ile cagri cakismalari yakalar.
#[tokio::test]
async fn cakisma_ucu_tekrar_sayisiyla_tum_haftalari_kontrol_eder() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    // Yalnizca 3. ve 4. haftaya denk gelen iki randevu.
    for gun in ["2026-09-21", "2026-09-28"] {
        cagir(&s, "POST", "/api/randevular", Some(json!({
            "client_id": d["id"],
            "baslangic": format!("{gun}T14:00"),
            "bitis": format!("{gun}T15:00")
        }))).await;
    }

    let (_, tekil) = cagir(
        &s, "GET",
        "/api/cakisma?baslangic=2026-09-07T14:00&bitis=2026-09-07T15:00", None,
    ).await;
    assert_eq!(
        tekil["cakisanlar"].as_array().unwrap().len(),
        0,
        "ilk hafta gercekten temiz -- tekil kontrol uyarmaz"
    );

    let (kod, seri) = cagir(
        &s, "GET",
        "/api/cakisma?baslangic=2026-09-07T14:00&bitis=2026-09-07T15:00&tekrar_sayisi=6", None,
    ).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(seri["cakisan_hafta_sayisi"], 2, "3. ve 4. hafta cakismali");
    assert_eq!(seri["kontrol_edilen_hafta"], 6);
    assert_eq!(seri["cakisanlar"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn cakisma_ucu_gecersiz_tekrar_sayisini_400_ile_reddeder() {
    let (_d, s) = kurulu_state().await;
    let (kod, json) = cagir(
        &s, "GET",
        "/api/cakisma?baslangic=2026-09-07T14:00&bitis=2026-09-07T15:00&tekrar_sayisi=53", None,
    ).await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("Tekrar"));
}

// --- Uc baglayici kural (Plan 1'in son incelemesinden, brief disi) ---

// Kural 1: `Oturum::dokun()` her basarili istekte cagrilmali. Zamani
// `acik_baglanti_ile` uzerinden disaridan enjekte ederek test ediyoruz --
// `core::session::Oturum`'un kendi testlerindeki desenin aynisi -- hic
// gercekten beklemeden: bilinen bir `t` anindan oturumu manuel `ac()` ile
// acip, kilit suresinin cogu kadar ileri bir `Instant` ile basarili bir
// "istek" yap (dokun() tetiklenmeli), sonra yine kilit suresinin cogu kadar
// ileri bir `Instant` ile tekrar dene. dokun() cagrilmasaydi iki adimin
// TOPLAMI (3sn'ye denk) kilit suresini (2sn) asardi ve ikinci cagri
// Err(401) donerdi (bkz. Bulgu 2 -- onceki surum gercek zamanla 3sn
// calisiyordu).
#[tokio::test]
async fn basarili_istek_oturuma_dokunur_ve_sureyi_uzatir() {
    let (_d, s) = kurulu_state().await;

    let t = Instant::now();
    {
        let mut oturum = s.oturum.lock().unwrap();
        let anahtar = oturum.anahtar(t).expect("kurulumdan sonra oturum acik olmali");
        oturum.kilit_suresi_ayarla(2);
        // Bilinen bir `t` anindan yeniden ac: son_islem'i kesin olarak
        // biliyoruz, gercek saatin akisina bagli degiliz.
        oturum.ac(anahtar, t);
    }

    let orta = t + Duration::from_millis(1500);
    let sonuc1 = acik_baglanti_ile(&s, orta);
    assert!(sonuc1.is_ok(), "ilk istek kilit suresi dolmadan yapilmali");

    let sonra = orta + Duration::from_millis(1500);
    let sonuc2 = acik_baglanti_ile(&s, sonra);
    assert!(
        sonuc2.is_ok(),
        "basarili istek oturuma dokunmadiysa toplam 3sn gecmis olur ve 2sn'lik kilit suresi asilirdi"
    );
}

// Kural 2: kilit acmada `open_encrypted` degil "yoksa olusturma" davranisi
// gerekli. `veri.db` dosyasi silindiginde (kullanici yanlislikla sildi,
// senkronizasyon klasoru yuttu) istek sessizce basarili olup bos bir
// veritabani YARATMAMALI; anlasilir bir hata donmeli ve dosya olusmamali.
#[tokio::test]
async fn veri_db_silinmisse_sessizce_yeniden_olusturulmaz_ve_net_hata_doner() {
    let (_d, s) = kurulu_state().await;
    assert!(s.db_yolu().exists(), "test onkosulu: kurulumdan sonra veri.db var olmali");
    std::fs::remove_file(s.db_yolu()).unwrap();

    let (kod, json) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(
        kod,
        StatusCode::INTERNAL_SERVER_ERROR,
        "silinmis veritabani sessizce bos liste dondurmemeli, acikca 500 donmeli"
    );
    assert!(
        !s.db_yolu().exists(),
        "acik_baglanti dosyayi sessizce yeniden olusturmamali (open_existing kullanilmali)"
    );
    let hata = json["hata"].as_str().unwrap_or("").to_lowercase();
    assert!(
        hata.contains("yedek"),
        "hata mesaji kullaniciyi yedekten geri yuklemeye yonlendirmeli: {hata}"
    );
}

// Bulgu 1: yukaridaki kural veri uc noktalari (`guard::acik_baglanti`) icin
// zaten `open_existing` kullaniyordu ama giris kapisi -- `kilit-ac` -- hala
// `open_encrypted` kullaniyordu. Senaryo: kullanici `veri.db`'yi yanlislikla
// sildi (ya da senkronizasyon klasoru yuttu) ama `keystore.json` yerinde.
// Dogru parolayla kilit acma istegi geldiginde `open_encrypted` BOS bir
// veritabani YARATIYORDU -- `migrate()` bos semayi basariyla kuruyor,
// kullanici "kilit acildi" goruyor, hicbir hata almadan tum danisanlarinin
// kayboldugunu fark ediyordu. Bu test kilit-ac'in artik `open_existing`
// kullandigini, oturumu ACMADIGINI ve dosyayi sessizce YARATMADIGINI
// dogrular.
#[tokio::test]
async fn veri_db_silinmisken_kilit_ac_oturum_acmaz_ve_dosya_yaratmaz() {
    let (_d, s) = kurulu_state().await;
    assert!(s.db_yolu().exists(), "test onkosulu: kurulumdan sonra veri.db var olmali");
    assert!(s.keystore_yolu().exists(), "test onkosulu: keystore.json var olmali");

    // Oturumu kilitle, sonra veri.db'yi sil ama keystore.json'i birak --
    // tam olarak brief'teki senaryo (dosya kayboldu, anahtar yerinde).
    cagir(&s, "POST", "/api/kilitle", None).await;
    std::fs::remove_file(s.db_yolu()).unwrap();

    let (kod, json) =
        cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;

    assert_eq!(
        kod,
        StatusCode::INTERNAL_SERVER_ERROR,
        "dogru parolayla bile kilit acma basarili gorunmemeli"
    );
    assert!(
        !s.db_yolu().exists(),
        "kilit-ac dosyayi sessizce yeniden olusturmamali (open_existing kullanilmali)"
    );
    let hata = json["hata"].as_str().unwrap_or("").to_lowercase();
    assert!(
        hata.contains("yedek"),
        "hata mesaji \"parolaniz hatali\" DEMEMELI, yedekten geri yuklemeye yonlendirmeli: {hata}"
    );
    assert!(
        !hata.contains("parola"),
        "yanlis teshis kullaniciyi veriyi imha etmeye itmemeli -- \"parola\" kelimesi gecmemeli: {hata}"
    );

    // Oturum gercekten ACILMAMIS olmali: kilitliyken korunan bir uc noktaya
    // yapilan istek hala 401 vermeli.
    let (kod2, _) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(kod2, StatusCode::UNAUTHORIZED, "basarisiz kilit-ac oturumu ACMAMALI");
}

// Duzeltme turu, Bulgu (Important): `kilit_ac` yukarida `open_existing`
// kullanacak sekilde duzeltildi ama `kilitle` hala `open_encrypted`
// kullaniyordu (cikis kaydi icin). Zincir: kullanici veri.db'yi siler,
// "Kilitle"ye basar -> `kilitle` bos bir veri.db YARATIR -> kullanici dogru
// parolayla kilidi acar -> `kilit_ac`'in `open_existing` kontrolu artik
// dosyayi BULUR (cunku az once yaratildi) -> sorunsuz acilir -> kullanici
// bos bir veritabaniyla karsilasir, hicbir uyari almadan. Bu test `kilitle`
// cagrisinin veri.db yokken (a) 200 dondugunu, (b) oturumu gercekten
// kilitledigini ve (c) dosyayi YARATMADIGINI dogrular.
#[tokio::test]
async fn veri_db_silinmisken_kilitle_dosya_yaratmaz_ve_basarili_doner() {
    let (_d, s) = kurulu_state().await;
    assert!(s.db_yolu().exists(), "test onkosulu: kurulumdan sonra veri.db var olmali");
    std::fs::remove_file(s.db_yolu()).unwrap();

    let (kod, _json) = cagir(&s, "POST", "/api/kilitle", None).await;

    assert_eq!(
        kod,
        StatusCode::OK,
        "kilitle fail-open olmali: audit yazilamasa bile 200 donmeli"
    );
    assert!(
        !s.db_yolu().exists(),
        "kilitle cikis kaydi icin veri.db'yi sessizce yeniden olusturmamali (open_existing kullanilmali)"
    );

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kilitli"], true, "kilitle sonrasi oturum kilitli olmali");
}

// Kural 3: `/api` altinda bilinmeyen bir yol 404 donmeli, SPA fallback'ine
// (200 + HTML) dusmemeli -- aksi halde bir `fetch` yazim hatasi sessizce
// "basarili bos yanit" gibi gorunur.
#[tokio::test]
async fn bilinmeyen_api_yolu_404_doner() {
    let (_d, s) = kurulu_state().await;
    let (kod, json) = cagir(&s, "GET", "/api/boyle-bir-uc-nokta-yok", None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    assert!(json.get("hata").is_some(), "404 yaniti bir hata alani icermeli");
}

// `/api` disindaki bilinmeyen yollarin hala SPA'ya (arayuze) dusmesi gerekir
// -- Kural 3'un yalnizca `/api` altini etkiledigini, genel SPA geri
// donusunu bozmadigini dogrular.
#[tokio::test]
async fn api_disindaki_bilinmeyen_yol_hala_arayuze_duser() {
    let (_d, s) = kurulu_state().await;
    let istek = Request::builder()
        .method("GET")
        .uri("/boyle-bir-sayfa-yok")
        .body(Body::empty())
        .unwrap();
    let yanit = router(s.clone()).oneshot(istek).await.unwrap();
    assert_eq!(yanit.status(), StatusCode::OK, "API disi bilinmeyen yol SPA'ya dusmeli");
}
