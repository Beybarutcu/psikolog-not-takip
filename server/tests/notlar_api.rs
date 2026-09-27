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
/// `rapor-kaydi`, toplam **on beş**; Plan 4 Görev 6'da o uç kalktı, yerine
/// `veri-raporu` geldi; Plan 5 Görev 4'te `danisanlar/{id}/seanslar` eklendi,
/// toplam **on altı**; Plan 5 Görev 5'te beş etiket ucu eklendi, toplam
/// **yirmi bir**) kilitliyken `401` döner ve gövdesinde hiçbir veri
/// taşımaz.
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
    let (kod, etiket) = cagir(
        &s,
        "POST",
        &format!("/api/randevular/{rid}/etiketler"),
        Some(json!({"ad":"GIZLI_ETIKET_ADI"})),
    )
    .await;
    assert_eq!(kod, StatusCode::CREATED, "kurulum: etiket eklenmeli");
    let tag_id = etiket["id"].as_i64().unwrap();

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
        // Plan 5 Gorev 4: notu olsun olmasin TUM seanslar -- kilitliyken bu
        // liste de gorunmemeli; `not_ilk_satiri` RESMI_GIZLI_ICERIK'i
        // tasidigi icin asagidaki gizli-tarama dongusu bunu da kapsar.
        ("GET", format!("/api/danisanlar/{cid}/seanslar"), None),
        // Tasarim S8: danisana ozel not aramasi da kapinin icinde.
        ("GET", format!("/api/danisanlar/{cid}/not-ara?q=RESMI"), None),
        ("GET", format!("/api/danisanlar/{cid}/ekler"), None),
        // POST /ekler ham govdeli oldugu icin ayri cagrilir (asagida).
        ("GET", format!("/api/ekler/{ek_id}"), None),
        ("DELETE", format!("/api/ekler/{ek_id}"), None),
        // Plan 5 Gorev 5: bes etiket ucu. Ad URL'ye girmez -- ekleme
        // govdede, kaldirma ve arama yalnizca sayisal kimlikle.
        ("GET", "/api/etiketler".to_string(), None),
        ("GET", format!("/api/randevular/{rid}/etiketler"), None),
        (
            "POST",
            format!("/api/randevular/{rid}/etiketler"),
            Some(json!({"ad":"x"})),
        ),
        ("DELETE", format!("/api/randevular/{rid}/etiketler/{tag_id}"), None),
        ("GET", format!("/api/etiketler/{tag_id}/seanslar"), None),
        ("GET", "/api/ara?q=GIZLI".to_string(), None),
        ("GET", "/api/saklama-suresi-dolanlar?bugun=2030-01-01".to_string(), None),
        ("GET", "/api/depolama-durumu".to_string(), None),
        // Veri raporu (Plan 4 Gorev 6) ayni kapidan gecer: kilitliyken bir
        // danisanin dosyasi disa aktarilamaz. Ayrintili hali:
        // `kilitliyken_veri_raporu_401_ve_log_yazilmaz`.
        (
            "POST",
            format!("/api/danisanlar/{cid}/veri-raporu"),
            Some(json!({"parola":"danisan-parolasi-1","bugun":"2026-09-16"})),
        ),
    ];
    assert_eq!(uclar.len(), 21, "POST /ekler ile birlikte yirmi iki uc kapsanmali");

    for (metot, yol, govde) in &uclar {
        let (kod, json) = cagir(&s, metot, yol, govde.clone()).await;
        assert_eq!(kod, StatusCode::UNAUTHORIZED, "{metot} {yol} kilitliyken 401 donmeli");
        let metin = json.to_string();
        for gizli in [
            "RESMI_GIZLI_ICERIK",
            "OZEL_GIZLI_ICERIK",
            "GIZLI_DOSYA_ADI",
            "GIZLI_DOSYA_ICERIGI",
            "GIZLI_ETIKET_ADI",
        ] {
            assert!(!metin.contains(gizli), "{metot} {yol} kilitliyken veri sizdirdi: {metin}");
        }
        assert!(!json.is_array(), "{metot} {yol}: basarili liste yaniti dizidir");
    }

    // On altinci uc: POST /api/danisanlar/{id}/ekler (ham govde).
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

