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
//!    girmez).
//! 6. Denetim satırı (`disa_aktarim_kaydi`) — **yazılamazsa baytlar
//!    verilmez**, `500`. Plan 1'in kararı: kaydedilemeyecek bir erişime izin
//!    verilmez.
//! 7. Baytlar.
//!
//! 3–6 CPU yoğun (Argon2 + PDF dizgi + AES) olduğu için
//! `tokio::task::spawn_blocking` içinde çalışır; eşzamanlı çalışan otomatik
//! not kaydı bu sırada async çalışanları beklemez.
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
use psikolog_core::pdf::{sifreli_pdf, ASGARI_PAROLA};
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
pub const GOVDE_GECERSIZ_MESAJI: &str = "İstek gövdesi eksik veya geçersiz.";

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

    let pdf = tokio::task::spawn_blocking(move || uret(&conn, &ks, id, &istek.parola))
        .await
        .map_err(|_| hata(StatusCode::INTERNAL_SERVER_ERROR, URETILEMEDI_MESAJI))??;

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

/// Sözleşmenin 3–6. adımları (bkz. modül başlığı). Engelleyici iş parçacığında.
fn uret(conn: &Connection, ks: &Keystore, id: i64, parola: &str) -> Result<Vec<u8>, ApiHata> {
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
    let pdf = sifreli_pdf(&icerik, parola)
        .map_err(|_| hata(StatusCode::INTERNAL_SERVER_ERROR, URETILEMEDI_MESAJI))?;
    // 6. Kayit yazilamazsa baytlar DONMEZ.
    disa_aktarim_kaydi(conn, id, Cihaz::Masaustu)
        .map_err(|_| hata(StatusCode::INTERNAL_SERVER_ERROR, KAYIT_YAZILAMADI_MESAJI))?;
    // 7.
    Ok(pdf)
}
