//! Plan 3 Görev 7 — not, özel not, ek dosya, arama ve danışan dosyası uç
//! noktalarının HTTP seviyesindeki testleri.
//!
//! # İki yön birlikte yazılır
//!
//! Her uç nokta için hem **artı yön** (doğru istek doğru sonucu verir) hem
//! **eksi yön** (kilitli/geçersiz/bulunamadı reddedilir) vardır. Yalnızca
//! eksi yön yazılsaydı **hiçbir şey döndürmeyen** bir API bütün koruma
//! testlerini geçerdi — bu kod tabanında Görev 6'nın M8/M9 mutasyonları bunu
//! birebir gösterdi.
//!
//! # Gizlilik iddiaları totoloji olmamalı
//!
//! "Yanıtta `GIZLI` geçmiyor" iddiası boş bir yanıtla da sağlanır. Bu yüzden
//! her sızıntı testi önce **beklenen verinin gerçekten döndüğünü** (ön
//! koşul), sonra özel notun dönmediğini doğrular.

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_core::store::attachments::AZAMI_DOSYA_BOYUTU;
use psikolog_server::{router, AppState};
use serde_json::json;
use tower::ServiceExt;

fn test_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let state =
        AppState::yeni(dir.path().to_path_buf(), KdfParams { m_cost: 8, t_cost: 1, p_cost: 1 });
    (dir, state)
}

/// Plan 2'nin `cagir` yardımcısı (takvim_api.rs) — JSON istek/yanıt.
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
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::json!({}));
    (kod, json)
}

/// Ham gövdeli istek (ek yükleme/indirme). Yanıt başlıkları da döner --
/// `Content-Disposition` ve `Content-Type` bu görevin üç tuzağından ikisi.
async fn cagir_ham(
    state: &AppState,
    method: &str,
    yol: &str,
    basliklar: &[(&str, &str)],
    govde: Vec<u8>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut b = Request::builder().method(method).uri(yol);
    for (ad, deger) in basliklar {
        b = b.header(*ad, *deger);
    }
    let istek = b.body(Body::from(govde)).unwrap();
    let yanit = router(state.clone()).oneshot(istek).await.unwrap();
    let kod = yanit.status();
    let basliklar = yanit.headers().clone();
    let bytes = yanit.into_body().collect().await.unwrap().to_bytes();
    (kod, basliklar, bytes.to_vec())
}

async fn kurulu_state() -> (tempfile::TempDir, AppState) {
    let (dir, state) = test_state();
    cagir(&state, "POST", "/api/kurulum", Some(json!({"parola":"gizliparola"}))).await;
    (dir, state)
}

async fn kilitle(s: &AppState) {
    cagir(s, "POST", "/api/kilitle", None).await;
}

async fn kilit_ac(s: &AppState) {
    cagir(s, "POST", "/api/kilit-ac", Some(json!({"parola":"gizliparola"}))).await;
}

async fn danisan_ekle(s: &AppState, ad: &str) -> i64 {
    let (kod, d) = cagir(s, "POST", "/api/danisanlar", Some(json!({ "ad_soyad": ad }))).await;
    assert_eq!(kod, StatusCode::CREATED, "kurulum: danisan eklenmeli");
    d["id"].as_i64().unwrap()
}

async fn randevu_ekle(s: &AppState, client_id: i64, gun: &str) -> i64 {
    let (kod, r) = cagir(
        s,
        "POST",
        "/api/randevular",
        Some(json!({
            "client_id": client_id,
            "baslangic": format!("{gun}T14:00"),
            "bitis": format!("{gun}T15:00"),
        })),
    )
    .await;
    assert_eq!(kod, StatusCode::CREATED, "kurulum: randevu eklenmeli");
    r[0]["id"].as_i64().unwrap()
}

/// Kurulum + bir danışan + bir randevu.
async fn dolu_state() -> (tempfile::TempDir, AppState, i64, i64) {
    let (dir, s) = kurulu_state().await;
    let cid = danisan_ekle(&s, "Ayse Yilmaz").await;
    let rid = randevu_ekle(&s, cid, "2026-09-07").await;
    (dir, s, cid, rid)
}

/// Bir ek yükler ve kimliğini döndürür.
async fn ek_yukle(s: &AppState, cid: i64, ad_kodlu: &str, icerik: &[u8]) -> i64 {
    let (kod, _b, govde) = cagir_ham(
        s,
        "POST",
        &format!("/api/danisanlar/{cid}/ekler"),
        &[("content-type", "application/pdf"), ("x-dosya-adi", ad_kodlu), ("x-ek-turu", "onam")],
        icerik.to_vec(),
    )
    .await;
    assert_eq!(kod, StatusCode::CREATED, "kurulum: ek yuklenmeli");
    let json: serde_json::Value = serde_json::from_slice(&govde).unwrap();
    json["id"].as_i64().unwrap()
}

// =====================================================================
// 1. KILITLI OTURUM -- ISTISNASIZ
// =====================================================================

/// Görev 7'nin eklediği on dört uç nokta (+ dal incelemesi C1'in eklediği
/// `rapor-kaydi`, toplam **on beş**) kilitliyken `401` döner ve gövdesinde
/// hiçbir veri taşımaz.
///
/// Tablo halinde yazılmıştır ki yeni bir uç nokta eklendiğinde satır
/// eklemeyi unutmak zorlaşsın; sayı ayrıca `assert_eq!` ile pinlenir.
/// "İşlem uygulanmamış olur" yönü ayrıca aşağıdaki yazma testlerinde,
/// kilidi tekrar açıp depoyu okuyarak doğrulanır.
#[tokio::test]
async fn kilitliyken_gorev7_uclarinin_hepsi_401_doner_ve_veri_sizdirmaz() {
    let (_d, s, cid, rid) = dolu_state().await;
    // Kilitlemeden ONCE bilinen veri yaz: yoksa "govdede GIZLI yok" iddiasi
    // bos bir veritabani tarafindan tatmin edilirdi (totoloji).
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"RESMI_GIZLI_ICERIK"})),
    )
    .await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/ozel-not"),
        Some(json!({"icerik":"OZEL_GIZLI_ICERIK"})),
    )
    .await;
    let ek_id = ek_yukle(&s, cid, "GIZLI_DOSYA_ADI.pdf", b"GIZLI_DOSYA_ICERIGI").await;

    kilitle(&s).await;

    let uclar: Vec<(&str, String, Option<serde_json::Value>)> = vec![
        ("GET", format!("/api/randevular/{rid}/not"), None),
        (
            "PUT",
            format!("/api/randevular/{rid}/not"),
            Some(json!({"sablon":"dap","icerik":"x"})),
        ),
        ("GET", format!("/api/randevular/{rid}/ozel-not"), None),
        ("PUT", format!("/api/randevular/{rid}/ozel-not"), Some(json!({"icerik":"x"}))),
        ("GET", format!("/api/danisanlar/{cid}"), None),
        ("PATCH", format!("/api/danisanlar/{cid}"), Some(json!({"risk_notu":"x"}))),
        ("GET", format!("/api/danisanlar/{cid}/notlar"), None),
        ("GET", format!("/api/danisanlar/{cid}/ekler"), None),
        // POST /ekler ham govdeli oldugu icin ayri cagrilir (asagida).
        ("GET", format!("/api/ekler/{ek_id}"), None),
        ("DELETE", format!("/api/ekler/{ek_id}"), None),
        ("GET", "/api/ara?q=GIZLI".to_string(), None),
        ("GET", "/api/saklama-suresi-dolanlar?bugun=2030-01-01".to_string(), None),
        ("GET", "/api/depolama-durumu".to_string(), None),
        // Dal incelemesi C1: veri raporu disa aktarim kaydi da ayni kapidan
        // gecer -- kilitliyken bir danisanin dosyasi disa aktarilamaz,
        // dolayisiyla o kaydin yazilmasi da reddedilir.
        ("POST", format!("/api/danisanlar/{cid}/rapor-kaydi"), None),
    ];
    assert_eq!(uclar.len(), 14, "POST /ekler ile birlikte on bes uc kapsanmali");

    for (metot, yol, govde) in &uclar {
        let (kod, json) = cagir(&s, metot, yol, govde.clone()).await;
        assert_eq!(kod, StatusCode::UNAUTHORIZED, "{metot} {yol} kilitliyken 401 donmeli");
        let metin = json.to_string();
        for gizli in
            ["RESMI_GIZLI_ICERIK", "OZEL_GIZLI_ICERIK", "GIZLI_DOSYA_ADI", "GIZLI_DOSYA_ICERIGI"]
        {
            assert!(!metin.contains(gizli), "{metot} {yol} kilitliyken veri sizdirdi: {metin}");
        }
        assert!(!json.is_array(), "{metot} {yol}: basarili liste yaniti dizidir");
    }

    // On besinci uc: POST /api/danisanlar/{id}/ekler (ham govde).
    let (kod, _b, govde) = cagir_ham(
        &s,
        "POST",
        &format!("/api/danisanlar/{cid}/ekler"),
        &[("content-type", "application/pdf"), ("x-dosya-adi", "y.pdf"), ("x-ek-turu", "onam")],
        b"YENI_GIZLI".to_vec(),
    )
    .await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED, "ek yukleme kilitliyken 401 donmeli");
    assert!(!String::from_utf8_lossy(&govde).contains("YENI_GIZLI"));
}

/// Kilitliyken indirme yolu **ham baytları da** sızdırmamalı: JSON gövde
/// kontrolü tek başına yetmez, bu uç nokta binary döner.
#[tokio::test]
async fn kilitliyken_ek_indirme_ham_bayt_sizdirmaz() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let ek_id = ek_yukle(&s, cid, "onam.pdf", b"GIZLI_PDF_BAYTLARI").await;
    kilitle(&s).await;

    let (kod, basliklar, govde) =
        cagir_ham(&s, "GET", &format!("/api/ekler/{ek_id}"), &[], Vec::new()).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(
        !String::from_utf8_lossy(&govde).contains("GIZLI_PDF_BAYTLARI"),
        "kilitliyken dosya baytlari donmemeli"
    );
    assert!(
        basliklar.get("content-disposition").is_none(),
        "kilitli yanit bir dosya indirmesi gibi gorunmemeli"
    );
}

#[tokio::test]
async fn kilitliyken_not_yazma_uygulanmaz() {
    let (_d, s, _cid, rid) = dolu_state().await;
    kilitle(&s).await;

    let (kod, _) = cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"KILITLIYKEN_YAZILAN"})),
    )
    .await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);

    kilit_ac(&s).await;
    let (_, not) = cagir(&s, "GET", &format!("/api/randevular/{rid}/not"), None).await;
    assert_eq!(not["icerik"], "", "kilitliyken yapilan yazma kalici olmamali");
}

#[tokio::test]
async fn kilitliyken_ozel_not_yazma_uygulanmaz() {
    let (_d, s, _cid, rid) = dolu_state().await;
    kilitle(&s).await;

    let (kod, _) = cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/ozel-not"),
        Some(json!({"icerik":"KILITLIYKEN_YAZILAN"})),
    )
    .await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);

    kilit_ac(&s).await;
    let (_, not) = cagir(&s, "GET", &format!("/api/randevular/{rid}/ozel-not"), None).await;
    assert_eq!(not["icerik"], "", "kilitliyken yapilan ozel not yazmasi kalici olmamali");
}

#[tokio::test]
async fn kilitliyken_ek_yukleme_ve_silme_uygulanmaz() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let ek_id = ek_yukle(&s, cid, "kalici.pdf", b"kalici").await;
    kilitle(&s).await;

    cagir_ham(
        &s,
        "POST",
        &format!("/api/danisanlar/{cid}/ekler"),
        &[("content-type", "application/pdf"), ("x-dosya-adi", "yeni.pdf"), ("x-ek-turu", "onam")],
        b"yeni".to_vec(),
    )
    .await;
    cagir(&s, "DELETE", &format!("/api/ekler/{ek_id}"), None).await;

    kilit_ac(&s).await;
    let (_, liste) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/ekler"), None).await;
    let ekler = liste.as_array().unwrap();
    assert_eq!(ekler.len(), 1, "kilitliyken ne yukleme ne silme uygulanmali");
    assert_eq!(ekler[0]["dosya_adi"], "kalici.pdf");
}

