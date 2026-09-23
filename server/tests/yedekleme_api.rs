//! Yedekleme, bütünlük kontrolü ve geri yükleme — HTTP seviyesinde.
//!
//! # Bu dosyanın ölçtüğü şey "yedek alındı" DEĞİL
//!
//! `core::backup` zaten kendi birim testlerine sahipti ve hepsi yeşildi;
//! eksik olan şey testler değil, **çağrı yeriydi**. Dolayısıyla buradaki
//! testlerin görevi dosyanın kopyalandığını doğrulamak değil, **ürünün
//! gerçekten kurtarabildiğini** doğrulamaktır:
//!
//! - `bozuk_veritabani_yedekten_geri_yuklenerek_kurtarilir` felaketin
//!   tamamını koşar: yedek al → veritabanını boz → kilit açılamıyor →
//!   geri yükle → kilit açılıyor → **danışan yerinde**.
//! - `geri_yuklenen_cift_eski_parolayla_calisir` çifti kanıtlar: yedekten
//!   sonra parola değiştirilir, geri yükleme yapılır ve **eski parolanın
//!   yeniden çalıştığı** gösterilir. Yalnızca `.db` kopyalansaydı bu
//!   imkânsız olurdu; dosyanın kopyalandığını kontrol eden bir test bu
//!   görevi doğrulamazdı.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use psikolog_core::crypto::keyring::{DataKey, KdfParams};
use psikolog_core::store::{db::open_encrypted, keystore};
use psikolog_server::{router, AppState};
use std::path::PathBuf;
use tower::ServiceExt;

const PAROLA: &str = "gizli123";
const DAMGA: &str = "2026-09-07";

struct Ortam {
    _veri: tempfile::TempDir,
    _yedek: tempfile::TempDir,
    s: AppState,
    yedek_dizini: String,
}

fn ortam() -> Ortam {
    let veri = tempfile::tempdir().unwrap();
    let yedek = tempfile::tempdir().unwrap();
    let s = AppState::yeni(
        veri.path().to_path_buf(),
        KdfParams { m_cost: 8, t_cost: 1, p_cost: 1 },
    );
    let yedek_dizini = yedek.path().display().to_string();
    Ortam { _veri: veri, _yedek: yedek, s, yedek_dizini }
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
    (kod, serde_json::from_slice(&bytes).unwrap_or(serde_json::json!({})))
}

async fn kur(o: &Ortam) {
    let (kod, _) =
        cagir(&o.s, "POST", "/api/kurulum", Some(serde_json::json!({ "parola": PAROLA }))).await;
    assert_eq!(kod, StatusCode::CREATED, "on kosul: kurulum basarili olmali");
}

async fn danisan_ekle(o: &Ortam, ad: &str) {
    let (kod, _) = cagir(
        &o.s,
        "POST",
        "/api/danisanlar",
        Some(serde_json::json!({ "ad_soyad": ad })),
    )
    .await;
    assert_eq!(kod, StatusCode::CREATED, "on kosul: danisan eklenebilmeli");
}

async fn yedek_al(o: &Ortam, damga: &str) -> (StatusCode, serde_json::Value) {
    cagir(
        &o.s,
        "POST",
        "/api/yedek",
        Some(serde_json::json!({ "damga": damga, "hedef_dizin": o.yedek_dizini })),
    )
    .await
}

async fn kilit_ac(o: &Ortam, parola: &str) -> (StatusCode, serde_json::Value) {
    cagir(&o.s, "POST", "/api/kilit-ac", Some(serde_json::json!({ "parola": parola }))).await
}

fn anahtar(o: &Ortam, parola: &str) -> DataKey {
    let ks = keystore::load(&o.s.keystore_yolu()).unwrap();
    keystore::unlock_with_password(&ks, parola).unwrap()
}

