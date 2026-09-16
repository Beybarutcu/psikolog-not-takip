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

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    /// `core`'un PDF'e gömdüğü her font dosyası (`include_bytes!` ile
    /// `assets/fonts/` altından), `core/`'a göre yol.
    fn gomulu_fontlar(tauri_dizini: &Path) -> Vec<PathBuf> {
        let pdf = tauri_dizini.join("../core/src/pdf.rs");
        let kaynak = std::fs::read_to_string(&pdf)
            .unwrap_or_else(|e| panic!("{} okunamadi: {e}", pdf.display()));
        kaynak
            .match_indices("include_bytes!(\"")
            .filter_map(|(i, isaret)| {
                let yol = &kaynak[i + isaret.len()..];
                let yol = &yol[..yol.find('"')?];
                yol.contains("assets/fonts/").then(|| tauri_dizini.join("../core/src").join(yol))
            })
            .collect()
    }

    /// Gömülü fontun lisansı dağıtımla birlikte gider (dal incelemesi M4,
    /// sürüm engelleyici).
    ///
    /// Noto Sans SIL OFL 1.1 ile dağıtılır; OFL, fontun gömülü olduğu
    /// yazılımla birlikte lisans metninin de dağıtılmasını ister. Metin
    /// `core/assets/fonts/OFL.txt`'de duruyordu ama uygulama paketine
    /// girmiyordu — yalnızca `pdf.rs`'teki bir yorum onu anıyordu (biçim 13:
    /// koşul yorumda yaşıyordu). Artık: `core` bir font GÖMDÜKÇE, o fontun
    /// dizinindeki `OFL.txt` `tauri.conf.json` `bundle.resources`'ta bir
    /// hedefe eşlenmiş olmalı.
    ///
    /// Sınır: paketleme (dmg) macOS CI'da; burada yapılandırmanın içeriği
    /// ve kaynak dosyanın varlığı doğrulanır. `tauri-build` derleme sırasında
    /// kaynağı `target/<profil>/` altına kopyalar, yol yanlışsa derleme kırılır.
    #[test]
    fn gomulu_fontun_ofl_lisansi_bundle_kaynaklarinda() {
        let tauri_dizini = Path::new(env!("CARGO_MANIFEST_DIR"));
        let fontlar = gomulu_fontlar(tauri_dizini);
        // ON KOSUL: tarama gercekten gomulu fontu buluyor; yoksa asagidaki
        // "her fontun lisansi" iddiasi bos kume uzerinde saglanirdi.
        assert!(!fontlar.is_empty(), "core/src/pdf.rs'te gomulu font bulunamadi");

        let conf: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(tauri_dizini.join("tauri.conf.json"))
                .expect("tauri.conf.json okunamadi"),
        )
        .expect("tauri.conf.json gecerli JSON degil");
        let kaynaklar = conf["bundle"]["resources"]
            .as_object()
            .expect("bundle.resources kaynak->hedef eslemesi (nesne) olmali");

        for font in fontlar {
            assert!(font.is_file(), "gomulu font diskte yok: {}", font.display());
            let lisans = font.parent().unwrap().join("OFL.txt");
            let lisans = lisans
                .canonicalize()
                .unwrap_or_else(|e| panic!("{} yok: {e}", lisans.display()));
            let hedef = kaynaklar.iter().find_map(|(kaynak, hedef)| {
                (tauri_dizini.join(kaynak).canonicalize().ok()? == lisans).then_some(hedef)
            });
            let hedef = hedef.and_then(|h| h.as_str()).unwrap_or_else(|| {
                panic!(
                    "{} gomulu ama lisansi ({}) bundle.resources'ta yok: {kaynaklar:?}",
                    font.display(),
                    lisans.display()
                )
            });
            assert!(
                hedef.starts_with("lisanslar/") && hedef.ends_with(".txt"),
                "lisans paket icinde lisanslar/ altina metin olarak gitmeli: {hedef}"
            );
        }
    }
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