#[tokio::test]
async fn kilitliyken_danisan_guncelleme_uygulanmaz() {
    let (_d, s, cid, _rid) = dolu_state().await;
    kilitle(&s).await;

    let (kod, _) = cagir(
        &s,
        "PATCH",
        &format!("/api/danisanlar/{cid}"),
        Some(json!({"risk_notu":"KILITLIYKEN_YAZILAN"})),
    )
    .await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);

    kilit_ac(&s).await;
    let (_, d) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}"), None).await;
    assert!(d["risk_notu"].is_null(), "kilitliyken yapilan guncelleme kalici olmamali");
}

// =====================================================================
// 2. BRIEF'IN YEDI TESTI + ARTI YON
// =====================================================================

#[tokio::test]
async fn kilitliyken_not_ucu_401_doner() {
    let (_d, s, _cid, rid) = dolu_state().await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"COK_GIZLI_SEANS_ICERIGI"})),
    )
    .await;
    kilitle(&s).await;

    let (kod, json) = cagir(&s, "GET", &format!("/api/randevular/{rid}/not"), None).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("icerik").is_none(), "kilitliyken not alani donmemeli");
    assert!(!json.to_string().contains("COK_GIZLI_SEANS_ICERIGI"), "{json}");
}

#[tokio::test]
async fn not_yazilir_ve_geri_okunur() {
    let (_d, s, cid, rid) = dolu_state().await;

    let (kod, yazilan) = cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"soap","icerik":"Danisan bugun daha iyiydi."})),
    )
    .await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(yazilan["icerik"], "Danisan bugun daha iyiydi.");

    let (kod, okunan) = cagir(&s, "GET", &format!("/api/randevular/{rid}/not"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(okunan["icerik"], "Danisan bugun daha iyiydi.");
    assert_eq!(okunan["sablon"], "soap");
    assert_eq!(okunan["client_id"], cid);
}

#[tokio::test]
async fn notu_olmayan_randevu_bos_not_dondurur_404_degil() {
    let (_d, s, _cid, rid) = dolu_state().await;
    let (kod, not) = cagir(&s, "GET", &format!("/api/randevular/{rid}/not"), None).await;
    assert_eq!(kod, StatusCode::OK, "editor acilirken 404 gosterilmemeli");
    assert_eq!(not["icerik"], "");
    assert_eq!(not["sablon"], "dap", "varsayilan sablon DAP");
}

#[tokio::test]
async fn ozel_not_ayri_uctan_gider_ve_danisan_notlarinda_gorunmez() {
    let (_d, s, cid, rid) = dolu_state().await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"resmi icerik"})),
    )
    .await;
    let (kod, _) = cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/ozel-not"),
        Some(json!({"icerik":"GIZLI"})),
    )
    .await;
    assert_eq!(kod, StatusCode::OK);

    // Ozel not KENDI ucundan okunabilir (arti yon).
    let (kod, ozel) = cagir(&s, "GET", &format!("/api/randevular/{rid}/ozel-not"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(ozel["icerik"], "GIZLI");

    // ... ama danisan not listesinde YOK.
    let (kod, liste) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/notlar"), None).await;
    assert_eq!(kod, StatusCode::OK);
    let notlar = liste.as_array().unwrap();
    // On kosul: liste BOS DEGIL, yoksa asagidaki iddia totoloji olurdu.
    assert_eq!(notlar.len(), 1, "resmi not listede gorunmeli");
    assert_eq!(notlar[0]["icerik"], "resmi icerik");
    assert!(!liste.to_string().contains("GIZLI"), "ozel not liste yanitinda gecmemeli: {liste}");

    // Resmi not ucu da ozel notu vermez.
    let (_, resmi) = cagir(&s, "GET", &format!("/api/randevular/{rid}/not"), None).await;
    assert_eq!(resmi["icerik"], "resmi icerik");
    assert!(!resmi.to_string().contains("GIZLI"));
}

/// KVKK md. 11 kapsamındaki dışa aktarım, terapistin özel notlarını **asla**
/// içermemeli. Bugün ayrı bir "rapor" uç noktası yoktur; danışanın verisi
/// API üzerinden okunabilen uç noktaların **toplamıdır**. Bu test o toplamı
/// gezer.
#[tokio::test]
async fn danisan_veri_raporu_ozel_not_icermez() {
    let (_d, s, cid, rid) = dolu_state().await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"RESMI_KAYIT_METNI"})),
    )
    .await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/ozel-not"),
        Some(json!({"icerik":"OZEL_HIPOTEZ_METNI"})),
    )
    .await;
    ek_yukle(&s, cid, "onam.pdf", b"onam").await;
    cagir(&s, "PATCH", &format!("/api/danisanlar/{cid}"), Some(json!({"risk_notu":"dusuk"})))
        .await;

    let yollar = [
        format!("/api/danisanlar/{cid}"),
        format!("/api/danisanlar/{cid}/notlar?limit=200"),
        format!("/api/danisanlar/{cid}/ekler"),
        "/api/danisanlar".to_string(),
        "/api/randevular?baslangic=2026-01-01T00:00&bitis=2027-01-01T00:00".to_string(),
        "/api/ara?q=METNI".to_string(),
        "/api/saklama-suresi-dolanlar?bugun=2099-01-01".to_string(),
        "/api/depolama-durumu".to_string(),
    ];

    let mut resmi_gorundu = false;
    for yol in &yollar {
        let (kod, json) = cagir(&s, "GET", yol, None).await;
        assert_eq!(kod, StatusCode::OK, "{yol}");
        let metin = json.to_string();
        assert!(
            !metin.contains("OZEL_HIPOTEZ_METNI"),
            "ozel not disa acik bir yoldan sizdi -- {yol}: {metin}"
        );
        if metin.contains("RESMI_KAYIT_METNI") {
            resmi_gorundu = true;
        }
    }
    // On kosul: bu gezinti gercekten VERI okuyor. Olmadan, her seye bos yanit
    // veren bir API testi gecerdi.
    assert!(resmi_gorundu, "resmi not en az bir yoldan gorunmeli, yoksa test totoloji");
}

#[tokio::test]
async fn ek_dosya_yuklenir_ve_liste_icerik_tasimaz() {
    let (_d, s, cid, _rid) = dolu_state().await;

    let (kod, _b, govde) = cagir_ham(
        &s,
        "POST",
        &format!("/api/danisanlar/{cid}/ekler"),
        &[("content-type", "application/pdf"), ("x-dosya-adi", "onam.pdf"), ("x-ek-turu", "onam")],
        b"GIZLI_PDF_ICERIGI".to_vec(),
    )
    .await;
    assert_eq!(kod, StatusCode::CREATED);
    let ek: serde_json::Value = serde_json::from_slice(&govde).unwrap();
    assert_eq!(ek["dosya_adi"], "onam.pdf");
    assert_eq!(ek["boyut"], 17);
    assert!(ek["id"].as_i64().unwrap() > 0);

    let (kod, liste) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/ekler"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1, "on kosul: liste bos olmamali");
    assert!(liste.to_string().contains("onam.pdf"));
    assert!(!liste.to_string().contains("GIZLI_PDF_ICERIGI"), "liste icerik tasimamali: {liste}");
}

#[tokio::test]
async fn arama_ozel_not_dondurmez() {
    let (_d, s, cid, rid) = dolu_state().await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"kaygi duzeyi dusuyor"})),
    )
    .await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/ozel-not"),
        Some(json!({"icerik":"ANAHTARKELIME gizli hipotez"})),
    )
    .await;

    // ARTI YON: arama resmi notu BULUR (yoksa asagidaki eksi yon totoloji).
    let (kod, sonuc) = cagir(&s, "GET", "/api/ara?q=kaygi", None).await;
    assert_eq!(kod, StatusCode::OK);
    let bulunan = sonuc.as_array().unwrap();
    assert_eq!(bulunan.len(), 1, "resmi not bulunmali: {sonuc}");
    assert_eq!(bulunan[0]["tur"], "not");
    assert_eq!(bulunan[0]["client_id"], cid);

    // EKSI YON: ozel nottaki kelime hicbir sey dondurmez.
    let (kod, sonuc) = cagir(&s, "GET", "/api/ara?q=ANAHTARKELIME", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert!(sonuc.as_array().unwrap().is_empty(), "ozel not aramaya girmemeli: {sonuc}");
    assert!(!sonuc.to_string().contains("hipotez"));
}

#[tokio::test]
async fn gecersiz_sablon_400_doner() {
    let (_d, s, _cid, rid) = dolu_state().await;

    let (kod, json) = cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"benimki","icerik":"x"})),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    // Mesaj NE OLDUGUNU soylemeli: "her hata parola hatasidir" sinifi bu kod
    // tabaninda dort katmanda bulundu.
    let mesaj = json["hata"].as_str().unwrap_or_default().to_string();
    assert!(mesaj.contains("şablon"), "hangi alanin sorunlu oldugunu soylemeli: {mesaj}");
    assert!(mesaj.contains("benimki"), "reddedilen degeri soylemeli: {mesaj}");

    // ARTI YON: gecerli uc sablonun ucu de kabul edilir.
    for sablon in ["dap", "soap", "serbest"] {
        let (kod, _) = cagir(
            &s,
            "PUT",
            &format!("/api/randevular/{rid}/not"),
            Some(json!({"sablon": sablon, "icerik":"x"})),
        )
        .await;
        assert_eq!(kod, StatusCode::OK, "{sablon} kabul edilmeliydi");
    }
}

// =====================================================================
// 3. LIMIT DOGRULAMASI (`?limit=`)
// =====================================================================