/// JSON gövde (`Json<T>`) ya da sorgu dizesi (`Sorgu<T>`) alan **her** veri
/// handler'ı, girdisi bozukken de kilitliyse önce `401` döner; kilit açıkken
/// aynı bozuk girdi Türkçe `400 {"hata"}` alır ve girdiyi yansıtmaz.
///
/// # Bulgu (dal incelemesi M1)
///
/// Extractor'lar handler gövdesinden önce çalışıyordu: kilitliyken bozuk
/// gövdeli `PATCH /randevular/{id}/odeme` → `422` + İngilizce
/// `invalid type: string "evet"`; parametresiz `GET /ay-ozeti` → `400`.
/// Düzeltme `guard::govde_coz` belgesinde.
///
/// Tablo elle bakımlıdır ama **kaynaktan doğrulanır**: `routes/` altındaki
/// veri modüllerinde parametre listesinde `Json<` ya da `Sorgu<` geçen her
/// `async fn` tabloda olmalı (ve tersi), ve o extractor çıplak değil
/// `Result<...>` olarak alınmalı. Yarın eklenecek bir handler tabloya
/// yazılmazsa ya da extractor'ı çıplak alırsa bu test kırılır.
#[tokio::test]
async fn kilitliyken_govde_ve_sorgu_alan_her_uc_once_401_doner() {
    let (_d, s, cid, rid) = dolu_state().await;
    const KANARYA: &str = "GIRDI-KANARYA";
    let bozuk_govde = Some(format!("\"{KANARYA}\""));
    // (dosya, handler, metot, yol, bozuk govde -- None ise sorgu ucu)
    let tablo: Vec<(&str, &str, &str, String, Option<String>)> = vec![
        ("appointments.rs", "liste", "GET", format!("/api/randevular?x={KANARYA}"), None),
        ("appointments.rs", "olustur", "POST", "/api/randevular".into(), bozuk_govde.clone()),
        ("appointments.rs", "durum", "PATCH", format!("/api/randevular/{rid}"), bozuk_govde.clone()),
        (
            "appointments.rs",
            "odeme",
            "PATCH",
            format!("/api/randevular/{rid}/odeme"),
            Some(r#"{"odendi":"evet"}"#.into()),
        ),
        ("appointments.rs", "guncelle", "PUT", format!("/api/randevular/{rid}"), bozuk_govde.clone()),
        (
            "appointments.rs",
            "seri_adedi",
            "GET",
            format!("/api/randevular/seri/s1?x={KANARYA}"),
            None,
        ),
        (
            "appointments.rs",
            "seri_kaldir",
            "DELETE",
            format!("/api/randevular/seri/s1?x={KANARYA}"),
            None,
        ),
        ("appointments.rs", "cakisma", "GET", format!("/api/cakisma?x={KANARYA}"), None),
        (
            "audit.rs",
            "liste",
            "GET",
            // `sayfa: Option<i64>` -- alan opsiyonel ama tipi sayisal; harf
            // gonderilince ayristirma coker (`notes.rs::danisan_listesi`nin
            // `limit={KANARYA}`iyle AYNI mekanizma).
            format!("/api/denetim-kayitlari?sayfa={KANARYA}"),
            None,
        ),
        ("backup.rs", "al", "POST", "/api/yedek".into(), bozuk_govde.clone()),
        ("clients.rs", "olustur", "POST", "/api/danisanlar".into(), bozuk_govde.clone()),
        ("clients.rs", "guncelle_uc", "PATCH", format!("/api/danisanlar/{cid}"), bozuk_govde.clone()),
        (
            "clients.rs",
            "saklama_listesi",
            "GET",
            format!("/api/saklama-suresi-dolanlar?x={KANARYA}"),
            None,
        ),
        ("notes.rs", "kaydet", "PUT", format!("/api/randevular/{rid}/not"), bozuk_govde.clone()),
        (
            "notes.rs",
            "danisan_listesi",
            "GET",
            format!("/api/danisanlar/{cid}/notlar?limit={KANARYA}"),
            None,
        ),
        (
            "notes.rs",
            "danisan_not_ara",
            "GET",
            format!("/api/danisanlar/{cid}/not-ara?x={KANARYA}"),
            None,
        ),
        ("ozet.rs", "ay_ozeti_uc", "GET", "/api/ay-ozeti".into(), None),
        ("password.rs", "degistir", "POST", "/api/parola".into(), bozuk_govde.clone()),
        (
            "private_notes.rs",
            "kaydet",
            "PUT",
            format!("/api/randevular/{rid}/ozel-not"),
            bozuk_govde.clone(),
        ),
        ("search.rs", "ara_uc", "GET", format!("/api/ara?x={KANARYA}"), None),
        (
            "tags.rs",
            "ekle",
            "POST",
            format!("/api/randevular/{rid}/etiketler"),
            bozuk_govde.clone(),
        ),
        (
            "veri_raporu.rs",
            "veri_raporu",
            "POST",
            format!("/api/danisanlar/{cid}/veri-raporu"),
            bozuk_govde.clone(),
        ),
    ];

    // --- Kaynakla birebir ortusme ---
    let mut kaynaktaki: Vec<(String, String)> = Vec::new();
    let mut ciplak: Vec<String> = Vec::new();
    for (ad, kaynak) in rota_kaynaklari() {
        if VERI_DISI_ROTALAR.contains(&ad.as_str()) {
            continue;
        }
        let kod = kod_satirlari(&kaynak);
        for parca in async_fn_parcalari(&kod) {
            let isim = parca.split('(').next().unwrap_or("").trim().to_string();
            // Parametre listesi: ilk `(` ile imzadaki ilk `) ->` arasi (donus
            // tipi `Result<(StatusCode, Json<..>)>` parametre sayilmamali).
            let imza = &parca[..parca.find('{').unwrap_or(parca.len())];
            let son = imza.find(") ->").or_else(|| imza.rfind(')')).unwrap_or(imza.len());
            let params = &imza[imza.find('(').map_or(0, |i| i + 1)..son];
            let mut var = false;
            for isaret in ["Json<", "Sorgu<"] {
                for (i, _) in params.match_indices(isaret) {
                    var = true;
                    if !params[..i].ends_with("Result<") {
                        ciplak.push(format!("{ad}::{isim}: `{isaret}` ciplak extractor"));
                    }
                }
            }
            if var {
                kaynaktaki.push((ad.clone(), isim));
            }
        }
    }
    assert!(
        ciplak.is_empty(),
        "extractor kapidan ONCE calisir; `Result<...>` alip kapidan sonra cozulmeli:\n{}",
        ciplak.join("\n")
    );
    let mut tablodaki: Vec<(String, String)> =
        tablo.iter().map(|(a, h, ..)| (a.to_string(), h.to_string())).collect();
    kaynaktaki.sort();
    tablodaki.sort();
    assert_eq!(tablodaki, kaynaktaki, "tablo ile kaynaktaki Json/Sorgu handler'lari ortusmeli");

    // --- ARTI YON: kilit acikken bozuk girdi Turkce 400, girdi yansimaz ---
    // (Bu olmadan "her seye 401 don" mutasyonu asagidaki dongu ile gecerdi.)
    for (ad, h, metot, yol, govde) in &tablo {
        let (kod, _b, yanit) = match govde {
            Some(g) => {
                cagir_ham(&s, metot, yol, &[("content-type", "application/json")], g.clone().into_bytes())
                    .await
            }
            None => cagir_ham(&s, metot, yol, &[], Vec::new()).await,
        };
        assert_eq!(kod, StatusCode::BAD_REQUEST, "{ad}::{h} acikken bozuk girdi 400 donmeli");
        let mesaj = hata_metni(&yanit);
        let beklenen = if govde.is_some() {
            "İstek gövdesi eksik veya geçersiz."
        } else {
            "Sorgu parametreleri eksik veya geçersiz."
        };
        assert_eq!(mesaj, beklenen, "{ad}::{h}");
        let ham = String::from_utf8_lossy(&yanit);
        assert!(
            !ham.contains(KANARYA) && !ham.contains("evet") && !ham.contains("invalid type"),
            "{ad}::{h}: girdi ya da Ingilizce metin yansidi: {ham}"
        );
    }

    // --- Kilitliyken: once 401 ---
    kilitle(&s).await;
    let mut hatalar = Vec::new();
    for (ad, h, metot, yol, govde) in &tablo {
        let (kod, _b, yanit) = match govde {
            Some(g) => {
                cagir_ham(&s, metot, yol, &[("content-type", "application/json")], g.clone().into_bytes())
                    .await
            }
            None => cagir_ham(&s, metot, yol, &[], Vec::new()).await,
        };
        let ham = String::from_utf8_lossy(&yanit);
        if kod != StatusCode::UNAUTHORIZED || ham.contains(KANARYA) || ham.contains("evet") {
            hatalar.push(format!("{ad}::{h} {metot} {yol}: {kod} {ham}"));
        }
    }
    assert!(hatalar.is_empty(), "kilitliyken 401 donmeyen uclar:\n{}", hatalar.join("\n"));
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
    assert_eq!(not["sablon"], "serbest", "varsayilan sablon Serbest olmali (analitik calisma, tasarim A7)");
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

/// Danışanın verisi API üzerinden okunabilen JSON uç noktalarının
/// **toplamıdır**; bu test o toplamı gezer ve hiçbirinden özel notun
/// dönmediğini doğrular.
///
/// Plan 4 Görev 6'dan beri KVKK md. 11 raporunun kendisi ayrı bir uç
/// noktadır ve şifreli PDF döner (JSON değil); özel notun ORAYA girmediği
/// PDF parolayla çözülerek
/// `veri_raporu_sifreli_pdf_doner_ve_disa_aktarma_loglanir` içinde doğrulanır.
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

// =====================================================================
// 2b. ETIKET UCLARI (Plan 5 Gorev 5)
// =====================================================================

#[tokio::test]
async fn etiket_eklenir_seansa_baglanir_ve_sozlukte_listelenir() {
    let (_d, s, _cid, rid) = dolu_state().await;

    let (kod, etiket) = cagir(
        &s,
        "POST",
        &format!("/api/randevular/{rid}/etiketler"),
        Some(json!({"ad":"Kaygı"})),
    )
    .await;
    assert_eq!(kod, StatusCode::CREATED);
    assert_eq!(etiket["ad"], "Kaygı");
    assert_eq!(etiket["kullanim"], 1);

    let (kod, seans_etiketleri) =
        cagir(&s, "GET", &format!("/api/randevular/{rid}/etiketler"), None).await;
    assert_eq!(kod, StatusCode::OK);
    let liste = seans_etiketleri.as_array().unwrap();
    assert_eq!(liste.len(), 1, "seans bu etiketi tasimali");
    assert_eq!(liste[0]["ad"], "Kaygı");

    let (kod, sozluk) = cagir(&s, "GET", "/api/etiketler", None).await;
    assert_eq!(kod, StatusCode::OK);
    let sozluk = sozluk.as_array().unwrap();
    assert_eq!(sozluk.len(), 1, "sozlukte de gorunmeli");
    assert_eq!(sozluk[0]["ad"], "Kaygı");

    // Ayni ad, farkli yazim -- ayni etiket kimligine baglanir, sozlukte ikinci
    // bir satir birakmaz (bkz. `store::tags::ad_anahtar_uret`).
    let (kod, ayni) = cagir(
        &s,
        "POST",
        &format!("/api/randevular/{rid}/etiketler"),
        Some(json!({"ad":"kaygı"})),
    )
    .await;
    assert_eq!(kod, StatusCode::CREATED);
    assert_eq!(ayni["id"], etiket["id"]);
}

#[tokio::test]
async fn etiket_kaldirilir_bilinmeyen_baglanti_kaldirmasi_404_doner() {
    let (_d, s, _cid, rid) = dolu_state().await;
    let (_, etiket) = cagir(
        &s,
        "POST",
        &format!("/api/randevular/{rid}/etiketler"),
        Some(json!({"ad":"aile"})),
    )
    .await;
    let tag_id = etiket["id"].as_i64().unwrap();

    let (kod, _) =
        cagir(&s, "DELETE", &format!("/api/randevular/{rid}/etiketler/{tag_id}"), None).await;
    assert_eq!(kod, StatusCode::NO_CONTENT);

    let (kod, liste) = cagir(&s, "GET", &format!("/api/randevular/{rid}/etiketler"), None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 0, "kaldirilan etiket seansta gorunmemeli");

    // Ayni bagi ikinci kez kaldirmak -- artik bagli degil -- bulunamadi doner.
    let (kod, _) =
        cagir(&s, "DELETE", &format!("/api/randevular/{rid}/etiketler/{tag_id}"), None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);

    // Hic var olmayan bir tag_id ile kaldirma da bulunamadi doner.
    let (kod, _) = cagir(&s, "DELETE", &format!("/api/randevular/{rid}/etiketler/999999"), None)
        .await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn etiketli_seanslar_ucu_danisan_adini_ve_baslangici_dondurur() {
    let (_d, s, cid, rid) = dolu_state().await;
    let (_, etiket) = cagir(
        &s,
        "POST",
        &format!("/api/randevular/{rid}/etiketler"),
        Some(json!({"ad":"kriz"})),
    )
    .await;
    let tag_id = etiket["id"].as_i64().unwrap();

    let (kod, seanslar) = cagir(&s, "GET", &format!("/api/etiketler/{tag_id}/seanslar"), None).await;
    assert_eq!(kod, StatusCode::OK);
    let liste = seanslar.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["appointment_id"], rid);
    assert_eq!(liste[0]["client_id"], cid);
    assert_eq!(liste[0]["danisan_adi"], "Ayse Yilmaz");

    // Bilinmeyen tag_id -- bulunamadi.
    let (kod, _) = cagir(&s, "GET", "/api/etiketler/999999/seanslar", None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
}

/// Brief Adım 2: 41 karakterlik ad `400` döner, gövdesinde adın KENDİSİ
/// yankılanmaz (yalnızca uzunluk mesajı) -- `store::tags::ad_dogrula` ile
/// `guard::depo_hatasi`nin ikisi de bu sözleşmeyi taşır.
#[tokio::test]
async fn kirk_bir_karakterlik_etiket_adi_400_doner_ad_yankilanmaz() {
    let (_d, s, _cid, rid) = dolu_state().await;
    let kirk_bir = "Ç".repeat(41);

    let (kod, govde) = cagir(
        &s,
        "POST",
        &format!("/api/randevular/{rid}/etiketler"),
        Some(json!({"ad": kirk_bir})),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    let metin = govde.to_string();
    assert!(!metin.contains(&kirk_bir), "reddedilen ad govdeye yankilanmamali: {metin}");
    assert!(metin.contains("40"), "hata mesaji uzunluk sinirini soylemeli: {metin}");

    // Bos ad da ayni sozlesmeyle 400 doner.
    let (kod, govde) = cagir(
        &s,
        "POST",
        &format!("/api/randevular/{rid}/etiketler"),
        Some(json!({"ad": ""})),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(!govde.to_string().is_empty());
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
    let bulunan = sonuc["sonuclar"].as_array().unwrap();
    assert_eq!(bulunan.len(), 1, "resmi not bulunmali: {sonuc}");
    assert_eq!(bulunan[0]["tur"], "not");
    assert_eq!(bulunan[0]["client_id"], cid);

    // EKSI YON: ozel nottaki kelime hicbir sey dondurmez.
    let (kod, sonuc) = cagir(&s, "GET", "/api/ara?q=ANAHTARKELIME", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert!(
        sonuc["sonuclar"].as_array().unwrap().is_empty(),
        "ozel not aramaya girmemeli: {sonuc}"
    );
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
/// Kesme, eski "Önceki seans notları" paneli için eklendi: o panel terapist
/// geçmiş bir seansı açtığında o seanstan SONRAKİ notları "önceki" diye
/// gösteriyordu. 2026-09-27'den beri panel "Diğer seanslar" (açık seansın
/// dışındaki BÜTÜN seanslar, sonrakiler dahil) ve kesmeyi göndermiyor;
/// parametre başka çağıranlar için isteğe bağlı kaldı, davranışı bu testle
/// sabit.
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
async fn not_yaniti_sunucunun_onizlemesini_ve_danisan_adini_tasir() {
    let (_d, s, cid, rid) = dolu_state().await;
    let (kod, yanit) = cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"<h2>Veri</h2><p><strong>Kaygı</strong> azaldı</p>"})),
    )
    .await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(yanit["onizleme"], json!("Kaygı azaldı"));
    assert_eq!(yanit["danisan_adi"], json!("Ayse Yilmaz"));
    let (_, okunan) = cagir(&s, "GET", &format!("/api/randevular/{rid}/not"), None).await;
    assert_eq!(okunan["onizleme"], json!("Kaygı azaldı"));
    // Notu olmayan randevu: önizleme `null` (dosya listesindeki `not_ilk_satiri` ile aynı anlam).
    let bos = randevu_ekle(&s, cid, "2026-09-08").await;
    let (_, bos_not) = cagir(&s, "GET", &format!("/api/randevular/{bos}/not"), None).await;
    assert!(bos_not["onizleme"].is_null(), "{bos_not}");
    assert_eq!(bos_not["danisan_adi"], json!("Ayse Yilmaz"));
}

#[tokio::test]
async fn danisan_not_aramasi_bu_danisanin_onceki_resmi_notlarini_dondurur() {
    let (_d, s) = kurulu_state().await;
    let ayse = danisan_ekle(&s, "Ayse Yilmaz").await;
    let mehmet = danisan_ekle(&s, "Mehmet Demir").await;
    let eski = randevu_ekle(&s, ayse, "2026-09-01").await;
    let simdiki = randevu_ekle(&s, ayse, "2026-09-08").await;
    let sonraki = randevu_ekle(&s, ayse, "2026-09-15").await;
    let baskasi = randevu_ekle(&s, mehmet, "2026-09-02").await;
    for (rid, icerik) in [
        (eski, "<p>ESKI <strong>KAYGI</strong> notu</p>"),
        (simdiki, "<p>SIMDIKI kaygi</p>"),
        (sonraki, "<p>SONRAKI kaygi</p>"),
        (baskasi, "<p>BASKASI kaygi</p>"),
    ] {
        cagir(&s, "PUT", &format!("/api/randevular/{rid}/not"), Some(json!({"sablon":"serbest","icerik":icerik})))
            .await;
    }
    cagir(&s, "PUT", &format!("/api/randevular/{eski}/ozel-not"), Some(json!({"icerik":"OZELKAYGI"}))).await;

    let (kod, sonuc) = cagir(
        &s,
        "GET",
        &format!("/api/danisanlar/{ayse}/not-ara?q=kayg%C4%B1&once=2026-09-08T14%3A00"),
        None,
    )
    .await;
    assert_eq!(kod, StatusCode::OK);
    let liste = sonuc.as_array().expect("dizi");
    assert_eq!(liste.len(), 1, "{sonuc}");
    assert_eq!(liste[0]["appointment_id"], json!(eski));
    assert_eq!(liste[0]["seans_zamani"], json!("2026-09-01T14:00"));
    let parca = liste[0]["parca"].as_str().unwrap();
    assert!(parca.contains("ESKI KAYGI notu") && !parca.contains('<'), "{parca}");
    for yok in ["SIMDIKI", "SONRAKI", "BASKASI", "OZELKAYGI"] {
        assert!(!sonuc.to_string().contains(yok), "{yok} sizdi: {sonuc}");
    }
    // ARTI YÖN: kesme `once`'den geliyor — verilmezse sonrakiler de döner.
    // "Diğer seanslar" paneli (2026-09-27'den beri) tam bu biçimi, kesmesiz
    // aramayı kullanır; açık seansın kendi notunu istemci atar.
    let (_, hepsi) = cagir(&s, "GET", &format!("/api/danisanlar/{ayse}/not-ara?q=kaygi"), None).await;
    assert_eq!(hepsi.as_array().unwrap().len(), 3, "{hepsi}");
    // Kısa terim boş liste (400 değil), olmayan danışan 404.
    let (kod, kisa) = cagir(&s, "GET", &format!("/api/danisanlar/{ayse}/not-ara?q=k"), None).await;
    assert_eq!((kod, kisa), (StatusCode::OK, json!([])));
    let (kod, _) = cagir(&s, "GET", "/api/danisanlar/9999/not-ara?q=kaygi", None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    // Terim loga girmedi.
    assert!(!audit_dokumu(&s).await.to_lowercase().contains("kayg"));
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

    let say = |v: &serde_json::Value| v["sonuclar"].as_array().unwrap().len();

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
async fn arama_yaniti_kirpilmayi_bildirir_ve_sonuc_sayisi_loga_girmez() {
    // BILINEN BOSLUK KAPANIYOR: butce paylastirmasi sessiz kaybi
    // hafifletti ama kaldirmadi. Ciplak bir dizi "hepsi bu" ile
    // "kirpildi"yi ayirt edilemez kiliyordu; terapist var olan bir notu
    // bulamadigini fark etmiyordu.
    //
    // IKI YON AYNI TESTTE: ayni kurulumda once kirpilmayan sonra kirpilan
    // bir arama. "Hep true" ve "hep false" mutasyonlarinin ikisi de kirilir.
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

    // Sinir 3, eslesme 3: hicbir sey dusmedi.
    let (kod, tam) = cagir(&s, "GET", "/api/ara?q=kaygi&limit=3", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(tam["sonuclar"].as_array().unwrap().len(), 3, "on kosul: ucu de donmeli");
    assert_eq!(
        tam["kirpildi"],
        json!(false),
        "tam sinirdaki arama kirpilmis sayilmamali: {tam}"
    );

    // Sinir 2, eslesme 3: biri dustu.
    let (kod, kirpik) = cagir(&s, "GET", "/api/ara?q=kaygi&limit=2", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(kirpik["sonuclar"].as_array().unwrap().len(), 2);
    assert_eq!(kirpik["kirpildi"], json!(true), "dusen eslesme bildirilmeli: {kirpik}");

    // SONUC SAYISI VE KIRPILMA LOGA GIRMEZ (bkz. `store::search` basligi):
    // yalnizca "bu cihazdan arama yapildi" satiri, sabit `varlik_id` ile.
    let arama_satirlari: Vec<String> =
        log_satirlari(&s).await.into_iter().filter(|x| x.contains("|arama|")).collect();
    assert!(!arama_satirlari.is_empty(), "on kosul: arama satiri yazilmis olmali");
    for satir in arama_satirlari {
        assert_eq!(satir, "goruntuleme|arama|genel", "arama satiri sabit olmali: {satir}");
    }
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
    assert!(sonuc["sonuclar"].as_array().unwrap().is_empty());
    // Kisa sorgu KIRPILMIS da sayilmamali: uyari, kullanicinin daraltmasi
    // gereken gercek bir durum icin ayrilmis.
    assert_eq!(sonuc["kirpildi"], serde_json::json!(false), "{sonuc}");
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
// 9b. DENETIM KAYITLARI -- Gorev 7 Plan 7 (KVKK 2018/10)
// =====================================================================

/// Bu görevin EN KRİTİK kuralı: denetim kaydını OKUMAK yeni bir silinemez
/// satır YAZMAMALI (bkz. `routes::audit` ve
/// `store::audit::son_kayitlar_sayfali` modül başlıkları -- "log kendini
/// besler, okundukça büyür"). Ucu ÜST ÜSTE ve FARKLI sayfalarla defalarca
/// çağırıp `audit_log`'un TAMAMEN değişmediğini doğrular.
///
/// Mutasyonla kanıtlandı: `routes::audit::liste`'nin gövdesine bir
/// `audit::kaydet(...)` çağrısı eklemek bu testi kırmızıya döndürür (bkz.
/// Görev 7 raporu).
#[tokio::test]
async fn denetim_ucu_okuma_ikinci_bir_satir_uretmez() {
    let (_d, s, cid, rid) = dolu_state().await;
    // Bilinen bir miktar GERCEK etkinlik uret ki asagidaki karsilastirma bos
    // bir listeyi bos bir listeyle kiyaslayip totolojiye dusmesin.
    cagir(&s, "GET", &format!("/api/danisanlar/{cid}"), None).await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"x"})),
    )
    .await;

    let once = log_satirlari(&s).await;
    assert!(!once.is_empty(), "on kosul: log bos olmamali");

    for sayfa in 0..5 {
        let (kod, _yanit) =
            cagir(&s, "GET", &format!("/api/denetim-kayitlari?sayfa={sayfa}"), None).await;
        assert_eq!(kod, StatusCode::OK);
    }
    let sonra = log_satirlari(&s).await;
    assert_eq!(once, sonra, "denetim kaydini OKUMAK yeni bir satir birakmamali");
}

/// Arti yon: liste gercekten dolu, en yeniden eskiye sirali, varlik/tarih
/// suzgecleri calisiyor -- VE gövdede hassas veri (not icerigi, danisan
/// adi) yok. Gizlilik iddiasi once VERININ GERCEKTEN DONDUGUNU (on kosul)
/// dogrular, yoksa bos bir yanitla da saglanirdi (bkz. dosya basligi).
#[tokio::test]
async fn denetim_kayitlari_listelenir_siralanir_ve_hassas_veri_tasimaz() {
    let (_d, s, cid, rid) = dolu_state().await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"COK_GIZLI_ICERIK"})),
    )
    .await;
    // EN SON eylem: danisan dosyasini acmak (client|goruntuleme, HerCagri).
    cagir(&s, "GET", &format!("/api/danisanlar/{cid}"), None).await;

    let (kod, sayfa) = cagir(&s, "GET", "/api/denetim-kayitlari", None).await;
    assert_eq!(kod, StatusCode::OK);
    let metin = sayfa.to_string();
    assert!(
        !metin.contains("COK_GIZLI_ICERIK"),
        "not icerigi denetim listesine sizmamali: {metin}"
    );
    assert!(!metin.contains("Ayse Yilmaz"), "danisan adi denetim listesine sizmamali: {metin}");

    let kayitlar = sayfa["kayitlar"].as_array().unwrap();
    assert!(!kayitlar.is_empty(), "on kosul: liste bos olmamali");
    // id DESC: en son yazilan satir ilk sirada olmali.
    assert_eq!(kayitlar[0]["varlik"], "client");
    assert_eq!(kayitlar[0]["varlik_id"], cid.to_string());
    assert_eq!(kayitlar[0]["eylem"], "goruntuleme");
    assert_eq!(kayitlar[0]["cihaz"], "masaustu");

    // Varlik suzgeci: yalnizca "progress_note".
    let (_, filtreli) =
        cagir(&s, "GET", "/api/denetim-kayitlari?varlik=progress_note", None).await;
    let filtreli_kayitlar = filtreli["kayitlar"].as_array().unwrap();
    assert!(!filtreli_kayitlar.is_empty(), "on kosul: filtreli liste bos olmamali");
    assert!(filtreli_kayitlar.iter().all(|k| k["varlik"] == "progress_note"));

    // Tarih araligi: uzak GELECEK bir baslangic hicbir gercek satiri kapsamaz.
    let (_, bos) = cagir(&s, "GET", "/api/denetim-kayitlari?baslangic=2099-01-01", None).await;
    assert_eq!(bos["kayitlar"].as_array().unwrap().len(), 0);

    // Uzak GECMIS bir bitis de ayni sekilde bos donmeli.
    let (_, bos2) = cagir(&s, "GET", "/api/denetim-kayitlari?bitis=2000-01-01", None).await;
    assert_eq!(bos2["kayitlar"].as_array().unwrap().len(), 0);
}

