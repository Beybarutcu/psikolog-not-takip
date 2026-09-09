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

/// `PSIKOLOG_E2E_PORTLAR` verilmediginde dinlenen tek port.
pub const VARSAYILAN_PORT: u16 = 7700;

/// `PSIKOLOG_E2E_PORTLAR` degerini port listesine cevirir.
///
/// # Neden birden fazla port
/// Bu ikili e2e testlerinin sunucusudur ve **her port kendi `AppState`'ini,
/// kendi oturumunu ve kendi veri alt dizinini** alir. Playwright tarafinda
/// her spec dosyasi kendi portuna baglanir; boylece bir dosyanin biraktigi
/// durum (kurulmus keystore, kilitli oturum, olusturulmus randevular) baska
/// bir dosyaya SIZMAZ. Onceki tasarimda tek sunucu/tek veri dizini vardi ve
/// dosyalarin alfabetik kosum sirasi testlerin gecip gecmeyecegini
/// belirliyordu.
///
/// # Neden tek surec
/// Playwright'in `webServer`'i icin uc ayri komut tanimlanabilirdi, ama o
/// komutlarin hepsi PARALEL baslatilir: uc `npm --prefix web run build` ayni
/// `web/dist` dizinine ayni anda yazar (yarim/karisik bundle) ve uc `cargo
/// run` cargo'nun derleme kilidi icin sirayla bekler. Tek surec + coklu port
/// bu iki tuzagi da ortadan kaldirir: derleme bir kez yapilir, yalitim yine
/// tam olur.
///
/// Kurallar (hepsi `testler` modulunde sabitlenmistir):
/// - Deger yoksa: yalnizca `VARSAYILAN_PORT`. Uretim davranisi (ve bu
///   ikilinin degisken verilmeden calistirilmasi) boylece aynen korunur.
/// - Virgulle ayrilmis liste, bosluklar kirpilir.
/// - Bos liste, sayi olmayan girdi, `0` ve tekrar eden port: hata.
pub fn portlari_coz(ham: Option<&str>) -> Result<Vec<u16>, String> {
    let Some(ham) = ham else {
        return Ok(vec![VARSAYILAN_PORT]);
    };

    let mut portlar: Vec<u16> = Vec::new();
    for parca in ham.split(',') {
        let parca = parca.trim();
        if parca.is_empty() {
            return Err(format!("'{ham}' icinde bos port girdisi var"));
        }
        let port: u16 = parca
            .parse()
            .map_err(|_| format!("'{parca}' gecerli bir port numarasi degil"))?;
        if port == 0 {
            return Err("port 0 kullanilamaz".to_string());
        }
        if portlar.contains(&port) {
            // Ayni port iki kez verilirse ikinci `bind` zaten basarisiz
            // olurdu; hatayi burada, anlasilir bir mesajla veriyoruz.
            return Err(format!("{port} portu birden fazla kez verildi"));
        }
        portlar.push(port);
    }

    if portlar.is_empty() {
        return Err("port listesi bos".to_string());
    }
    Ok(portlar)
}

#[tokio::main]
async fn main() {
    let taban = std::env::var("PSIKOLOG_VERI_DIZINI")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("psikolog-e2e"));

    if !silinebilir_mi(&taban) {
        eprintln!(
            "PSIKOLOG_VERI_DIZINI ('{}') sistem gecici dizininin ('{}') altinda \
             degil (ya da gecici dizinin kendisi). Bu test yardimcisi baslangicta \
             veri dizinini geri donusumsuz olarak siler; guvenlik icin, gecici \
             dizin disindaki bir yol -- ornegin gercek/uretim veri dizini --\
             verildiginde silme yapilmaz ve surec durdurulur.",
            taban.display(),
            std::env::temp_dir().display(),
        );
        std::process::exit(1);
    }

    let portlar = match portlari_coz(std::env::var("PSIKOLOG_E2E_PORTLAR").ok().as_deref()) {
        Ok(p) => p,
        Err(mesaj) => {
            eprintln!("PSIKOLOG_E2E_PORTLAR gecersiz: {mesaj}");
            std::process::exit(1);
        }
    };

    // Silme TABAN dizinde, tek seferde: her portun alt dizini bunun altinda.
    let _ = std::fs::remove_dir_all(&taban);

    // Once TUM portlar baglanir, sonra servis baslar. Playwright hazir olma
    // kontrolunu tek bir url ile yapiyor; asagidaki ikinci dongude hic
    // `await` yok, yani bir port cevap verebiliyorsa digerlerinin gorevleri
    // de coktan olusturulmustur.
    let mut dinleyiciler = Vec::with_capacity(portlar.len());
    for port in &portlar {
        // `YEREL_ADRES` sabit: adres ASLA ortam degiskeninden gelmez (bkz.
        // `psikolog_server::YEREL_ADRES`). Degisken yalnizca PORT secer.
        let dinleyici = tokio::net::TcpListener::bind(format!("{YEREL_ADRES}:{port}"))
            .await
            .unwrap_or_else(|e| panic!("{YEREL_ADRES}:{port} dinlenemedi: {e}"));
        dinleyiciler.push((*port, dinleyici));
    }

    let mut gorevler = Vec::with_capacity(dinleyiciler.len());
    for (port, dinleyici) in dinleyiciler {
        // Her portun KENDI veri dizini: `<taban>/<port>`.
        let state = AppState::yeni(taban.join(port.to_string()), KdfParams::default());
        gorevler.push(tokio::spawn(async move {
            axum::serve(dinleyici, router(state)).await.unwrap();
        }));
    }

    for gorev in gorevler {
        gorev.await.unwrap();
    }
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

    /// Degisken verilmediginde davranis DEGISMEDI: tek sunucu, 7700.
    /// Coklu port yalnizca acikca istendiginde devreye girer.
    #[test]
    fn degisken_yoksa_tek_varsayilan_port() {
        assert_eq!(portlari_coz(None).unwrap(), vec![7700]);
        assert_eq!(VARSAYILAN_PORT, 7700);
    }

    #[test]
    fn virgullu_liste_ve_bosluklar_ayristirilir() {
        assert_eq!(portlari_coz(Some("7700,7701,7702")).unwrap(), vec![7700, 7701, 7702]);
        assert_eq!(portlari_coz(Some(" 7700 , 7701 ")).unwrap(), vec![7700, 7701]);
        assert_eq!(portlari_coz(Some("7700")).unwrap(), vec![7700]);
    }

    #[test]
    fn gecersiz_port_listesi_reddedilir() {
        // Bos girdi, sayi olmayan girdi, 0 ve tekrar: dordu de hata.
        assert!(portlari_coz(Some("")).is_err());
        assert!(portlari_coz(Some("7700,")).is_err());
        assert!(portlari_coz(Some("7700,abc")).is_err());
        assert!(portlari_coz(Some("0")).is_err());
        assert!(portlari_coz(Some("7700,7700")).is_err());
        // 65536 u16'ya sigmaz.
        assert!(portlari_coz(Some("65536")).is_err());
    }

    /// Port secimi ortam degiskenine acildi; BAGLANMA ADRESI acilmadi.
    /// Bu ikili de, uretim ikilisi (`src-tauri`) de yalnizca `127.0.0.1`
    /// dinler -- `0.0.0.0`/`::` sifreli seans notlarini ayni agdaki diger
    /// cihazlara acardi (bkz. `psikolog_server::YEREL_ADRES`).
    #[test]
    fn baglanma_adresi_yerel_kalir() {
        assert_eq!(YEREL_ADRES, "127.0.0.1");
    }
}
