use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::guard::acik_baglanti_ile;
use psikolog_server::{router, AppState};
use serde_json::json;
use std::time::{Duration, Instant, SystemTime};
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

// --- Plan 2'den devredilen madde 2: arsivleme rotasi ------------------

#[tokio::test]
async fn danisan_arsivlenir_ve_listeden_dusser_ama_silinmez() {
    let (_d, s) = kurulu_state().await;
    let (_, a) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Mehmet"}))).await;
    let id = a["id"].as_i64().unwrap();

    let (kod, _) = cagir(&s, "POST", &format!("/api/danisanlar/{id}/arsivle"), None).await;
    assert_eq!(kod, StatusCode::OK);

    let (_, liste) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1, "arsivlenen danisan listede olmamali");
    assert_eq!(liste[0]["ad_soyad"], "Mehmet");

    // Arsivleme FIZIKSEL SILME DEGILDIR: kayit duruyor, yalnizca durumu
    // degisti. Arayuz metni de bunu soyluyor -- burada dogrulanan sey o
    // metnin dogru oldugudur.
    let conn = acik_baglanti_ile(&s, Instant::now(), SystemTime::now()).unwrap();
    let (sayi, durum): (i64, String) = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM clients), durum FROM clients WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(sayi, 2, "arsivleme satiri SILMEMELI");
    assert_eq!(durum, "arsiv");
}