/// `son_kayitlar`'in zaten sahip oldugu `LIMIT`, bu ucta sayfalamaya
/// donusuyor: 190 bin satirlik bir gunlukte hepsini tek seferde cekmek
/// yasak (bkz. dosya basligi).
#[tokio::test]
async fn denetim_kayitlari_sayfalanir() {
    let (_d, s, _cid, _rid) = dolu_state().await;
    // ONCE 60 FARKLI danisan olustur, SONRA her birini bir kez GET et.
    //
    // Neden AYNI danisani 60 kez GET etmek YETMEZ: `AuditKaydi` satir `id`si
    // TASIMAZ (bkz. tip -- kimlik bilgisi disinda gosterim alanlari) ve
    // `olay_zamani` saniye cozunurlugunde. HerCagri 60 cagriyi de birlestir-
    // meden ayri ayri yazar (`clients::getir_uc` -> `clients::getir`), ama
    // aynı danisana (ayni varlik_id) ayni saniye icinde atilan 60 GET, id'siz
    // JSON gorunumde BIRBIRINDEN AYIRT EDILEMEZ satirlar uretir -- asagidaki
    // "sayfalar cakismamali" iddiasi (kesin farkli SATIRLAR ama kesin AYNI
    // ICERIK) o zaman ortama/zamanlamaya bagli olarak kirmiziya donerdi
    // (goreve bagli mutasyon dogrulamasi sirasinda gozlemlendi). Farkli
    // danisanlar varlik_id'yi de ayirir, bu yuzden karsilastirma her kosulda
    // deterministik.
    let mut idler = Vec::with_capacity(60);
    for i in 0..60 {
        idler.push(danisan_ekle(&s, &format!("Sayfalama Testi {i}")).await);
    }
    for id in &idler {
        cagir(&s, "GET", &format!("/api/danisanlar/{id}"), None).await;
    }

    let (kod, sayfa0) = cagir(&s, "GET", "/api/denetim-kayitlari?varlik=client", None).await;
    assert_eq!(kod, StatusCode::OK);
    let kayitlar0 = sayfa0["kayitlar"].as_array().unwrap();
    assert_eq!(kayitlar0.len(), 50, "sayfa boyutu 50 olmali");
    assert_eq!(sayfa0["sayfa"], 0);
    assert_eq!(sayfa0["sonraki_sayfa_var"], true);

    let (_, sayfa1) =
        cagir(&s, "GET", "/api/denetim-kayitlari?varlik=client&sayfa=1", None).await;
    let kayitlar1 = sayfa1["kayitlar"].as_array().unwrap();
    assert!(!kayitlar1.is_empty(), "ikinci sayfa bos olmamali");
    assert_eq!(sayfa1["sayfa"], 1);
    // Sayfalar CAKISMAMALI -- varlik_id farkli danisanlardan geldigi icin bu
    // karsilastirma zamana bagli DEGIL.
    assert_ne!(kayitlar0[0], kayitlar1[0]);
}

