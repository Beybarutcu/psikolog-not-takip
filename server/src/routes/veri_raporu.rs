//! Danışan veri raporu uç noktası (`POST /api/danisanlar/{id}/veri-raporu`,
//! Plan 4 Görev 6) — KVKK md. 11 raporu sunucuda, AES-256 parola korumalı
//! PDF olarak üretilir.
//!
//! # Sıra bir sözleşmedir
//!
//! 1. Kapı (`acik_baglanti`): kilitliyken `401`, hiçbir şey okunmaz.
//! 2. Gövde `{"parola", "bugun"}`; `bugun` geçerli bir takvim günü değilse
//!    `400` (dosya adına ve `Content-Disposition` başlığına yazılır — bkz.
//!    `store::veri_raporu::rapor_dosya_adi`). Parola `ASGARI_PAROLA`
//!    karakterden kısaysa `400`.
//! 3. Parola **ana parolaysa** `400`: bu parola danışana verilir; ana parola
//!    olsaydı danışan bütün kayıtları açan anahtarın sahibi olurdu. Argon2
//!    maliyeti bilinçli olarak kabul edildi.
//! 4. İçerik (`store::veri_raporu::rapor_icerigi`) — danışan yoksa `404`.
//! 5. Şifreli PDF — hata `500 "Rapor üretilemedi."` (kütüphane metni gövdeye
//!    girmez) ve **denetim satırı yok** (üretilmeyen rapor kayıtta görünmez;
//!    `veri_raporu_uretim_basarisizsa_500_ve_log_yazilmaz`).
//! 6. **Yeniden doğrulama** — taze bir kapı çağrısı. Üretim saniyeler
//!    sürebilir (2000 not ≈ 3 sn release, 26 sn debug); bu arada oturum
//!    kilitlendiyse `401`, baytlar verilmez, satır yazılmaz. 1. adımdaki
//!    kapı yalnızca **başlangıç** anını doğrular
//!    (`uretim_surerken_kilitlenirse_401_pdf_ve_log_yok`).
//! 7. Denetim satırı (`disa_aktarim_kaydi`), 6'nın taze bağlantısıyla —
//!    **yazılamazsa baytlar verilmez**, `500`. Plan 1'in kararı:
//!    kaydedilemeyecek bir erişime izin verilmez.
//! 8. Baytlar.
//!
//! 3–5 CPU yoğun (Argon2 + PDF dizgi + AES) olduğu için
//! `tokio::task::spawn_blocking` içinde çalışır; eşzamanlı çalışan otomatik
//! not kaydı bu sırada async çalışanları beklemez.
//!
//! # Kapı bu handler'da İKİ kez çağrılır — bilinçli istisna
//!
//! Yapısal kural (`notlar_api.rs::her_veri_handleri_acik_baglantidan_gecer`)
//! "ilk satır kapı, kapı tam bir kez" der. "Tam bir kez"in gerekçesi iki
//! karşıt kusurun sayımda birbirini götürmesiydi; ikinci çağrı o kusur değil,
//! uzun süren bir işten **sonra** yetkinin hâlâ geçerli olduğunun
//! doğrulanmasıdır. İstisna testte adıyla yazılıdır ve çalıştırılabilir:
//! ikinci çağrı `spawn_blocking`'den sonra gelmeli, sayı tam iki olmalı;
//! ikinci çağrı kaldırılırsa istisna bayatlar ve test kırılır.
//!
//! # Parola
//!
//! Gövdede gelir (URL'ler geçmişe ve günlüklere düşer). İstek tipinin `Debug`'ı
//! elle yazılmıştır ve parolayı basmaz; bu modülde günlüğe yazan hiçbir satır
//! yoktur; hata gövdeleri sabit metinlerdir. Gövde ayrıştırma hatası axum'un
//! İngilizce metni yerine `400 {"hata"}` döner — o metin hatalı gövdeden
//! parça yansıtabilirdi.
//!
//! # Denetim satırı neden çekirdekte yazılıyor
//!
//! Rota katmanı `audit::kaydet` çağırmaz
//! (`notlar_api.rs::rota_modulleri_audit_kaydet_cagirmaz`); satırı
//! `store::veri_raporu::disa_aktarim_kaydi` yazar, **ne zaman** yazılacağına
//! bu handler karar verir (`backup::yedek_al_ve_kaydet` ile aynı ayrım).