#[tokio::test]
async fn arsivlenen_danisan_randevu_secim_listesinde_gorunmez() {
    // Devredilen maddenin somut sonucu: randevu acilir menusu sinirsiz
    // buyuyordu. Menu `GET /api/danisanlar` ile besleniyor.
    let (_d, s) = kurulu_state().await;
    let (_, a) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let id = a["id"].as_i64().unwrap();
    let (_, once) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(once.as_array().unwrap().len(), 1, "on kosul: danisan listede");

    cagir(&s, "POST", &format!("/api/danisanlar/{id}/arsivle"), None).await;

    let (_, sonra) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert!(sonra.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn olmayan_danisanin_arsivlenmesi_404_doner() {
    let (_d, s) = kurulu_state().await;
    let (kod, json) = cagir(&s, "POST", "/api/danisanlar/9999/arsivle", None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    assert!(json.get("hata").is_some());
}

// Kilitli oturum korumasi: arsivleme de `guard::acik_baglanti` kapisindan
// gecmeli. Bulgu 4 dersi geregi yalnizca 401'e degil, islemin GERCEKTEN
// uygulanmamis olduguna da bakiliyor.
#[tokio::test]
async fn kilitliyken_danisan_arsivleme_401_doner_ve_arsivlemez() {
    let (_d, s) = kurulu_state().await;
    let (_, a) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Gizli Danisan"}))).await;
    let id = a["id"].as_i64().unwrap();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "POST", &format!("/api/danisanlar/{id}/arsivle"), None).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("hata").is_some());
    assert!(
        !json.to_string().contains("Gizli Danisan"),
        "kilitliyken bilinen bir danisan adi govdede olmamali: {json}"
    );

    cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
    let (_, liste) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(
        liste.as_array().unwrap().len(),
        1,
        "kilitliyken yapilan arsivleme istegi uygulanmamis olmali"
    );
}

// --- Plan 2'den devredilen madde 1: ad/telefon dogrulamasi HTTP'de ----

#[tokio::test]
async fn gecersiz_telefon_400_ve_alani_adlandiran_mesaj_doner() {
    let (_d, s) = kurulu_state().await;
    let (kod, json) = cagir(
        &s, "POST", "/api/danisanlar",
        Some(json!({"ad_soyad":"Ayse","telefon":"asdfgh"})),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    // "Danisan eklenemedi" yeterli DEGIL: kullanici hangi alani duzeltecegini
    // bilmeli (bu kod tabaninda "her hata parola hatasidir" sinifi dort
    // katmanda ayri ayri bulundu).
    let mesaj = json["hata"].as_str().unwrap();
    assert!(mesaj.contains("Telefon"), "hata mesaji alani adlandirmali: {mesaj}");

    let (_, liste) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert!(liste.as_array().unwrap().is_empty(), "reddedilen kayit yazilmamis olmali");
}

#[tokio::test]
async fn gecerli_telefon_hala_kabul_edilir() {
    // Reddetme testinin ikizi: her seyi reddeden bir dogrulayici ustteki
    // testi de gecerdi.
    let (_d, s) = kurulu_state().await;
    let (kod, olusan) = cagir(
        &s, "POST", "/api/danisanlar",
        Some(json!({"ad_soyad":"Ayse","telefon":"+90 (212) 555 12 34"})),
    )
    .await;
    assert_eq!(kod, StatusCode::CREATED);
    assert_eq!(olusan["telefon"], "+90 (212) 555 12 34");
}

#[tokio::test]
async fn cok_uzun_ad_400_doner() {
    let (_d, s) = kurulu_state().await;
    let (kod, json) = cagir(
        &s, "POST", "/api/danisanlar",
        Some(json!({"ad_soyad": "a".repeat(200)})),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    let mesaj = json["hata"].as_str().unwrap();
    assert!(mesaj.contains("adı"), "hata mesaji alani adlandirmali: {mesaj}");
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

// Plan 7 Gorev 3: PATCH yaniti artik "geldi" isaretlemesinde guncellenen
// `son_temas`/`saklama_bitis`i (+ `client_id`) tasiyor -- istemci kartla
// saklama listesini bunlardan YEREL yamiyor, `clients::getir`/
// `saklama_suresi_dolanlar`i (ikisi de `HerCagri`) yeniden CEKMIYOR. Bu test
// olmasaydi onceki test (yalnizca haftalik listeyi kontrol eden) yanit govdesi
// hep `{}` donse de gecerdi.
#[tokio::test]
async fn durum_gelince_yanit_son_temas_ve_saklama_bitisini_tasir() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();

    let (kod, govde) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}"), Some(json!({"durum":"geldi"}))).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(govde["client_id"], cid);
    assert_eq!(govde["son_temas"], "2026-09-07");
    assert_eq!(govde["saklama_bitis"], "2033-09-07");
}

// Ters yon: "gelmedi" bir temas degil, yanit da bunu ic alanlar TASIMAYARAK
// soylemeli (`{}` -- istemci hicbir seyi yamamamali).
#[tokio::test]
async fn durum_gelmedi_olunca_yanitta_son_temas_alani_yok() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();

    let (kod, govde) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}"), Some(json!({"durum":"gelmedi"}))).await;
    assert_eq!(kod, StatusCode::OK);
    assert!(govde.get("son_temas").is_none(), "gelmedi bir temas degil: {govde}");
    assert!(govde.get("saklama_bitis").is_none(), "gelmedi bir temas degil: {govde}");
    assert!(govde.get("client_id").is_none(), "gelmedi bir temas degil: {govde}");
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

// Plan A Gorev 9 (tasarim A4): "geldi" seansi PUT ile tasininca son temas
// ilerleyebilir (`appointments::guncelle_ve_son_temas`). PATCH `durum`
// yanitiyla AYNI gerekce: istemci karti ve saklama listesini bu yanittan
// YEREL yamar, `clients::getir`/`saklama_suresi_dolanlar`i (ikisi de
// `HerCagri`) yeniden CEKMEZ. Yanit `Randevu` alanlarini AYNEN tasir (var
// olan istemci sekli bozulmaz), iki alan yalnizca GERCEKTEN ilerlediyse eklenir.
#[tokio::test]
async fn geldi_randevu_tasininca_yanit_son_temas_ve_saklama_bitisini_tasir() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "ucret": 45000
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();
    let (kod, _) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}"), Some(json!({"durum":"geldi"}))).await;
    assert_eq!(kod, StatusCode::OK, "on kosul: seans geldi isaretlendi");

    let (kod, yanit) = cagir(&s, "PUT", &format!("/api/randevular/{id}"), Some(json!({
        "client_id": cid, "baslangic": "2026-09-10T14:00", "bitis": "2026-09-10T15:00",
        "ucret": 45000
    }))).await;
    assert_eq!(kod, StatusCode::OK);
    // `Randevu` alanlari duz (flatten) -- ic ice bir `randevu` nesnesi degil.
    assert_eq!(yanit["id"].as_i64().unwrap(), id, "ayni kayit donmeli: {yanit}");
    assert_eq!(yanit["client_id"], cid);
    assert_eq!(yanit["baslangic"], "2026-09-10T14:00", "yanit YENI zamani tasimali");
    assert_eq!(yanit["durum"], "geldi", "tasima durumu korur");
    assert_eq!(yanit["son_temas"], "2026-09-10");
    assert_eq!(yanit["saklama_bitis"], "2033-09-10");
    assert!(yanit.get("randevu").is_none(), "Randevu duz olmali, ic ice degil: {yanit}");
}

