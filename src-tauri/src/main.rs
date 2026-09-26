#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pencere;

use pencere::{gezinme_izni, pencere_karari, PencereKarari};
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState, YEREL_ADRES};
use std::path::PathBuf;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_opener::OpenerExt;

/// Ana pencerenin etiketi; kapanınca uygulama çıkar (tasarım P5).
const ANA_PENCERE: &str = "ana";

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

/// Her pencerenin ORTAK kurucusu (tasarım P6b, §9). Gezinme yalnızca kendi
/// kökenine; başka bir `http(s)`/`mailto` adresine gezinme de yeni pencere
/// isteği de sistemin varsayılan uygulamasına devredilir ve REDDEDİLİR.
/// `window.open` isteği hiçbir zaman webview'in kendi penceresine
/// bırakılmaz (`Deny`): okuma penceresini bu kurucu kendisi açar.
fn korumali_pencere<'a>(
    app: &'a AppHandle,
    etiket: &str,
    adres: Url,
    koken: Url,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    let gezinme_app = app.clone();
    let gezinme_koken = koken.clone();
    let yeni_app = app.clone();
    WebviewWindowBuilder::new(app, etiket, WebviewUrl::External(adres))
        .theme(Some(tauri::Theme::Light))
        .on_navigation(move |hedef| {
            if gezinme_izni(hedef, &gezinme_koken) {
                return true;
            }
            if pencere_karari(hedef, &gezinme_koken) == PencereKarari::DisaAc {
                disarida_ac(&gezinme_app, hedef);
            }
            false
        })
        .on_new_window(move |hedef, _ozellikler| {
            match pencere_karari(&hedef, &koken) {
                PencereKarari::OkumaPenceresi { randevu_id } => {
                    okuma_penceresi_ac(&yeni_app, randevu_id, &koken)
                }
                PencereKarari::DisaAc => disarida_ac(&yeni_app, &hedef),
                PencereKarari::Reddet => {}
            }
            NewWindowResponse::Deny
        })
}

/// Salt okunur okuma penceresi (tasarım P1-P3): etiket `okuma-<id>`, aynı
/// seans ikinci kez istenirse var olan öne gelir. Başlık danışan adı
/// TAŞIMAZ (pencere listelerinde görünür); ad sayfanın içinde.
fn okuma_penceresi_ac(app: &AppHandle, randevu_id: i64, koken: &Url) {
    let etiket = format!("okuma-{randevu_id}");
    if let Some(var_olan) = app.get_webview_window(&etiket) {
        let _ = var_olan.set_focus();
        return;
    }
    let mut adres = koken.clone();
    adres.set_path("/");
    adres.set_query(Some(&format!("okuma={randevu_id}")));
    let app = app.clone();
    let koken = koken.clone();
    // Pencere webview'in kendi geri çağrısının İÇİNDE kurulmaz (Windows'ta
    // olay döngüsü kilitlenebilir); ayrı bir görevde.
    tauri::async_runtime::spawn(async move {
        let sonuc = korumali_pencere(&app, &etiket, adres, koken)
            .title("Seans notu (salt okunur)")
            .inner_size(720.0, 800.0)
            .build();
        if sonuc.is_err() {
            eprintln!("okuma penceresi acilamadi");
        }
    });
}

/// Sistemin varsayılan tarayıcısı/posta uygulaması. Hata satırı ADRES
/// BASMAZ: bağlantı hassas bilgi taşıyabilir.
fn disarida_ac(app: &AppHandle, adres: &Url) {
    if app.opener().open_url(adres.as_str(), None::<&str>).is_err() {
        eprintln!("baglanti sistem uygulamasinda acilamadi");
    }
}

fn main() {
    let port = sunucuyu_baslat(veri_dizini());
    let koken: Url = format!("http://{YEREL_ADRES}:{port}/").parse().expect("yerel adres gecersiz");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            korumali_pencere(app.handle(), ANA_PENCERE, koken.clone(), koken.clone())
                .title("Terapi Notlari")
                .inner_size(1200.0, 760.0)
                .min_inner_size(1024.0, 680.0)
                .theme(Some(tauri::Theme::Light))
                .build()?;
            Ok(())
        })
        // Tasarım P5: ana pencere kapanınca uygulama çıkar, okuma pencereleri
        // de kapanır (yoksa son okuma penceresi kapanana kadar süreç yaşardı).
        .on_window_event(|pencere, olay| {
            if pencere.label() == ANA_PENCERE && matches!(olay, tauri::WindowEvent::Destroyed) {
                pencere.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("uygulama baslatilamadi");
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

    /// Tasarim A3/A8: pencere 1200x760 acilir, 1024x680'den kucuk olmaz ve
    /// macOS koyu modda bile ACIK temayla cizilir. Kabuk Rust tarafinda
    /// calistirilamadigi icin kaynak okunarak sabitleniyor.
    #[test]
    fn pencere_boyutu_ve_tema_sabit() {
        let kaynak = include_str!("main.rs");
        let kurucu = kaynak.split("#[cfg(test)]").next().unwrap();
        assert!(kurucu.contains(".inner_size(1200.0, 760.0)"), "varsayilan boyut");
        assert!(kurucu.contains(".min_inner_size(1024.0, 680.0)"), "asgari boyut");
        assert!(kurucu.contains(".theme(Some(tauri::Theme::Light))"), "acik tema");
        assert!(kurucu.contains(".inner_size(720.0, 800.0)"), "okuma penceresi boyutu (P2)");
        assert!(kurucu.contains(".on_navigation(") && kurucu.contains(".on_new_window("), "gezinme korumasi (P6b)");
        assert!(kurucu.contains("NewWindowResponse::Deny"), "yeni pencere istegi webview'e birakilmaz");
        assert!(kurucu.contains(".plugin(tauri_plugin_opener::init())"), "opener eklentisi (P6b)");
        assert!(kurucu.contains("WindowEvent::Destroyed") && kurucu.contains("exit(0)"), "ana pencere kapaninca cikis (P5)");
        assert!(kurucu.contains("korumali_pencere(app.handle(), ANA_PENCERE"), "ana pencere de korumali kurucudan");
    }
}
