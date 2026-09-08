use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState};
use serde_json::json;
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

#[tokio::test]
async fn kilitliyken_danisan_listesi_401_doner() {
    let (_d, s) = kurulu_state().await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("danisanlar").is_none(), "kilitliyken veri sizmamalı");
}

#[tokio::test]
async fn kilitliyken_randevu_listesi_401_doner() {
    let (_d, s) = kurulu_state().await;
    cagir(&s, "POST", "/api/kilitle", None).await;
    let (kod, _) =
        cagir(&s, "GET", "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None)
            .await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
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

#[tokio::test]
async fn cakisma_ucu_cakisanlari_dondurur() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;

    let (kod, cakisanlar) = cagir(
        &s, "GET",
        "/api/cakisma?baslangic=2026-09-07T14:30&bitis=2026-09-07T15:30", None,
    ).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(cakisanlar.as_array().unwrap().len(), 1);
}

// --- Uc baglayici kural (Plan 1'in son incelemesinden, brief disi) ---

// Kural 1: `Oturum::dokun()` her basarili istekte cagrilmali. Kilit suresini
// kisa tutup GERCEK zamanla test ediyoruz (Instant::now() HTTP katmaninda
// disaridan enjekte edilemiyor): kilit suresinin cogu kadar bekle, basarili
// bir istek yap (dokun() tetiklenmeli), tekrar kilit suresinin cogu kadar
// bekle. dokun() cagrilmasaydi toplam gecen sure (iki bekleme toplami) kilit
// suresini asardi ve ikinci istek 401 alirdi.
#[tokio::test]
async fn basarili_istek_oturuma_dokunur_ve_sureyi_uzatir() {
    let (_d, s) = kurulu_state().await;
    s.oturum.lock().unwrap().kilit_suresi_ayarla(2);

    std::thread::sleep(std::time::Duration::from_millis(1500));
    let (kod1, _) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(kod1, StatusCode::OK, "ilk istek kilit suresi dolmadan yapilmali");

    std::thread::sleep(std::time::Duration::from_millis(1500));
    let (kod2, _) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(
        kod2,
        StatusCode::OK,
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
    assert_ne!(kod, StatusCode::OK, "silinmis veritabani sessizce bos liste dondurmemeli");
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