#[tokio::test]
async fn denetim_kayitlari_gecersiz_tarihi_400_ile_reddeder() {
    let (_d, s, _cid, _rid) = dolu_state().await;
    for (alan, deger) in [("baslangic", "2026-9-7"), ("bitis", "yarin")] {
        let (kod, json) =
            cagir(&s, "GET", &format!("/api/denetim-kayitlari?{alan}={deger}"), None).await;
        assert_eq!(kod, StatusCode::BAD_REQUEST, "'{alan}={deger}' reddedilmeli");
        assert!(json["hata"].as_str().unwrap().contains("YYYY-AA-GG"), "{json}");
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
///
/// **Plan 4 Görev 1 incelemesi (dördüncü kusur): parçalayıcı görünürlüğe
/// bağlıydı.** Kaynak `"pub async fn "` ile bölünüp ilk parça (`skip(1)`)
/// atılıyordu. Modüldeki ilk `pub async fn`'den ÖNCE yazılmış kapısız bir
/// `pub(crate) async fn` o ilk parçanın içinde kalıyor, hiç handler
/// sayılmıyor ve `lib.rs` onu rotaya bağlayabiliyordu (mutasyonla
/// gösterildi: `/ay-ozeti` kapısız bir `pub(crate) async fn`'e bağlandı,
/// 47/47 yeşil). Rotaya bağlanabilmek `pub` olmaya değil `async fn` olmaya
/// bağlı; artık **her** `async fn` (`pub`, `pub(crate)`, `pub(super)`,
/// görünürlüksüz) handler adayıdır — bkz. `async_fn_parcalari`.
///
/// **Plan 4 Görev 6 düzeltmesi: "tam bir kez"in tek istisnası.** Veri raporu
/// saniyeler süren bir üretimden SONRA kapıyı yeniden çağırır; yoksa üretim
/// sürerken kilitlenen oturuma rapor verilirdi (incelemede ölçüldü: `200` +
/// PDF). "Tam bir kez"in gerekçesi sayım telafisiydi (b); o telafi artık
/// parça başına ilk satır iddiasıyla da imkânsız, ama kural yine de
/// gevşetilmedi — istisna **adıyla** `URETIM_SONRASI_YENIDEN_DOGRULAYANLAR`
/// listesinde ve üç şartla çalıştırılabilir: tam iki çağrı, ikincisi
/// `spawn_blocking`'den sonra, listedeki ad gerçekten var.
#[test]
fn her_veri_handleri_acik_baglantidan_gecer() {
    const KAPI: &str = "let conn = acik_baglanti(&s)?;";
    let kaynaklar = rota_kaynaklari();
    istisnalar_gercek_mi(&kaynaklar, &VERI_DISI_ROTALAR);

    let mut toplam = 0;
    let mut kullanilan_istisnalar: Vec<(String, String)> = Vec::new();
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

        let parcalar = async_fn_parcalari(&kod);
        // Bos bir veri rota modulu, "hicbir handler yok" diyerek her iddiayi
        // sessizce saglardi.
        assert!(
            !parcalar.is_empty(),
            "{ad}: veri rota modulu en az bir `async fn` icermeli \
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
            let cagrilar: Vec<usize> =
                parca.match_indices("acik_baglanti(").map(|(i, _)| i).collect();
            if URETIM_SONRASI_YENIDEN_DOGRULAYANLAR.contains(&(ad.as_str(), isim)) {
                // Bilinçli istisna: ilk satir kapi + uzun uretimden SONRA
                // taze kapi. Istisna calistirilabilir: ikinci cagri kalkarsa
                // (bayat istisna) ya da uretimden once gelirse kirilir.
                kullanilan_istisnalar.push((ad.clone(), isim.to_string()));
                assert_eq!(
                    cagrilar.len(),
                    2,
                    "{ad}::{isim}: istisna TAM iki kapi cagrisi ister (ilk satir + \
                     uretim sonrasi); tek cagri kaldiysa istisnayi listeden sil"
                );
                let uretim = parca.find("spawn_blocking(").unwrap_or_else(|| {
                    panic!("{ad}::{isim}: istisnanin gerekcesi olan uretim adimi yok")
                });
                assert!(
                    cagrilar[1] > uretim,
                    "{ad}::{isim}: ikinci kapi uretimden ({{spawn_blocking}}) SONRA olmali"
                );
            } else {
                // (b) telafisi: iki kez cagiran bir handler, kapisiz kalan bir
                // baskasini artik ortemez.
                assert_eq!(cagrilar.len(), 1, "{ad}::{isim}: kapi tam bir kez cagrilmali");
            }
        }
        toplam += parcalar.len();
    }
    // Istisna listesi bayatlamamali: adi yazili her handler gercekten
    // bulunmali (dosya/handler yeniden adlandirilirsa sessizce etkisizlesirdi).
    for (ad, isim) in URETIM_SONRASI_YENIDEN_DOGRULAYANLAR {
        assert!(
            kullanilan_istisnalar.iter().any(|(a, i)| a == ad && i == isim),
            "URETIM_SONRASI_YENIDEN_DOGRULAYANLAR bayat: {ad}::{isim} bulunamadi"
        );
    }
    // Ikinci ag: sayi degisirse (handler eklendi/silindi) bu satir kirilir ve
    // degisiklik BILINCLI olarak onaylanir. Birincil koruma artik yukaridaki
    // bire bir esleme -- sayiyi guncellemek tek basina bir kapiyi geri
    // getirmez.
    // Plan 5 Gorev 4: `/danisanlar/{id}/seanslar` (routes::danisan_seanslari)
    // 32. veri handler'i olarak eklendi; kapiyi kullanan tek handler'i var.
    // Plan 5 Gorev 5: `routes::tags` bes yeni veri handler'i ekledi (listele,
    // seans_listesi, ekle, kaldir, seanslar) -- toplam 32 -> 37.
    // Gorev 7 Plan 7: `routes::audit::liste` (denetim kaydini OKUMA ucu)
    // eklendi -- toplam 37 -> 38.
    // Tasarım S8 (2026-09-26): `routes::notes::danisan_not_ara` -- toplam 38 -> 39.
    assert_eq!(toplam, 39, "toplam veri handler'i sayisi 39 olmali");
}

/// Kapıyı ilk satırda VE uzun bir üretimden sonra ikinci kez çağırmasına izin
/// verilen handler'lar: `(dosya, handler)`. Bkz. `her_veri_handleri_acik_baglantidan_gecer`.
const URETIM_SONRASI_YENIDEN_DOGRULAYANLAR: [(&str, &str); 1] = [("veri_raporu.rs", "veri_raporu")];

/// Kaynağı **her** `async fn` başlangıcından parçalar; her parça fonksiyon
/// adıyla başlar ve bir sonraki `async fn`'e kadar sürer. Görünürlük
/// belirteci (`pub`, `pub(crate)`, `pub(super)`, hiçbiri) ayırt edilmez.
///
/// `async` bir tanımlayıcının parçası olmamalı (`asenkron_async`); ardından
/// en az bir boşluk, `fn` ve yine en az bir boşluk gelmeli. `async  fn` ya da
/// satır sonuyla bölünmüş `async`/`fn` da yakalanır.
fn async_fn_parcalari(kod: &str) -> Vec<&str> {
    fn tanimlayici(c: char) -> bool {
        c.is_alphanumeric() || c == '_'
    }
    let mut baslar = Vec::new();
    let mut arama = 0usize;
    while let Some(yer) = kod[arama..].find("async") {
        let bas = arama + yer;
        arama = bas + "async".len();
        if kod[..bas].chars().next_back().is_some_and(tanimlayici) {
            continue;
        }
        let kalan = &kod[arama..];
        let bosluksuz = kalan.trim_start();
        if bosluksuz.len() == kalan.len() || !bosluksuz.starts_with("fn") {
            continue;
        }
        let fn_sonrasi = &bosluksuz["fn".len()..];
        let ad = fn_sonrasi.trim_start();
        if ad.len() == fn_sonrasi.len() {
            continue;
        }
        baslar.push(kod.len() - ad.len());
    }
    baslar
        .iter()
        .enumerate()
        .map(|(i, &b)| &kod[b..baslar.get(i + 1).copied().unwrap_or(kod.len())])
        .collect()
}

/// Parçalayıcının kendisi: görünürlükten bağımsız yakalama, tanımlayıcı
/// içindeki `async` hecesinin aday sayılmaması. Parçalayıcı yeniden
/// `pub async fn`'e daralırsa bu test kırılır.
#[test]
fn async_fn_parcalayici_gorunurlukten_bagimsizdir() {
    let kod = [
        "use x;",
        "pub(crate) async fn gizli(s: S) -> R {",
        "    govde();",
        "}",
        "async  fn yalin() {}",
        "pub(super) async",
        "fn bolunmus() {}",
        "fn asenkron_async() {}",
        "let fn_async = 1;",
        "pub async fn acik(s: S) -> R {}",
    ]
    .join("\n");
    let adlar: Vec<&str> = async_fn_parcalari(&kod)
        .iter()
        .map(|p| p.split(|c: char| c == '(' || c.is_whitespace()).next().unwrap())
        .collect();
    assert_eq!(adlar, ["gizli", "yalin", "bolunmus", "acik"]);
}

// =====================================================================
// DOSYA INDIREN UCLAR -- SIFRELI YA DA ADLI ISTISNA (dal incelemesi D3/I3)
// =====================================================================

/// Dosya indiren (yanıtına `Content-Disposition`/`attachment` koyan) ama
/// yanıt gövdesini `pdf::sifreli_pdf`'ten ÜRETMEYEN handler'lar:
/// `(rota dosyası, handler)`. Her girdinin gerekçesi yanında yazılır.
///
/// Tasarım §10 dışa aktarılan her dosyanın şifreli olmasını ister. Bu liste o
/// kuralın **adlı ve çalıştırılabilir** istisnasıdır: listede olmayan yeni bir
/// indirme ucu şifresizse `dosya_indiren_her_uc_sifreli_ya_da_adli_istisnadir`
/// kırılır; listedeki bir girdi bayatlarsa (handler yok, artık indirmiyor ya
/// da artık şifreliyor) yine kırılır.
const SIFRESIZ_INDIRME_ISTISNALARI: [(&str, &str); 1] = [
    // Terapistin kendi yüklediği kaynak belgeyi (onam formu, test sonucu)
    // kendi makinesinde açması; rapor üretimi değil. Belge yüklenirken zaten
    // terapistin elindeydi, şifrelemek yeni bir koruma katmaz ama parolasını
    // unutulabilecek ikinci bir kopya üretir. Bkz. `routes::attachments::indir`.
    ("attachments.rs", "indir"),
];

/// Kaynaktaki her `fn` öğesi (`async` olsun olmasın): `(ad, async mı, parça)`.
/// Parça, fonksiyon adından bir sonraki `fn`'e kadar sürer. `FnOnce` gibi
/// tanımlayıcı içindeki hece sayılmaz.
fn fn_parcalari(kod: &str) -> Vec<(String, bool, &str)> {
    fn tanimlayici(c: char) -> bool {
        c.is_alphanumeric() || c == '_'
    }
    let mut baslar: Vec<(usize, String, bool)> = Vec::new();
    let mut arama = 0usize;
    while let Some(yer) = kod[arama..].find("fn") {
        let bas = arama + yer;
        arama = bas + 2;
        if kod[..bas].chars().next_back().is_some_and(tanimlayici) {
            continue;
        }
        let sonrasi = &kod[arama..];
        let ad_bas = sonrasi.trim_start();
        if ad_bas.len() == sonrasi.len() {
            continue;
        }
        let ad: String = ad_bas.chars().take_while(|&c| tanimlayici(c)).collect();
        if ad.is_empty() {
            continue;
        }
        let once = kod[..bas].trim_end();
        let asenkron = once.ends_with("async")
            && !once[..once.len() - "async".len()].chars().next_back().is_some_and(tanimlayici);
        baslar.push((bas, ad, asenkron));
    }
    baslar
        .iter()
        .enumerate()
        .map(|(i, (b, ad, asenkron))| {
            let son = baslar.get(i + 1).map_or(kod.len(), |x| x.0);
            (ad.clone(), *asenkron, &kod[*b..son])
        })
        .collect()
}

/// Kodda dosya indirme başlığı kuruluyor mu. Yalnızca KOD satırlarına bakılır
/// (çağıran `kod_satirlari` verir); `attachments::` modül yolu `"attachment`
/// dizgi başlangıcıyla karışmaz.
fn indirme_basligi_var(parca: &str) -> bool {
    let kucuk = parca.to_lowercase();
    kucuk.contains("content_disposition")
        || kucuk.contains("content-disposition")
        || kucuk.contains("\"attachment")
}

/// Bir rota dosyasında indirme başlığı kuran **kök** fonksiyonlar:
/// `(ad, sifreli_pdf'e ulaşıyor mu)`. Başlığı doğrudan ya da dosya içi bir
/// yardımcı üzerinden (geçişli) kuran ve dosyada başka hiçbir fonksiyonun
/// çağırmadığı her fonksiyon köktür — `async fn` olması gerekmez, çünkü
/// `impl Future` dönen düz bir `fn` de rotaya bağlanabilir.
///
/// Sınır (biçim 10 gereği açıkça): "şifreli" iddiası `sifreli_pdf` adının kök
/// fonksiyonun geçişli çağrı kümesinde GEÇMESİDİR; baytların gerçekten o
/// çıktıdan geldiği veri akışı analiz edilmez. Veri raporu için akış ayrıca
/// davranışsal olarak ölçülüyor
/// (`veri_raporu_sifreli_pdf_doner_ve_disa_aktarma_loglanir`: `is_encrypted`).
fn indirme_kokleri(kod: &str) -> Vec<(String, bool)> {
    let parcalar = fn_parcalari(kod);
    let cagiriyor = |parca: &str, ad: &str| {
        // Tanımın kendisi (`fn ad(`) çağrı sayılmaz.
        parca.match_indices(&format!("{ad}(")).any(|(i, _)| {
            !parca[..i].trim_end().ends_with("fn")
                && !parca[..i].chars().next_back().is_some_and(|c| c.is_alphanumeric() || c == '_')
        })
    };
    // Gecisli kapanis: baslik kuran ve sifreli_pdf'e ulasan fonksiyon kumeleri.
    let mut baslik: Vec<bool> = parcalar.iter().map(|(_, _, p)| indirme_basligi_var(p)).collect();
    let mut sifreli: Vec<bool> = parcalar.iter().map(|(_, _, p)| p.contains("sifreli_pdf")).collect();
    loop {
        let mut degisti = false;
        for i in 0..parcalar.len() {
            for j in 0..parcalar.len() {
                if i != j && cagiriyor(parcalar[i].2, &parcalar[j].0) {
                    if baslik[j] && !baslik[i] {
                        baslik[i] = true;
                        degisti = true;
                    }
                    if sifreli[j] && !sifreli[i] {
                        sifreli[i] = true;
                        degisti = true;
                    }
                }
            }
        }
        if !degisti {
            break;
        }
    }
    parcalar
        .iter()
        .enumerate()
        .filter(|&(i, (ad, _, _))| {
            baslik[i]
                && !parcalar.iter().enumerate().any(|(j, (_, _, p))| j != i && cagiriyor(p, ad))
        })
        .map(|(i, (ad, _, _))| (ad.clone(), sifreli[i]))
        .collect()
}

/// Dosya indiren her uç ya şifreli PDF üretir ya da adıyla istisnadır.
///
/// # Bulgu (dal incelemesi I3)
///
/// Çekirdek ek indirmeyi `DisaAktarma` sayıyordu ama baytları şifresiz
/// veriyordu — tasarım §10 ("dışa aktarılan her dosya şifreli") ile çelişki.
/// Karar D3: ek indirme şifresiz kalır, ama bu bir **adlı** istisnadır ve
/// sunucuda "`Content-Disposition` dönen her uç şifreli olmalı" kuralı artık
/// çalıştırılabilir. Küme `server/src/routes/` dizininden türetilir: yarın
/// eklenecek bir CSV/yedek/özet indirme ucu hiçbir şey yapılmadan kapsama
/// girer.
#[test]
fn dosya_indiren_her_uc_sifreli_ya_da_adli_istisnadir() {
    let kaynaklar = rota_kaynaklari();
    let mut kokler: Vec<(String, String, bool)> = Vec::new();
    for (ad, kaynak) in &kaynaklar {
        for (isim, sifreli) in indirme_kokleri(&kod_satirlari(kaynak)) {
            kokler.push((ad.clone(), isim, sifreli));
        }
    }

    // ON KOSUL (totoloji engeli): tarayici bugunku iki indirme ucunu GERCEKTEN
    // buluyor -- biri sifreli (yardimci zinciri uzerinden), biri istisna.
    assert!(
        kokler.iter().any(|(a, i, s)| a == "veri_raporu.rs" && i == "veri_raporu" && *s),
        "veri raporu sifreli indirme ucu olarak taninmadi: {kokler:?}"
    );

    let mut ihlaller = Vec::new();
    for (ad, isim, sifreli) in &kokler {
        let istisna = SIFRESIZ_INDIRME_ISTISNALARI.contains(&(ad.as_str(), isim.as_str()));
        if !sifreli && !istisna {
            ihlaller.push(format!(
                "{ad}::{isim}: dosya indiriyor ama yanitini `pdf::sifreli_pdf`'ten uretmiyor \
                 ve SIFRESIZ_INDIRME_ISTISNALARI'nda yok (tasarim §10)"
            ));
        }
        if *sifreli && istisna {
            ihlaller.push(format!(
                "{ad}::{isim}: artik sifreli -- SIFRESIZ_INDIRME_ISTISNALARI girdisi bayat, silinmeli"
            ));
        }
    }
    // Bayatlik: listedeki her handler gercekten var ve gercekten indirme
    // basligi kuruyor.
    for (ad, isim) in SIFRESIZ_INDIRME_ISTISNALARI {
        if !kokler.iter().any(|(a, i, _)| a == ad && i == isim) {
            ihlaller.push(format!(
                "SIFRESIZ_INDIRME_ISTISNALARI bayat: {ad}::{isim} yok ya da artik \
                 Content-Disposition kurmuyor"
            ));
        }
    }
    assert!(ihlaller.is_empty(), "{} ihlal:\n{}", ihlaller.len(), ihlaller.join("\n"));
}

/// Tarayıcının kendisi, dosyalardan bağımsız: geçişli yardımcı, kök tespiti,
/// `FnOnce` hecesi, `"attachment` ile `attachments::` ayrımı.
#[test]
fn indirme_koku_tarayicisi_yardimci_zincirini_izler() {
    let kod = [
        "use psikolog_core::store::attachments::liste;",
        "fn baslik_koy(y: &mut R) { y.insert(header::CONTENT_DISPOSITION, v); }",
        "fn akis<U: FnOnce()>(u: U) -> impl Future { async move { baslik_koy(&mut y) } }",
        "pub async fn sifreli_uc(s: S) -> R { akis(sifreli_pdf) }",
        "pub async fn duz_uc(s: S) -> R { let _ = \"attachment; filename=x\"; }",
        "pub async fn liste_uc(s: S) -> R { liste(&c) }",
    ]
    .join("\n");
    let mut kokler = indirme_kokleri(&kod);
    kokler.sort();
    assert_eq!(kokler, [("duz_uc".to_string(), false), ("sifreli_uc".to_string(), true)]);
}

// =====================================================================
// PLAN 4 GOREV 6 -- DANISAN VERI RAPORU (sunucuda, AES-256 sifreli PDF)
// =====================================================================
//
// Plan 3'teki `POST /api/danisanlar/{id}/rapor-kaydi` ucu KALDIRILDI: rapor
// istemcide uretiliyor, sunucu yalnizca "haberdar ediliyordu". Artik raporu
// ureten uc nokta onu loglar. Kaldirilan testlerin karsiliklari:
//
// - rapor_kaydi_uc_noktasi_disa_aktarma_satiri_yazar
//     -> veri_raporu_sifreli_pdf_doner_ve_disa_aktarma_loglanir
// - ard_arda_iki_disa_aktarim_iki_satir_yazar
//     -> ayni_rapor_ikinci_kez_alininca_ikinci_log_satiri_yazilir
// - olmayan_danisan_icin_rapor_kaydi_404_doner_ve_log_yazmaz
//     -> olmayan_danisan_icin_veri_raporu_404_doner_ve_log_yazmaz
// - kilitliyken_rapor_kaydi_401_doner_ve_log_yazmaz
//     -> kilitliyken_veri_raporu_401_ve_log_yazilmaz
// - (istemcideki "once kayit, sonra rapor" sirasi)
//     -> kayit_yazilamazsa_500_doner_ve_pdf_verilmez

/// Oturumun anahtariyla `audit_log`'u okur ve `eylem|varlik|varlik_id`
/// uclusunu dondurur (en yeni once). Testler dogrudan veriye bakar.
async fn log_satirlari(s: &AppState) -> Vec<String> {
    use psikolog_server::guard::acik_baglanti_ile;
    let conn =
        acik_baglanti_ile(s, || (std::time::Instant::now(), std::time::SystemTime::now()))
            .expect("log okumak icin oturum acik olmali");
    psikolog_core::store::audit::son_kayitlar(&conn, 100_000)
        .unwrap()
        .into_iter()
        .map(|k| format!("{}|{}|{}", k.eylem, k.varlik, k.varlik_id))
        .collect()
}

/// Denetim kaydinin TUM alanlari (zaman, eylem, varlik, kimlik, cihaz,
/// ayrinti) tek metin olarak -- sizinti taramasi icin. En yeni satir once.
async fn audit_dokumu(s: &AppState) -> String {
    use psikolog_server::guard::acik_baglanti_ile;
    let conn = acik_baglanti_ile(s, || (std::time::Instant::now(), std::time::SystemTime::now()))
        .expect("oturum acik olmali");
    psikolog_core::store::audit::son_kayitlar(&conn, 100_000)
        .unwrap()
        .into_iter()
        .map(|k| {
            format!(
                "{}|{}|{}|{}|{}|{:?}",
                k.olay_zamani, k.eylem, k.varlik, k.varlik_id, k.cihaz, k.ayrinti
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

const RAPOR_PAROLASI: &str = "danisan-parolasi-1";
/// Istemcinin yerel gunu (Gorev 7). Sunucunun saatinden BILEREK farkli bir
/// gun: dosya adi sunucu saatinden uretilseydi esitlik tutmazdi.
const RAPOR_GUNU: &str = "2031-01-02";

async fn rapor_iste(s: &AppState, cid: i64, govde: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
    cagir_ham(
        s,
        "POST",
        &format!("/api/danisanlar/{cid}/veri-raporu"),
        &[("content-type", "application/json")],
        govde.as_bytes().to_vec(),
    )
    .await
}

async fn rapor_parolayla(
    s: &AppState,
    cid: i64,
    parola: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    rapor_iste(s, cid, &json!({ "parola": parola, "bugun": RAPOR_GUNU }).to_string()).await
}

fn hata_metni(govde: &[u8]) -> String {
    let j: serde_json::Value = serde_json::from_slice(govde)
        .unwrap_or_else(|_| panic!("govde JSON degil: {}", String::from_utf8_lossy(govde)));
    j["hata"].as_str().unwrap_or_else(|| panic!("`hata` alani yok: {j}")).to_string()
}

fn pdf_mi(govde: &[u8]) -> bool {
    String::from_utf8_lossy(govde).contains("%PDF")
}

/// PDF'i verilen parolayla cozup metnini cikarir. Yanlis parola `Err`.
fn pdf_metni(pdf: &[u8], parola: &str) -> Result<String, String> {
    let doc =
        lopdf::Document::load_mem_with_options(pdf, lopdf::LoadOptions::with_password(parola))
            .map_err(|e| e.to_string())?;
    let sayfalar: Vec<u32> = doc.get_pages().keys().copied().collect();
    doc.extract_text(&sayfalar).map_err(|e| e.to_string())
}

#[tokio::test]
async fn veri_raporu_sifreli_pdf_doner_ve_disa_aktarma_loglanir() {
    let (_d, s, cid, rid) = dolu_state().await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"RESMI-KANARYA"})),
    )
    .await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/ozel-not"),
        Some(json!({"icerik":"OZEL-KANARYA"})),
    )
    .await;
    // Plan 4 Gorev 7: ek ADI rapora girer (danisanin kendi verisi), ek
    // ICERIGI girmez. Ek, log on kosulundan ONCE yukleniyor.
    ek_yukle(&s, cid, "EK-ADI-KANARYA.pdf", b"EK-ICERIK-KANARYA").await;
    // Plan 3'teki C1 bulgusunun kosulu: seans paneli ayni danisan icin
    // acilmis (not listesi `goruntuleme` yazmis). Disa aktarim satiri bu
    // satirin arkasina saklanmamali.
    cagir(&s, "GET", &format!("/api/danisanlar/{cid}/notlar?limit=200"), None).await;
    let once = log_satirlari(&s).await;
    assert!(!once.iter().any(|x| x.starts_with("disa_aktarma")), "on kosul: {once:?}");

    let (kod, basliklar, govde) = rapor_parolayla(&s, cid, RAPOR_PAROLASI).await;
    assert_eq!(kod, StatusCode::OK, "{}", String::from_utf8_lossy(&govde));
    assert_eq!(basliklar.get("content-type").unwrap(), "application/pdf");
    let ek = basliklar.get("content-disposition").expect("content-disposition").to_str().unwrap();
    assert!(ek.starts_with("attachment;"), "{ek}");
    let dosya = ek.split("filename=\"").nth(1).and_then(|p| p.strip_suffix('"')).expect(ek);
    assert_eq!(dosya, format!("danisan-veri-raporu-{RAPOR_GUNU}.pdf"), "istemcinin yerel gunu");
    assert!(!ek.contains("Ayse") && !ek.contains("Yilmaz"), "dosya adinda danisan adi: {ek}");
    assert_eq!(basliklar.get("x-content-type-options").unwrap(), "nosniff");

    // Sifreli: ham baytlarda kanarya yok VE sifreleme sozlugu var. Ham bayt
    // taramasi tek basina yetmez: icerik akisi sifresiz dosyada da glif
    // kimligi olarak durur (bkz. `pdf.rs::baslik_ustverisi_de_ham_...`).
    assert!(govde.starts_with(b"%PDF-"));
    assert!(!String::from_utf8_lossy(&govde).contains("RESMI-KANARYA"));
    assert!(lopdf::Document::load_mem(&govde).unwrap().is_encrypted(), "PDF sifreli olmali");

    let metin = pdf_metni(&govde, RAPOR_PAROLASI).expect("dogru parolayla acilmali");
    // ARTI YON: yoksa "ozel yok" iddiasi bos bir raporla da saglanirdi.
    assert!(metin.contains("RESMI-KANARYA"), "resmi not raporda olmali: {metin}");
    assert!(metin.contains("Ayse Yilmaz"), "danisan adi raporda olmali");
    assert!(!metin.contains("OZEL-KANARYA"), "ozel not rapora SIZDI: {metin}");
    assert!(metin.contains("EK-ADI-KANARYA.pdf"), "ek adi raporda olmali: {metin}");
    assert!(!metin.contains("EK-ICERIK-KANARYA"), "ek icerigi rapora gomulmemeli: {metin}");
    assert!(!String::from_utf8_lossy(&govde).contains("EK-ADI-KANARYA"), "ek adi sifreli olmali");
    assert!(
        pdf_metni(&govde, "yanlis-parola-9").map_or(true, |m| !m.contains("RESMI-KANARYA")),
        "yanlis parola icerigi acmamali"
    );

    let sonra = log_satirlari(&s).await;
    assert_eq!(sonra.len(), once.len() + 1, "TAM OLARAK bir satir: {sonra:?}");
    assert_eq!(sonra[0], format!("disa_aktarma|client|{cid}"), "en ustte disa aktarma satiri");
    let dokum = audit_dokumu(&s).await;
    assert!(dokum.lines().next().unwrap().ends_with("|None"), "ayrinti bos olmali: {dokum}");
}

