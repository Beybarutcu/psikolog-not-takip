//! Arama uç noktası (`GET /api/ara?q=`).
//!
//! # KRİTİK: özel notlar aramaya girmez
//!
//! `store::search::ara` yalnızca `clients` ve `progress_notes` tablolarını
//! okur; `private_notes` sorgularının hiçbirinde geçmez (bkz. o modülün
//! başlığı). Bu handler başka hiçbir kaynağa bakmaz ve sonucu olduğu gibi
//! döndürür — özel notun arama sonucunda görünmesi yapısal olarak imkânsızdır
//! ve `tests/notlar_api.rs::arama_ozel_not_dondurmez` bunu HTTP seviyesinde
//! sabitler.
//!
//! # Arama terimi loga girmez
//!
//! `ara` yalnızca "bu cihazdan arama yapıldı" bilgisini yazar; sorgu metni,
//! sonuç sayısı ve danışan kimliği `audit_log`'a **yazılmaz**
//! (`audit::Ayrinti` kapalı bir enum'dur ve doğrulanmamış serbest metin
//! taşıyan bir varyantı yoktur). Bu handler da ne ikinci bir log satırı yazar
//! ne de sorguyu sunucu günlüğüne düşürür.
//!
//! # `limit` doğrulaması nerede
//!
//! `ara` limiti kendi içinde `clamp(1, AZAMI_SONUC)` ile kırpar — bu, `-1`in
//! SQLite'ta "sınırsız" anlamına gelmesine karşı korumadır ve depo
//! katmanındadır. `store::notes::danisan_notlari` bunu **bilerek** yapmaz,
//! o yüzden oradaki kırpma rota katmanında (`routes::notes::limiti_kirp`)
//! durur. İki farklı yer, iki farklı bilinçli karar.

use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::AppState;
use axum::{
    extract::{Query, State},
    Json,
};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::search::{ara, AramaSonucu, AZAMI_SONUC};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct AramaSorgusu {
    pub q: String,
    pub limit: Option<i64>,
}

/// `GET /api/ara?q=...&limit=...`
///
/// İki karakterden kısa bir sorgu hiçbir tabloyu okumaz, hiçbir log satırı
/// bırakmaz ve **boş liste** döner (400 değil): arayüz kullanıcı yazarken her
/// tuşta çağırır, "sorgu çok kısa" hatası göstermek doğru davranış değildir.
pub async fn ara_uc(
    State(s): State<AppState>,
    Query(q): Query<AramaSorgusu>,
) -> Result<Json<Vec<AramaSonucu>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let sonuclar =
        ara(&conn, &q.q, q.limit.unwrap_or(AZAMI_SONUC), Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(sonuclar))
}