/// `veri.db`'nin **veri sayfalarını** bozar; şema sayfası sağlam kalır.
///
/// Bu kritik: bozulma şema sayfasında olsaydı `open_existing` zaten
/// başarısız olurdu ve test bütünlük kontrolünü değil, anahtar
/// sınıflandırmasını ölçerdi. Burada dosya **açılabilir** kalıyor -- yani
/// bugüne kadar tespit edilmeyen bozulma sınıfı tam olarak bu.
fn veritabanini_boz(o: &Ortam) {
    let key = anahtar(o, PAROLA);
    {
        let c = open_encrypted(&o.s.db_yolu(), &key).unwrap();
        c.execute_batch("CREATE TABLE dolgu(x TEXT);").unwrap();
        let mut stmt = c.prepare("INSERT INTO dolgu VALUES (?1)").unwrap();
        for i in 0..500 {
            stmt.execute([format!("satir-{i}-{}", "x".repeat(50))]).unwrap();
        }
    }
    let yol: PathBuf = o.s.db_yolu();
    let mut bytes = std::fs::read(&yol).unwrap();
    let uzunluk = bytes.len();
    assert!(uzunluk > 8192, "test icin en az iki sayfalik veri gerekiyor: {uzunluk}");
    for b in bytes.iter_mut().skip(uzunluk - 200) {
        *b ^= 0xFF;
    }
    std::fs::write(&yol, &bytes).unwrap();
}

// =====================================================================
// 1. FELAKET TURU: bozuk veritabani yedekten kurtarilir
// =====================================================================