/// `store::notes::danisan_notlari`'nın `limit`'i bilerek doğrulanmaz ve
/// SQLite'ta `LIMIT -1` **sınırsız** demektir. Sınırı koymak rotanın işi.
#[tokio::test]
async fn not_listesi_limiti_rota_katmaninda_kirpilir() {
    let (_d, s) = kurulu_state().await;
    let cid = danisan_ekle(&s, "Ayse Yilmaz").await;
    for gun in ["2026-09-07", "2026-09-14", "2026-09-21"] {
        let rid = randevu_ekle(&s, cid, gun).await;
        cagir(
            &s,
            "PUT",
            &format!("/api/randevular/{rid}/not"),
            Some(json!({"sablon":"dap","icerik": format!("not {gun}")})),
        )
        .await;
    }

    let say = |v: &serde_json::Value| v.as_array().unwrap().len();

    // ARTI YON: limitsiz ve gecerli limit dogru calisir.
    let (_, hepsi) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/notlar"), None).await;
    assert_eq!(say(&hepsi), 3, "varsayilan limit ucunu de vermeli");
    let (_, ikisi) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/notlar?limit=2"), None).await;
    assert_eq!(say(&ikisi), 2, "gecerli limit oldugu gibi uygulanmali");

    // EKSI YON: -1 "sinirsiz" olmamali, 1'e kirpilmali.
    let (kod, eksi) =
        cagir(&s, "GET", &format!("/api/danisanlar/{cid}/notlar?limit=-1"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(say(&eksi), 1, "limit=-1 SQLite'ta SINIRSIZ demektir; 1'e kirpilmali");

    // 0 sessizce bos liste vermemeli ("bu danisanin notu yok" yanilsamasi).
    let (_, sifir) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/notlar?limit=0"), None).await;
    assert_eq!(say(&sifir), 1, "limit=0 bos liste degil, 1'e kirpilmis liste vermeli");

    // Cok buyuk deger ust sinira kirpilir; var olan uc not yine doner.
    let (_, buyuk) = cagir(
        &s,
        "GET",
        &format!("/api/danisanlar/{cid}/notlar?limit=9223372036854775807"),
        None,
    )
    .await;
    assert_eq!(say(&buyuk), 3);
}

/// İnceleme I2: `?once=` ile "bu seanstan önce" kesmesi.
///
/// Kesme olmadan "Önceki seans notları" paneli, terapist geçmiş bir seansı
/// açtığında o seanstan SONRAKİ notları gösteriyordu.
#[tokio::test]
async fn not_listesi_once_ile_sonraki_seanslari_kesmeli() {
    let (_d, s) = kurulu_state().await;
    let cid = danisan_ekle(&s, "Ayse Yilmaz").await;
    let mut kimlikler = Vec::new();
    for gun in ["2026-06-01", "2026-07-01", "2026-08-01"] {
        let rid = randevu_ekle(&s, cid, gun).await;
        cagir(
            &s,
            "PUT",
            &format!("/api/randevular/{rid}/not"),
            Some(json!({"sablon":"dap","icerik": format!("not {gun}")})),
        )
        .await;
        kimlikler.push(rid);
    }

    // ON KOSUL / ARTI YON: `once` verilmeyince kesme YOK -- veri raporu
    // (KVKK md. 11) tum notlari almaya devam ediyor.
    let (kod, hepsi) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/notlar"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(hepsi.as_array().unwrap().len(), 3, "once yoksa hepsi donmeli");

    // Ortadaki seans aciliyor: SONRAKI (agustos) listeye giremez.
    let (kod, kesmeli) = cagir(
        &s,
        "GET",
        &format!("/api/danisanlar/{cid}/notlar?limit=50&once=2026-07-01T14:00"),
        None,
    )
    .await;
    assert_eq!(kod, StatusCode::OK);
    let icerikler: Vec<&str> =
        kesmeli.as_array().unwrap().iter().map(|n| n["icerik"].as_str().unwrap()).collect();
    assert_eq!(
        icerikler,
        vec!["not 2026-06-01"],
        "yalnizca ONCEKI seansin notu donmeli: {icerikler:?}"
    );

    // Bicimi tutmayan bir `once` enjeksiyon degil, bos liste uretir.
    let (kod, sacma) = cagir(
        &s,
        "GET",
        &format!("/api/danisanlar/{cid}/notlar?once=0000-00-00T00:00'%20OR%20'1'='1"),
        None,
    )
    .await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(sacma.as_array().unwrap().len(), 0, "anlamsiz kesme bos liste vermeli");
}

/// İnceleme I3: sıralama anahtarı (`a.baslangic`) yanıtta görünür olmalı.
/// Ekrandaki tek tarih `guncelleme_zamani` iken liste sık sık sırasız
/// görünüyordu — ikisi farklı niceliklerdir.
#[tokio::test]
async fn not_yanitlari_seans_zamanini_tasir() {
    let (_d, s) = kurulu_state().await;
    let cid = danisan_ekle(&s, "Ayse Yilmaz").await;
    let haziran = randevu_ekle(&s, cid, "2026-06-01").await;
    let agustos = randevu_ekle(&s, cid, "2026-08-01").await;
    for rid in [haziran, agustos] {
        cagir(
            &s,
            "PUT",
            &format!("/api/randevular/{rid}/not"),
            Some(json!({"sablon":"dap","icerik":"metin"})),
        )
        .await;
    }

    let (_, liste) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/notlar"), None).await;
    let zamanlar: Vec<&str> =
        liste.as_array().unwrap().iter().map(|n| n["seans_zamani"].as_str().unwrap()).collect();
    assert_eq!(
        zamanlar,
        vec!["2026-08-01T14:00", "2026-06-01T14:00"],
        "liste `a.baslangic DESC` ile geliyor; o anahtar yanitta gorunmeli"
    );

    // Tek not ucu da tasir (editor basliginin ve raporun ayni kaynagi).
    let (_, tek) = cagir(&s, "GET", &format!("/api/randevular/{haziran}/not"), None).await;
    assert_eq!(tek["seans_zamani"].as_str().unwrap(), "2026-06-01T14:00");
    // Notu OLMAYAN randevu da: bos not donerken de alan dolu gelmeli.
    let bos = randevu_ekle(&s, cid, "2026-09-07").await;
    let (_, bos_not) = cagir(&s, "GET", &format!("/api/randevular/{bos}/not"), None).await;
    assert_eq!(bos_not["icerik"].as_str().unwrap(), "");
    assert_eq!(bos_not["seans_zamani"].as_str().unwrap(), "2026-09-07T14:00");
}

#[tokio::test]
async fn arama_limiti_de_kirpilir() {
    // KURULUM AYRIMI TASIMALI. Bu testin onceki hali TEK eslesen kayit
    // yaratiyordu; `limit=-1` (SQLite'ta sinirsiz), 50 ve 1 ayni tek sonucu
    // verdigi icin `store::search::ara`'daki `clamp(1, AZAMI_SONUC)` silinince
    // test YESIL kaliyordu -- kurulum, olculen anahtari gorunmez kiliyordu.
    // Kardes `not_listesi_limiti_rota_katmaninda_kirpilir` bu yuzden UC kayit
    // kurar; burada da oyle yapiliyor.
    let (_d, s) = kurulu_state().await;
    let cid = danisan_ekle(&s, "Ayse Yilmaz").await;
    for gun in ["2026-09-07", "2026-09-14", "2026-09-21"] {
        let rid = randevu_ekle(&s, cid, gun).await;
        cagir(
            &s,
            "PUT",
            &format!("/api/randevular/{rid}/not"),
            Some(json!({"sablon":"dap","icerik": format!("kaygi duzeyi {gun}")})),
        )
        .await;
    }

    let say = |v: &serde_json::Value| v.as_array().unwrap().len();

    // ON KOSUL + ARTI YON: uc not da gercekten eslesiyor, yani asagidaki
    // sayilar limitin FARKINI olcuyor, kurulumun darligini degil.
    let (kod, varsayilan) = cagir(&s, "GET", "/api/ara?q=kaygi", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(say(&varsayilan), 3, "varsayilan limit (AZAMI_SONUC) ucunu de vermeli");

    let (_, ikisi) = cagir(&s, "GET", "/api/ara?q=kaygi&limit=2", None).await;
    assert_eq!(say(&ikisi), 2, "gecerli limit oldugu gibi uygulanmali");

    // EKSI YON: -1 SQLite'ta SINIRSIZ demektir; alt uctan 1'e kirpilmali.
    // Kirpma silinirse burada 3 doner ve test kirilir.
    let (kod, eksi) = cagir(&s, "GET", "/api/ara?q=kaygi&limit=-1", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(say(&eksi), 1, "limit=-1 sinirsiz olmamali, 1'e kirpilmali");

    let (_, sifir) = cagir(&s, "GET", "/api/ara?q=kaygi&limit=0", None).await;
    assert_eq!(say(&sifir), 1, "limit=0 sessizce bos liste vermemeli");

    // UST UC: cok buyuk deger `AZAMI_SONUC`'a kirpilir. Sinirin KENDISI
    // (50) cekirdegin `azami_sonuc_asilmaz` testinde 55 kayitla olculuyor;
    // burada olculen, HTTP'den gelen devasa degerin yutulmasi.
    let (_, buyuk) = cagir(&s, "GET", "/api/ara?q=kaygi&limit=9223372036854775807", None).await;
    assert_eq!(say(&buyuk), 3);
}

#[tokio::test]
async fn iki_karakterden_kisa_sorgu_bos_liste_dondurur() {
    let (_d, s, _cid, rid) = dolu_state().await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"kaygi"})),
    )
    .await;

    let (kod, sonuc) = cagir(&s, "GET", "/api/ara?q=k", None).await;
    assert_eq!(kod, StatusCode::OK, "kisa sorgu hata degil, bos liste");
    assert!(sonuc.as_array().unwrap().is_empty());
}

// =====================================================================
// 4. EK DOSYA INDIRME -- BASLIK TUZAKLARI
// =====================================================================

#[tokio::test]
async fn ek_indirilir_ve_icerik_bozulmadan_gelir() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let icerik: Vec<u8> = (0u8..=255).collect();
    let (kod, _b, govde) = cagir_ham(
        &s,
        "POST",
        &format!("/api/danisanlar/{cid}/ekler"),
        &[
            ("content-type", "application/octet-stream"),
            ("x-dosya-adi", "veri.bin"),
            ("x-ek-turu", "diger"),
        ],
        icerik.clone(),
    )
    .await;
    assert_eq!(kod, StatusCode::CREATED);
    let ek: serde_json::Value = serde_json::from_slice(&govde).unwrap();
    let ek_id = ek["id"].as_i64().unwrap();

    let (kod, basliklar, inen) =
        cagir_ham(&s, "GET", &format!("/api/ekler/{ek_id}"), &[], Vec::new()).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(inen, icerik, "ikili icerik bozulmadan donmeli");
    assert_eq!(basliklar.get("content-type").unwrap(), "application/octet-stream");
}

/// `Content-Disposition` üç şeyi birden yapmalı: `attachment` olmalı
/// (`inline` DEĞİL), Türkçe adı RFC 5987 ile taşımalı ve başlığı ham UTF-8
/// ile parçalamamalı.
#[tokio::test]
async fn indirme_content_disposition_attachment_ve_rfc5987() {
    let (_d, s, cid, _rid) = dolu_state().await;
    // "değerlendirme raporu.pdf" -- Turkce harf + bosluk.
    let ek_id = ek_yukle(&s, cid, "de%C4%9Ferlendirme%20raporu.pdf", b"icerik").await;

    let (kod, basliklar, _g) =
        cagir_ham(&s, "GET", &format!("/api/ekler/{ek_id}"), &[], Vec::new()).await;
    assert_eq!(kod, StatusCode::OK);

    let cd = basliklar.get("content-disposition").expect("Content-Disposition olmali");
    let cd = cd.to_str().unwrap();
    assert!(cd.starts_with("attachment"), "gomulu (inline) acilmamali: {cd}");
    assert!(!cd.contains("inline"), "{cd}");
    // RFC 5987: ham UTF-8 DEGIL, yuzde kodlamali.
    assert!(cd.contains("filename*=UTF-8''"), "{cd}");
    assert!(cd.contains("de%C4%9Ferlendirme%20raporu.pdf"), "{cd}");
    assert!(!cd.contains('ğ'), "ham UTF-8 basliga girmemeli: {cd}");
    // ASCII yedegi de var ve tirnaklari bozmuyor.
    assert!(cd.contains("filename=\"de_erlendirme raporu.pdf\""), "{cd}");
    // Basligin tamami gorunur ASCII: yoksa istemci basligi parcalar.
    assert!(cd.chars().all(|c| c == ' ' || c.is_ascii_graphic()), "{cd}");
}

/// `mime` alanı `tip/alttip` biçimini geçirir ama RFC 9110 token kümesini
/// zorlamaz; başlığa konulmadan önce kodlanmalı, uymayan değer
/// `application/octet-stream`'e düşmeli.
#[tokio::test]
async fn indirme_gecersiz_token_tasiyan_mimeyi_octet_streame_dusurur() {
    let (_d, s, cid, _rid) = dolu_state().await;
    // `mime_dogrula`'yi gecen ama RFC 9110 token'i OLMAYAN bir deger.
    let (kod, _b, govde) = cagir_ham(
        &s,
        "POST",
        &format!("/api/danisanlar/{cid}/ekler"),
        &[
            ("content-type", "application/pdf%20x"),
            ("x-dosya-adi", "a.pdf"),
            ("x-ek-turu", "diger"),
        ],
        b"x".to_vec(),
    )
    .await;
    // `%20` `tchar`dir, dolayisiyla bu deger token olarak GECERLIDIR; asil
    // sinav asagida, ASCII disi bir MIME ile.
    assert_eq!(kod, StatusCode::CREATED, "{}", String::from_utf8_lossy(&govde));

    // ASCII disi bir MIME dogrudan basliga konulamaz (HeaderValue reddeder).
    // `x-` baslikla gonderilemeyecegi icin depoya DOGRUDAN yazip indiriyoruz.
    let ek_id = ek_yukle(&s, cid, "b.pdf", b"y").await;
    {
        let conn = psikolog_core::store::db::open_existing(
            &s.db_yolu(),
            &s.acik_anahtar().expect("oturum acik olmali"),
        )
        .unwrap();
        conn.execute("UPDATE attachments SET mime = 'application/pdf ödev' WHERE id = ?1", [ek_id])
            .unwrap();
    }

    let (kod, basliklar, inen) =
        cagir_ham(&s, "GET", &format!("/api/ekler/{ek_id}"), &[], Vec::new()).await;
    assert_eq!(kod, StatusCode::OK, "gecersiz MIME indirmeyi patlatmamali");
    assert_eq!(
        basliklar.get("content-type").unwrap(),
        "application/octet-stream",
        "token disi MIME guvenli degere dusmeli"
    );
    assert_eq!(
        basliklar.get("x-content-type-options").unwrap(),
        "nosniff",
        "octet-stream'e dusuldugunde tarayici tur tahmin etmemeli"
    );
    assert_eq!(inen, b"y", "icerik yine de dogru donmeli");
}

