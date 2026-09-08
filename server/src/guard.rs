//! Veri uç noktaları için ortak kilit koruması.
//!
//! `acik_baglanti` her veri uç noktasının (danışan/randevu) ilk satırında
//! çağrılır ve iki şeyi birden yapar:
//!
//! 1. Oturum kilitliyse `401` döner, **gövdede hiçbir veri taşımaz**.
//! 2. Oturum açıksa, veritabanı bağlantısını `open_existing` ile açar --
//!    `open_encrypted` DEĞİL: `open_encrypted` dosya yoksa onu yaratır, bu da
//!    `veri.db` silinmişse (kullanıcı yanlışlıkla sildi, senkronizasyon
//!    klasörü yuttu) isteğin sessizce başarılı olup boş bir veritabanı
//!    yaratmasına yol açardı -- kullanıcı hiçbir uyarı almadan "tüm
//!    danışanlarım silinmiş" izlenimine kapılırdı (bkz. Plan 1'in son
//!    incelemesinden Kural 2).
//!
//! # Oturuma dokunma (Kural 1)
//! Bu fonksiyon aynı zamanda `Oturum::dokun()`'u çağıran TEK yerdir. Bu
//! metot yazılmış ve test edilmişti ama hiçbir yerden çağrılmıyordu; bunun
//! sonucu boşta kalma kilidinin "son etkinlikten 5 dakika sonra" değil,
//! "kilit açıldıktan 5 dakika sonra" çalışmasıydı -- 50 dakikalık bir
//! seansta not yazan bir psikolog 5. dakikada kilitlenirdi. `anahtar()` ile
//! `dokun()` BİRLİKTE, tek bir kilit (`Mutex<Oturum>`) tutulurken çağrılır;
//! aksi halde iki ayrı `.lock()` arasında oturum başka bir istek tarafından
//! kilitlenebilir ve `dokun()` (kendi iç kontrolü sayesinde zaten süresi
//! dolmuş bir oturumu diriltmez, bkz. `Oturum::dokun` dokümantasyonu) yanlış
//! bir öncülle çağrılmış olur.

use crate::state::AppState;
use axum::{http::StatusCode, Json};
use psikolog_core::store::db::{open_existing, DbError};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::time::Instant;

pub type ApiHata = (StatusCode, Json<Value>);

/// Açık oturumun anahtarıyla veritabanı bağlantısı verir; kilitliyse `401`.
/// Başarılı her çağrı `Oturum::dokun()`'u tetikler (bkz. modül dokümantasyonu).
pub fn acik_baglanti(state: &AppState) -> Result<Connection, ApiHata> {
    let now = Instant::now();
    let mut oturum = state.oturum.lock().unwrap_or_else(|e| e.into_inner());

    let anahtar = oturum.anahtar(now).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "hata": "Oturum kilitli. Lütfen parolanızı girin." })),
    ))?;

    // Kural 1: yalnızca burada, tam da erişimin fiilen VERİLDİĞİ an --
    // oturumu bu istek için "canlı" say ve boşta kalma sayacını sıfırla.
    oturum.dokun(now);
    drop(oturum);

    open_existing(&state.db_yolu(), &anahtar).map_err(veritabani_hatasi)
}

/// Tüm `DbError` varyantları -- `DosyaYok` dahil -- şu an aynı durum koduna
/// (`500`) eşleniyor: istemci tarafında bunları ayırt eden bir dal yok,
/// arayüz zaten gövdedeki Türkçe `hata` metnini olduğu gibi gösteriyor.
/// Önemli olan `DbError::DosyaYok`'un kendi `#[error(...)]` metninin
/// kullanıcıyı yedekten geri yüklemeye yönlendirmesi (bkz. `db.rs`) --
/// durum kodu değil, gövdedeki bu metin ayrımı taşıyor.
fn veritabani_hatasi(e: DbError) -> ApiHata {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
}

pub fn depo_hatasi(e: psikolog_core::store::clients::DepoHatasi) -> ApiHata {
    use psikolog_core::store::clients::DepoHatasi as D;
    match e {
        D::Bulunamadi => (StatusCode::NOT_FOUND, Json(json!({ "hata": "Kayıt bulunamadı." }))),
        D::GecersizVeri(m) => (StatusCode::BAD_REQUEST, Json(json!({ "hata": m }))),
        D::Sqlite(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
        }
    }
}