#[tokio::test]
async fn bozuk_veritabani_yedekten_geri_yuklenerek_kurtarilir() {
    let o = ortam();
    kur(&o).await;
    danisan_ekle(&o, "Ayse Yilmaz").await;

    let (kod, _) = yedek_al(&o, DAMGA).await;
    assert_eq!(kod, StatusCode::OK, "yedek alinabilmeli");

    veritabanini_boz(&o);
    cagir(&o.s, "POST", "/api/kilitle", None).await;

    // (a) Kilit acilmiyor VE sebep dogru anlatiliyor.
    let (kod, json) = kilit_ac(&o, PAROLA).await;
    assert_eq!(kod, StatusCode::INTERNAL_SERVER_ERROR, "bozuk veritabaniyla oturum acilmamali");
    assert_eq!(
        json["veritabani_bozuk"], true,
        "arayuz geri yukleme ekranina bu BAYRAKLA duser, metne bakarak degil"
    );
    let mesaj = json["hata"].as_str().unwrap().to_lowercase();
    assert!(
        mesaj.contains("parolanız doğru"),
        "dogru parolali kullaniciya parolasi suclanmamali: {mesaj}"
    );
    let (_, durum) = cagir(&o.s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kilitli"], true, "bozuk veritabaniyla oturum acilmis olmamali");

    // (b) Geri yukleme ekraninin ihtiyaci olan liste KILITLIYKEN geliyor.
    let (kod, liste) = cagir(&o.s, "POST", "/api/yedekler", Some(serde_json::json!({}))).await;
    assert_eq!(kod, StatusCode::OK, "yedek listesi kilitliyken de gelmeli");
    let yedekler = liste["yedekler"].as_array().unwrap();
    assert_eq!(yedekler.len(), 1);
    let dosya_adi = yedekler[0]["dosya_adi"].as_str().unwrap().to_string();
    assert_eq!(dosya_adi, format!("yedek-{DAMGA}.db"));

    // (c) Geri yukleme.
    let (kod, _) = cagir(
        &o.s,
        "POST",
        "/api/geri-yukleme",
        Some(serde_json::json!({ "dosya_adi": dosya_adi, "parola": PAROLA })),
    )
    .await;
    assert_eq!(kod, StatusCode::OK, "geri yukleme basarili olmali");

    // (d) KANIT: kilit yeniden aciliyor ve DANISAN YERINDE.
    let (kod, _) = kilit_ac(&o, PAROLA).await;
    assert_eq!(kod, StatusCode::OK, "geri yuklemeden sonra kilit acilmali");
    let (kod, danisanlar) = cagir(&o.s, "GET", "/api/danisanlar", None).await;
    assert_eq!(kod, StatusCode::OK);
    let adlar: Vec<&str> =
        danisanlar.as_array().unwrap().iter().map(|d| d["ad_soyad"].as_str().unwrap()).collect();
    assert_eq!(adlar, vec!["Ayse Yilmaz"], "yedekteki danisan geri gelmeli");

    // (e) Ve geri yukleme silinemez kayda yazildi.
    let satirlar: Vec<String> = o
        .s
        .audit_dokumu()
        .unwrap()
        .into_iter()
        .map(|k| format!("{}|{}|{}", k.eylem, k.varlik, k.varlik_id))
        .collect();
    assert!(
        satirlar.contains(&format!("geri_yukleme|backup|{DAMGA}")),
        "geri yukleme denetim kaydinda gorunmeli -- {satirlar:?}"
    );
    // Yedek ALMA satiri burada YOK ve bu dogru: `yedek_al_ve_kaydet` once
    // anlik goruntuyu alir, SONRA loglar (`attachments::icerik_getir` ile
    // ayni sira -- basarisiz bir islem log satiri birakmasin diye). Yani bir
    // yedek, kendi alinisinin kaydini hicbir zaman icermez; o satir canli
    // veritabaninda kalir ve geri yuklemeyle birlikte gider.
    assert!(
        !satirlar.contains(&format!("disa_aktarma|backup|{DAMGA}")),
        "yedek, kendi alinisinin kaydini iceremez (once kopya, sonra log) -- {satirlar:?}"
    );
}

// =====================================================================
// 2. GERI YUKLENEN CIFT GERCEKTEN BIRLIKTE CALISIYOR MU
// =====================================================================

#[tokio::test]
async fn geri_yuklenen_cift_eski_parolayla_calisir() {
    // BU TESTIN VARLIK SEBEBI: dosyanin kopyalanmis olmasi degil, geri
    // yuklenen CIFTIN (veritabani + anahtar dosyasi) birlikte calistigi.
    // Yalnizca `.db` kopyalansaydi asagidaki son iddia imkansiz olurdu.
    let o = ortam();
    kur(&o).await;
    danisan_ekle(&o, "Ayse Yilmaz").await;
    let (kod, _) = yedek_al(&o, DAMGA).await;
    assert_eq!(kod, StatusCode::OK);

    // Parolayi degistir: DISKTEKI anahtar dosyasi degisir. Degisiklik artik
    // URUNUN KENDI UC NOKTASINDAN (`POST /api/parola`) yapiliyor -- eskiden
    // burada "parola degistirme ucu bu planda yok" yazip cekirdegi dogrudan
    // cagiriyorduk. Bu, "eski yedekler ESKI parolayla acilir" davranisinin
    // gercek kullanici yolundan da dogru oldugunu gosterir.
    let eski_anahtar = anahtar(&o, PAROLA);
    let (kod, govde) = cagir(
        &o.s,
        "POST",
        "/api/parola",
        Some(serde_json::json!({ "mevcut_parola": PAROLA, "yeni_parola": "yeni-parola-456" })),
    )
    .await;
    assert_eq!(kod, StatusCode::OK, "on kosul: parola degistirme ucu calismali: {govde}");
    cagir(&o.s, "POST", "/api/kilitle", None).await;

    // ON KOSUL: eski parola artik CALISMIYOR.
    let (kod, _) = kilit_ac(&o, PAROLA).await;
    assert_eq!(
        kod,
        StatusCode::UNAUTHORIZED,
        "on kosul: parola degisimi gercekten uygulanmis olmali"
    );
    let (kod, _) = kilit_ac(&o, "yeni-parola-456").await;
    assert_eq!(kod, StatusCode::OK);

    // Veriyi de degistir ki geri yuklemenin veritabanini da tasidigini gorelim.
    danisan_ekle(&o, "Sonradan Eklenen").await;

    // Geri yukleme ESKI parolayla yapiliyor: yedegin KENDI anahtar dosyasi
    // o parolayla acilir. Acik oturumun (yeni parolaya ait) anahtari
    // kullanilmaz -- yeni bir bilgisayarda zaten oyle bir anahtar yok.
    let (kod, _) = cagir(
        &o.s,
        "POST",
        "/api/geri-yukleme",
        Some(serde_json::json!({ "dosya_adi": format!("yedek-{DAMGA}.db"), "parola": PAROLA })),
    )
    .await;
    assert_eq!(kod, StatusCode::OK);

    // KANIT 1: ESKI parola yeniden calisiyor -> keystore da geri yuklendi.
    let (kod, _) = kilit_ac(&o, PAROLA).await;
    assert_eq!(kod, StatusCode::OK, "geri yuklenen anahtar dosyasi ESKI parolayla acilmali");
    // KANIT 2: yeni parola artik calismiyor (cift birlikte geri geldi).
    cagir(&o.s, "POST", "/api/kilitle", None).await;
    let (kod, _) = kilit_ac(&o, "yeni-parola-456").await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED, "parola degisikligi de geri alinmis olmali");

    // KANIT 3: veritabani da yedekteki haline dondu ve AYNI anahtarla aciliyor.
    let (kod, _) = kilit_ac(&o, PAROLA).await;
    assert_eq!(kod, StatusCode::OK);
    let (_, danisanlar) = cagir(&o.s, "GET", "/api/danisanlar", None).await;
    let adlar: Vec<&str> =
        danisanlar.as_array().unwrap().iter().map(|d| d["ad_soyad"].as_str().unwrap()).collect();
    assert_eq!(adlar, vec!["Ayse Yilmaz"], "yedekten sonra eklenen kayit gitmis olmali");
    assert_eq!(
        anahtar(&o, PAROLA).as_ref(),
        eski_anahtar.as_ref(),
        "geri yuklenen anahtar dosyasi ayni veri anahtarini vermeli"
    );
}

