//! Parola değiştirme uç noktası — HTTP seviyesinde.
//!
//! # Bu dosyanın ölçtüğü şey "parola sarmalandı" DEĞİL
//!
//! `core::parola` ve `core::store::keystore` zaten kendi birim testlerine
//! sahip. Buradaki testlerin görevi **ürünün gerçekten çalıştığını**
//! doğrulamak: kilit yeni parolayla açılıyor mu, eskisiyle açılmıyor mu,
//! kurtarma kodu hâlâ çalışıyor mu, açık oturum ayakta kalıyor mu.
//!
//! `keystore::change_password` Plan 1'den beri yazılı ve testliydi ama
//! hiçbir çağrı yeri yoktu (`yedekleme_api.rs`'teki eski yorum bunu
//! açıkça söylüyordu: *"parola değiştirme ucu bu planda yok"*). Bu dosya o
//! zincirin çağrı yeri tarafını ölçüyor.
//!
//! # İki yön birlikte
//!
//! Her koruma için hem "reddediliyor" hem "kabul ediliyor" var: yalnızca
//! eksi yön yazılsaydı **her isteği reddeden** bir uç nokta bütün koruma
//! testlerini geçerdi.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState};
use serde_json::json;
use tower::ServiceExt;

const ESKI: &str = "eski-parola-123";
const YENI: &str = "yeni-parola-456";

fn test_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let state =
        AppState::yeni(dir.path().to_path_buf(), KdfParams { m_cost: 8, t_cost: 1, p_cost: 1 });
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
    (kod, serde_json::from_slice(&bytes).unwrap_or(json!({})))
}

/// Kurulum yapar ve kurtarma kodunu döndürür.
async fn kur(s: &AppState) -> String {
    let (kod, govde) = cagir(s, "POST", "/api/kurulum", Some(json!({ "parola": ESKI }))).await;
    assert_eq!(kod, StatusCode::CREATED, "on kosul: kurulum basarili olmali");
    govde["kurtarma_kodu"].as_str().unwrap().to_string()
}

async fn parola_degistir(
    s: &AppState,
    mevcut: &str,
    yeni: &str,
) -> (StatusCode, serde_json::Value) {
    cagir(
        s,
        "POST",
        "/api/parola",
        Some(json!({ "mevcut_parola": mevcut, "yeni_parola": yeni })),
    )
    .await
}

async fn kilitle(s: &AppState) {
    cagir(s, "POST", "/api/kilitle", None).await;
}

async fn kilit_ac(s: &AppState, govde: serde_json::Value) -> StatusCode {
    cagir(s, "POST", "/api/kilit-ac", Some(govde)).await.0
}

/// Denetim kaydını okur: `eylem|varlik|varlik_id|ayrinti`.
async fn log_satirlari(s: &AppState) -> Vec<String> {
    use psikolog_server::guard::acik_baglanti_ile;
    let conn = acik_baglanti_ile(s, std::time::Instant::now())
        .expect("log okumak icin oturum acik olmali");
    psikolog_core::store::audit::son_kayitlar(&conn, 200)
        .unwrap()
        .into_iter()
        .map(|k| format!("{}|{}|{}|{:?}", k.eylem, k.varlik, k.varlik_id, k.ayrinti))
        .collect()
}

// =====================================================================
// ARTI YON
// =====================================================================

#[tokio::test]
async fn parola_degisir_ve_kilit_yeni_parolayla_acilir() {
    let (_d, s) = test_state();
    kur(&s).await;

    let (kod, govde) = parola_degistir(&s, ESKI, YENI).await;
    assert_eq!(kod, StatusCode::OK, "gecerli degisiklik kabul edilmeli: {govde}");
    // Yanit HICBIR SEY tasimaz: ne yeni parola, ne kurtarma kodu.
    assert_eq!(govde, json!({}), "yanit bos olmali: {govde}");

    kilitle(&s).await;
    assert_eq!(
        kilit_ac(&s, json!({ "parola": YENI })).await,
        StatusCode::OK,
        "yeni parola kilidi acmali"
    );
    kilitle(&s).await;
    assert_eq!(
        kilit_ac(&s, json!({ "parola": ESKI })).await,
        StatusCode::UNAUTHORIZED,
        "eski parola artik acmamali"
    );
}

