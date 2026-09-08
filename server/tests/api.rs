use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState};
use tower::ServiceExt;

fn test_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::yeni(dir.path().to_path_buf(), KdfParams { m_cost: 8, t_cost: 1, p_cost: 1 });
    (dir, state)
}

async fn cagir(state: &AppState, method: &str, yol: &str, govde: Option<serde_json::Value>) -> (StatusCode, serde_json::Value) {
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

#[tokio::test]
async fn ilk_acilista_kurulum_gerekli_bildirilir() {
    let (_d, s) = test_state();
    let (kod, json) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(json["kurulum_gerekli"], true);
    assert_eq!(json["kilitli"], true);
}

#[tokio::test]
async fn kurulum_kurtarma_kodu_dondurur_ve_oturumu_acar() {
    let (_d, s) = test_state();
    let (kod, json) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    assert_eq!(kod, StatusCode::CREATED);

    let kurtarma = json["kurtarma_kodu"].as_str().unwrap();
    assert_eq!(kurtarma.split('-').count(), 5);

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kurulum_gerekli"], false);
    assert_eq!(durum["kilitli"], false, "kurulum sonrasi oturum acik olmali");
}

#[tokio::test]
async fn ikinci_kurulum_reddedilir() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    let (kod, _) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"baska"}))).await;
    assert_eq!(kod, StatusCode::CONFLICT);
}

#[tokio::test]
async fn dogru_parola_kilidi_acar() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, _) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"gizli123"}))).await;
    assert_eq!(kod, StatusCode::OK);

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kilitli"], false);
}

#[tokio::test]
async fn yanlis_parola_401_dondurur_ve_kilitli_kalir() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"yanlis"}))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json["hata"].as_str().unwrap().contains("hatalı"));

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kilitli"], true);
}

#[tokio::test]
async fn kurtarma_koduyla_kilit_acilir() {
    let (_d, s) = test_state();
    let (_, json) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    let kurtarma = json["kurtarma_kodu"].as_str().unwrap().to_string();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, _) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"kurtarma_kodu": kurtarma}))).await;
    assert_eq!(kod, StatusCode::OK);
}

#[tokio::test]
async fn giris_ve_cikis_erisim_loguna_yazilir() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;
    cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"gizli123"}))).await;

    let kayitlar = s.audit_dokumu().unwrap();
    let eylemler: Vec<&str> = kayitlar.iter().map(|k| k.eylem.as_str()).collect();
    assert!(eylemler.contains(&"giris"));
    assert!(eylemler.contains(&"cikis"));
}

// --- Ek testler: kilitli oturumda veri sizmamasi (gorev brief'i disinda, incelemeden gelen kisit) ---

#[tokio::test]
async fn kilitliyken_durum_yaniti_kurtarma_kodu_veya_anahtar_icermez() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(kod, StatusCode::OK);
    // Yanit govdesi yalnizca uc bool alan icermeli (kurulum_gerekli, kilitli,
    // keystore_bozuk), baska hicbir sey degil. (keystore_bozuk alani
    // Bulgu 1 duzeltmesiyle eklendi; dogruladigi sey -- hassas veri
    // sizmamasi -- degismedi, yalnizca alan sayisi 2'den 3'e cikti.)
    let alanlar: Vec<&String> = json.as_object().unwrap().keys().collect();
    assert_eq!(alanlar.len(), 3, "durum yaniti beklenenden fazla alan iceriyor: {json}");
    assert!(json.get("kurtarma_kodu").is_none());
    assert!(json.get("parola").is_none());
}

#[tokio::test]
async fn kilitliyken_kilitle_cagirmak_govdede_veri_dondurmez() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    // Zaten kilitliyken tekrar kilitle cagirmak da veri sizdirmamali.
    let (kod, json) = cagir(&s, "POST", "/api/kilitle", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(json, serde_json::json!({}), "kilitle yaniti bos govde disinda bir sey icermemeli");
}