#[tokio::test]
async fn kurtarma_koduyla_da_geri_yuklenebilir() {
    // Parolasini unutmus kullanicinin yolu. `change_password` kurtarma
    // sarmalamasini korudugu icin kurtarma kodu eski bir yedegi de acar.
    let o = ortam();
    let (_, kurulum) =
        cagir(&o.s, "POST", "/api/kurulum", Some(serde_json::json!({ "parola": PAROLA }))).await;
    let kod_metni = kurulum["kurtarma_kodu"].as_str().unwrap().to_string();
    danisan_ekle(&o, "Ayse Yilmaz").await;
    yedek_al(&o, DAMGA).await;

    let (kod, _) = cagir(
        &o.s,
        "POST",
        "/api/geri-yukleme",
        Some(serde_json::json!({
            "dosya_adi": format!("yedek-{DAMGA}.db"),
            "kurtarma_kodu": kod_metni,
        })),
    )
    .await;
    assert_eq!(kod, StatusCode::OK, "kurtarma koduyla da geri yuklenebilmeli");
}

// =====================================================================
// 3. SAGLAM VERITABANI ENGELLENMEZ (arti yon)
// =====================================================================

#[tokio::test]
async fn saglam_veritabaninda_kilit_normal_acilir() {
    // "Her zaman bozuk de" mutasyonu burada kirilir: butunluk kontrolu
    // eklendikten sonra normal acilis calismaya devam etmeli.
    let o = ortam();
    kur(&o).await;
    cagir(&o.s, "POST", "/api/kilitle", None).await;

    let (kod, json) = kilit_ac(&o, PAROLA).await;
    assert_eq!(kod, StatusCode::OK, "saglam veritabaninda kilit acilmali");
    assert!(json.get("veritabani_bozuk").is_none(), "basarili yanit bayrak tasimamali");
}

// =====================================================================
// 4. KILIT KAPISI VE DOGRULAMALAR
// =====================================================================

#[tokio::test]
async fn kilitliyken_yedek_alinamaz_ve_dosya_olusmaz() {
    let o = ortam();
    kur(&o).await;
    cagir(&o.s, "POST", "/api/kilitle", None).await;

    let (kod, json) = yedek_al(&o, DAMGA).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED, "yedek alma kilit kapisindan gecmeli");
    assert!(json.get("tarih").is_none());
    assert!(
        !std::path::Path::new(&o.yedek_dizini).join(format!("yedek-{DAMGA}.db")).exists(),
        "kilitliyken atilan istek diske dosya yazmamali"
    );
}

#[tokio::test]
async fn hedef_klasor_secilmeden_yedek_alinamaz() {
    let o = ortam();
    kur(&o).await;
    let (kod, json) =
        cagir(&o.s, "POST", "/api/yedek", Some(serde_json::json!({ "damga": DAMGA }))).await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("klasör"), "{json}");
}

#[tokio::test]
async fn olmayan_klasor_reddedilir_ve_yaratilmaz() {
    // Yazim hatasi sessizce yeni bir klasor yaratmamali: kullanici
    // yedeklerini hic bakmayacagi bir yere yazardi ve "yedegim var"
    // sanirdi. (`yedek_al` icindeki `create_dir_all` bunu yapardi.)
    let o = ortam();
    kur(&o).await;
    let olmayan = std::path::Path::new(&o.yedek_dizini).join("boyle-bir-klasor-yok");
    let (kod, json) = cagir(
        &o.s,
        "POST",
        "/api/yedek",
        Some(serde_json::json!({ "damga": DAMGA, "hedef_dizin": olmayan.display().to_string() })),
    )
    .await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("bulunamadı"), "{json}");
    assert!(!olmayan.exists(), "reddedilen klasor YARATILMAMALI");
}

#[tokio::test]
async fn gecersiz_damga_reddedilir() {
    let o = ortam();
    kur(&o).await;
    let (kod, json) = yedek_al(&o, "eskiyedegim").await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("tarih"), "{json}");
}