#[tokio::test]
async fn olmayan_ek_404_doner() {
    let (_d, s, cid, _rid) = dolu_state().await;
    // ARTI YON: var olan ek 200.
    let ek_id = ek_yukle(&s, cid, "a.pdf", b"x").await;
    let (kod, _b, _g) = cagir_ham(&s, "GET", &format!("/api/ekler/{ek_id}"), &[], Vec::new()).await;
    assert_eq!(kod, StatusCode::OK);

    // EKSI YON.
    let (kod, json) = cagir(&s, "GET", "/api/ekler/999999", None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND, "{json}");
    let (kod, _) = cagir(&s, "DELETE", "/api/ekler/999999", None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn ek_silinir_ve_listeden_cikar() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let ek_id = ek_yukle(&s, cid, "a.pdf", b"x").await;

    let (kod, _) = cagir(&s, "DELETE", &format!("/api/ekler/{ek_id}"), None).await;
    assert_eq!(kod, StatusCode::OK);

    let (_, liste) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/ekler"), None).await;
    assert!(liste.as_array().unwrap().is_empty());
    let (kod, _b, _g) = cagir_ham(&s, "GET", &format!("/api/ekler/{ek_id}"), &[], Vec::new()).await;
    assert_eq!(kod, StatusCode::NOT_FOUND, "silinen ek indirilememeli");
}

// =====================================================================
// 5. GOVDE BOYUTU SINIRI
// =====================================================================

/// Sınırın **tam üzerindeki** dosya kabul edilir. Bu yön olmadan
/// `DefaultBodyLimit`'i 1 bayta çeken bir mutasyon aşağıdaki "aşan reddedilir"
/// testini yine geçerdi.
#[tokio::test]
async fn tam_sinirdaki_dosya_kabul_edilir() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let tam = vec![7u8; AZAMI_DOSYA_BOYUTU];
    let (kod, _b, govde) = cagir_ham(
        &s,
        "POST",
        &format!("/api/danisanlar/{cid}/ekler"),
        &[
            ("content-type", "application/octet-stream"),
            ("x-dosya-adi", "tam.bin"),
            ("x-ek-turu", "diger"),
        ],
        tam,
    )
    .await;
    assert_eq!(
        kod,
        StatusCode::CREATED,
        "20 MB'lik GECERLI dosya kabul edilmeli: {}",
        String::from_utf8_lossy(&govde)
    );
    let ek: serde_json::Value = serde_json::from_slice(&govde).unwrap();
    assert_eq!(ek["boyut"], AZAMI_DOSYA_BOYUTU as i64);
}

#[tokio::test]
async fn siniri_asan_govde_reddedilir_ve_kaydedilmez() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let buyuk = vec![0u8; AZAMI_DOSYA_BOYUTU + 1];
    let (kod, _b, _g) = cagir_ham(
        &s,
        "POST",
        &format!("/api/danisanlar/{cid}/ekler"),
        &[
            ("content-type", "application/octet-stream"),
            ("x-dosya-adi", "buyuk.bin"),
            ("x-ek-turu", "diger"),
        ],
        buyuk,
    )
    .await;
    assert_eq!(kod, StatusCode::PAYLOAD_TOO_LARGE, "siniri asan govde 413 almali");

    let (_, liste) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}/ekler"), None).await;
    assert!(liste.as_array().unwrap().is_empty(), "reddedilen yukleme kaydedilmemeli");
}

// =====================================================================
// 6. HATA ESLEMESI DUZLESTIRILMEZ
// =====================================================================

/// `attachments::ekle`'nin **on üç** ayrı red mesajı vardır ve
/// `guard::depo_hatasi` bunları doğrudan HTTP gövdesine koyar. Eşleme
/// bunları düzleştirmemeli: kullanıcı hangi alanı düzelteceğini bilmeli.
///
/// On üçün **on ikisi** HTTP'den erişilebilir ve hepsi burada pinlidir. Bu
/// testin ilk hâli yalnızca sekizini kapsıyordu; kapsanmayan dördü arasında
/// **MIME'de denetim karakteri** vardı — Görev 5'te mutasyonla kanıtlandığı
/// gibi, o doğrulayıcı kaldırıldığında `mime: "application/pdf\r\nX-Enjekte: 1"`
/// kabul edilir ve değer bu görevin indirme rotasında doğrudan
/// `Content-Type` başlığına konur (CRLF enjeksiyonu; bkz.
/// `store::attachments::mime_dogrula` belgesi). HTTP'de `\r\n` bir başlık
/// değerine hiç konulamadığı için burada **HTAB** ile ölçülür: aynı
/// `is_control()` dalıdır.
///
/// On üçüncü ("Dosya çok büyük") HTTP'den **erişilemez**: `DefaultBodyLimit`
/// daha gövde okunmadan `413` döndürür, `ekle` hiç çağrılmaz. O yol
/// `core`'un `mesajlar_birbirinden_ayirt_edilebilir` testinde ve buradaki
/// `siniri_asan_govde_reddedilir_ve_kaydedilmez` testinde ölçülür.
#[tokio::test]
async fn ek_yukleme_hatalari_birbirinden_ayirt_edilebilir() {
    let (_d, s, cid, _rid) = dolu_state().await;

    /// (vaka adı, dosya adı (yüzde kodlu), mime, tür, içerik, mesajda
    /// **geçmesi** gereken anahtar kelimeler)
    type RedVakasi = (&'static str, String, String, &'static str, Vec<u8>, Vec<&'static str>);

    let uzun_ad = "a".repeat(300);
    let uzun_mime = format!("application/{}", "a".repeat(130));
    let denemeler: Vec<RedVakasi> = vec![
        ("bos ad", "%20%20".into(), "application/pdf".into(), "onam", b"x".to_vec(), vec![
            "Dosya adı", "boş",
        ]),
        ("uzun ad", uzun_ad, "application/pdf".into(), "onam", b"x".to_vec(), vec![
            "Dosya adı", "uzun", "255",
        ]),
        (
            "yol ayiraci",
            "..%2Fgizli.pdf".into(),
            "application/pdf".into(),
            "onam",
            b"x".to_vec(),
            vec!["Dosya adı", "yol ayıracı"],
        ),
        (
            // `..` yol ayiraci TASIMAZ; ayri bir red yoludur.
            "nokta adi",
            "..".into(),
            "application/pdf".into(),
            "onam",
            b"x".to_vec(),
            vec!["Dosya adı", "geçerli"],
        ),
        (
            // Adda denetim karakteri: `Content-Disposition`'a gidecek deger.
            "addaki denetim karakteri",
            "a%0Ab.pdf".into(),
            "application/pdf".into(),
            "onam",
            b"x".to_vec(),
            vec!["Dosya adı", "denetim karakteri"],
        ),
        (
            "yon degistiren karakter",
            "annexe%E2%80%AEfdp.exe".into(),
            "application/pdf".into(),
            "onam",
            b"x".to_vec(),
            vec!["Dosya adı", "yön"],
        ),
        ("bos mime", "a.pdf".into(), "  ".into(), "onam", b"x".to_vec(), vec!["MIME", "boş"]),
        ("uzun mime", "a.pdf".into(), uzun_mime, "onam", b"x".to_vec(), vec![
            "MIME", "uzun", "128",
        ]),
        (
            // CRLF ENJEKSIYON KAPISI. `\r\n` bir HTTP baslik degerine hic
            // konulamaz; ayni `is_control()` dalini HTAB ile olcuyoruz.
            // Bu dogrulayici kaldirilirsa deger indirme rotasinda dogrudan
            // `Content-Type` basligina gider.
            "mime denetim karakteri",
            "a.pdf".into(),
            "application/pdf\tX-Enjekte: 1".into(),
            "onam",
            b"x".to_vec(),
            vec!["MIME", "denetim karakteri"],
        ),
        ("bicimsiz mime", "a.pdf".into(), "x".into(), "onam", b"x".to_vec(), vec![
            "MIME", "tip/alttip",
        ]),
        ("gecersiz tur", "a.pdf".into(), "application/pdf".into(), "baska", b"x".to_vec(), vec![
            "tür", "baska", "onam",
        ]),
        ("bos icerik", "a.pdf".into(), "application/pdf".into(), "onam", Vec::new(), vec![
            "Dosya boş", "0 bayt",
        ]),
    ];

    // Vaka sayisi da pinli (Gorev 5'teki desen): `ekle`ye yeni bir red yolu
    // eklendiginde HTTP'den erisilebilirligi de burada karara baglanmali,
    // yoksa yeni yol sessizce kapsam disi kalir.
    assert_eq!(
        denemeler.len(),
        12,
        "`ekle`nin HTTP'den ERISILEBILEN her red yolu burada olmali (on ucuncusu \
         `DefaultBodyLimit` yuzunden 413'e gider, bkz. test belgesi)"
    );

    let mut mesajlar: Vec<String> = Vec::new();
    for (vaka, ad, mime, tur, icerik, anahtarlar) in &denemeler {
        let (kod, _b, govde) = cagir_ham(
            &s,
            "POST",
            &format!("/api/danisanlar/{cid}/ekler"),
            &[("content-type", mime), ("x-dosya-adi", ad), ("x-ek-turu", tur)],
            icerik.clone(),
        )
        .await;
        assert_eq!(kod, StatusCode::BAD_REQUEST, "'{vaka}' 400 donmeli");
        let json: serde_json::Value = serde_json::from_slice(&govde).unwrap();
        let mesaj = json["hata"].as_str().unwrap_or_default().to_string();
        for anahtar in anahtarlar {
            assert!(
                mesaj.contains(anahtar),
                "'{vaka}' mesaji '{anahtar}' gecirmeli, ne oldugunu soylemeli: {mesaj}"
            );
        }
        // Dosya adi hata metnine GIRMEZ.
        assert!(!mesaj.contains("gizli.pdf"), "hata mesaji dosya adi tasimamali: {mesaj}");
        mesajlar.push(mesaj);
    }

    // Hicbir ikisi ayni degil: "Dosya eklenemedi." duzlestirmesi burada kirilir.
    let mut benzersiz = mesajlar.clone();
    benzersiz.sort();
    benzersiz.dedup();
    assert_eq!(benzersiz.len(), mesajlar.len(), "mesajlar duzlestirilmis: {mesajlar:?}");
}

#[tokio::test]
async fn eksik_baslik_400_doner_ve_hangi_baslik_oldugunu_soyler() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let yol = format!("/api/danisanlar/{cid}/ekler");

    // `x-dosya-adi` yok.
    let (kod, _b, g) = cagir_ham(
        &s,
        "POST",
        &yol,
        &[("content-type", "application/pdf"), ("x-ek-turu", "onam")],
        b"x".to_vec(),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    let j: serde_json::Value = serde_json::from_slice(&g).unwrap();
    assert!(j["hata"].as_str().unwrap().contains("x-dosya-adi"), "{j}");

    // `x-ek-turu` yok.
    let (kod, _b, g) = cagir_ham(
        &s,
        "POST",
        &yol,
        &[("content-type", "application/pdf"), ("x-dosya-adi", "a.pdf")],
        b"x".to_vec(),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    let j: serde_json::Value = serde_json::from_slice(&g).unwrap();
    assert!(j["hata"].as_str().unwrap().contains("x-ek-turu"), "{j}");

    // Bozuk yuzde kodlamasi.
    let (kod, _b, g) = cagir_ham(
        &s,
        "POST",
        &yol,
        &[("content-type", "application/pdf"), ("x-dosya-adi", "a%ZZ.pdf"), ("x-ek-turu", "onam")],
        b"x".to_vec(),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    let j: serde_json::Value = serde_json::from_slice(&g).unwrap();
    assert!(j["hata"].as_str().unwrap().contains("kodlamalı"), "{j}");
}

#[tokio::test]
async fn olmayan_kayitlar_404_doner() {
    let (_d, s, _cid, _rid) = dolu_state().await;
    for (metot, yol, govde) in [
        ("GET", "/api/randevular/999999/not", None),
        ("GET", "/api/randevular/999999/ozel-not", None),
        (
            "PUT",
            "/api/randevular/999999/not",
            Some(json!({"sablon":"dap","icerik":"x"})),
        ),
        ("PUT", "/api/randevular/999999/ozel-not", Some(json!({"icerik":"x"}))),
        ("GET", "/api/danisanlar/999999", None),
        ("PATCH", "/api/danisanlar/999999", Some(json!({"risk_notu":"x"}))),
        ("GET", "/api/danisanlar/999999/notlar", None),
        ("GET", "/api/danisanlar/999999/ekler", None),
    ] {
        let (kod, json) = cagir(&s, metot, yol, govde).await;
        assert_eq!(kod, StatusCode::NOT_FOUND, "{metot} {yol} 404 donmeli: {json}");
    }
}

// =====================================================================
// 7. DANISAN DOSYASI (GET/PATCH) VE SAKLAMA LISTESI
// =====================================================================

#[tokio::test]
async fn danisan_dosyasi_okunur_ve_kismi_guncellenir() {
    let (_d, s, cid, _rid) = dolu_state().await;

    let (kod, d) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(d["ad_soyad"], "Ayse Yilmaz");
    assert!(d["risk_notu"].is_null());

    let (kod, guncel) = cagir(
        &s,
        "PATCH",
        &format!("/api/danisanlar/{cid}"),
        Some(json!({"risk_notu":"dusuk risk","riza_tarihi":"2026-09-01"})),
    )
    .await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(guncel["risk_notu"], "dusuk risk");
    assert_eq!(guncel["riza_tarihi"], "2026-09-01");
    // Gonderilmeyen alan DOKUNULMAMIS olmali.
    assert_eq!(guncel["ad_soyad"], "Ayse Yilmaz");

    let (_, tekrar) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}"), None).await;
    assert_eq!(tekrar["risk_notu"], "dusuk risk", "guncelleme kalici olmali");
}

#[tokio::test]
async fn danisan_guncellemesi_gecersiz_veriyi_400_ile_reddeder() {
    let (_d, s, cid, _rid) = dolu_state().await;

    let (kod, json) =
        cagir(&s, "PATCH", &format!("/api/danisanlar/{cid}"), Some(json!({"ad_soyad":"  "})))
            .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("adı"), "{json}");

    let (kod, json) = cagir(
        &s,
        "PATCH",
        &format!("/api/danisanlar/{cid}"),
        Some(json!({"dogum_tarihi":"07/09/1990"})),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("Doğum"), "hangi alan: {json}");

    // Reddedilen istek HICBIR sey yazmamali.
    let (_, d) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}"), None).await;
    assert_eq!(d["ad_soyad"], "Ayse Yilmaz");
    assert!(d["dogum_tarihi"].is_null());
}