#[tokio::test]
async fn kilitliyken_yanlis_kilit_ac_denemesi_kurtarma_kodu_sizdirmaz() {
    let (_d, s) = test_state();
    let (_, kurulum_json) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    let kurtarma = kurulum_json["kurtarma_kodu"].as_str().unwrap().to_string();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"yanlis"}))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    let govde_metni = json.to_string();
    assert!(!govde_metni.contains(&kurtarma), "hata yaniti kurtarma kodunu icermemeli");
}

// --- Inceleme Bulgu 1: bozuk keystore karsisinda celiskili teshis ---
//
// `keystore::exists()` yalnizca dosyanin var olup olmadigina bakar,
// `keystore::load()` ise "dosya yok" ile "dosya bozuk"u ayni io hatasi
// altinda birlestirir. Duzeltmeden once bu, /api/kilit-ac'in bozuk dosyada
// "once kurulum yapilmali" demesine (kullaniciyi "keystore'u silip yeniden
// kurayim" gibi veri kaybina goturen bir cozume) yol aciyordu. Bu test hem
// eski (yanlis) davranisi hem de duzeltilmis sozlesmeyi dogrulamak icin var.
#[tokio::test]
async fn bozuk_keystore_hicbir_uc_nokta_kurulum_yapilmamis_demez() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;

    // Keystore dosyasinin icerigini gecersiz JSON ile ez (bozuk dosya simulasyonu).
    std::fs::write(s.keystore_yolu(), b"{ bu gecerli json degil, bozuk dosya").unwrap();

    // 1) GET /api/durum: kurulum_gerekli YANLIS kalmali (kurulum yapmak veriyi
    //    yok eder), ama yeni keystore_bozuk alani DOGRU olmali.
    let (kod_durum, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(kod_durum, StatusCode::OK);
    assert_eq!(durum["kurulum_gerekli"], false, "bozuk dosyada kurulum_gerekli asla true olmamali");
    assert_eq!(durum["keystore_bozuk"], true, "durum yaniti bozuk keystore'u bildirmeli");

    // 2) POST /api/kilit-ac: "once kurulum yapilmali" DEMEMELI.
    let (kod_ac, json_ac) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"gizli123"}))).await;
    let hata_ac = json_ac["hata"].as_str().unwrap_or("").to_lowercase();
    assert!(
        !hata_ac.contains("once kurulum") && !hata_ac.contains("önce kurulum"),
        "bozuk keystore'da kilit-ac 'once kurulum yapilmali' dememeli: {hata_ac}"
    );
    assert_ne!(kod_ac, StatusCode::CONFLICT, "bozuk keystore artik 409 'kurulum yok' anlamina gelmemeli");
    // Mesaj kullaniciyi dosyayi SILMEMESI konusunda uyarmali.
    assert!(hata_ac.contains("silme"), "mesaj kullaniciyi dosyayi silmemesi konusunda uyarmali: {hata_ac}");

    // 3) POST /api/kurulum: reddetmeye devam etmeli (ezme riskine karsi), ama
    //    "kurulum yapilmamis" DEMEMELI -- tam tersi, zaten bir dosya var.
    let (kod_kur, json_kur) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"baskaparola"}))).await;
    assert_eq!(kod_kur, StatusCode::CONFLICT);
    let hata_kur = json_kur["hata"].as_str().unwrap_or("").to_lowercase();
    assert!(
        !hata_kur.contains("kurulum yapilmamis") && !hata_kur.contains("kurulum yapılmamış"),
        "kurulum ucnoktasi bozuk dosyada 'kurulum yapilmamis' dememeli: {hata_kur}"
    );
}