// =====================================================================
// 5. GERI YUKLEME REDLERI -- mevcut veriye DOKUNULMAZ
// =====================================================================

#[tokio::test]
async fn yanlis_parolayla_geri_yukleme_reddedilir_ve_mevcut_veri_korunur() {
    let o = ortam();
    kur(&o).await;
    danisan_ekle(&o, "Ayse Yilmaz").await;
    yedek_al(&o, DAMGA).await;

    let db_once = std::fs::read(o.s.db_yolu()).unwrap();
    let ks_once = std::fs::read(o.s.keystore_yolu()).unwrap();

    let (kod, json) = cagir(
        &o.s,
        "POST",
        "/api/geri-yukleme",
        Some(serde_json::json!({ "dosya_adi": format!("yedek-{DAMGA}.db"), "parola": "yanlis" })),
    )
    .await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    let mesaj = json["hata"].as_str().unwrap();
    assert!(mesaj.contains("Hiçbir şey değiştirilmedi"), "{mesaj}");
    assert!(!mesaj.to_lowercase().contains("bozuk"), "yanlis parola 'bozuk' diye anlatilmamali");

    assert_eq!(std::fs::read(o.s.db_yolu()).unwrap(), db_once, "mevcut veritabani degismemeli");
    assert_eq!(
        std::fs::read(o.s.keystore_yolu()).unwrap(),
        ks_once,
        "mevcut anahtar dosyasi degismemeli"
    );
}

/// Bir yedek dosyasinin `schema_version` damgasini degistirir.
///
/// "Daha yeni bir surumle alinmis yedek" durumunu uretmenin tek yolu bu:
/// dosya sapasaglamdir, yalnizca bu kurulum onu okuyamaz.
fn yedek_surumunu_ayarla(o: &Ortam, damga: &str, deger: i64) {
    let key = anahtar(o, PAROLA);
    let yol = std::path::Path::new(&o.yedek_dizini).join(format!("yedek-{damga}.db"));
    {
        let c = open_encrypted(&yol, &key).unwrap();
        c.execute(
            "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version', ?1)
             ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger",
            [deger.to_string()],
        )
        .unwrap();
    }
    for ek in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(yol.with_extension(ek));
    }
}

#[tokio::test]
async fn ileri_surumlu_yedek_reddedilir_ve_o_gunun_kayitlari_durur() {
    // URUNUN EN CIDDI HATASININ HTTP KARSILIGI: veri kaybini onlemek icin
    // var olan ozellik, veri kaybinin sebebi oluyordu. Terapist yeni surumle
    // yedek almis, sonra eski kuruluma donuyor; parola dogru, dosya saglam
    // -- eski davranista mevcut `veri.db` siliniyor, `migrate` patliyor ve o
    // gun girilen, henuz yedeklenmemis kayitlar YOK oluyordu.
    let o = ortam();
    kur(&o).await;
    danisan_ekle(&o, "Ayse Yilmaz").await;
    let (kod, _) = yedek_al(&o, DAMGA).await;
    assert_eq!(kod, StatusCode::OK, "on kosul: yedek alinabilmeli");

    // Yedek, bu kurulumun bildiginden daha yeni bir semayla alinmis.
    yedek_surumunu_ayarla(&o, DAMGA, psikolog_core::store::schema::CURRENT_VERSION + 1);

    // YEDEKTEN SONRA girilen kayit: geri yukleme yapilsaydi KAYBOLURDU.
    // Bu satir olmadan asagidaki "veri duruyor" iddiasi, yedekle canli
    // veritabani ayni oldugu icin hicbir sey olcmezdi
    // (docs/test-yesil-ama-korumuyor.md, 6. bicim).
    danisan_ekle(&o, "Bugun Gelen").await;

    let db_once = std::fs::read(o.s.db_yolu()).unwrap();
    let ks_once = std::fs::read(o.s.keystore_yolu()).unwrap();

    let (kod, json) = cagir(
        &o.s,
        "POST",
        "/api/geri-yukleme",
        Some(serde_json::json!({ "dosya_adi": format!("yedek-{DAMGA}.db"), "parola": PAROLA })),
    )
    .await;

    // 409: sunucu arizasi degil, bu yedekle bu kurulum bagdasmiyor.
    assert_eq!(kod, StatusCode::CONFLICT, "govde: {json}");
    let mesaj = json["hata"].as_str().unwrap();
    assert!(
        !mesaj.to_lowercase().contains("bozuk"),
        "saglam bir yedek 'bozuk' diye anlatilmamali: {mesaj}"
    );
    assert!(mesaj.contains("güncelle"), "mesaj ne yapilacagini soylemeli: {mesaj}");
    // Hassas veri yok: dosya adi, klasor yolu, parola gecmemeli.
    assert!(!mesaj.contains("yedek-"), "dosya adi hata govdesine girmemeli: {mesaj}");
    assert!(!mesaj.contains(&o.yedek_dizini), "klasor yolu hata govdesine girmemeli: {mesaj}");
    assert!(!mesaj.contains(PAROLA), "parola hata govdesine girmemeli: {mesaj}");

    // Mevcut cift ICERIK olarak degismedi.
    assert_eq!(std::fs::read(o.s.db_yolu()).unwrap(), db_once, "mevcut veritabani degismemeli");
    assert_eq!(
        std::fs::read(o.s.keystore_yolu()).unwrap(),
        ks_once,
        "mevcut anahtar dosyasi degismemeli"
    );

    // KANIT: uygulama calismaya devam ediyor ve o gunun kaydi YERINDE.
    let (kod, danisanlar) = cagir(&o.s, "GET", "/api/danisanlar", None).await;
    assert_eq!(kod, StatusCode::OK, "reddedilen geri yukleme oturumu bozmamali");
    let adlar: Vec<&str> =
        danisanlar.as_array().unwrap().iter().map(|d| d["ad_soyad"].as_str().unwrap()).collect();
    assert!(
        adlar.contains(&"Bugun Gelen"),
        "yedeklenmemis kayit yok olmamali -- {adlar:?}"
    );
}

