pub mod assets;
pub mod routes;
pub mod state;

pub use state::AppState;

use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Router,
};

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

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/durum", get(routes::session::durum))
        .route("/api/kurulum", post(routes::setup::kurulum))
        .route("/api/kilit-ac", post(routes::session::kilit_ac))
        .route("/api/kilitle", post(routes::session::kilitle))
        // API rotalari eslesmezse arayuz sunulur (SPA geri donusu).
        .fallback(assets::statik)
        // Tum yanitlara (statik varliklar + API) CSP basligini ekleyen tek katman.
        .layer(middleware::from_fn(csp_basligi_ekle))
        .with_state(state)
}
