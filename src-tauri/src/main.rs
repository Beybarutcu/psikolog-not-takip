#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState, YEREL_ADRES};
use std::path::PathBuf;

fn veri_dizini() -> PathBuf {
    // macOS: ~/Library/Application Support/com.psikolog.notlar
    dirs::data_dir().expect("veri dizini bulunamadi").join("com.psikolog.notlar")
}

fn sunucuyu_baslat(veri_dizini: PathBuf) -> u16 {
    let dinleyici =
        std::net::TcpListener::bind(format!("{YEREL_ADRES}:0")).expect("port acilamadi");
    let port = dinleyici.local_addr().unwrap().port();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("calisma zamani kurulamadi");
        rt.block_on(async move {
            let state = AppState::yeni(veri_dizini, KdfParams::default());
            let dinleyici = tokio::net::TcpListener::from_std(dinleyici).unwrap();
            // Sunucu gorevi basarisiz olursa sessiz kalma: pencere acik ama
            // arkasinda API yoksa kullanici bos/donuk bir ekranla bas basa
            // kalir ve nedenini asla anlayamaz. Hatayi yazip sureci
            // sonlandirarak en azindan "uygulama acilmadi" gibi anlasilir
            // bir davranis elde edilir.
            if let Err(hata) = axum::serve(dinleyici, router(state)).await {
                eprintln!("Arka plan sunucusu basarisiz oldu, uygulama kapatiliyor: {hata}");
                std::process::exit(1);
            }
        });
    });

    port
}

fn main() {
    let port = sunucuyu_baslat(veri_dizini());
    let adres = format!("http://{YEREL_ADRES}:{port}");

    tauri::Builder::default()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "ana",
                tauri::WebviewUrl::External(adres.parse().unwrap()),
            )
            .title("Terapi Notlari")
            .inner_size(1280.0, 820.0)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("uygulama baslatilamadi");
}