// Ters yon: planli seans temas degil -- yanit bugunku `Randevu` sekliyle
// AYNI kalir, iki anahtar HIC yoktur (`null` degil). Istemci o zaman hicbir
// seyi yamamaz.
#[tokio::test]
async fn planli_randevu_tasininca_yanitta_son_temas_alani_yok() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();

    let (kod, yanit) = cagir(&s, "PUT", &format!("/api/randevular/{id}"), Some(json!({
        "client_id": cid, "baslangic": "2026-09-10T14:00", "bitis": "2026-09-10T15:00"
    }))).await;
    assert_eq!(kod, StatusCode::OK);
    // Pozitif bariyer: yanit gercekten dolu bir `Randevu` nesnesi (bos `{}`
    // ya da dizi uzerinde `get` totolojik olurdu, bkz. dosya basi Bulgu 4).
    assert_eq!(yanit["id"].as_i64().unwrap(), id, "ayni kayit donmeli: {yanit}");
    assert_eq!(yanit["baslangic"], "2026-09-10T14:00");
    assert!(yanit.get("son_temas").is_none(), "planli seans temas degil: {yanit}");
    assert!(yanit.get("saklama_bitis").is_none(), "planli seans temas degil: {yanit}");
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

// --- Plan 4 Gorev 1: odeme isaretleme (`PATCH /randevular/{id}/odeme`) ---
//
// Odeme AYRI bir yol: `PATCH /randevular/{id} {durum}` sozlesmesine dokunulmaz
// (bkz. yukaridaki `put_eklendikten_sonra_patch_durum_sozlesmesi_degismez`).

async fn odeme_icin_randevu(s: &AppState) -> i64 {
    let (_, d) = cagir(s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let (_, olusan) = cagir(s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "ucret": 45000
    }))).await;
    olusan[0]["id"].as_i64().unwrap()
}

async fn hafta_getir(s: &AppState) -> serde_json::Value {
    let (kod, hafta) = cagir(
        s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(kod, StatusCode::OK);
    hafta
}

#[tokio::test]
async fn odeme_isaretlenir_ve_geri_alinir_http() {
    let (_d, s) = kurulu_state().await;
    let id = odeme_icin_randevu(&s).await;
    assert_eq!(hafta_getir(&s).await[0]["odendi"], false, "on kosul: odenmemis");

    let (kod, _) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}/odeme"), Some(json!({"odendi":true}))).await;
    assert_eq!(kod, StatusCode::NO_CONTENT);
    let hafta = hafta_getir(&s).await;
    assert_eq!(hafta.as_array().unwrap().len(), 1, "odeme kopya uretmemeli");
    assert_eq!(hafta[0]["odendi"], true);
    assert_eq!(hafta[0]["durum"], "planlandi", "odeme durumu degistirmemeli");
    assert_eq!(hafta[0]["ucret"], 45000, "odeme ucreti degistirmemeli");

    // Iki yon: geri alma da yazilmali.
    let (kod, _) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}/odeme"), Some(json!({"odendi":false}))).await;
    assert_eq!(kod, StatusCode::NO_CONTENT);
    assert_eq!(hafta_getir(&s).await[0]["odendi"], false, "geri alma da uygulanmali");
}

#[tokio::test]
async fn olmayan_randevuya_odeme_404_doner() {
    let (_d, s) = kurulu_state().await;
    let (kod, json) =
        cagir(&s, "PATCH", "/api/randevular/999999/odeme", Some(json!({"odendi":true}))).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    // Rota yokken de 404 + `hata` donerdi (`api_bulunamadi` fallback'i); bu
    // yuzden mesaj, depo esleme yolunu (`DepoHatasi::Bulunamadi`) ayirt eder.
    assert_eq!(
        json["hata"], "Kayıt bulunamadı.",
        "404 depo eslemesinden gelmeli, bilinmeyen-yol fallback'inden degil: {json}"
    );
}