// --- Son inceleme Bulgu 1: gecerli JSON ama yapisal olarak bozuk keystore ---
//
// Yukaridaki test gecersiz JSON ile bozulmayi simule ediyordu (`keystore::load`
// bunu zaten `Err` olarak yakalar). Daha sinsi senaryo: dosya GECERLI JSON
// kalir ama icindeki `ciphertext_hex` yarim disk yazimi/geri yukleme yuzunden
// kisalmis olabilir. Duzeltmeden once `keystore::load` bu durumda basariyla
// donerdi, `keystore_bozuk` yanlis negatif verirdi, bozuk-keystore ekrani
// ACILMAZDI ve kullanici DOGRU parolasini girdiginde 401 "parola hatali"
// gorurdu -- teknik olmayan kullanicinin "ikisini de kaybettim" sanacagi tam
// senaryo bu. Bu test hem `/api/durum`'u hem `/api/kilit-ac`'i dogrular.
#[tokio::test]
async fn gecerli_json_ama_yapisal_bozuk_keystore_dogru_parolada_401_vermez() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    // Keystore hala tamamen gecerli JSON'dur; yalnizca password.ciphertext_hex
    // alani kisaltilmistir (yarim yazim/geri yukleme simulasyonu).
    let icerik = std::fs::read_to_string(s.keystore_yolu()).unwrap();
    let mut deger: serde_json::Value = serde_json::from_str(&icerik).unwrap();
    let ciphertext = deger["password"]["ciphertext_hex"].as_str().unwrap().to_string();
    assert!(ciphertext.len() > 10, "test onkosulu: ciphertext_hex kisaltmaya yetecek kadar uzun olmali");
    deger["password"]["ciphertext_hex"] = serde_json::json!(ciphertext[..ciphertext.len() - 10]);
    std::fs::write(s.keystore_yolu(), serde_json::to_vec(&deger).unwrap()).unwrap();
    // Onkosul: dosya hala gecerli JSON olarak ayristirilabiliyor (aksi halde
    // bu, yukaridaki "gecersiz JSON" senaryosuyla ayni sey olurdu).
    assert!(serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(s.keystore_yolu()).unwrap()).is_ok());

    // 1) GET /api/durum: keystore_bozuk DOGRU olmali.
    let (kod_durum, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(kod_durum, StatusCode::OK);
    assert_eq!(
        durum["keystore_bozuk"], true,
        "gecerli JSON ama yapisal olarak bozuk kayit keystore_bozuk=true bildirmeli"
    );

    // 2) POST /api/kilit-ac DOGRU parolayla: 401 "hatali" DEMEMELI, bozuk
    //    kayit mesajini vermeli.
    let (kod_ac, json_ac) =
        cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"gizli123"}))).await;
    assert_ne!(
        kod_ac,
        StatusCode::UNAUTHORIZED,
        "yapisal olarak bozuk kayitta DOGRU parola 401 almamali: {json_ac}"
    );
    assert_eq!(kod_ac, StatusCode::INTERNAL_SERVER_ERROR);
    let hata_ac = json_ac["hata"].as_str().unwrap_or("").to_lowercase();
    assert!(
        !hata_ac.contains("parola veya kurtarma kodu hatalı"),
        "bozuk kayit 'parola hatali' mesaji vermemeli: {hata_ac}"
    );
    assert!(
        hata_ac.contains("silme"),
        "mesaj kullaniciyi dosyayi silmemesi konusunda uyarmali: {hata_ac}"
    );
}

