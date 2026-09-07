use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState};

#[tokio::main]
async fn main() {
    let dizin = std::env::var("PSIKOLOG_VERI_DIZINI")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("psikolog-e2e"));
    let _ = std::fs::remove_dir_all(&dizin);

    let state = AppState::yeni(dizin, KdfParams::default());
    let dinleyici = tokio::net::TcpListener::bind("127.0.0.1:7700").await.unwrap();
    axum::serve(dinleyici, router(state)).await.unwrap();
}