/// Dal incelemesi karari D1: raporda "Randevular ve odemeler" bolumu --
/// notsuz ve iptal edilmis randevular da, ucret `1.234,50 TL` bicimiyle,
/// odendi bilgisiyle. Baskasinin randevusu yok, tasinan randevu yeni
/// danisanda, ozel not hala yok. Olcum COZULMUS PDF metni uzerinde.
#[tokio::test]
async fn veri_raporu_randevular_ve_odemeler_bolumunu_icerir() {
    let (_d, s) = kurulu_state().await;
    let cid = danisan_ekle(&s, "Ayse Yilmaz").await;
    let baska = danisan_ekle(&s, "Mehmet Demir").await;
    let randevu = |cid: i64, bas: &str, ucret: Option<i64>| {
        let s = s.clone();
        let bas = bas.to_string();
        async move {
            let (kod, r) = cagir(
                &s,
                "POST",
                "/api/randevular",
                Some(json!({
                    "client_id": cid,
                    "baslangic": bas,
                    "bitis": format!("{}T23:59", &bas[..10]),
                    "ucret": ucret,
                })),
            )
            .await;
            assert_eq!(kod, StatusCode::CREATED, "kurulum: {r}");
            r[0]["id"].as_i64().unwrap()
        }
    };
    let geldi = randevu(cid, "2026-01-10T09:30", Some(123450)).await;
    let iptal = randevu(cid, "2026-02-11T10:00", Some(45000)).await;
    randevu(cid, "2026-03-12T11:15", None).await;
    let tasinan = randevu(baska, "2026-04-13T12:00", Some(98765)).await;
    randevu(baska, "2026-05-14T13:00", Some(777700)).await;

    for (id, yol, govde) in [
        (geldi, "", json!({"durum":"geldi"})),
        (geldi, "/odeme", json!({"odendi":true})),
        (iptal, "", json!({"durum":"iptal"})),
    ] {
        let (kod, j) = cagir(&s, "PATCH", &format!("/api/randevular/{id}{yol}"), Some(govde)).await;
        assert!(kod.is_success(), "kurulum: {kod} {j}");
    }
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{iptal}/ozel-not"),
        Some(json!({"icerik":"OZEL-KANARYA-RANDEVU"})),
    )
    .await;
    let (kod, j) = cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{tasinan}"),
        Some(json!({
            "client_id": cid,
            "baslangic": "2026-04-13T12:00",
            "bitis": "2026-04-13T23:59",
            "ucret": 98765,
        })),
    )
    .await;
    assert_eq!(kod, StatusCode::OK, "kurulum: tasima {j}");

    let (kod, _b, govde) = rapor_parolayla(&s, cid, RAPOR_PAROLASI).await;
    assert_eq!(kod, StatusCode::OK, "{}", String::from_utf8_lossy(&govde));
    let metin = pdf_metni(&govde, RAPOR_PAROLASI).expect("dogru parolayla acilmali");
    // PDF metin cikarimi satir sonlarini/bosluklari degistirebilir; iddialar
    // bosluklar atilmis metin uzerinde.
    let sade: String = metin.chars().filter(|c| !c.is_whitespace()).collect();
    let icerir = |parca: &str| {
        let p: String = parca.chars().filter(|c| !c.is_whitespace()).collect();
        sade.contains(&p)
    };
    assert!(icerir("Randevular ve ödemeler (4)"), "{metin}");
    for satir in [
        "10.01.2026 09:30 · Geldi · Ücret: 1.234,50 TL · Ödendi: Evet",
        "11.02.2026 10:00 · İptal · Ücret: 450,00 TL · Ödendi: Hayır",
        "12.03.2026 11:15 · Planlandı · Ücret girilmemiş · Ödendi: Hayır",
        "13.04.2026 12:00 · Planlandı · Ücret: 987,65 TL · Ödendi: Hayır",
    ] {
        assert!(icerir(satir), "`{satir}` raporda yok:\n{metin}");
    }
    assert!(!icerir("7.777,00 TL") && !icerir("14.05.2026"), "baskasinin randevusu: {metin}");
    assert!(!icerir("OZEL-KANARYA-RANDEVU"), "ozel not rapora SIZDI: {metin}");

    // Tasinan randevu eski danisanin raporundan cikti.
    let (kod, _b, govde) = rapor_parolayla(&s, baska, RAPOR_PAROLASI).await;
    assert_eq!(kod, StatusCode::OK);
    let b_metin: String = pdf_metni(&govde, RAPOR_PAROLASI)
        .unwrap()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    assert!(b_metin.contains("Randevularveödemeler(1)"), "{b_metin}");
    assert!(!b_metin.contains("987,65TL") && b_metin.contains("7.777,00TL"), "{b_metin}");
}

