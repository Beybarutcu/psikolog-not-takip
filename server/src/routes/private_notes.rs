//! Terapistin **özel** notunun uç noktaları (`private_notes`) — ve kod
//! tabanında bu tabloya HTTP üzerinden erişen tek yer.
//!
//! # Neden ayrı bir modül
//!
//! `store::notes` modül başlığı özel notun korunmasının tek mekanizmasının
//! **ayrı tablo** olduğunu söyler; ama bu garanti bugüne kadar yalnızca depo
//! katmanındaydı. Rotalar onu delebilirdi: ileride eklenecek bir dışa
//! aktarım, rapor veya yazdırma uç noktası "danışanın notlarını veren
//! handler"ı arar, bulur ve yeniden kullanır. O handler'ın (`routes::notes`)
//! özel nota erişimi olsaydı, tek bir yeniden kullanım özel notu bir PDF
//! raporunun içine koyardı.
//!
//! Bu yüzden ayrım rota katmanında da **yapısaldır**:
//!
//! - `store::notes::ozel_not_getir` / `ozel_not_kaydet` yalnızca bu dosyada
//!   `use` edilir. `routes::notes`, `routes::attachments`, `routes::search`
//!   ve `routes::clients` bu adları hiç geçirmez.
//! - Yol öneki de ayrıdır: `/api/randevular/{id}/ozel-not`. Bir liste veya
//!   dışa aktarım yolu bu handler'ı yanlışlıkla çağıramaz.
//! - Hiçbir rota `private_notes` tablosuna **elle SQL** yazmaz; tek erişim
//!   kapısı yukarıdaki iki depo fonksiyonudur.
//!
//! Bu üç değişmez `tests/notlar_api.rs` içinde kaynak metin üzerinden
//! (yapısal olarak) ve yanıt gövdeleri üzerinden (davranışsal olarak)
//! ayrı ayrı test edilir.
//!
//! # Özel not hiçbir liste, arama veya dışa aktarım yanıtında görünmez
//!
//! Bu modülün iki handler'ı da **tek bir randevunun** özel notunu döndürür;
//! liste döndüren bir handler burada bilerek YOKTUR. Böyle bir uç nokta
//! gerekirse, gerekçesi bu başlıkta yeniden tartışılmalıdır.
//!
//! # Kilit ve denetim kaydı
//!
//! İki handler'ın da ilk satırı `guard::acik_baglanti`'dir (kilitliyken
//! `401`, gövdede veri yok, işlem uygulanmaz). Rota katmanı **ikinci bir log
//! satırı yazmaz**: `store::notes` özel not erişimini zaten `private_note`
//! adlı **ayrı** bir `audit_log.varlik` değeriyle kaydeder — resmî nota
//! erişimin arkasına saklanmaz.

use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::notes::{ozel_not_getir, ozel_not_kaydet, OzelNot};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct OzelNotIstegi {
    pub icerik: String,
}

/// `GET /api/randevular/{id}/ozel-not`.
///
/// Not yoksa boş bir not döner (404 değil); var olmayan RANDEVU `404`.
pub async fn getir(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<OzelNot>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let not = ozel_not_getir(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(not))
}

/// `PUT /api/randevular/{id}/ozel-not`.
///
/// Özel notun şablonu yoktur (`store::notes::OzelNot` alanlarına bakınız):
/// gövde yalnızca `icerik` taşır. Resmî not isteğiyle (`{sablon, icerik}`)
/// aynı şekle sahip olmaması kasıtlıdır — iki sözleşme birbirine
/// karışamasın.
pub async fn kaydet(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    Json(istek): Json<OzelNotIstegi>,
) -> Result<Json<OzelNot>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let not = ozel_not_kaydet(&conn, id, &istek.icerik, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(not))
}
