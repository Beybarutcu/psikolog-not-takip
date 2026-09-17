//! Danışanın seans listesi ucu (Plan 5 Görev 4).
//!
//! Hesaplama, sıralama ve denetim kaydı tamamen çekirdektedir
//! (`store::danisan_seanslari`); bu handler yalnızca kapıdan geçer,
//! `id`'yi çekirdeğe iletir ve sonucu olduğu gibi döndürür -- desen
//! `routes::ozet::ay_ozeti_uc` ile birebir aynı.
//!
//! # Kilit: ilk satır her zaman `acik_baglanti`
//!
//! Tek handler burada da kilitli oturumda `401` döner, gövdede veri
//! taşımaz (bkz. `guard` modül başlığı).
//!
//! # Denetim kaydı: rota katmanı ikinci bir satır YAZMAZ
//!
//! `store::danisan_seanslari`'nın tek log çağrısı hacim kararını
//! (`LogHacmi::OturumBasi`) zaten vermiştir; burada `audit::kaydet`
//! çağrılmaz (bkz. `routes::notes` modül başlığındaki aynı gerekçe).

use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::danisan_seanslari::{danisan_seanslari, DanisanSeansi};

/// `GET /api/danisanlar/{id}/seanslar` -- danışanın notu olsun olmasın TÜM
/// seansları, en yeniden eskiye.
pub async fn liste(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<DanisanSeansi>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    danisan_seanslari(&conn, id, Cihaz::Masaustu)
        .map(Json)
        .map_err(depo_hatasi)
}