/// Gorev 7: dosya adindaki tarih ISTEMCININ yerel gunudur (duvar saati
/// sozlesmesi; emsal `saklama-suresi-dolanlar?bugun=`). Iki farkli gun:
/// sunucunun kendi gunune donen bir uygulama ikisini birden tutturamaz.
#[tokio::test]
async fn dosya_adi_istemcinin_gonderdigi_yerel_gundur() {
    let (_d, s, cid, _rid) = dolu_state().await;
    for gun in ["2026-09-09", "2019-12-31"] {
        let govde = json!({ "parola": RAPOR_PAROLASI, "bugun": gun }).to_string();
        let (kod, basliklar, yanit) = rapor_iste(&s, cid, &govde).await;
        assert_eq!(kod, StatusCode::OK, "{}", String::from_utf8_lossy(&yanit));
        assert_eq!(
            basliklar.get("content-disposition").unwrap(),
            &format!("attachment; filename=\"danisan-veri-raporu-{gun}.pdf\""),
        );
    }
}

/// Gecersiz gun `400 {"hata"}`: PDF uretilmez, log satiri yazilmaz, deger
/// basliga yansimaz (baslik enjeksiyonu denemesi dahil).
#[tokio::test]
async fn gecersiz_bugun_400_doner_rapor_uretilmez_log_yazilmaz() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();
    for kotu in ["2026-02-30", "2026-9-9", "", "2026-09-09\r\nX-Enjekte: 1", "../x"] {
        let govde = json!({ "parola": RAPOR_PAROLASI, "bugun": kotu }).to_string();
        let (kod, basliklar, yanit) = rapor_iste(&s, cid, &govde).await;
        assert_eq!(kod, StatusCode::BAD_REQUEST, "{kotu:?}");
        assert_eq!(
            hata_metni(&yanit),
            "Rapor tarihi YYYY-AA-GG biçiminde geçerli bir gün olmalı.",
            "{kotu:?}"
        );
        assert!(!pdf_mi(&yanit) && basliklar.get("content-disposition").is_none(), "{kotu:?}");
        assert!(basliklar.get("x-enjekte").is_none());
    }
    assert_eq!(log_satirlari(&s).await.len(), once, "red log satiri birakmamali");
}

#[tokio::test]
async fn ayni_rapor_ikinci_kez_alininca_ikinci_log_satiri_yazilir() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();
    for _ in 0..2 {
        let (kod, _, govde) = rapor_parolayla(&s, cid, RAPOR_PAROLASI).await;
        assert_eq!(kod, StatusCode::OK);
        assert!(govde.starts_with(b"%PDF-"));
    }
    let sonra = log_satirlari(&s).await;
    assert_eq!(sonra.len(), once + 2, "HerCagri: iki istek iki satir -- {sonra:?}");
    assert_eq!(sonra.iter().filter(|x| **x == format!("disa_aktarma|client|{cid}")).count(), 2);
}

#[tokio::test]
async fn ana_parola_rapor_parolasi_olarak_reddedilir_ve_log_yazilmaz() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();

    // `kurulu_state`in ana parolasi: "gizliparola".
    let (kod, basliklar, govde) = rapor_parolayla(&s, cid, "gizliparola").await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert_eq!(
        hata_metni(&govde),
        "Rapor için ana parolanızı kullanmayın; danışana vereceğiniz ayrı bir parola seçin."
    );
    assert!(!pdf_mi(&govde) && basliklar.get("content-disposition").is_none());
    assert_eq!(log_satirlari(&s).await.len(), once, "red log satiri birakmamali");

    // TERS YON: ana parolaya BENZEYEN ama farkli bir parola reddedilmez --
    // yoksa her seyi reddeden bir kontrol de bu testi gecerdi.
    let (kod, _, govde) = rapor_parolayla(&s, cid, "gizliparolA").await;
    assert_eq!(kod, StatusCode::OK, "{}", String::from_utf8_lossy(&govde));
    assert!(govde.starts_with(b"%PDF-"));
}

#[tokio::test]
async fn kisa_parola_400_sinirdaki_200() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();
    // "şşşşşşş": 7 karakter, 14 bayt -- bayt sayan bir kontrol bunu gecirirdi.
    for kisa in ["1234567", "şşşşşşş"] {
        let (kod, _, govde) = rapor_parolayla(&s, cid, kisa).await;
        assert_eq!(kod, StatusCode::BAD_REQUEST, "{kisa}");
        assert_eq!(hata_metni(&govde), "Rapor parolası en az 8 karakter olmalı.");
    }
    assert_eq!(log_satirlari(&s).await.len(), once);
    for sinirda in ["12345678", "şşşşşşşş"] {
        let (kod, _, govde) = rapor_parolayla(&s, cid, sinirda).await;
        assert_eq!(kod, StatusCode::OK, "{sinirda}: {}", String::from_utf8_lossy(&govde));
        assert!(pdf_metni(&govde, sinirda).unwrap().contains("Ayse Yilmaz"));
    }
}

#[tokio::test]
async fn kilitliyken_veri_raporu_401_ve_log_yazilmaz() {
    let (_d, s, cid, rid) = dolu_state().await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"KILITLI-KANARYA"})),
    )
    .await;
    let once = log_satirlari(&s).await.len();

    kilitle(&s).await;
    let (kod, basliklar, govde) = rapor_parolayla(&s, cid, RAPOR_PAROLASI).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(!pdf_mi(&govde), "kilitliyken PDF donmemeli");
    assert!(!String::from_utf8_lossy(&govde).contains("KILITLI-KANARYA"));
    assert!(basliklar.get("content-disposition").is_none());
    // Kapi govde ayristirmasindan ONCE: bozuk govde de 401 (400 degil).
    let (kod, _, _) = rapor_iste(&s, cid, "{bozuk").await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);

    kilit_ac(&s).await;
    let sonra = log_satirlari(&s).await;
    assert!(!sonra.iter().any(|x| x.starts_with("disa_aktarma")), "{sonra:?}");
    assert_eq!(sonra.len(), once + 2, "yalnizca cikis + giris satirlari eklenmeli");
}

#[tokio::test]
async fn olmayan_danisan_icin_veri_raporu_404_doner_ve_log_yazmaz() {
    let (_d, s, _cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();
    let (kod, _, govde) = rapor_parolayla(&s, 9999, RAPOR_PAROLASI).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    // Bilinmeyen yol da `404 {hata}` doner; mesaj ikisini ayirir.
    assert_eq!(hata_metni(&govde), "Kayıt bulunamadı.");
    assert_eq!(log_satirlari(&s).await.len(), once, "404 log satiri birakmamali");
}

/// Fail-closed: denetim satiri yazilamazsa rapor VERILMEZ. Kaldirilan
/// istemci tarafi "once kayit, sonra rapor" sirasinin sunucudaki karsiligi.
#[tokio::test]
async fn kayit_yazilamazsa_500_doner_ve_pdf_verilmez() {
    let (_d, s, cid, _rid) = dolu_state().await;
    // On kosul: ayni durumda rapor GERCEKTEN uretilebiliyor.
    let (kod, _, govde) = rapor_parolayla(&s, cid, RAPOR_PAROLASI).await;
    assert_eq!(kod, StatusCode::OK);
    assert!(pdf_mi(&govde));

    {
        use psikolog_server::guard::acik_baglanti_ile;
        let conn =
            acik_baglanti_ile(&s, || (std::time::Instant::now(), std::time::SystemTime::now()))
                .unwrap();
        conn.execute_batch("DROP TABLE audit_log").unwrap();
    }

    let (kod, basliklar, govde) = rapor_parolayla(&s, cid, RAPOR_PAROLASI).await;
    assert_eq!(kod, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        hata_metni(&govde),
        "Dışa aktarım denetim kaydına yazılamadı; rapor verilmedi."
    );
    assert!(!pdf_mi(&govde), "kayit yazilamadiysa PDF baytlari donmemeli");
    assert!(basliklar.get("content-disposition").is_none());
}

/// `rapor_akisi`'ni uc noktanin yaptigi gibi cagirir: once gercek kapi,
/// sonra verilen PDF ureticisiyle akis. Yanit `(kod, govde)` olarak.
async fn akisla_rapor<U>(s: &AppState, cid: i64, pdf_uret: U) -> (StatusCode, Vec<u8>)
where
    U: FnOnce(
            &psikolog_core::pdf::RaporIcerigi,
            &str,
        ) -> Result<Vec<u8>, psikolog_core::pdf::PdfHatasi>
        + Send
        + 'static,
{
    use axum::response::IntoResponse;
    let conn = psikolog_server::guard::acik_baglanti(s).expect("on kosul: kapi acik olmali");
    let istek: psikolog_server::routes::veri_raporu::RaporIstegi =
        serde_json::from_value(json!({ "parola": RAPOR_PAROLASI, "bugun": RAPOR_GUNU })).unwrap();
    let yanit = psikolog_server::routes::veri_raporu::rapor_akisi(
        s.clone(),
        conn,
        cid,
        Ok(axum::Json(istek)),
        pdf_uret,
    )
    .await
    .into_response();
    let kod = yanit.status();
    let govde = yanit.into_body().collect().await.unwrap().to_bytes().to_vec();
    (kod, govde)
}

/// M2: kapi yalnizca handler basindaydi; 400 notlu bir raporda uretim
/// basladiktan 300 ms sonra `/kilitle` -> `200` + PDF olculmustu.
///
/// Sabit bekleme YOK: kilitleme uretimin ICINDEN, gercek `/api/kilitle`
/// ucuyla yapiliyor (uretici engelleyici is parcaciginda calisir; kapi o an
/// coktan gecilmistir). Uretici gercek `sifreli_pdf`'i cagirir -- yani PDF
/// baytlari GERCEKTEN uretilmistir ve verilmemesi gereken tam da onlardir.
#[tokio::test(flavor = "multi_thread")]
async fn uretim_surerken_kilitlenirse_401_pdf_ve_log_yok() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    let (_d, s, cid, _rid) = dolu_state().await;

    // ARTI YON / on kosul: kilitlemeyen ayni uretici 200 + PDF + tek satir
    // verir. Yoksa asagidaki 401 akisin kendisinin bozuk olmasindan gelebilirdi.
    let once = log_satirlari(&s).await.len();
    let (kod, govde) = akisla_rapor(&s, cid, psikolog_core::pdf::sifreli_pdf).await;
    assert_eq!(kod, StatusCode::OK, "{}", String::from_utf8_lossy(&govde));
    assert!(govde.starts_with(b"%PDF-"));
    assert_eq!(log_satirlari(&s).await.len(), once + 1, "on kosul: basarili akis bir satir yazar");

    let once = log_satirlari(&s).await;
    let calisti = Arc::new(AtomicBool::new(false));
    let (s2, calisti2) = (s.clone(), calisti.clone());
    let calisma_zamani = tokio::runtime::Handle::current();
    let (kod, govde) = akisla_rapor(&s, cid, move |icerik, parola| {
        let pdf = psikolog_core::pdf::sifreli_pdf(icerik, parola);
        calisma_zamani.block_on(kilitle(&s2));
        // On kosul: kilit GERCEKTEN uretim sirasinda kondu.
        assert!(s2.acik_anahtar().is_none(), "uretim icinde oturum kilitlenmis olmali");
        calisti2.store(true, Ordering::SeqCst);
        pdf
    })
    .await;
    assert!(calisti.load(Ordering::SeqCst), "on kosul: uretici calisti (ilk kapi gecildi)");
    assert_eq!(kod, StatusCode::UNAUTHORIZED, "{}", String::from_utf8_lossy(&govde));
    assert!(!pdf_mi(&govde), "kilitlenen oturuma PDF baytlari verilmemeli");
    assert_eq!(hata_metni(&govde), "Oturum kilitli. Lütfen parolanızı girin.");

    kilit_ac(&s).await;
    let sonra = log_satirlari(&s).await;
    let disa = |v: &[String]| v.iter().filter(|x| x.starts_with("disa_aktarma")).count();
    assert_eq!(disa(&sonra), disa(&once), "verilmeyen rapor icin denetim satiri yazilmamali");
    // Yalnizca cikis + giris satirlari eklendi.
    assert_eq!(sonra.len(), once.len() + 2, "{sonra:?}");
}