#[tokio::test]
async fn kurtarma_kodu_parola_degisiminden_sonra_da_calisir() {
    // BAGLAYICI KARAR: veri anahtari hem parolayla hem kurtarma koduyla
    // AYRI AYRI sarmalanir; parola degisimi yalnizca parola sarmalamasini
    // yeniler. Kurtarma kodunu gecersiz kilan bir uygulama, kullaniciya
    // bunu ancak parolasini unuttugu anda -- kurtarmanin tek ise
    // yarayacagi anda -- fark ettirirdi.
    //
    // MUTASYON: `keystore::change_password`i `recovery`yi de yeniden
    // sarmalayacak sekilde degistir -> bu test kirilir.
    let (_d, s) = test_state();
    let kurtarma = kur(&s).await;

    // ON KOSUL: kod degisiklikten ONCE zaten calisiyor (yoksa asagidaki
    // iddia "hicbir zaman calismayan bir kod" icin de saglanirdi).
    kilitle(&s).await;
    assert_eq!(
        kilit_ac(&s, json!({ "kurtarma_kodu": kurtarma })).await,
        StatusCode::OK,
        "on kosul: kurtarma kodu degisiklikten once calismali"
    );

    assert_eq!(parola_degistir(&s, ESKI, YENI).await.0, StatusCode::OK);

    kilitle(&s).await;
    assert_eq!(
        kilit_ac(&s, json!({ "kurtarma_kodu": kurtarma })).await,
        StatusCode::OK,
        "kurtarma kodu parola degisiminden SONRA da ayni anahtari acmali"
    );
}

#[tokio::test]
async fn acik_oturum_parola_degisiminden_sonra_kapanmaz() {
    // Veri anahtari DEGISMIYOR, yalnizca sarmalamasi degisiyor: terapist
    // seans notu yazarken parolasini degistirebilmeli ve panelinden
    // atilmamali.
    let (_d, s) = test_state();
    kur(&s).await;
    let (kod, _) = cagir(&s, "POST", "/api/danisanlar", Some(json!({ "ad_soyad": "Ayse" }))).await;
    assert_eq!(kod, StatusCode::CREATED);

    assert_eq!(parola_degistir(&s, ESKI, YENI).await.0, StatusCode::OK);

    let (kod, liste) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(kod, StatusCode::OK, "oturum acik kalmali");
    assert_eq!(liste.as_array().unwrap().len(), 1, "veri yerinde kalmali");
}

// =====================================================================
// EKSI YON
// =====================================================================

#[tokio::test]
async fn kilitliyken_parola_degistirilemez_ve_parola_degismez() {
    // Kapi (`acik_baglanti`) ILK SATIR: kilitli oturumda bu uc nokta
    // calismaz ve hicbir sey degistirmez. Aksi halde kilitli bir
    // uygulamanin onunden gecen biri, mevcut parolayi deneme yanilma ile
    // aramaya baslayabilirdi.
    let (_d, s) = test_state();
    kur(&s).await;
    let once = std::fs::read(s.keystore_yolu()).unwrap();
    kilitle(&s).await;

    let (kod, govde) = parola_degistir(&s, ESKI, YENI).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(
        govde["hata"].as_str().unwrap().contains("kilitli"),
        "kilit reddi kendi mesajini vermeli: {govde}"
    );

    assert_eq!(
        std::fs::read(s.keystore_yolu()).unwrap(),
        once,
        "kilitliyken gelen istek anahtar dosyasina DOKUNMAMALI"
    );
    assert_eq!(
        kilit_ac(&s, json!({ "parola": ESKI })).await,
        StatusCode::OK,
        "eski parola calismaya devam etmeli"
    );
}