// --- Inceleme Bulgu 2: es zamanli kurulum yarisi keystore'u eziyor ---
//
// Iki es zamanli /api/kurulum istegi (cift tiklama yeter) `exists()` kontrolu
// ile `save()` arasinda kilit olmadan calisirsa ikisi de "dosya yok" gorup
// yazabilir; ikincisi birincinin keystore'unu (ve parolasini) sessizce ezer.
// Bu test gercek OS thread'leriyle (her biri kendi tokio runtime'inda) ve bir
// Barrier ile iki istegi mumkun oldugunca ayni anda baslatir; AppState'teki
// `kurulum_kilidi` (Arc<Mutex<()>>) sayesinde tam olarak biri basarili (201),
// digeri 409 almali -- hicbir zaman ikisi de basarili olmamali.
#[test]
fn eszamanli_kurulum_yarisi_keystoreu_ezmez() {
    let dir = tempfile::tempdir().unwrap();
    let state = psikolog_server::AppState::yeni(
        dir.path().to_path_buf(),
        KdfParams { m_cost: 8, t_cost: 1, p_cost: 1 },
    );

    let engel = std::sync::Arc::new(std::sync::Barrier::new(2));

    let s1 = state.clone();
    let e1 = engel.clone();
    let t1 = std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async move {
            e1.wait();
            cagir(&s1, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"parolabirtane"}))).await
        })
    });

    let s2 = state.clone();
    let e2 = engel.clone();
    let t2 = std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async move {
            e2.wait();
            cagir(&s2, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"parolaikitane"}))).await
        })
    });

    let (kod1, _) = t1.join().unwrap();
    let (kod2, _) = t2.join().unwrap();
    let kodlar = [kod1, kod2];

    let basarili = kodlar.iter().filter(|k| **k == StatusCode::CREATED).count();
    let cakisma = kodlar.iter().filter(|k| **k == StatusCode::CONFLICT).count();
    assert_eq!(basarili, 1, "tam olarak bir kurulum istegi basarili olmali, ikisi degil: {kodlar:?}");
    assert_eq!(cakisma, 1, "diger istek 409 (kurulum zaten yapilmis) almali: {kodlar:?}");

    // Kazanan parola calismali, ezilen (kaybeden) parola calismamali -- yani
    // keystore hic ezilmemis, sadece tek bir yazan kazanmis olmali.
    let rt = tokio::runtime::Runtime::new().unwrap();
    let s3 = state.clone();
    rt.block_on(async move {
        let (kod_bir, _) = cagir(&s3, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"parolabirtane"}))).await;
        cagir(&s3, "POST", "/api/kilitle", None).await;
        let (kod_iki, _) = cagir(&s3, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"parolaikitane"}))).await;
        let basariliydi = [kod_bir, kod_iki].iter().filter(|k| **k == StatusCode::OK).count();
        assert_eq!(basariliydi, 1, "sadece kazanan parola kilidi acabilmeli, digeri calismamali");
    });
}

// --- Inceleme Bulgu 2 (Gorev 12): CSP fiilen uygulanmiyor olabilir ---
//
// Pencere `WebviewUrl::External("http://127.0.0.1:<port>")` ile acildigi
// icin Tauri'nin kendi CSP enjeksiyonu bu icerige uygulanmaz -- sunucunun
// kendisi her yanita `content-security-policy` basligini eklemeli. Bu, hem
// statik varlik (SPA) yanitlarinda hem de API yanitlarinda dogrulanir; deger
// `src-tauri/tauri.conf.json` > `app.security.csp` ile birebir ayni olmali.
#[tokio::test]
async fn statik_yanit_csp_basligi_tasir() {
    let (_d, s) = test_state();
    let istek = Request::builder().method("GET").uri("/").body(Body::empty()).unwrap();
    let yanit = router(s).oneshot(istek).await.unwrap();

    assert_eq!(yanit.status(), StatusCode::OK);
    let deger = yanit
        .headers()
        .get("content-security-policy")
        .expect("statik yanitta content-security-policy basligi eksik");
    assert_eq!(deger, "default-src 'self'; style-src 'self' 'unsafe-inline'");
}

#[tokio::test]
async fn api_yaniti_csp_basligi_tasir() {
    let (_d, s) = test_state();
    let istek = Request::builder().method("GET").uri("/api/durum").body(Body::empty()).unwrap();
    let yanit = router(s).oneshot(istek).await.unwrap();

    assert_eq!(yanit.status(), StatusCode::OK);
    let deger = yanit
        .headers()
        .get("content-security-policy")
        .expect("API yanitinda content-security-policy basligi eksik");
    assert_eq!(deger, "default-src 'self'; style-src 'self' 'unsafe-inline'");
}