#[tokio::test]
async fn kilitliyken_odeme_401_doner_ve_isaretlemez() {
    let (_d, s) = kurulu_state().await;
    let id = odeme_icin_randevu(&s).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}/odeme"), Some(json!({"odendi":true}))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("hata").is_some());
    let govde = json.to_string();
    assert!(
        !govde.contains("Ayse") && !govde.contains("45000") && !govde.contains("odendi"),
        "kilitliyken govdede veri olmamali: {govde}"
    );

    cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
    let hafta = hafta_getir(&s).await;
    assert_eq!(hafta.as_array().unwrap().len(), 1);
    assert_eq!(
        hafta[0]["odendi"], false,
        "kilitliyken yapilan odeme isaretlemesi uygulanmamis olmali"
    );
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

// --- Dal incelemesi I4a: seri silme rotasi ---------------------------

async fn seri_kur(s: &AppState) -> (i64, String) {
    let (_, d) = cagir(s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();
    let (_, olusan) = cagir(s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "tekrar_sayisi": 4
    }))).await;
    let seri_id = olusan[0]["seri_id"].as_str().unwrap().to_string();
    (cid, seri_id)
}

#[tokio::test]
async fn seri_adedi_silinecek_sayiyi_verir_ve_silmez() {
    let (_d, s) = kurulu_state().await;
    let (_cid, sid) = seri_kur(&s).await;

    let (kod, json) = cagir(
        &s, "GET",
        &format!("/api/randevular/seri/{sid}?bu_tarihten_itibaren=2026-09-21T00:00"), None,
    ).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(json["adet"], 2, "21 ve 28 Eylul silinecek, gecmis korunacak");

    let (_, hepsi) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-01T00:00&bitis=2026-10-01T00:00", None,
    ).await;
    assert_eq!(hepsi.as_array().unwrap().len(), 4, "sayim hicbir sey silmemeli");
}

#[tokio::test]
async fn seri_silinir_ve_gecmis_korunur() {
    let (_d, s) = kurulu_state().await;
    let (_cid, sid) = seri_kur(&s).await;

    let (kod, json) = cagir(
        &s, "DELETE",
        &format!("/api/randevular/seri/{sid}?bu_tarihten_itibaren=2026-09-21T00:00"), None,
    ).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(json["silinen"], 2);

    let (_, kalan) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-01T00:00&bitis=2026-10-01T00:00", None,
    ).await;
    assert_eq!(kalan.as_array().unwrap().len(), 2, "gecmis randevular silinmemeli");
    assert_eq!(kalan[0]["baslangic"], "2026-09-07T14:00");
    assert_eq!(kalan[1]["baslangic"], "2026-09-14T14:00");
}

#[tokio::test]
async fn olmayan_seriyi_silme_404_doner_ve_log_yazmaz() {
    // Cekirdek `DepoHatasi::Bulunamadi` donduruyor; bu ESLEMENIN rota
    // seviyesinde testi yoktu -- `depo_hatasi` eslemesi degisirse sessizce
    // 200'e donebilirdi ve "sildim" diyen bir yanitin arkasinda hicbir silme
    // olmazdi. Ayrica 0 satir silen bir istek SILINEMEZ bir log satiri
    // birakmamali (disaridan tetiklenebilir gurultu yolu).
    let (_d, s) = kurulu_state().await;
    let (_cid, _sid) = seri_kur(&s).await;

    let (kod, json) = cagir(
        &s, "DELETE",
        "/api/randevular/seri/boyle-bir-seri-yok?bu_tarihten_itibaren=2026-09-01T00:00", None,
    ).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    assert!(json.get("silinen").is_none(), "silme olmadi, sonuc donmemeli");

    let (_, kalan) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-01T00:00&bitis=2026-10-01T00:00", None,
    ).await;
    assert_eq!(kalan.as_array().unwrap().len(), 4, "var olan seri etkilenmemeli");
}

#[tokio::test]
async fn kilitliyken_seri_silme_401_doner_ve_silmez() {
    let (_d, s) = kurulu_state().await;
    let (_cid, sid) = seri_kur(&s).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(
        &s, "DELETE",
        &format!("/api/randevular/seri/{sid}?bu_tarihten_itibaren=2026-09-01T00:00"), None,
    ).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("silinen").is_none(), "kilitliyken silme sonucu donmemeli");

    cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
    let (_, kalan) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-01T00:00&bitis=2026-10-01T00:00", None,
    ).await;
    assert_eq!(
        kalan.as_array().unwrap().len(),
        4,
        "kilitliyken yapilan seri silme istegi uygulanmamis olmali"
    );
}

