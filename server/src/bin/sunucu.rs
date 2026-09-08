use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState, YEREL_ADRES};
use std::path::{Path, PathBuf};

/// Verilen yolun guvenle (geri donusumsuz olarak) silinip silinemeyecegini
/// bildirir. Bu ikili yalnizca test/e2e amaclidir ve baslarken kendi veri
/// dizinini `remove_dir_all` ile temizler; bu fonksiyon o silmenin sistemin
/// gecici dizini disina -- ozellikle gercek/uretim veri dizinine -- tasmasini
/// engeller.
///
/// Kurallar:
/// - Yol, sistemin gecici dizini (`std::env::temp_dir()`) ALTINDA degilse: false.
/// - Yol, gecici dizinin KENDISIYSE (alt dizini degil): false -- gecici
///   dizinin tamamini silmek de kabul edilemez.
/// - Mumkunse her iki yol da `canonicalize` edilip oyle karsilastirilir;
///   biri (genellikle henuz var olmayan hedef dizin) canonicalize
///   edilemiyorsa, tutarsiz bir karsilastirmadan kacinmak icin ikisi de ham
///   (canonicalize edilmemis) haliyle karsilastirilir.
pub fn silinebilir_mi(yol: &Path) -> bool {
    let gecici = std::env::temp_dir();

    let (yol_k, gecici_k) = match (yol.canonicalize(), gecici.canonicalize()) {
        (Ok(y), Ok(g)) => (y, g),
        _ => (yol.to_path_buf(), gecici),
    };

    yol_k != gecici_k && yol_k.starts_with(&gecici_k)
}

#[tokio::main]
async fn main() {
    let dizin = std::env::var("PSIKOLOG_VERI_DIZINI")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("psikolog-e2e"));

    if !silinebilir_mi(&dizin) {
        eprintln!(
            "PSIKOLOG_VERI_DIZINI ('{}') sistem gecici dizininin ('{}') altinda \
             degil (ya da gecici dizinin kendisi). Bu test yardimcisi baslangicta \
             veri dizinini geri donusumsuz olarak siler; guvenlik icin, gecici \
             dizin disindaki bir yol -- ornegin gercek/uretim veri dizini --\
             verildiginde silme yapilmaz ve surec durdurulur.",
            dizin.display(),
            std::env::temp_dir().display(),
        );
        std::process::exit(1);
    }
    let _ = std::fs::remove_dir_all(&dizin);

    let state = AppState::yeni(dizin, KdfParams::default());
    let dinleyici = tokio::net::TcpListener::bind(format!("{YEREL_ADRES}:7700"))
        .await
        .unwrap();
    axum::serve(dinleyici, router(state)).await.unwrap();
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn gecici_dizin_altindaki_yol_silinebilir() {
        let hedef = std::env::temp_dir().join("psikolog-silinebilir-mi-testi");
        assert!(silinebilir_mi(&hedef));
    }

    #[test]
    fn ev_dizini_gibi_uretim_benzeri_bir_yol_silinemez() {
        let ev = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Users\\birisi"));
        assert!(!silinebilir_mi(&ev));

        // Gercek/uretim veri dizinini taklit eden bir yol da reddedilmeli
        // (macOS'ta uygulamanin gercek veri dizininin sekli budur).
        let uretim_benzeri = ev.join("Library").join("Application Support").join("com.psikolog.notlar");
        assert!(!silinebilir_mi(&uretim_benzeri));
    }

    #[test]
    fn surucu_koku_gibi_bir_yol_silinemez() {
        let kok = if cfg!(windows) {
            PathBuf::from("C:\\")
        } else {
            PathBuf::from("/")
        };
        assert!(!silinebilir_mi(&kok));
    }

    #[test]
    fn gecici_dizinin_kendisi_silinemez() {
        let gecici = std::env::temp_dir();
        assert!(!silinebilir_mi(&gecici));
    }
}