/// `riza_dosya_id` için `null` = "bağı kopar", alanı hiç göndermemek =
/// "dokunma". İki durum HTTP katmanında da ayrışmalı.
#[tokio::test]
async fn riza_dosya_bagi_null_ile_koparilir_alan_yoksa_korunur() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let ek_id = ek_yukle(&s, cid, "onam.pdf", b"onam").await;

    let (kod, d) = cagir(
        &s,
        "PATCH",
        &format!("/api/danisanlar/{cid}"),
        Some(json!({ "riza_dosya_id": ek_id })),
    )
    .await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(d["riza_dosya_id"], ek_id);

    // Alan gonderilmedi -> DOKUNMA.
    let (_, d) =
        cagir(&s, "PATCH", &format!("/api/danisanlar/{cid}"), Some(json!({"risk_notu":"x"}))).await;
    assert_eq!(d["riza_dosya_id"], ek_id, "alan gonderilmeyince bag korunmali");

    // `null` -> BAGI KOPAR.
    let (_, d) = cagir(
        &s,
        "PATCH",
        &format!("/api/danisanlar/{cid}"),
        Some(json!({ "riza_dosya_id": serde_json::Value::Null })),
    )
    .await;
    assert!(d["riza_dosya_id"].is_null(), "null bagi koparmali");
}