#[tokio::test]
async fn kilitliyken_seri_adedi_401_doner() {
    let (_d, s) = kurulu_state().await;
    let (_cid, sid) = seri_kur(&s).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(
        &s, "GET",
        &format!("/api/randevular/seri/{sid}?bu_tarihten_itibaren=2026-09-01T00:00"), None,
    ).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("adet").is_none(), "kilitliyken adet donmemeli");
}

#[tokio::test]
async fn seri_silmede_gecersiz_tarih_400_doner() {
    let (_d, s) = kurulu_state().await;
    let (_cid, sid) = seri_kur(&s).await;

    let (kod, json) = cagir(
        &s, "DELETE",
        &format!("/api/randevular/seri/{sid}?bu_tarihten_itibaren=01.09.2026"), None,
    ).await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("Tarih"));
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
    let td = SystemTime::now();
    {
        let mut oturum = s.oturum.lock().unwrap();
        let anahtar =
            oturum.anahtar(t, td).expect("kurulumdan sonra oturum acik olmali");
        oturum.kilit_suresi_ayarla(2);
        // Bilinen bir `t`/`td` anindan yeniden ac: son_islem'i kesin olarak
        // biliyoruz, gercek saatin akisina bagli degiliz. Ikisi (monotonik +
        // duvar) birlikte ayni miktarda ilerletiliyor ki bu test yalnizca
        // "dokun cagrildi mi" kuralini olcsun (bkz. `core::session::Oturum`
        // - uyku/duvar saati bulgusu bu testin konusu degil).
        oturum.ac(anahtar, t, td);
    }

    let orta = t + Duration::from_millis(1500);
    let orta_td = td + Duration::from_millis(1500);
    let sonuc1 = acik_baglanti_ile(&s, orta, orta_td);
    assert!(sonuc1.is_ok(), "ilk istek kilit suresi dolmadan yapilmali");

    let sonra = orta + Duration::from_millis(1500);
    let sonra_td = orta_td + Duration::from_millis(1500);
    let sonuc2 = acik_baglanti_ile(&s, sonra, sonra_td);
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

// =====================================================================
// DAL INCELEMESI I2 -- CASCADE SILINEN NOTLARIN ONIZLEMESI
// =====================================================================
//
// Bulgu: `progress_notes` / `private_notes` `ON DELETE CASCADE` tasiyor;
// randevu silinince notlar da gidiyordu ve onay metni bundan hic soz
// etmiyordu. Onay metninin sayiyi soyleyebilmesi icin sunucuya sormasi
// gerekiyor -- 52 haftalik bir serinin notlari ekrandaki haftanin cok
// otesinde olabilir.

/// Bir randevuya resmi + ozel not yazar.
async fn iki_not_yaz(s: &AppState, randevu_id: i64) {
    let (k1, _) = cagir(
        s,
        "PUT",
        &format!("/api/randevular/{randevu_id}/not"),
        Some(json!({"sablon":"dap","icerik":"seans notu"})),
    )
    .await;
    assert_eq!(k1, StatusCode::OK, "kurulum: resmi not yazilmali");
    let (k2, _) = cagir(
        s,
        "PUT",
        &format!("/api/randevular/{randevu_id}/ozel-not"),
        Some(json!({"icerik":"ozel not"})),
    )
    .await;
    assert_eq!(k2, StatusCode::OK, "kurulum: ozel not yazilmali");
}

#[tokio::test]
async fn silinecekler_not_sayisini_verir_ve_hicbir_sey_degistirmez() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();

    // ARTI YON once: notsuz randevu 0 verir. "Hep 2 don" diyen bir uygulama
    // asagidaki iddiayi tek basina gecerdi.
    let (kod, json) = cagir(&s, "GET", &format!("/api/randevular/{id}/silinecekler"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(json["not_adedi"], 0);

    iki_not_yaz(&s, id).await;

    let (_, json) = cagir(&s, "GET", &format!("/api/randevular/{id}/silinecekler"), None).await;
    assert_eq!(json["not_adedi"], 2, "resmi + ozel not sayilmali");

    // Onizleme HICBIR SEY silmedi: randevu ve notu yerinde.
    let (kod, not) = cagir(&s, "GET", &format!("/api/randevular/{id}/not"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(not["icerik"], "seans notu");
}

#[tokio::test]
async fn silinecekler_not_icerigini_dondurmez() {
    // Onizleme bir SAYI ucudur. Not metnini dondurseydi, onay kutusunu
    // hazirlamak icin danisan verisi ekrana/bellege gelmis olurdu.
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{id}/not"),
        Some(json!({"sablon":"dap","icerik":"GIZLI_NOT_ICERIGI"})),
    )
    .await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{id}/ozel-not"),
        Some(json!({"icerik":"GIZLI_OZEL_ICERIGI"})),
    )
    .await;

    let (_, json) = cagir(&s, "GET", &format!("/api/randevular/{id}/silinecekler"), None).await;
    let metin = json.to_string();
    assert!(!metin.contains("GIZLI_NOT_ICERIGI"), "not icerigi donmemeli: {metin}");
    assert!(!metin.contains("GIZLI_OZEL_ICERIGI"), "ozel not icerigi donmemeli: {metin}");
    assert_eq!(json["not_adedi"], 2);
}

#[tokio::test]
async fn kilitliyken_silinecekler_401_doner() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();
    iki_not_yaz(&s, id).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "GET", &format!("/api/randevular/{id}/silinecekler"), None).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("not_adedi").is_none(), "kilitliyken sayi donmemeli");
}

