//! Ay sonu özeti uç noktası (`GET /api/ay-ozeti?ay=YYYY-AA`, Plan 4 Görev 3).
//!
//! Hesaplama, sayım kuralları ve denetim kaydı tamamen çekirdektedir
//! (`store::ozet`); bu handler kapıdan geçer, `ay`'ı çekirdeğe iletir ve
//! sonucu olduğu gibi döndürür. Geçersiz `ay` çekirdekte
//! `DepoHatasi::GecersizVeri` olur ve `400 {"hata"}` döner; eksik `ay`
//! `guard::Sorgu`'nun Türkçe JSON reddine düşer.

use crate::guard::{acik_baglanti, depo_hatasi, ApiHata, Sorgu};
use crate::state::AppState;
use axum::{extract::State, Json};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::ozet::{ay_ozeti, AyOzeti};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct AySorgusu {
    pub ay: String,
}

/// `GET /api/ay-ozeti?ay=YYYY-AA`
pub async fn ay_ozeti_uc(
    State(s): State<AppState>,
    Sorgu(q): Sorgu<AySorgusu>,
) -> Result<Json<AyOzeti>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let ozet = ay_ozeti(&conn, &q.ay, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(ozet))
}