#[tokio::test]
async fn saklama_suresi_dolanlar_listelenir_ama_silinmez() {
    let (_d, s, cid, rid) = dolu_state().await;
    // "geldi" isaretlemek son temasi ve saklama bitisini yazar.
    let (kod, _) =
        cagir(&s, "PATCH", &format!("/api/randevular/{rid}"), Some(json!({"durum":"geldi"}))).await;
    assert_eq!(kod, StatusCode::OK);

    // EKSI YON: saklama suresi dolmadan liste bos.
    let (kod, bos) = cagir(&s, "GET", "/api/saklama-suresi-dolanlar?bugun=2026-09-08", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert!(bos.as_array().unwrap().is_empty(), "suresi dolmamis dosya listede olmamali: {bos}");

    // ARTI YON: yedi yil sonra listede.
    let (kod, dolu) = cagir(&s, "GET", "/api/saklama-suresi-dolanlar?bugun=2099-01-01", None).await;
    assert_eq!(kod, StatusCode::OK);
    let liste = dolu.as_array().unwrap();
    assert_eq!(liste.len(), 1, "suresi dolan dosya listelenmeli: {dolu}");
    assert_eq!(liste[0]["id"], cid);

    // SILME YOK: danisan hala duruyor.
    let (kod, _) = cagir(&s, "GET", &format!("/api/danisanlar/{cid}"), None).await;
    assert_eq!(kod, StatusCode::OK, "saklama listesi hicbir seyi silmemeli");
}

#[tokio::test]
async fn saklama_listesi_gecersiz_tarihi_400_ile_reddeder() {
    let (_d, s, _cid, _rid) = dolu_state().await;
    // Tek haneli ay ve 16 karakterlik duvar saati: ikisi de sessizce YANLIS
    // bir imha listesi uretirdi (bkz. `saklama_suresi_dolanlar` belgesi).
    for bugun in ["2026-9-7", "2026-09-07T00:00", "yarin"] {
        let (kod, json) =
            cagir(&s, "GET", &format!("/api/saklama-suresi-dolanlar?bugun={bugun}"), None).await;
        assert_eq!(kod, StatusCode::BAD_REQUEST, "'{bugun}' reddedilmeli");
        assert!(json["hata"].as_str().unwrap().contains("YYYY-AA-GG"), "{json}");
    }
}

// =====================================================================
// 8. DEPOLAMA DURUMU -- "kodda var uründe yok" olmasin
// =====================================================================

#[tokio::test]
async fn depolama_durumu_ucu_baglidir_ve_esigi_bildirir() {
    let (_d, s, cid, _rid) = dolu_state().await;

    let (kod, durum) = cagir(&s, "GET", "/api/depolama-durumu", None).await;
    assert_eq!(kod, StatusCode::OK, "500 MB kisiti kodda var uründe yok olmamali");
    assert_eq!(durum["toplam_boyut"], 0);
    assert_eq!(durum["esik"], 500 * 1024 * 1024i64, "plan: toplam uyari esigi 500 MB");
    assert_eq!(durum["uyari"], false);

    ek_yukle(&s, cid, "a.pdf", b"1234567890").await;
    let (_, durum) = cagir(&s, "GET", "/api/depolama-durumu", None).await;
    assert_eq!(durum["toplam_boyut"], 10, "toplam gercekten hesaplanmali");
    assert_eq!(durum["uyari"], false, "esik ASILMADAN uyari verilmemeli");
}

// =====================================================================
// 9. SORGU PARAMETRESI HATASI DA JSON SOZLESMESINE UYAR
// =====================================================================

/// Eksik/geçersiz sorgu parametresi de `{"hata": "..."}` döndürür.
///
/// Çıplak `axum::extract::Query` başarısız olduğunda `400 text/plain` ve
/// **İngilizce axum metni** (`Failed to deserialize query string: missing
/// field 'q'`) döndürüyordu. Arayüzün hata gösterme yolu gövdedeki `hata`
/// alanını okur; bulamayınca kullanıcıya boş/yanlış bir mesaj gösterirdi --
/// tam olarak `api_bulunamadi` fallback'inin kapattığı sessiz tutarsızlık
/// sınıfı (bkz. `lib.rs`).
///
/// Kural konulurken **zaten var olan ihlaller de arandı**: Görev 7'nin iki
/// ucunun yanında Plan 2'nin dört ucu da aynı hatayı veriyordu. Altısı da
/// burada.
#[tokio::test]
async fn eksik_sorgu_parametresi_turkce_json_hata_dondurur() {
    let (_d, s, cid, _rid) = dolu_state().await;

    let bozuk: Vec<(&str, String)> = vec![
        // --- Gorev 7 ---
        ("GET", "/api/ara".into()),                     // `q` yok
        ("GET", "/api/saklama-suresi-dolanlar".into()), // `bugun` yok
        // `limit` OPSIYONEL ama tipi i64: harf gonderilince ayristirma coker.
        ("GET", format!("/api/danisanlar/{cid}/notlar?limit=abc")),
        // --- Plan 2 (onceden var olan ihlaller) ---
        ("GET", "/api/randevular".into()), // `baslangic`/`bitis` yok
        ("GET", "/api/cakisma".into()),
        ("GET", "/api/randevular/seri/seri-yok".into()), // `bu_tarihten_itibaren` yok
        ("DELETE", "/api/randevular/seri/seri-yok".into()),
    ];
    assert_eq!(bozuk.len(), 7, "sorgu parametresi alan HER uc burada olmali");

    for (metot, yol) in &bozuk {
        let (kod, basliklar, govde) = cagir_ham(&s, metot, yol, &[], Vec::new()).await;
        assert_eq!(kod, StatusCode::BAD_REQUEST, "{metot} {yol} 400 donmeli");

        let tur = basliklar.get("content-type").expect("content-type olmali");
        assert!(
            tur.to_str().unwrap().starts_with("application/json"),
            "{metot} {yol}: text/plain degil JSON donmeli: {tur:?}"
        );

        let json: serde_json::Value = serde_json::from_slice(&govde)
            .unwrap_or_else(|_| panic!("{metot} {yol}: govde JSON olmali"));
        let mesaj = json["hata"].as_str().unwrap_or_default();
        assert_eq!(
            mesaj, "Sorgu parametreleri eksik veya geçersiz.",
            "{metot} {yol}: govde sozlesmesi `hata` alani tasimali"
        );
        // axum/serde'nin ic metni sizmamali.
        let ham = String::from_utf8_lossy(&govde);
        assert!(
            !ham.contains("Failed to deserialize") && !ham.contains("missing field"),
            "{metot} {yol}: Ingilizce axum metni sizdi: {ham}"
        );
    }

    // ARTI YON. Bu olmadan "her istege 400 don" mutasyonu testi gecerdi.
    let iyi: Vec<(&str, String, StatusCode)> = vec![
        ("GET", "/api/ara?q=kaygi".into(), StatusCode::OK),
        ("GET", "/api/saklama-suresi-dolanlar?bugun=2030-01-01".into(), StatusCode::OK),
        ("GET", format!("/api/danisanlar/{cid}/notlar?limit=5"), StatusCode::OK),
        (
            "GET",
            "/api/randevular?baslangic=2026-09-01T00:00&bitis=2026-10-01T00:00".into(),
            StatusCode::OK,
        ),
        (
            "GET",
            "/api/cakisma?baslangic=2026-09-07T14:00&bitis=2026-09-07T15:00".into(),
            StatusCode::OK,
        ),
        (
            "GET",
            "/api/randevular/seri/seri-yok?bu_tarihten_itibaren=2026-09-07T00:00".into(),
            StatusCode::OK,
        ),
        (
            // Olmayan seri: 404 -- ama 400 DEGIL, yani sorgu ayristirildi.
            "DELETE",
            "/api/randevular/seri/seri-yok?bu_tarihten_itibaren=2026-09-07T00:00".into(),
            StatusCode::NOT_FOUND,
        ),
    ];
    for (metot, yol, beklenen) in &iyi {
        let (kod, _b, _g) = cagir_ham(&s, metot, yol, &[], Vec::new()).await;
        assert_eq!(kod, *beklenen, "{metot} {yol}: gecerli sorgu calismali");
    }
}

// =====================================================================
// YAPISAL GUVENCELERIN DOSYA KUMESI -- DIZINDEN TURETILIR
// =====================================================================
//
// # Bulgu (dal incelemesi): iddia doğru, kapsamı yanlış
//
// Aşağıdaki dört yapısal test "yarın eklenecek handler'ı yakalamak" için
// yazılmıştı ama dosya listesini **elle** taşıyordu. `include_str!` derleme
// zamanında sabit bir yol ister, dolayısıyla liste ancak insan eliyle
// büyür. Sonuç: Plan 4'ün ekleyeceği `routes/export.rs` (ya da
// `payments.rs`, `devices.rs`)
//
//   - `acik_baglanti` kapısını atlarsa YAKALANMAZDI (`toplam == 27`
//     iddiası ancak liste elle güncellenirse artar);
//   - `store::notes::ozel_*` içe aktarırsa YAKALANMAZDI -- ki
//     `routes::private_notes` modül başlığının tarif ettiği tehlike tam
//     olarak budur: *"ileride eklenecek bir dışa aktarım/rapor ucu liste
//     handler'ını yeniden kullanır."*
//
// Yani yapısal iddianın dosya kümesi, ihlalin gerçekleşebileceği kavşağı
// dışarıda bırakıyordu.
//
// # Düzeltme: küme `server/src/routes/` dizininden okunuyor
//
// `include_str!` yerine çalışma zamanında `std::fs` kullanılıyor
// (`CARGO_MANIFEST_DIR` = `server/`). Yeni bir rota modülü eklendiğinde
// **hiçbir şey yapılmadan** dört iddianın da kapsamına girer.
//
// Emsal: `playwright.config.ts` aynı tuzağı (listeye eklenmemiş spec
// sessizce koşulmaz) `e2e/` dizinini listeyle karşılaştırıp hata fırlatarak
// kapatıyor. Buradaki fark, listeyi tümüyle ortadan kaldırabilmemiz.
//
// Geriye yalnızca **istisnalar** elle yazılı kaldı ve her istisna için iki
// yönlü ön koşul var: dosya gerçekten var mı, ve istisna gerçekten
// gerekiyor mu (yani dosya kuralı fiilen ihlal ediyor mu). Bir istisna
// bayatlarsa test bunu söyler.

/// `server/src/routes/` altındaki her `.rs` dosyası (`mod.rs` hariç),
/// `(dosya adı, kaynak)` çifti olarak, ada göre sıralı.
fn rota_kaynaklari() -> Vec<(String, String)> {
    let dizin = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/routes");
    let mut liste: Vec<(String, String)> = std::fs::read_dir(&dizin)
        .unwrap_or_else(|e| panic!("{} okunamadi: {e}", dizin.display()))
        .map(|girdi| girdi.expect("dizin girdisi okunamadi").path())
        .filter(|yol| yol.extension().and_then(|u| u.to_str()) == Some("rs"))
        .map(|yol| {
            let ad = yol.file_name().unwrap().to_string_lossy().into_owned();
            let kaynak = std::fs::read_to_string(&yol)
                .unwrap_or_else(|e| panic!("{ad} okunamadi: {e}"));
            (ad, kaynak)
        })
        .filter(|(ad, _)| ad != "mod.rs")
        .collect();
    liste.sort();
    // Dizin okunamaz hale gelirse (yol degisti, calisma dizini farkli) her
    // iddia BOS bir kume uzerinde saglanirdi -- sessiz yesil.
    assert!(
        liste.len() >= 8,
        "rota dizini beklenenden kucuk, dosya kumesi turetilememis: {:?}",
        liste.iter().map(|(a, _)| a).collect::<Vec<_>>()
    );
    liste
}

/// Yorum satırları elenmiş kaynak: kuralların KENDİSİ yorumlarda geçer.
fn kod_satirlari(kaynak: &str) -> String {
    kaynak
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Veri handler'ı **olmayan** rota modülleri.
///
/// `session.rs` (durum/kilit-aç/kilitle) ve `setup.rs` (kurulum) danışan
/// verisine hiç dokunmaz: birincisi oturumun kendisini yönetir, ikincisi
/// keystore'u kurar. `acik_baglanti` kapısı onlar için anlamsızdır (kilitli
/// oturumda çalışmaları GEREKİR) ve denetim kaydını da **kendileri** yazar
/// -- `giris`/`cikis`/`kurulum` satırlarını yazacak bir çekirdek çağrısı
/// yok, kaynak onlar.
///
/// `restore.rs` (yedek listeleme + geri yükleme) aynı sınıfa **bilerek**
/// katıldı: geri yüklemenin var oluş sebebi oturumun açılamadığı durumdur
/// (bozuk veritabanı, okunamayan anahtar dosyası, boş bir veri dizini),
/// dolayısıyla `acik_baglanti` orada tanım gereği `401` dönerdi. Yetkisiz
/// DEĞİL: çağıran, geri yüklenecek yedeğin **kendi** anahtar dosyasını
/// açabilen parolayı vermek zorunda ve `geri_yukleme` satırını modül
/// kendisi yazar -- eski veritabanı artık yerinde olmadığı için o satırı
/// yazabilecek bir çekirdek çağrısı da yok. Yedek ALMA bilerek AYRI bir
/// modülde (`backup.rs`) ve kapının İÇİNDE; ikisini birleştirmek, kapısız
/// bir modülde kapı isteyen bir handler bulundurmak olurdu.
const VERI_DISI_ROTALAR: [&str; 3] = ["restore.rs", "session.rs", "setup.rs"];

/// İstisna listesinin bayatlamadığını doğrular: adı yazılı her dosya
/// gerçekten diskte olmalı. Dosya yeniden adlandırılırsa istisna sessizce
/// etkisizleşir ve o modül **kurala tabi olmadığı hâlde** kurala tabi
/// sayılırdı (ya da tersi).
fn istisnalar_gercek_mi(kaynaklar: &[(String, String)], istisnalar: &[&str]) {
    for istisna in istisnalar {
        assert!(
            kaynaklar.iter().any(|(ad, _)| ad == istisna),
            "istisna listesi bayat: `{istisna}` artik server/src/routes/ altinda yok"
        );
    }
}

/// `routes/` dizini ile `routes/mod.rs` **birebir** örtüşmeli.
///
/// İki yön de gerçek bir hata: `mod.rs`'e yazılmayan bir dosya hiç
/// derlenmez (yazılan kod ölüdür, hiçbir test onu çalıştırmaz ve
/// geliştirici "eklemiştim" sanır); `mod.rs`'te olup diskte olmayan bir
/// modül zaten derlenmez. `playwright.config.ts`'in `e2e/` kontrolüyle aynı
/// desen -- orada da sessizlik bir hataya çevrilmişti.
#[test]
fn rota_dizini_ve_mod_rs_birebir_ortusur() {
    let dizindeki: Vec<String> =
        rota_kaynaklari().into_iter().map(|(ad, _)| ad).collect();
    let mod_rs = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/routes/mod.rs"),
    )
    .expect("routes/mod.rs okunamadi");
    let bildirilen: Vec<String> = kod_satirlari(&mod_rs)
        .lines()
        .filter_map(|l| l.trim().strip_prefix("pub mod ")?.strip_suffix(';').map(str::to_string))
        .map(|ad| format!("{ad}.rs"))
        .collect();

    let bildirilmeyen: Vec<&String> =
        dizindeki.iter().filter(|a| !bildirilen.contains(a)).collect();
    let kayip: Vec<&String> = bildirilen.iter().filter(|a| !dizindeki.contains(a)).collect();
    assert!(
        bildirilmeyen.is_empty() && kayip.is_empty(),
        "routes/mod.rs dizinle uyumsuz. `pub mod` yazilmamis (derlenmeyen) dosyalar: \
         {bildirilmeyen:?}. Bildirilip diskte olmayanlar: {kayip:?}"
    );
}

/// Rota katmanında çıplak `Query` kalmamalı: hepsi `guard::Sorgu`'dan geçer.
///
/// Davranışsal tablo elle bakımlıdır; yarın eklenecek bir handler oraya
/// yazılmayı unutabilir. Bu test, kuralın kaynak üzerinde **yapısal**
/// karşılığıdır. Dosya kümesi dizinden gelir (bkz. yukarıdaki başlık).
#[test]
fn rota_modulleri_ciplak_query_kullanmaz() {
    for (ad, kaynak) in rota_kaynaklari() {
        // Yorumlar kuralin KENDISINDEN bahsedebilir (kardes yapisal testlerle
        // ayni eleme).
        let kod = kod_satirlari(&kaynak);
        assert!(
            !kod.contains("Query"),
            "{ad}: ciplak `axum::extract::Query` yerine `guard::Sorgu` kullanilmali; \
             Query'nin reddi Ingilizce `text/plain` doner ve govde sozlesmesini \
             (`hata` alani) bozar"
        );
    }
}

// =====================================================================
// 10. YAPISAL AYRIM -- ozel not rota katmaninda da ayri
// =====================================================================

/// Özel notun korunması bugüne kadar yalnızca depo katmanındaydı. Rota
/// katmanındaki ayrım kaynak metni üzerinden **yapısal** olarak sabitlenir:
/// davranışsal testler yalnızca bugünün handler'larını kapsar, bu test
/// yarın eklenecek bir dışa aktarım handler'ının yanlış modüle yazılmasını
/// da yakalar.
#[test]
fn rota_katmani_ozel_nota_yapisal_olarak_ayri_erisir() {
    const AYRILMIS: &str = "private_notes.rs";
    let kaynaklar = rota_kaynaklari();
    let ozel = &kaynaklar
        .iter()
        .find(|(ad, _)| ad == AYRILMIS)
        .unwrap_or_else(|| panic!("{AYRILMIS} bulunamadi"))
        .1;

    // On kosul: ayrilmis modul gercekten ozel not fonksiyonlarini CAGIRIYOR.
    // Yoksa asagidaki "digerlerinde yok" iddiasi, hicbir yerde cagrilmayan
    // bir fonksiyon icin de gecerdi (totoloji).
    assert!(ozel.contains("ozel_not_getir") && ozel.contains("ozel_not_kaydet"));

    // DIGERLERI dizinden geliyor: yarin eklenecek bir `export.rs` de
    // hicbir sey yapilmadan bu iddianin kapsamina girer.
    for (ad, kaynak) in kaynaklar.iter().filter(|(ad, _)| ad != AYRILMIS) {
        // Yorum satirlari kuralin KENDISINDEN bahsedebilir; yalnizca kod
        // satirlarina bakiyoruz.
        let kod = kod_satirlari(kaynak);
        assert!(
            !kod.contains("ozel_not_"),
            "{ad}: ozel not fonksiyonlari yalnizca private_notes.rs'ten cagrilmali"
        );
        assert!(
            !kod.contains("private_notes"),
            "{ad}: hicbir rota `private_notes` tablosuna elle SQL yazmamali"
        );
    }

    // Ve hicbir rota modulu `private_notes` tablosuna elle SQL yazmiyor:
    // ozel nota erisimin tek kapisi depo fonksiyonlaridir.
    let ozel_kod = kod_satirlari(ozel);
    assert!(
        !ozel_kod.contains("SELECT") && !ozel_kod.contains("INSERT"),
        "private_notes.rs de elle SQL yazmamali; yalnizca depo fonksiyonlarini cagirmali"
    );
}

/// Rota katmanı ikinci bir denetim kaydı satırı yazmaz.
///
/// Dosya kümesi dizinden gelir; istisna `VERI_DISI_ROTALAR`'dır ve o
/// istisnanın **gerekli olduğu** aşağıda ayrıca doğrulanır (bayat bir
/// istisna, kuralı sessizce bir modülden kaldırırdı).
#[test]
fn rota_modulleri_audit_kaydet_cagirmaz() {
    let kaynaklar = rota_kaynaklari();
    istisnalar_gercek_mi(&kaynaklar, &VERI_DISI_ROTALAR);

    for (ad, kaynak) in &kaynaklar {
        let kod = kod_satirlari(kaynak);
        if VERI_DISI_ROTALAR.contains(&ad.as_str()) {
            // ON KOSUL: istisna GERCEKTEN gerekli. `session.rs`/`setup.rs`
            // giris/cikis/kurulum satirlarinin KAYNAGI; yazmayi birakirlarsa
            // istisna listesinden de dusmeleri gerekir.
            assert!(
                kod.contains("kaydet("),
                "{ad}: veri disi rota artik denetim kaydi yazmiyor -- \
                 VERI_DISI_ROTALAR istisnasi bayatladi"
            );
            continue;
        }
        assert!(
            !kod.contains("audit::kaydet") && !kod.contains("audit::{kaydet"),
            "{ad}: cekirdek hacim kararini zaten verdi; rota ikinci bir SILINEMEZ satir yazmamali"
        );
        // Ham baytlarin/`EkIcerigi`'nin `{:?}` ile bicimlendirilmesi 20 MB'lik
        // tek satiri loga dokerdi (bkz. `EkIcerigi` tip belgesi).
        assert!(!kod.contains("dbg!"), "{ad}: dbg! birakilmamali");
        assert!(!kod.contains("tracing::"), "{ad}: rota katmani gunluge yazmamali");
    }
}

/// Her veri handler'ının **ilk satırı** `acik_baglanti`'dir.
///
/// Bu testin ilan edilen görevi, elle bakımlı 14 satırlık davranışsal
/// listenin kapsamadığı **yarınki** handler'ı yakalamaktır. Önceki hâli bunu
/// yapmıyordu: ham kaynakta `pub async fn ` ve `acik_baglanti(&s)?`
/// geçişlerini **sayıp** eşitliğine bakıyordu. İki mutasyon da hayatta kaldı
/// (deney çıktıları için bkz. task-7-report.md):
///
/// - **(a) Yorum sayacı şişiriyor.** Bir handler kapısız bırakılıp başka bir
///   handler'ın üstüne `/// Ornek: let conn = acik_baglanti(&s)?;` doküman
///   satırı eklendiğinde sayılar yine eşitleniyordu. Aynı dosyadaki kardeş
///   yapısal testler yorumları zaten eliyordu; bu elemiyordu.
/// - **(b) İki karşıt kusur birbirini götürüyor.** Bir handler kapıyı atlar,
///   başka biri kapıyı iki kez çağırırsa toplamlar yine eşit çıkıyordu.
///
/// Ayrıca "ilk satır" iddiası hiç denetlenmiyordu: kapı fonksiyonun sonunda
/// da olsa test geçerdi — oysa kilit kontrolünden ÖNCE çalışan her satır
/// (parametre okuma, log, yan etki) kilitli oturumda da çalışır.
///
/// Yeni biçim: yorumlar elenir, kaynak `pub async fn ` ile **parçalanır** ve
/// her parçanın gövdesinin **ilk satırının** kapı olduğu iddia edilir —
/// sayım değil, **bire bir eşleme**. Kapının parça başına tam bir kez geçmesi
/// de ayrıca iddia edilir, böylece (b) tipi telafi imkânsızdır.
///
/// **Dal incelemesi (üçüncü kusur): modül listesi elle yazılıydı.** Modül
/// başına beklenen handler sayısı tutuluyordu ve yeni bir rota dosyası
/// (Plan 4'ün `export.rs`'i) listeye eklenmedikçe iddia onu hiç görmezdi.
/// Artık küme `server/src/routes/` dizininden okunuyor: kapısız bir
/// `pub async fn` içeren yeni bir dosya, listeye eklenmeden de bu testi
/// kırar. Elle kalan tek şey `VERI_DISI_ROTALAR` istisnası ve o istisnanın
/// **gerekli olduğu** burada iki yönlü doğrulanıyor.
#[test]
fn her_veri_handleri_acik_baglantidan_gecer() {
    const KAPI: &str = "let conn = acik_baglanti(&s)?;";
    let kaynaklar = rota_kaynaklari();
    istisnalar_gercek_mi(&kaynaklar, &VERI_DISI_ROTALAR);

    let mut toplam = 0;
    for (ad, kaynak) in &kaynaklar {
        // Yorum satirlari kuralin KENDISINDEN bahsedebilir; yalnizca kod
        // satirlarina bakiyoruz (kardes yapisal testlerle ayni eleme).
        let kod = kod_satirlari(kaynak);

        if VERI_DISI_ROTALAR.contains(&ad.as_str()) {
            // ON KOSUL: istisna GERCEKTEN gerekli. Bu modul kapiyi bir gun
            // kullanmaya baslarsa artik "veri disi" degildir ve istisna
            // listesinden dusmelidir -- o an bu iddia kirilir.
            assert!(
                !kod.contains("acik_baglanti"),
                "{ad}: veri disi rota kapiyi kullaniyor -- VERI_DISI_ROTALAR \
                 istisnasi bayatladi, modul artik veri handler'i tasiyor"
            );
            continue;
        }

        let parcalar: Vec<&str> = kod.split("pub async fn ").skip(1).collect();
        // Bos bir veri rota modulu, "hicbir handler yok" diyerek her iddiayi
        // sessizce saglardi.
        assert!(
            !parcalar.is_empty(),
            "{ad}: veri rota modulu en az bir `pub async fn` icermeli \
             (icermiyorsa VERI_DISI_ROTALAR'a yazilmali)"
        );

        for parca in &parcalar {
            let isim = parca.split('(').next().unwrap_or("").trim();
            // Imza tek satirlik da olabilir, cok satirlik da; ikisinde de
            // govde `{` ile biten ILK satirdan sonra baslar.
            let imza_sonu = parca
                .lines()
                .position(|l| l.trim_end().ends_with('{'))
                .unwrap_or_else(|| panic!("{ad}::{isim}: handler imzasi '{{' ile bitmeli"));
            let ilk_satir = parca
                .lines()
                .skip(imza_sonu + 1)
                .find(|l| !l.trim().is_empty())
                .unwrap_or("");
            assert_eq!(
                ilk_satir.trim(),
                KAPI,
                "{ad}::{isim}: handler'in ILK satiri `{KAPI}` olmali -- kilit \
                 kontrolunden once calisan her satir kilitli oturumda da calisir"
            );
            // (b) telafisi: iki kez cagiran bir handler, kapisiz kalan bir
            // baskasini artik ortemez.
            assert_eq!(
                parca.matches("acik_baglanti(").count(),
                1,
                "{ad}::{isim}: kapi tam bir kez cagrilmali"
            );
        }
        toplam += parcalar.len();
    }
    // Ikinci ag: sayi degisirse (handler eklendi/silindi) bu satir kirilir ve
    // degisiklik BILINCLI olarak onaylanir. Birincil koruma artik yukaridaki
    // bire bir esleme -- sayiyi guncellemek tek basina bir kapiyi geri
    // getirmez.
    assert_eq!(toplam, 29, "toplam veri handler'i sayisi 29 olmali");
}

// =====================================================================
// DAL INCELEMESI C1 -- VERI RAPORU DISA AKTARIMI DENETIM KAYDI
// =====================================================================
//
// Bulgu: rapor tamamen ISTEMCIDE uretiliyor ve sunucuya giden tek istek
// `GET /api/danisanlar/{id}/notlar` idi. O yol `goruntuleme` yazip 5
// dakikalik pencerede BIRLESIYOR; seans paneli ayni danisan icin acilmissa
// disa aktarim SIFIR satir uretiyordu. Olculen log su idi:
//
//   ["goruntuleme|progress_note|liste:1", "duzenleme|progress_note|1",
//    "ekleme|appointment|1", "ekleme|client|1"]   -- hic `disa_aktarma` yok
//
// Asagidaki testler tam olarak o olcumu HTTP seviyesinde tekrarlar.

/// Oturumun anahtariyla `audit_log`'u okur ve `eylem|varlik|varlik_id`
/// uclusunu dondurur. Testler dogrudan veriye bakar, yanit sekline degil.
async fn log_satirlari(s: &AppState) -> Vec<String> {
    use psikolog_server::guard::acik_baglanti_ile;
    let conn = acik_baglanti_ile(s, std::time::Instant::now())
        .expect("log okumak icin oturum acik olmali");
    psikolog_core::store::audit::son_kayitlar(&conn, 200)
        .unwrap()
        .into_iter()
        .map(|k| format!("{}|{}|{}", k.eylem, k.varlik, k.varlik_id))
        .collect()
}

#[tokio::test]
async fn rapor_kaydi_uc_noktasi_disa_aktarma_satiri_yazar() {
    let (_d, s, cid, rid) = dolu_state().await;

    // Arayuzun disa aktarimdan ONCE yaptigi seyi birebir taklit et: seans
    // paneli ayni danisan icin acilmis (not listesi cekilmis) olsun. Bulgu
    // TAM OLARAK bu durumda ortaya cikiyordu.
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"seans notu"})),
    )
    .await;
    cagir(&s, "GET", &format!("/api/danisanlar/{cid}/notlar?limit=200"), None).await;

    // ON KOSUL -- bulgunun kendisi: not listesi hicbir `disa_aktarma`
    // satiri uretmez. Bu iddia olmasa asagidaki artı yon "zaten oyleydi"
    // ile tatmin olabilirdi.
    let panel_sonrasi = log_satirlari(&s).await;
    assert!(
        !panel_sonrasi.iter().any(|x| x.starts_with("disa_aktarma")),
        "on kosul: not listesi disa_aktarma yazmaz -- {panel_sonrasi:?}"
    );

    let (kod, _) = cagir(&s, "POST", &format!("/api/danisanlar/{cid}/rapor-kaydi"), None).await;
    assert_eq!(kod, StatusCode::OK);

    let rapor_sonrasi = log_satirlari(&s).await;
    assert!(
        rapor_sonrasi.contains(&format!("disa_aktarma|client|{cid}")),
        "veri raporu disa aktarimi silinemez kayitta gorunmeli -- {rapor_sonrasi:?}"
    );
    assert_eq!(
        rapor_sonrasi.len(),
        panel_sonrasi.len() + 1,
        "TAM OLARAK bir satir eklenmeli (ne sifir, ne iki)"
    );
}