#[tokio::test]
async fn seri_adedi_silinecek_not_sayisini_da_verir() {
    let (_d, s) = kurulu_state().await;
    let (_cid, sid) = seri_kur(&s).await;

    // Serinin tum uyelerini bul, son ikisine not yaz.
    let (_, hepsi) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-01T00:00&bitis=2026-10-01T00:00", None,
    ).await;
    let uyeler = hepsi.as_array().unwrap();
    assert_eq!(uyeler.len(), 4, "on kosul: dort haftalik seri");
    // 07, 14, 21, 28 Eylul. Ilk (07) ve son (28) uyeye not yaz: kesme
    // gercekten calisiyorsa yalnizca 28'inki sayilir.
    iki_not_yaz(&s, uyeler[0]["id"].as_i64().unwrap()).await;
    iki_not_yaz(&s, uyeler[3]["id"].as_i64().unwrap()).await;

    let (kod, json) = cagir(
        &s, "GET",
        &format!("/api/randevular/seri/{sid}?bu_tarihten_itibaren=2026-09-21T00:00"), None,
    ).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(json["adet"], 2, "21 ve 28 Eylul silinecek");
    assert_eq!(
        json["not_adedi"], 2,
        "yalnizca 28 Eylul'un iki notu sayilmali -- 07 Eylul silinmiyor"
    );

    // Kesme geriye alininca dort not birden sayilir: sayi gercekten tarihe bagli.
    let (_, json) = cagir(
        &s, "GET",
        &format!("/api/randevular/seri/{sid}?bu_tarihten_itibaren=2026-09-01T00:00"), None,
    ).await;
    assert_eq!(json["adet"], 4);
    assert_eq!(json["not_adedi"], 4);
}