use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::{AppState, KeystoreDurumu};
use axum::{
    body::Body,
    extract::{rejection::JsonRejection, Path, State},
    http::{header, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use psikolog_core::crypto::keyring::CryptoError;
use psikolog_core::pdf::{sifreli_pdf, PdfHatasi, RaporIcerigi, ASGARI_PAROLA};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::keystore::{unlock_with_password, Keystore};
use psikolog_core::store::veri_raporu::{disa_aktarim_kaydi, rapor_dosya_adi, rapor_icerigi};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::json;

/// İstek gövdesi. `Debug` elle yazılmıştır: parola basılmaz.
#[derive(Deserialize)]
pub struct RaporIstegi {
    pub parola: String,
    /// `YYYY-AA-GG` — istemcinin **yerel** takvim günü; yalnızca dosya adına
    /// girer. Sunucunun UTC günü Türkiye'de 00:00–03:00 arasında dünü verirdi.
    pub bugun: String,
}

impl std::fmt::Debug for RaporIstegi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RaporIstegi")
            .field("parola", &"<gizli>")
            .field("bugun", &self.bugun)
            .finish()
    }
}

pub const KISA_PAROLA_MESAJI: &str = "Rapor parolası en az 8 karakter olmalı.";
pub const ANA_PAROLA_MESAJI: &str =
    "Rapor için ana parolanızı kullanmayın; danışana vereceğiniz ayrı bir parola seçin.";
pub const URETILEMEDI_MESAJI: &str = "Rapor üretilemedi.";
pub const KAYIT_YAZILAMADI_MESAJI: &str =
    "Dışa aktarım denetim kaydına yazılamadı; rapor verilmedi.";
pub const GOVDE_GECERSIZ_MESAJI: &str = crate::guard::GOVDE_GECERSIZ_MESAJI;

fn hata(kod: StatusCode, mesaj: &str) -> ApiHata {
    (kod, Json(json!({ "hata": mesaj })))
}

/// `POST /api/danisanlar/{id}/veri-raporu` gövde `{"parola": "...", "bugun": "YYYY-AA-GG"}`.
pub async fn veri_raporu(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    govde: Result<Json<RaporIstegi>, JsonRejection>,
) -> Result<Response, ApiHata> {
    let conn = acik_baglanti(&s)?;
    rapor_akisi(s, conn, id, govde, sifreli_pdf).await
}