/// M1: sira "uret -> yeniden dogrula -> kaydet -> ver". Uretim basarisizsa
/// `500` ve denetim satiri YOK. Kayit uretimden once alinsaydi bu test
/// kirilirdi (eskiden adimlar yer degistirince her sey yesildi).
#[tokio::test]
async fn veri_raporu_uretim_basarisizsa_500_ve_log_yazilmaz() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();
    let (kod, govde) = akisla_rapor(&s, cid, |_icerik, _parola| {
        Err(psikolog_core::pdf::PdfHatasi::Uretim("GIZLI-KUTUPHANE-METNI".into()))
    })
    .await;
    assert_eq!(kod, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(hata_metni(&govde), "Rapor üretilemedi.");
    assert!(!String::from_utf8_lossy(&govde).contains("GIZLI-KUTUPHANE"), "kutuphane metni sizdi");
    assert_eq!(log_satirlari(&s).await.len(), once, "uretilmeyen rapor loga girmemeli");

    // TERS YON: ayni yardimci gercek ureticiyle satir YAZAR -- yoksa "satir
    // yok" iddiasi hic yazmayan bir akisla da saglanirdi.
    let (kod, _) = akisla_rapor(&s, cid, psikolog_core::pdf::sifreli_pdf).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(log_satirlari(&s).await.len(), once + 1);
}

/// Ana parola kontrolu YAPILAMAZSA rapor verilmez (fail-closed). Yalnizca
/// `WrongSecret` rapora devam eder; anahtar kaydi okunup yapisal olarak
/// gecerli gorunen ama KDF'i calistirilamayan bir kayit (`t_cost = 0`:
/// `yapisal_gecerli_mi` yalnizca UST sinirlara bakar, Argon2 alt siniri
/// reddeder) `CryptoError::Kdf` dondurur. Oturum acik kalir -- anahtar
/// bellekte -- dolayisiyla kapi ve `keystore_durumu` geciliyor ve olculen
/// dal gercekten `uret`'teki `Err(_)` koludur.
#[tokio::test]
async fn ana_parola_kontrolu_yapilamazsa_500_pdf_verilmez_log_yazilmaz() {
    use psikolog_core::crypto::keyring::CryptoError;
    use psikolog_core::store::keystore::{load, save, unlock_with_password};
    use psikolog_server::state::KeystoreDurumu;

    let (_d, s, cid, _rid) = dolu_state().await;
    // On kosul: ayni durumda rapor GERCEKTEN uretilebiliyor.
    let (kod, _, govde) = rapor_parolayla(&s, cid, RAPOR_PAROLASI).await;
    assert_eq!(kod, StatusCode::OK, "{}", String::from_utf8_lossy(&govde));
    let once = log_satirlari(&s).await.len();

    let mut ks = load(&s.keystore_yolu()).unwrap();
    ks.password.kdf.t_cost = 0;
    save(&ks, &s.keystore_yolu()).unwrap();
    // On kosullar: kayit handler'in `let-else` dalina DUSMUYOR (Var) ve
    // kilit acma denemesi "yanlis parola" DEGIL, baska bir hata.
    let KeystoreDurumu::Var(okunan) = s.keystore_durumu() else {
        panic!("on kosul: bozulan kayit yine `Var` okunmali");
    };
    assert!(
        matches!(unlock_with_password(&okunan, RAPOR_PAROLASI), Err(CryptoError::Kdf(_))),
        "on kosul: ana parola kontrolu Kdf hatasiyla yapilamamali"
    );

    let (kod, basliklar, govde) = rapor_parolayla(&s, cid, RAPOR_PAROLASI).await;
    assert_eq!(kod, StatusCode::INTERNAL_SERVER_ERROR, "{}", String::from_utf8_lossy(&govde));
    assert_eq!(hata_metni(&govde), "Rapor üretilemedi.");
    assert!(!pdf_mi(&govde) && basliklar.get("content-disposition").is_none());
    assert_eq!(log_satirlari(&s).await.len(), once, "kontrol yapilamadiysa log satiri yok");
}

#[tokio::test]
async fn bozuk_govde_turkce_json_hata_doner() {
    let (_d, s, cid, _rid) = dolu_state().await;
    for govde in [
        "{bozuk",
        "{}",
        r#"{"parola": 12345678, "bugun": "2026-09-16"}"#,
        "",
        // Gorev 7: `bugun` zorunlu.
        r#"{"parola": "danisan-parolasi-1"}"#,
    ] {
        let (kod, basliklar, yanit) = rapor_iste(&s, cid, govde).await;
        assert_eq!(kod, StatusCode::BAD_REQUEST, "{govde}");
        assert!(basliklar.get("content-type").unwrap().to_str().unwrap().contains("json"));
        assert_eq!(hata_metni(&yanit), "İstek gövdesi eksik veya geçersiz.", "{govde}");
    }
}

#[tokio::test]
async fn parola_hicbir_log_satirinda_ve_hata_govdesinde_gecmez() {
    let (_d, s, cid, rid) = dolu_state().await;
    cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"x"})),
    )
    .await;
    const GECERLI: &str = "SIZINTI-GECERLI-PAROLA-3K";
    const KISA: &str = "SZN-7kr";
    const BOZUK_GOVDEDE: &str = "SIZINTI-BOZUK-GOVDE-8M";
    let parolalar = [GECERLI, KISA, BOZUK_GOVDEDE, "gizliparola"];

    let mut yanitlar: Vec<(StatusCode, HeaderMap, Vec<u8>)> = vec![
        rapor_parolayla(&s, cid, GECERLI).await,
        rapor_parolayla(&s, 9999, GECERLI).await,
        rapor_parolayla(&s, cid, KISA).await,
        rapor_parolayla(&s, cid, "gizliparola").await,
        rapor_iste(&s, cid, &format!("{{\"parola\": \"{BOZUK_GOVDEDE}\"")).await,
        rapor_iste(&s, cid, &format!("{{\"parola\": [\"{BOZUK_GOVDEDE}\"]}}")).await,
        // Gorev 7: gecersiz gun reddi de parolayi yansitmaz.
        rapor_iste(&s, cid, &json!({ "parola": GECERLI, "bugun": "2026-02-30" }).to_string())
            .await,
    ];
    // On kosul: her yol GERCEKTEN denendi (basari, 404, kisa, ana parola, iki
    // bozuk govde) -- yoksa tarama bos yanitlar uzerinde saglanirdi.
    let kodlar: Vec<u16> = yanitlar.iter().map(|(k, _, _)| k.as_u16()).collect();
    assert_eq!(kodlar, [200, 404, 400, 400, 400, 400, 400]);

    kilitle(&s).await;
    yanitlar.push(rapor_parolayla(&s, cid, GECERLI).await);
    kilit_ac(&s).await;

    let dokum = audit_dokumu(&s).await;
    assert!(dokum.contains("disa_aktarma|client"), "on kosul: dokum gercek satirlar icermeli");
    for p in parolalar {
        assert!(!dokum.contains(p), "parola denetim kaydina dustu: {p}");
        for (kod, basliklar, govde) in &yanitlar {
            assert!(
                !String::from_utf8_lossy(govde).contains(p),
                "{kod}: parola yanit govdesinde: {p}"
            );
            for (ad, deger) in basliklar {
                assert!(
                    !deger.to_str().unwrap_or("").contains(p),
                    "{kod}: parola {ad} basliginda: {p}"
                );
            }
        }
    }

    let istek: psikolog_server::routes::veri_raporu::RaporIstegi =
        serde_json::from_str(&json!({ "parola": GECERLI, "bugun": "2026-09-16" }).to_string())
            .unwrap();
    assert_eq!(istek.parola, GECERLI, "on kosul: parola gercekten tipte");
    assert!(!format!("{istek:?}").contains(GECERLI), "Debug parolayi basmamali");
}

/// Bir `Cargo.toml`'daki TEK `lopdf` bildiriminin surum dizgisi. Yorum
/// satirlari elenir (kuralin kendisi yorumda geciyor); bildirim yoksa ya da
/// birden fazlaysa test bos/yanlis bir esitlikle tatmin olmasin diye panik.
fn lopdf_surumu(toml_yolu: &std::path::Path) -> String {
    let metin = std::fs::read_to_string(toml_yolu)
        .unwrap_or_else(|e| panic!("{} okunamadi: {e}", toml_yolu.display()));
    let satirlar: Vec<&str> = metin
        .lines()
        .map(str::trim)
        .filter(|l| !l.starts_with('#'))
        .filter(|l| l.split('=').next().is_some_and(|ad| ad.trim() == "lopdf"))
        .collect();
    assert_eq!(satirlar.len(), 1, "{}: tam bir `lopdf` bildirimi olmali: {satirlar:?}", toml_yolu.display());
    let deger = satirlar[0].split_once('=').unwrap().1.trim();
    // Iki bicim: `lopdf = "=x"` ve `lopdf = { version = "=x", ... }`.
    let surum_bolumu = match deger.find("version") {
        Some(i) => &deger[i..],
        None => deger,
    };
    let surum = surum_bolumu
        .split('"')
        .nth(1)
        .unwrap_or_else(|| panic!("{}: lopdf surumu okunamadi: {deger}", toml_yolu.display()));
    assert!(!surum.is_empty(), "{}: bos lopdf surumu", toml_yolu.display());
    surum.to_string()
}