#[tokio::test]
async fn ard_arda_iki_disa_aktarim_iki_satir_yazar() {
    // `attachments::icerik_getir` ile ayni gerekce: birlestirilseydi iki
    // disa aktarimdan biri gorunmez olurdu. `goruntuleme` yolundan farkli
    // oldugunu kanitlayan sey bu testtir.
    let (_d, s, cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();

    for _ in 0..2 {
        let (kod, _) = cagir(&s, "POST", &format!("/api/danisanlar/{cid}/rapor-kaydi"), None).await;
        assert_eq!(kod, StatusCode::OK);
    }

    let sonra = log_satirlari(&s).await;
    assert_eq!(sonra.len(), once + 2, "her disa aktarim ayri satir yazmali");
    assert_eq!(
        sonra.iter().filter(|x| *x == &format!("disa_aktarma|client|{cid}")).count(),
        2
    );
}

#[tokio::test]
async fn olmayan_danisan_icin_rapor_kaydi_404_doner_ve_log_yazmaz() {
    // Uydurma bir kimlikle atilan istek, silinemez loga disaridan
    // tetiklenebilir bir gurultu satiri dusurmemeli (`seriyi_sil` dersi).
    let (_d, s, _cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();

    let (kod, json) = cagir(&s, "POST", "/api/danisanlar/9999/rapor-kaydi", None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    assert!(json.get("hata").is_some());

    assert_eq!(log_satirlari(&s).await.len(), once, "404 log satiri birakmamali");
}

#[tokio::test]
async fn kilitliyken_rapor_kaydi_401_doner_ve_log_yazmaz() {
    // Fail-closed'un sunucu tarafi: kilitli oturumda kayit YAZILAMAZ,
    // dolayisiyla (arayuzdeki siralama geregi) disa aktarim da yapilamaz.
    let (_d, s, cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();

    kilitle(&s).await;
    let (kod, _) = cagir(&s, "POST", &format!("/api/danisanlar/{cid}/rapor-kaydi"), None).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);

    kilit_ac(&s).await;
    let sonra = log_satirlari(&s).await;
    assert!(
        !sonra.iter().any(|x| x.starts_with("disa_aktarma")),
        "kilitliyken atilan istek disa_aktarma satiri birakmamali -- {sonra:?}"
    );
    // `kilitle`/`kilit_ac` kendi `cikis`/`giris` satirlarini yaziyor;
    // olculen sey disa_aktarma satirinin YOKLUGU ve toplamın o iki
    // oturum satiri disinda buyumemesidir.
    assert_eq!(sonra.len(), once + 2, "yalnizca cikis + giris satirlari eklenmeli");
}

// =====================================================================
// HTTP -> ARAYUZ: her ucun bir ISTEMCI CAGRI YERI var mi?
// =====================================================================
//
// # Bulgu (dal incelemesi): tarama TEK YONLU yapilmisti
//
// Görev 7 "çağrı yeri olmayan çekirdek" taramasını **çekirdek → HTTP**
// yönünde eksiksiz yaptı (`backup`, `seriyi_sil`, `arsivle`,
// `depolama_durumu` o taramayla bulundu) ve sınıfı kapalı ilan etti.
// **HTTP → arayüz** yönü hiç taranmadı. Sonuç: üç uç noktanın
// `web/src/api.ts` içinde karşılığı yoktu ve bu üründe üç somut eksik
// demekti -- `GET /api/saklama-suresi-dolanlar` (tasarım §7'nin ana ekran
// hatırlatması), `GET /api/depolama-durumu` (500 MB eşiği "kodda var,
// üründe yok"), `DELETE /api/ekler/{id}` (yanlış danışana yüklenen bir
// onam PDF'i silinemiyordu).
//
// Taramanın VARLIĞI, sınıfın kapalı olduğu izlenimini üretmişti. Bu test o
// izlenimi bir ölçüme çevirir ve sınıfın bir daha sessizce açılmasını
// engeller.
//
// # Nasıl ölçüyor
//
// `server/src/lib.rs::api_router`'dan `(METOT, yol)` çiftleri,
// `web/src/api.ts` içindeki `/api/...` dizgilerinden de aynı biçimde
// `(METOT, yol)` çiftleri çıkarılır ve **iki yönlü** karşılaştırılır. Yol
// parametreleri (`{id}` / `${id}`) `{}` olarak normalleştirilir; sorgu
// dizgisi atılır.
//
// Ters yön de gerçek bir hata: arayüzün var olmayan bir yola attığı istek
// `api_bulunamadi`'ya düşer ve kullanıcı "Bilinmeyen API yolu." görür.

/// `//` satırları ve `/* ... */` blokları atılmış kaynak.
///
/// Zorunlu: `api.ts`'in JSDoc başlıkları uç noktaları **adıyla** anıyor
/// (`GET /api/danisanlar/{id}/ekler` yanıtı…). Yorumlar elenmezse bir uç
/// nokta, hakkında yazılmış bir yorum sayesinde "çağrı yeri var" sayılırdı
/// -- ölçüm tam da yakalaması gereken şeyi kaçırırdı.
fn yorumsuz(kaynak: &str) -> String {
    let mut bloksuz = String::with_capacity(kaynak.len());
    let mut kalan = kaynak;
    while let Some(bas) = kalan.find("/*") {
        bloksuz.push_str(&kalan[..bas]);
        match kalan[bas + 2..].find("*/") {
            Some(son) => kalan = &kalan[bas + 2 + son + 2..],
            None => {
                kalan = "";
                break;
            }
        }
    }
    bloksuz.push_str(kalan);
    bloksuz
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

const METOTLAR: [&str; 5] = ["get", "post", "patch", "put", "delete"];

/// `metot(` geçişi -- öncesinde harf/rakam/alt çizgi olmamalı, yani bir
/// sabitin (`AZAMI_GOVDE_BOYUTU`) içinde kalan hece sayılmasın.
fn metot_cagrisi_var(metin: &str, metot: &str) -> bool {
    let desen = format!("{metot}(");
    let mut arama = 0usize;
    while let Some(yer) = metin[arama..].find(&desen) {
        let mutlak = arama + yer;
        let onceki = metin[..mutlak].chars().next_back();
        if !matches!(onceki, Some(k) if k.is_alphanumeric() || k == '_') {
            return true;
        }
        arama = mutlak + desen.len();
    }
    false
}

/// `{id}` / `${danisanId}` gibi parametreleri `{}`'ye indirger.
fn yolu_normallestir(yol: &str) -> String {
    let mut cikti = String::with_capacity(yol.len());
    let mut kalan = yol;
    while let Some(bas) = kalan.find('{') {
        cikti.push_str(kalan[..bas].trim_end_matches('$'));
        cikti.push_str("{}");
        match kalan[bas..].find('}') {
            Some(son) => kalan = &kalan[bas + son + 1..],
            None => {
                kalan = "";
                break;
            }
        }
    }
    cikti.push_str(kalan);
    cikti
}

/// `api_router`'ın tanımladığı `(METOT, yol)` çiftleri.
fn sunucu_rotalari() -> Vec<(String, String)> {
    let kaynak =
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"))
            .expect("server/src/lib.rs okunamadi");
    let kod = yorumsuz(&kaynak);
    let govde = kod
        .split("fn api_router")
        .nth(1)
        .expect("api_router bulunamadi")
        .split("pub fn router")
        .next()
        .expect("bolme her zaman parca verir")
        .to_string();

    let mut rotalar: Vec<(String, String)> = Vec::new();
    for parca in govde.split(".route(").skip(1) {
        let bas = parca.find('"').expect("rota yolu tirnak icinde olmali");
        let son = parca[bas + 1..].find('"').expect("rota yolu kapanmali");
        let yol = format!("/api{}", &parca[bas + 1..bas + 1 + son]);
        let kalan = &parca[bas + 1 + son + 1..];
        for metot in METOTLAR {
            if metot_cagrisi_var(kalan, metot) {
                rotalar.push((metot.to_uppercase(), yolu_normallestir(&yol)));
            }
        }
    }
    rotalar.sort();
    rotalar.dedup();
    // Ayristirma bozulursa BOS bir kume her iddiayi saglardi -- sessiz yesil.
    assert!(rotalar.len() >= 20, "rota tablosu ayristirilamadi: {rotalar:?}");
    rotalar
}

/// `web/src/api.ts`'in gerçekten kurduğu `(METOT, yol)` çiftleri.
///
/// Metot, yol dizgisinden **sonraki** pencerede aranır (`istek(...)`
/// çağrısının seçenek nesnesi orada); bulunmazsa `GET` -- `fetch`/`istek`
/// varsayılanı budur.
fn istemci_cagrilari() -> Vec<(String, String)> {
    let kaynak = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/src/api.ts"),
    )
    .expect("web/src/api.ts okunamadi");
    let k: Vec<char> = yorumsuz(&kaynak).chars().collect();
    const ONEK: [char; 4] = ['/', 'a', 'p', 'i'];

    // Once TUM `/api...` baslangiclari: metot penceresi "bir sonraki yol
    // dizgisine kadar" olacak, boylece bir cagrinin metodu komsusuna
    // atfedilemez.
    let baslangiclar: Vec<usize> =
        (0..k.len().saturating_sub(4)).filter(|&i| k[i..i + 4] == ONEK).collect();

    let mut cagrilar: Vec<(String, String)> = Vec::new();
    for (sira, &bas) in baslangiclar.iter().enumerate() {
        let mut yol = String::new();
        let mut j = bas;
        while j < k.len() {
            let c = k[j];
            if c == '`' || c == '\'' || c == '"' || c == '?' {
                break;
            }
            if c == '$' && k.get(j + 1) == Some(&'{') {
                // `${encodeURIComponent(id)}` -> `{}`; ic ice suslu de olabilir.
                let mut derinlik = 1usize;
                let mut i = j + 2;
                while i < k.len() && derinlik > 0 {
                    if k[i] == '{' {
                        derinlik += 1;
                    } else if k[i] == '}' {
                        derinlik -= 1;
                    }
                    i += 1;
                }
                yol.push_str("{}");
                j = i;
                continue;
            }
            yol.push(c);
            j += 1;
        }

        let sinir = baslangiclar
            .get(sira + 1)
            .copied()
            .unwrap_or(k.len())
            .min(j.saturating_add(400))
            .min(k.len())
            .max(j);
        let pencere: String = k[j..sinir].iter().collect();
        let metot = pencere
            .split("method: '")
            .nth(1)
            .and_then(|p| p.split('\'').next())
            .map(|m| m.trim().to_uppercase())
            .unwrap_or_else(|| "GET".to_string());

        cagrilar.push((metot, yolu_normallestir(&yol)));
    }
    cagrilar.sort();
    cagrilar.dedup();
    assert!(cagrilar.len() >= 20, "api.ts ayristirilamadi: {cagrilar:?}");
    cagrilar
}

/// Arayüzden bilinçli olarak çağrılmayan uç noktalar.
///
/// **Bugün boş.** Boş kalması bir hedef değil, bir ölçüm: bir uç nokta
/// buraya yazılacaksa gerekçesi de buraya yazılır ve o gerekçe kod
/// incelemesine düşer. Sessizce bağlanmamış bir uç nokta ile bilinçli
/// olarak bağlanmamış bir uç nokta arasındaki fark tam olarak budur.
const ISTEMCISIZ_UCLAR: [(&str, &str); 0] = [];

#[test]
fn her_http_ucunun_bir_istemci_cagri_yeri_var() {
    let rotalar = sunucu_rotalari();
    let cagrilar = istemci_cagrilari();

    // ON KOSUL: istisna listesi bayat olmasin -- listedeki her uc GERCEKTEN
    // sunucuda tanimli olmali.
    for (metot, yol) in ISTEMCISIZ_UCLAR {
        assert!(
            rotalar.contains(&(metot.to_string(), yol.to_string())),
            "istisna listesi bayat: {metot} {yol} artik bir rota degil"
        );
    }

    let bagsiz: Vec<&(String, String)> = rotalar
        .iter()
        .filter(|(m, y)| {
            !cagrilar.contains(&(m.clone(), y.clone()))
                && !ISTEMCISIZ_UCLAR.iter().any(|(im, iy)| im == m && iy == y)
        })
        .collect();
    assert!(
        bagsiz.is_empty(),
        "bu uc noktalarin `web/src/api.ts` icinde hicbir cagri yeri yok \
         (kodda var, URUNDE yok): {bagsiz:?}"
    );

    // TERS YON: arayuzun var olmayan bir yola attigi istek `api_bulunamadi`ya
    // duser ve kullanici "Bilinmeyen API yolu." gorur.
    let hayali: Vec<&(String, String)> = cagrilar.iter().filter(|c| !rotalar.contains(c)).collect();
    assert!(hayali.is_empty(), "arayuz sunucuda OLMAYAN uclara istek atiyor: {hayali:?}");
}