#[tokio::test]
async fn seri_silme_gelecek_uyelerin_notlarini_da_siler() {
    // Cascade davranisini HTTP seviyesinde sabitler: silinen uyenin notu
    // artik okunamaz, KORUNAN uyenin notu yerinde.
    let (_d, s) = kurulu_state().await;
    let (_cid, sid) = seri_kur(&s).await;
    let (_, hepsi) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-01T00:00&bitis=2026-10-01T00:00", None,
    ).await;
    let uyeler = hepsi.as_array().unwrap().clone();
    let korunan = uyeler[0]["id"].as_i64().unwrap();
    let silinen_id = uyeler[3]["id"].as_i64().unwrap();
    iki_not_yaz(&s, korunan).await;
    iki_not_yaz(&s, silinen_id).await;

    let (kod, _) = cagir(
        &s, "DELETE",
        &format!("/api/randevular/seri/{sid}?bu_tarihten_itibaren=2026-09-21T00:00"), None,
    ).await;
    assert_eq!(kod, StatusCode::OK);

    // Silinen uyenin randevusu yok -> notu da yok (404).
    let (kod, _) = cagir(&s, "GET", &format!("/api/randevular/{silinen_id}/not"), None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND, "silinen uyenin notu okunamamali");
    // Korunan uyenin notu YERINDE: "gecmis randevular silinmez" sozu
    // notlar icin de gecerli.
    let (kod, not) = cagir(&s, "GET", &format!("/api/randevular/{korunan}/not"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(not["icerik"], "seans notu");
}

// --- Plan 4 Gorev 3: ay sonu ozeti (`GET /api/ay-ozeti?ay=YYYY-AA`) ---
//
// Sayim kurallarinin kendisi cekirdekte (`store::ozet::tests`) sabit; burada
// HTTP sozlesmesi olculur: alanlar, iki farkli 400 yolu ve kilit kapisi.
// Bilinmeyen yollar da `{hata}` dondugu icin (bkz. `api_bulunamadi`) her
// hata testinde MESAJ da dogrulanir.

async fn ozet_icin_borclu(s: &AppState) -> i64 {
    let (_, d) =
        cagir(s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ozet Borclusu"}))).await;
    let cid = d["id"].as_i64().unwrap();
    let (_, olusan) = cagir(s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "ucret": 45000
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();
    let (kod, _) =
        cagir(s, "PATCH", &format!("/api/randevular/{id}"), Some(json!({"durum":"geldi"}))).await;
    assert_eq!(kod, StatusCode::OK, "on kosul: durum geldi olmali");
    cid
}

async fn ozet_log_satirlari(s: &AppState) -> Vec<String> {
    let conn = acik_baglanti_ile(s, Instant::now(), SystemTime::now()).expect("oturum acik olmali");
    psikolog_core::store::audit::son_kayitlar(&conn, 200)
        .unwrap()
        .into_iter()
        .filter(|k| k.varlik == "ozet")
        .map(|k| format!("{}|{}", k.eylem, k.varlik_id))
        .collect()
}

#[tokio::test]
async fn ay_ozeti_200_ve_tum_alanlar_doner() {
    let (_d, s) = kurulu_state().await;
    let cid = ozet_icin_borclu(&s).await;

    let (kod, json) = cagir(&s, "GET", "/api/ay-ozeti?ay=2026-09", None).await;
    assert_eq!(kod, StatusCode::OK, "{json}");
    assert_eq!(
        json,
        json!({
            "ay": "2026-09",
            "seans_sayisi": 1,
            "tahsilat_kurus": 0,
            "bekleyen_kurus": 45000,
            "borclular": [
                {"client_id": cid, "ad_soyad": "Ozet Borclusu", "borc_kurus": 45000, "seans_sayisi": 1}
            ]
        })
    );
    assert_eq!(ozet_log_satirlari(&s).await, ["goruntuleme|ay:2026-09"]);

    // Baska bir ay: bos ozet, ama yine 200 ve yine gorunur alanlar.
    let (kod, bos) = cagir(&s, "GET", "/api/ay-ozeti?ay=2026-10", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(bos["seans_sayisi"], 0);
    assert_eq!(bos["borclular"], json!([]));
}

#[tokio::test]
async fn ay_ozeti_gecersiz_ay_400_ve_cekirdek_mesaji() {
    let (_d, s) = kurulu_state().await;
    let (kod, json) = cagir(&s, "GET", "/api/ay-ozeti?ay=2026-13", None).await;
    assert_eq!(kod, StatusCode::BAD_REQUEST, "{json}");
    assert_eq!(
        json["hata"], "Ay YYYY-AA biçiminde olmalı.",
        "400 cekirdegin dogrulamasindan gelmeli: {json}"
    );
    assert!(ozet_log_satirlari(&s).await.is_empty(), "gecersiz ay log yazmamali");
}

#[tokio::test]
async fn ay_ozeti_ay_parametresi_yoksa_turkce_json_400() {
    let (_d, s) = kurulu_state().await;
    let (kod, json) = cagir(&s, "GET", "/api/ay-ozeti", None).await;
    assert_eq!(kod, StatusCode::BAD_REQUEST, "{json}");
    assert_eq!(
        json["hata"], "Sorgu parametreleri eksik veya geçersiz.",
        "eksik parametre `guard::Sorgu` reddinden gelmeli: {json}"
    );
}

#[tokio::test]
async fn kilitliyken_ay_ozeti_401_doner_veri_ve_log_yok() {
    let (_d, s) = kurulu_state().await;
    ozet_icin_borclu(&s).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "GET", "/api/ay-ozeti?ay=2026-09", None).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("hata").is_some(), "{json}");
    let govde = json.to_string();
    assert!(
        !govde.contains("Ozet Borclusu") && !govde.contains("45000") && !govde.contains("borclular"),
        "kilitliyken govdede veri olmamali: {govde}"
    );

    cagir(&s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
    assert!(
        ozet_log_satirlari(&s).await.is_empty(),
        "kilitliyken istek goruntuleme satiri birakmamali"
    );
}