#[tokio::test]
async fn yanlis_mevcut_parola_401_doner_ve_hicbir_sey_degismez() {
    // BAGLAYICI KISIT: mevcut parola DOGRULANMALI. Yalnizca yeni parola
    // isteyen bir uc nokta, oturum acikken bilgisayarin basina gecen
    // birinin terapisti kendi verisinden kilitlemesine izin verirdi.
    //
    // MUTASYON: `core::parola`daki `unlock_with_password` kontrolunu sil ->
    // bu test kirilir.
    let (_d, s) = test_state();
    kur(&s).await;
    let once = std::fs::read(s.keystore_yolu()).unwrap();

    let (kod, govde) = parola_degistir(&s, "bambaska-parola", YENI).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED, "{govde}");

    assert_eq!(
        std::fs::read(s.keystore_yolu()).unwrap(),
        once,
        "reddedilen degisiklik anahtar dosyasina DOKUNMAMALI"
    );
    kilitle(&s).await;
    assert_eq!(kilit_ac(&s, json!({ "parola": ESKI })).await, StatusCode::OK);
    kilitle(&s).await;
    assert_eq!(kilit_ac(&s, json!({ "parola": YENI })).await, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn ret_sebepleri_http_seviyesinde_de_ayrisik() {
    // "Her hata parola hatasidir" tuzagi bu kod tabaninda DORT katmanda
    // bulundu. Uc ret sebebi hem farkli durum kodu hem farkli metin
    // vermeli; kullanici neyi duzeltecegini bilmeli.
    let (_d, s) = test_state();
    kur(&s).await;

    let (yanlis_kod, yanlis) = parola_degistir(&s, "bambaska-parola", YENI).await;
    let (kisa_kod, kisa) = parola_degistir(&s, ESKI, "kisa").await;
    let (ayni_kod, ayni) = parola_degistir(&s, ESKI, ESKI).await;

    assert_eq!(yanlis_kod, StatusCode::UNAUTHORIZED, "yalnizca bu gercekten parola hatasi");
    assert_eq!(kisa_kod, StatusCode::BAD_REQUEST);
    assert_eq!(ayni_kod, StatusCode::BAD_REQUEST);

    let metinler: Vec<String> = [&yanlis, &kisa, &ayni]
        .iter()
        .map(|g| g["hata"].as_str().unwrap_or("").to_string())
        .collect();
    for m in &metinler {
        assert!(!m.is_empty(), "her ret bir mesaj tasimali");
        assert!(m.contains("değişmedi"), "ret mesaji parolanin degismedigini soylemeli: {m}");
    }
    for (i, a) in metinler.iter().enumerate() {
        for b in metinler.iter().skip(i + 1) {
            assert_ne!(a, b, "iki ayri ret ayni mesaji vermemeli: {metinler:?}");
        }
    }

    // ARTI YON: uc reddin hicbiri parolayi degistirmedi ama gecerli bir
    // istek hala kabul ediliyor (hepsini reddeden bir uc nokta yukaridaki
    // iddialarin tamamini gecerdi).
    assert_eq!(parola_degistir(&s, ESKI, YENI).await.0, StatusCode::OK);
}

// =====================================================================
// GIZLILIK
// =====================================================================

#[tokio::test]
async fn parola_hicbir_bicimde_denetim_kaydina_girmez() {
    // `audit_log` satirlari SILINEMEZ: oraya dusen bir parola kalicidir.
    // Yazilan satir `duzenleme|session|parola` ve `ayrinti` None.
    let (_d, s) = test_state();
    kur(&s).await;
    assert_eq!(parola_degistir(&s, ESKI, YENI).await.0, StatusCode::OK);

    let satirlar = log_satirlari(&s).await;
    // ON KOSUL: satir gercekten yazildi (yoksa "sizmiyor" iddiasi bos bir
    // kume uzerinde saglanirdi).
    assert!(
        satirlar.iter().any(|x| x == "duzenleme|session|parola|None"),
        "parola degisikligi tek bir satir yazmali: {satirlar:?}"
    );
    for satir in &satirlar {
        let kucuk = satir.to_lowercase();
        for parca in [ESKI, YENI, "parola-123", "parola-456", "eski-", "yeni-"] {
            assert!(
                !kucuk.contains(&parca.to_lowercase()),
                "parola parcasi '{parca}' loga sizmis: {satir}"
            );
        }
    }
}

#[tokio::test]
async fn parola_yanitlarin_hicbirinde_yankilanmaz() {
    // Basarili ya da basarisiz, gonderilen parolalar yanit govdesinde
    // GORUNMEMELI (bir hata mesajinin icine "girdiginiz parola: ..." diye
    // sizmasi bu sinifin en olagan bicimi).
    let (_d, s) = test_state();
    kur(&s).await;

    let mut govdeler = Vec::new();
    for (mevcut, yeni) in
        [("KANARYA_YANLIS_1", "KANARYA_YENI_1"), (ESKI, "KISA1"), (ESKI, "KANARYA_YENI_2")]
    {
        let (_, g) = parola_degistir(&s, mevcut, yeni).await;
        govdeler.push(g.to_string());
    }

    for g in &govdeler {
        for kanarya in ["KANARYA_YANLIS_1", "KANARYA_YENI_1", "KANARYA_YENI_2", "KISA1", ESKI] {
            assert!(!g.contains(kanarya), "parola yanitta yankilandi: {g}");
        }
    }
}