#[tokio::test]
async fn eski_semali_yedek_geri_yuklenince_goc_kosar() {
    // "Geri yukleme gocten gecer" degismezinin HTTP karsiligi: eski semali
    // bir yedek sessizce yerine konsaydi uygulama guncel semanin tablolarini
    // arar ve kullanici bunu kendi hatasi sanardi.
    let o = ortam();
    kur(&o).await;
    danisan_ekle(&o, "Ayse Yilmaz").await;
    yedek_al(&o, DAMGA).await;

    // Yedegi V4 semasina dondur: V5'in urettigi nesneler gider, damga 4 olur.
    let key = anahtar(&o, PAROLA);
    let yedek_yolu = std::path::Path::new(&o.yedek_dizini).join(format!("yedek-{DAMGA}.db"));
    {
        let c = open_encrypted(&yedek_yolu, &key).unwrap();
        c.execute_batch(
            "DROP TRIGGER progress_note_tags_temizle_kullanilmayan;
             DROP TABLE progress_note_tags;
             DROP TABLE tags;
             UPDATE app_meta SET deger='4' WHERE anahtar='schema_version';",
        )
        .unwrap();
    }
    for ek in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(yedek_yolu.with_extension(ek));
    }

    let (kod, json) = cagir(
        &o.s,
        "POST",
        "/api/geri-yukleme",
        Some(serde_json::json!({ "dosya_adi": format!("yedek-{DAMGA}.db"), "parola": PAROLA })),
    )
    .await;
    assert_eq!(kod, StatusCode::OK, "eski semali yedek geri yuklenebilmeli: {json}");

    // KANIT: sema yukseltildi ve veri yerinde.
    let c = open_encrypted(&o.s.db_yolu(), &key).unwrap();
    assert_eq!(
        psikolog_core::store::schema::okunan_surum(&c).unwrap(),
        psikolog_core::store::schema::CURRENT_VERSION,
        "geri yuklenen veritabani guncel semaya yukseltilmis olmali"
    );
    drop(c);

    let (kod, _) = kilit_ac(&o, PAROLA).await;
    assert_eq!(kod, StatusCode::OK, "geri yuklemeden sonra kilit acilmali");
    let (kod, danisanlar) = cagir(&o.s, "GET", "/api/danisanlar", None).await;
    assert_eq!(kod, StatusCode::OK);
    let adlar: Vec<&str> =
        danisanlar.as_array().unwrap().iter().map(|d| d["ad_soyad"].as_str().unwrap()).collect();
    assert_eq!(adlar, vec!["Ayse Yilmaz"], "goc hicbir kaydi degistirmemeli");
}

