pub mod assets;
pub mod guard;
pub mod routes;
pub mod state;

pub use state::AppState;

use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};

/// Sunucunun baglanacagi yerel adres. Sadece bu makineden erisim icin
/// `127.0.0.1` kullanilmali; `0.0.0.0` veya `::` (ya da bir ortam
/// degiskeninden gelen, denetlenmemis bir adres) ASLA kullanilmamali --
/// bunlar, diskte sifreli tutulan danisan seans notlarina hizmet eden
/// API'yi ayni ag/Wi-Fi uzerindeki diger cihazlara acar (saglik verisi
/// sizintisi riski).
pub const YEREL_ADRES: &str = "127.0.0.1";

/// Icerik Guvenlik Politikasi (CSP) basligi. `src-tauri/tauri.conf.json`
/// icindeki `app.security.csp` ile AYNI olmali -- Tauri'nin CSP enjeksiyonu
/// yalnizca kendi ozel protokoluyle sunulan icerige uygulaniyor; bu pencere
/// `WebviewUrl::External("http://127.0.0.1:<port>")` ile acildigi icin
/// politika sunucu tarafindan da fiilen zorlanmali.
const CSP_POLITIKASI: &str = "default-src 'self'; style-src 'self' 'unsafe-inline'";

async fn csp_basligi_ekle(istek: Request<Body>, next: Next) -> Response {
    let mut yanit = next.run(istek).await;
    yanit.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CSP_POLITIKASI),
    );
    yanit
}

/// `/api` altında hiçbir rotayla eşleşmeyen bir yol için 404 döner.
///
/// `assets::statik` (genel SPA geri dönüşü) yalnızca `/api` DIŞINDAKİ
/// bilinmeyen yollara uygulanır -- bu ayrı fallback olmasaydı `/api`
/// köküne `.fallback(assets::statik)` uygulanır ve `/api/yanlisyol` gibi bir
/// yazım hatası içeren bir `fetch` sessizce `200` + HTML dönerdi; arayüz
/// bunu hatasız "boş nesne" gibi yorumlar, hiçbir hata fırlatmazdı (bkz.
/// Plan 1'in son incelemesinden Kural 3). Plan 2 sekizden fazla yeni uç
/// nokta eklediği için bu artık gerçek bir risk.
async fn api_bulunamadi() -> (StatusCode, Json<Value>) {
    (StatusCode::NOT_FOUND, Json(json!({ "hata": "Bilinmeyen API yolu." })))
}

fn api_router() -> Router<AppState> {
    Router::new()
        .route("/durum", get(routes::session::durum))
        .route("/kurulum", post(routes::setup::kurulum))
        .route("/kilit-ac", post(routes::session::kilit_ac))
        .route("/kilitle", post(routes::session::kilitle))
        .route("/danisanlar", get(routes::clients::liste).post(routes::clients::olustur))
        // Arşivleme ayrı bir yol segmentinde ve `POST`: yumuşak silmedir,
        // `DELETE` değildir (gerekçe için bkz. `routes::clients::arsivle_uc`).
        // Görev 7'nin ekleyeceği `/danisanlar/{id}` ile çakışmaz -- bu üç
        // segmentli.
        .route("/danisanlar/{id}/arsivle", post(routes::clients::arsivle_uc))
        .route(
            "/randevular",
            get(routes::appointments::liste).post(routes::appointments::olustur),
        )
        .route(
            "/randevular/{id}",
            // PATCH: yalnizca `{durum}` (Gorev 11'den beri degismeyen
            // sozlesme). PUT: alan guncelleme (danisan/saat/ucret) --
            // gerekce icin bkz. `routes::appointments::guncelle`.
            axum::routing::patch(routes::appointments::durum)
                .put(routes::appointments::guncelle)
                .delete(routes::appointments::kaldir),
        )
        // Seri islemleri ayri bir yol segmentinde: `/randevular/{id}` iki
        // segmentli, bu uc segmentli -- cakisma yok.
        .route(
            "/randevular/seri/{seri_id}",
            get(routes::appointments::seri_adedi)
                .delete(routes::appointments::seri_kaldir),
        )
        .route("/cakisma", get(routes::appointments::cakisma))
        .fallback(api_bulunamadi)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/api", api_router())
        // API disindaki (ve /api altinda eslesmeyen degil, hic /api ile
        // baslamayan) yollar icin arayuz sunulur (SPA geri donusu).
        .fallback(assets::statik)
        // Tum yanitlara (statik varliklar + API) CSP basligini ekleyen tek katman.
        .layer(middleware::from_fn(csp_basligi_ekle))
        .with_state(state)
}