/// Bicim 13'un karsi ilaci: "test bagimliligi `lopdf` surumu `core`un
/// sabitledigiyle ayni olmali" kurali eskiden yalnizca `server/Cargo.toml`
/// yorumundaydi. Surumler ayrisirsa Cargo iki ayri `lopdf` derler ve HTTP
/// testleri PDF'i **uretenden farkli** bir kutuphaneyle cozer -- sifreleme
/// bicimi degisse bile testler eski okuyucuyla yesil kalabilirdi. Dizgi
/// esitligi (`=` sabitlemesi dahil) iddia edilir; `"0.45"` gibi uyumlu ama
/// sabitlenmemis bir yazim da kirilir.
#[test]
fn lopdf_test_surumu_core_ile_ayni() {
    let kok = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let sunucu = lopdf_surumu(&kok.join("Cargo.toml"));
    let cekirdek = lopdf_surumu(&kok.join("../core/Cargo.toml"));
    assert!(cekirdek.starts_with('='), "on kosul: core lopdf surumunu sabitliyor: {cekirdek}");
    assert_eq!(sunucu, cekirdek, "server dev-dependency lopdf surumu core ile ayni olmali");
}

#[tokio::test]
async fn eski_rapor_kaydi_ucu_artik_yok() {
    let (_d, s, cid, _rid) = dolu_state().await;
    let once = log_satirlari(&s).await.len();
    let (kod, json) =
        cagir(&s, "POST", &format!("/api/danisanlar/{cid}/rapor-kaydi"), None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    assert_eq!(json["hata"], "Bilinmeyen API yolu.", "rota kalkmis olmali, danisan 404'u degil");
    assert_eq!(log_satirlari(&s).await.len(), once);
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
/// Boş kalması bir hedef değil, bir ölçüm: bir uç nokta buraya yazılacaksa
/// gerekçesi de buraya yazılır ve o gerekçe kod incelemesine düşer.
/// Sessizce bağlanmamış bir uç nokta ile bilinçli olarak bağlanmamış bir uç
/// nokta arasındaki fark tam olarak budur.
///
/// `GET /danisanlar/{id}/seanslar` (Plan 5 Görev 4) burada geçici bir
/// istisnaydı -- Görev 4 yalnızca çekirdek + sunucuyu kapsıyordu, `web/src`a
/// dokunmuyordu. Plan 5 Görev 5 `web/src/api.ts`e (`danisanApi.seanslar`) ve
/// `useDanisanSeanslari`e gerçek çağrı yerini ekledi; istisna KALDIRILDI --
/// aksi hâlde bu test artık gerçek bir bağlantı eksikliğini sessizce
/// gizlerdi.
///
/// `GET /danisanlar/{id}/notlar` (`notes::danisan_listesi`, çekirdekte
/// `store::notes::danisan_notlari`'yı çağırır): Görev 11 istemcideki tek
/// çağıranı (`notApi.danisanNotlari`) kaldırdı -- Görev 8 "önceki seans
/// notları" panelini `danisanApi.seanslar` + `notApi.notGetir`/`notApi.
/// notAra`e taşıdığından beri bu geniş listeyi kullanan yoktu. Uç ve
/// çekirdek fonksiyonu KALDIRILMADI: veri raporu (`store::veri_raporu`) BU
/// HTTP UCUNU DA `danisan_notlari` FONKSİYONUNU DA ÇAĞIRMAZ -- kendi ayrı
/// SQL sorgusuyla `progress_notes.duz_metin`'i doğrudan okur (preflight F24
/// bu yanlış varsayımı işaretlemişti) -- ama e2e `notlar.spec.ts`teki
/// kilitli-uç (`kapaliYollar`) testi hâlâ bu HTTP ucunu doğrudan çağırıyor.
/// `web/src`e geri bağlamak (ya da ucu tamamen kaldırmak) ayrı bir ürün
/// kararı (bkz. görev 11 raporu "sonraki iş").
const ISTEMCISIZ_UCLAR: [(&str, &str); 1] = [("GET", "/api/danisanlar/{}/notlar")];

/// Kilit kapısının **dışında** olması BİLİNÇLİ olan uçlar — adı konmuş
/// istisna (inceleme, ikinci tur).
///
/// Her satırın gerekçesi burada; sessizce kapısız kalan bir uç ile bilinçli
/// olarak kapısız bırakılan bir uç arasındaki fark tam olarak budur
/// (`ISTEMCISIZ_UCLAR` / `VERI_DISI_ROTALAR` ile aynı kalıp).
///
/// - `POST /api/kurulum`, `/api/kilit-ac`, `/api/kilitle`, `GET /api/durum`:
///   oturumun **kendisini** kuran/yöneten uçlar; kilitliyken çalışmazlarsa
///   kilit hiç açılamaz.
/// - `POST /api/yedekler`, `/api/geri-yukleme`: geri yüklemenin var oluş
///   sebebi oturumun **açılamadığı** durumdur (bkz. `routes::restore` modül
///   başlığı). Yetkisiz değil: çağıran yedeğin kendi anahtar dosyasını
///   açabilen parolayı vermek zorunda.
/// - `POST /api/onceki-dosyalari-kaldir`: geri yüklemenin **kendisiyle aynı
///   erişilebilirlikte** olmak zorunda. Kapının içindeyken bir ÇIKMAZ
///   üretiyordu: yarım kalmış bir geri almadan sonra canlı çift eşleşmez,
///   oturum açılamaz, `.onceki` durduğu için geri yükleme de `409` alır ve
///   kullanıcının tek çıkışı Finder'da elle dosya taşımak olurdu -- kapının
///   önlemek istediği şeyin ta kendisi. Uç hiçbir veri OKUMAZ (yanıt
///   yalnızca bir sayı) ve hiçbir şey SİLMEZ.
///
/// Üçüncü alan, kilitliyken **beklenen durum kodudur** (aşağıdaki testteki
/// birleşik geçerli gövdeyle). "`401` değil" demek yetmiyor; bkz. testin
/// içindeki gerekçe (inceleme ÖNEMLİ-1).
const KILITSIZ_UCLAR: [(&str, &str, StatusCode); 7] = [
    ("GET", "/api/durum", StatusCode::OK),
    // Kurulum zaten yapılmış: `409`. Uç çalışıyor ve kendi kararını
    // veriyor -- kapıya takılmıyor.
    ("POST", "/api/kurulum", StatusCode::CONFLICT),
    ("POST", "/api/kilit-ac", StatusCode::OK),
    ("POST", "/api/kilitle", StatusCode::OK),
    // Yedek klasörü ayarı yok: `400` ("klasörün yolunu yazın"). Kapı
    // değil, uç noktanın kendi doğrulaması.
    ("POST", "/api/yedekler", StatusCode::BAD_REQUEST),
    ("POST", "/api/geri-yukleme", StatusCode::BAD_REQUEST),
    // Taşınacak `.onceki` yok: `200 {"tasinan": 0}`.
    ("POST", "/api/onceki-dosyalari-kaldir", StatusCode::OK),
];

/// İstisna listesinin **iki yönlü** kontrolü.
///
/// (1) Listedeki her uç GERÇEKTEN kilitsiz olmalı: biri kapının arkasına
///     alınırsa (`401`) bu test kırılır ve karar yeniden verilmeye zorlanır.
/// (2) Listede OLMAYAN her uç kilitliyken `401` dönmeli: yarın eklenecek
///     kapısız bir uç, listeye yazılmadan sessizce geçemez.
///
/// Tek yönlü bir istisna listesi (yalnızca (2)) bayatlardı: kapıya geri
/// alınan bir uç listede kalır ve kimse fark etmezdi.
#[tokio::test]
async fn kilitsiz_uclar_bilincli_digerlerinin_hepsi_401() {
    let (_d, s, cid, rid) = dolu_state().await;
    kilitle(&s).await;

    // Yol kaliplarindaki `{}` yerine var olan kimlikler konur; `401`
    // kararinin kimlikten BAGIMSIZ oldugunu da gosterir.
    let somutlastir = |yol: &str| -> String {
        let mut cikti = String::new();
        let mut kalan = yol;
        let mut sira = 0;
        while let Some(bas) = kalan.find("{}") {
            cikti.push_str(&kalan[..bas]);
            // Ilk yer tutucu danisan/randevu kimligi, ikincisi etiket.
            cikti.push_str(&if yol.starts_with("/api/danisanlar") && sira == 0 {
                cid.to_string()
            } else if sira == 0 {
                rid.to_string()
            } else {
                "1".to_string()
            });
            kalan = &kalan[bas + 2..];
            sira += 1;
        }
        cikti.push_str(kalan);
        cikti
    };

    let rotalar = sunucu_rotalari();
    // ON KOSUL: istisna listesi bayat olmasin -- adi yazili her uc
    // GERCEKTEN bir rota olmali.
    for (metot, yol, _) in KILITSIZ_UCLAR {
        assert!(
            rotalar.contains(&(metot.to_string(), yol.to_string())),
            "istisna listesi bayat: {metot} {yol} artik bir rota degil"
        );
    }

    for (metot, yol) in &rotalar {
        let somut = somutlastir(yol);
        // Her cagridan ONCE yeniden kilitlenir: listedeki `/api/kilit-ac`
        // basariyla acar ve sonraki uclar artik kilitli bir oturum
        // olcmezdi.
        kilitle(&s).await;
        // GOVDE: istisna listesindeki uclarin extractor'i BASARIYLA
        // cozulmeli. Serde bilinmeyen alanlari yok saydigi icin tek bir
        // birlesik govde hepsine yetiyor.
        let govde = json!({
            "parola": "gizliparola",
            "damga": "20260101-0000",
            "dosya_adi": "yedek-2026-01-01.db",
            "ad_soyad": "X",
        });
        let (kod, _) = cagir(&s, metot, &somut, Some(govde)).await;
        if let Some((_, _, beklenen)) =
            KILITSIZ_UCLAR.iter().find(|(m, y, _)| m == metot && y == yol)
        {
            // (1) Istisna GEREKLI **ve** uc GERCEKTEN CALISIYOR.
            //
            // # Neden `assert_ne!(kod, 401)` YETMIYOR (inceleme ONEMLI-1)
            //
            // O iddia, handler'a hic GIRILMEDEN de saglanabiliyordu: govde
            // sozlesmesi degisip extractor `400/422` dondururse "401 degil"
            // dogru olur ve test yesil kalir (`docs/test-yesil-ama-
            // korumuyor.md` 6. bicim). Inceleme bunu olcerek gosterdi --
            // `OncekiIstegi`'ye zorunlu bir alan eklenip AYNI ANDA uc
            // kapinin arkasina alininca test YESIL kalmisti: kapiya geri
            // alinmis bir KURTARMA ucu sessizce gecti.
            //
            // Cozum: her istisnanin BEKLENEN durum kodu listede yazili ve
            // birebir karsilastiriliyor. Govde sozlesmesi degisirse test,
            // kurtarma yolu kirilmadan ONCE kirilir.
            assert_eq!(
                kod, *beklenen,
                "{metot} {yol} KILITSIZ_UCLAR'da ama kilitliyken {kod} donuyor (beklenen \
                 {beklenen}). Ya kapinin arkasina alindi (kurtarma yolu kirilmis olabilir), \
                 ya govde sozlesmesi degisti ve uc artik CALISMIYOR, ya da istisna gereksiz."
            );
            assert_ne!(
                kod,
                StatusCode::UNAUTHORIZED,
                "{metot} {yol}: bir istisnanin beklenen kodu 401 OLAMAZ -- o zaman istisna \
                 degildir"
            );
        } else {
            // (2) Kapisiz kalan yeni bir uc sessizce gecemez.
            assert_eq!(
                kod,
                StatusCode::UNAUTHORIZED,
                "{metot} {yol} kilitliyken 401 donmeli; bilerek kapisizsa KILITSIZ_UCLAR'a \
                 GEREKCESIYLE yazilmali"
            );
        }
    }
}

#[test]
fn her_http_ucunun_bir_istemci_cagri_yeri_var() {
    let rotalar = sunucu_rotalari();
    let cagrilar = istemci_cagrilari();

    // ON KOSUL, IKI YONLU (VERI_DISI_ROTALAR/istisnalar_gercek_mi ve
    // URETIM_SONRASI_YENIDEN_DOGRULAYANLAR/kullanilan_istisnalar ile ayni
    // kalip): istisna listesi bayat olmasin.
    for (metot, yol) in ISTEMCISIZ_UCLAR {
        // (a) Listedeki her uc GERCEKTEN sunucuda tanimli olmali.
        assert!(
            rotalar.contains(&(metot.to_string(), yol.to_string())),
            "istisna listesi bayat: {metot} {yol} artik bir rota degil"
        );
        // (b) Istisna hala GEREKLI olmali: `api.ts` bu ucu artik
        // cagiriyorsa istisna gereksizdir. Bu kontrol olmadan Gorev 5-6
        // cagriyi eklese de, alti ay sonra biri cagriyi silse de bu test
        // sessizce yesil kalirdi.
        assert!(
            !cagrilar.contains(&(metot.to_string(), yol.to_string())),
            "istisna gereksiz: {metot} {yol} artik api.ts'ten cagriliyor -- \
             ISTEMCISIZ_UCLAR'dan cikarilmali"
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