#[tokio::test]
async fn eksik_ciftli_yedek_ne_listelenir_ne_geri_yuklenir() {
    // "Eksik" ile "bozuk" ayri hatalar: eksik dosya buyuk ihtimalle
    // tasinmistir ve bulunabilir; "yedeginiz bozuk" demek kullaniciyi
    // saglam bir yedegi silmeye itebilir.
    let o = ortam();
    kur(&o).await;
    yedek_al(&o, DAMGA).await;
    std::fs::remove_file(
        std::path::Path::new(&o.yedek_dizini).join(format!("yedek-{DAMGA}.keystore.json")),
    )
    .unwrap();

    let (_, liste) = cagir(&o.s, "POST", "/api/yedekler", Some(serde_json::json!({}))).await;
    assert_eq!(
        liste["yedekler"].as_array().unwrap().len(),
        0,
        "geri yuklenemeyecek yedek listede gosterilmemeli"
    );

    let (kod, json) = cagir(
        &o.s,
        "POST",
        "/api/geri-yukleme",
        Some(serde_json::json!({ "dosya_adi": format!("yedek-{DAMGA}.db"), "parola": PAROLA })),
    )
    .await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    let mesaj = json["hata"].as_str().unwrap();
    assert!(mesaj.contains("eksik"), "eksik parca 'eksik' olarak anlatilmali: {mesaj}");
    assert!(!mesaj.to_lowercase().contains("parola"), "eksik dosya parolayi suclamamali: {mesaj}");
}

#[tokio::test]
async fn yedek_adi_veri_dizininin_disina_cikamaz() {
    // Istemciden gelen ad `..` ya da MUTLAK bir yol icerebilir ve
    // `Path::join` mutlak bir yol verildiginde tabani TUMUYLE atar --
    // yani `{"dosya_adi": "<veri dizini>/veri.db"}` gibi bir istek, geri
    // yukleme KAYNAGI olarak uygulamanin kendi dosyalarini gosterebilirdi.
    //
    // # Bu test bir kez TOTOLOJIYDI (mutasyon M3 hayatta kaldi)
    //
    // Ilk hali yedek klasoru HIC AYARLANMADAN kotu adlar gonderiyordu:
    // istek `dizini_coz`'da "Yedek klasoru belli degil" ile 400 aliyor ve
    // `yedek_yolunu_coz`'a HIC ULASMIYORDU. Ad dogrulamasi tumuyle
    // kaldirildiginda bile test geciyordu -- iddia, kisitladigi kodun
    // disindaki bir davranisla tatmin oluyordu.
    //
    // Iki duzeltme: (1) klasor gercekten ayarlaniyor (on kosul asagida
    // olculuyor), (2) yalnizca durum kodu degil, REDDIN KENDISI (mesaj)
    // iddia ediliyor -- boylece "baska bir sebeple 400/404 dondu" ile
    // "ad reddedildi" ayirt ediliyor.
    let o = ortam();
    kur(&o).await;
    let (kod, _) = yedek_al(&o, DAMGA).await;
    assert_eq!(kod, StatusCode::OK, "on kosul: klasor ayarlanmis ve gercek bir yedek var");

    // ON KOSUL: GECERLI bir ad bu noktada dogrulamayi GECIYOR (yanlis
    // parolayla 401 aliyor, "gecersiz ad" ile 400 degil). Bu olmadan
    // asagidaki redler "her sey reddediliyor" ile de saglanirdi.
    let (kod, json) = cagir(
        &o.s,
        "POST",
        "/api/geri-yukleme",
        Some(serde_json::json!({ "dosya_adi": format!("yedek-{DAMGA}.db"), "parola": "yanlis" })),
    )
    .await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED, "on kosul: gecerli ad dogrulamadan gecmeli");
    assert!(!json["hata"].as_str().unwrap().contains("Geçersiz yedek adı"));

    let db_once = std::fs::read(o.s.db_yolu()).unwrap();
    let ks_once = std::fs::read(o.s.keystore_yolu()).unwrap();
    let veri_dizini = o.s.veri_dizini.display().to_string();

    for kotu in [
        "../keystore.json".to_string(),
        "..\\keystore.json".to_string(),
        "yedek-2026-09-07.db/../../keystore.json".to_string(),
        "keystore.json".to_string(),
        // MUTLAK yol: `join` tabani tumuyle atar -- gercek tehlike bu.
        format!("{veri_dizini}/veri.db"),
        format!("{veri_dizini}/keystore.json"),
        // Uzunlugu DOGRU ama bicimi bozuk (damga cikarma yolunun panik
        // yuzeyi): ad dogrulamasi kaldirilirsa burasi da patlar.
        "yedek-..%2f..%2fa.db".to_string(),
    ] {
        let (kod, json) = cagir(
            &o.s,
            "POST",
            "/api/geri-yukleme",
            Some(serde_json::json!({ "dosya_adi": kotu, "parola": PAROLA })),
        )
        .await;
        assert_eq!(kod, StatusCode::BAD_REQUEST, "reddedilmeli: {kotu}");
        assert_eq!(
            json["hata"].as_str().unwrap(),
            "Geçersiz yedek adı. Listeden bir yedek seçin.",
            "red ADIN KENDISI yuzunden olmali, baska bir sebeple degil: {kotu}"
        );
    }

    assert_eq!(std::fs::read(o.s.db_yolu()).unwrap(), db_once, "veritabani degismemeli");
    assert_eq!(
        std::fs::read(o.s.keystore_yolu()).unwrap(),
        ks_once,
        "hicbir deneme mevcut anahtar dosyasina dokunmamali"
    );
}