/// Sözleşmenin 2–8. adımları; PDF üreticisi parametredir.
///
/// Uç nokta bunu gerçek `sifreli_pdf` ile çağırır. Parametre, **üretim
/// sürerken** olanların (oturumun kilitlenmesi, üretimin başarısız olması)
/// HTTP testlerinde sabit bir bekleme olmadan, deterministik olarak
/// kurulabilmesi içindir (`notlar_api.rs::uretim_surerken_kilitlenirse_...`,
/// `..._uretim_basarisizsa_...`).
///
/// Bir rota handler'ı DEĞİLDİR ve olamaz: açık bir `Connection` ister, yani
/// çağıran kapıdan zaten geçmiştir; bu tip bir extractor değildir.
///
/// `async fn` DEĞİL, bilerek: yapısal kapı testi her `async fn`'i ayrı bir
/// handler adayı sayar ve ilk satırında kapı ister. Düz `fn` olduğu için bu
/// gövde `veri_raporu`'nun parçasında kalır ve oradaki iki kapı çağrısı
/// (ilk satır + üretim sonrası) **birlikte** denetlenir.
#[allow(clippy::manual_async_fn)]
pub fn rapor_akisi<U>(
    s: AppState,
    conn: Connection,
    id: i64,
    govde: Result<Json<RaporIstegi>, JsonRejection>,
    pdf_uret: U,
) -> impl std::future::Future<Output = Result<Response, ApiHata>> + Send
where
    U: FnOnce(&RaporIcerigi, &str) -> Result<Vec<u8>, PdfHatasi> + Send + 'static,
{
    async move {
        // Reddin ic metni BILEREK kullanilmiyor (bkz. modul basligi).
        let Ok(Json(istek)) = govde else {
            return Err(hata(StatusCode::BAD_REQUEST, GOVDE_GECERSIZ_MESAJI));
        };
        // Pahali isten (Argon2, PDF) ve log satirindan ONCE.
        let dosya_adi = rapor_dosya_adi(&istek.bugun).map_err(depo_hatasi)?;
        if istek.parola.chars().count() < ASGARI_PAROLA {
            return Err(hata(StatusCode::BAD_REQUEST, KISA_PAROLA_MESAJI));
        }
        // Kapidan gecmis bir istekte keystore'un olmamasi fiilen imkansiz; yine
        // de ana parola kontrolu yapilamiyorsa rapor VERILMEZ (fail-closed).
        let KeystoreDurumu::Var(ks) = s.keystore_durumu() else {
            return Err(hata(StatusCode::INTERNAL_SERVER_ERROR, URETILEMEDI_MESAJI));
        };

        // 3-5: ana parola reddi, icerik, sifreli PDF. Log YAZMAZ.
        let pdf =
            tokio::task::spawn_blocking(move || uret(&conn, &ks, id, &istek.parola, pdf_uret))
                .await
                .map_err(|_| hata(StatusCode::INTERNAL_SERVER_ERROR, URETILEMEDI_MESAJI))??;

        // 6. Yeniden dogrulama: uretim saniyeler surebilir; bu arada oturum
        //    kilitlendiyse (elle ya da bosta kalma suresi) TAZE kapi 401
        //    doner ve baytlar verilmez. Ilk kapinin baglantisi bilerek
        //    kullanilmiyor -- o baglanti kilitlemeden etkilenmez.
        let conn = acik_baglanti(&s)?;
        // 7. Kayit yazilamazsa baytlar DONMEZ.
        disa_aktarim_kaydi(&conn, id, Cihaz::Masaustu)
            .map_err(|_| hata(StatusCode::INTERNAL_SERVER_ERROR, KAYIT_YAZILAMADI_MESAJI))?;

        // 8.
        pdf_yaniti(pdf, &dosya_adi)
    }
}

fn pdf_yaniti(pdf: Vec<u8>, dosya_adi: &str) -> Result<Response, ApiHata> {
    let mut yanit = Response::new(Body::from(pdf));
    let b = yanit.headers_mut();
    b.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/pdf"));
    let ek = HeaderValue::from_str(&format!("attachment; filename=\"{dosya_adi}\""))
        .map_err(|_| hata(StatusCode::INTERNAL_SERVER_ERROR, URETILEMEDI_MESAJI))?;
    b.insert(header::CONTENT_DISPOSITION, ek);
    b.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    b.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(yanit)
}

/// Sözleşmenin 3–5. adımları (bkz. modül başlığı). Engelleyici iş parçacığında.
/// Denetim satırı burada YAZILMAZ: kilit yeniden doğrulanmadan yazılsaydı
/// verilmeyen bir rapor kayıtta görünürdü.
fn uret<U>(
    conn: &Connection,
    ks: &Keystore,
    id: i64,
    parola: &str,
    pdf_uret: U,
) -> Result<Vec<u8>, ApiHata>
where
    U: FnOnce(&RaporIcerigi, &str) -> Result<Vec<u8>, PdfHatasi>,
{
    // 3. Ana parola reddi. YALNIZCA "yanlis sir" rapora devam eder; anahtar
    //    kaydi okunamiyorsa kontrol yapilamamistir ve rapor verilmez.
    match unlock_with_password(ks, parola) {
        Ok(_) => return Err(hata(StatusCode::BAD_REQUEST, ANA_PAROLA_MESAJI)),
        Err(CryptoError::WrongSecret) => {}
        Err(_) => return Err(hata(StatusCode::INTERNAL_SERVER_ERROR, URETILEMEDI_MESAJI)),
    }
    // 4.
    let icerik = rapor_icerigi(conn, id).map_err(depo_hatasi)?;
    // 5.
    pdf_uret(&icerik, parola)
        .map_err(|_| hata(StatusCode::INTERNAL_SERVER_ERROR, URETILEMEDI_MESAJI))
}