// =====================================================================
// 6. YANITLAR MUTLAK YOL SIZDIRMAZ
// =====================================================================

#[tokio::test]
async fn yedek_yanitlari_mutlak_dosya_yolu_tasimaz() {
    // Ertelenmis madde: `YedekBilgisi` mutlak yolu `Serialize` ediyordu.
    // Bir HTTP ucundan donseydi kullanicinin ev dizini -- yani ADI --
    // tarayiciya giderdi. Tip artik `Serialize` turetmiyor; bu test o
    // kararin urundeki karsiligini olcer.
    let o = ortam();
    kur(&o).await;
    let (_, alma) = yedek_al(&o, DAMGA).await;
    let alma_metni = alma.to_string();
    assert!(
        !alma_metni.contains(&o.yedek_dizini.replace('\\', "\\\\")),
        "yedek alma yaniti hedef klasor yolunu tasimamali: {alma_metni}"
    );
    assert!(
        !alma_metni.contains(&o.s.veri_dizini.display().to_string().replace('\\', "\\\\")),
        "yedek alma yaniti veri dizini yolunu tasimamali: {alma_metni}"
    );

    let (_, liste) = cagir(&o.s, "POST", "/api/yedekler", Some(serde_json::json!({}))).await;
    // `hedef_dizin` BILEREK doner (kullaniciya "yedekleriniz su klasorde"
    // diyebilmek icin, `/api/durum`'un `veri_dizini` alaniyla ayni gerekce);
    // olculen sey, TEK TEK YEDEKLERIN mutlak yol tasimamasi.
    for y in liste["yedekler"].as_array().unwrap() {
        let metin = y.to_string();
        assert!(!metin.contains('/') && !metin.contains('\\'), "yedek girdisi yol tasiyor: {metin}");
        assert_eq!(y["dosya_adi"], format!("yedek-{DAMGA}.db"));
    }
}

// =====================================================================
// 7. AYAR KALICI: ikinci yedek klasor yazmadan alinabilir
// =====================================================================

#[tokio::test]
async fn secilen_klasor_kalici_olur_ve_rotasyon_calisir() {
    let o = ortam();
    kur(&o).await;
    // Ilk cagri klasoru de ayarliyor.
    let (kod, _) = yedek_al(&o, "2026-09-01").await;
    assert_eq!(kod, StatusCode::OK);

    // Sonraki cagrilar klasor VERMEDEN calismali (otomatik gunluk yedegin
    // yapacagi tam olarak budur).
    for gun in 2..=10 {
        let (kod, _) = cagir(
            &o.s,
            "POST",
            "/api/yedek",
            Some(serde_json::json!({ "damga": format!("2026-09-{gun:02}") })),
        )
        .await;
        assert_eq!(kod, StatusCode::OK, "kayitli klasorle yedek alinabilmeli");
    }

    let (_, liste) = cagir(&o.s, "POST", "/api/yedekler", Some(serde_json::json!({}))).await;
    let yedekler = liste["yedekler"].as_array().unwrap();
    assert_eq!(yedekler.len(), 7, "7 gunluk donusum korunmali");
    assert_eq!(yedekler[0]["tarih"], "2026-09-10", "en yeni basta olmali");
    assert_eq!(liste["hedef_dizin"].as_str().unwrap(), o.yedek_dizini);
}
