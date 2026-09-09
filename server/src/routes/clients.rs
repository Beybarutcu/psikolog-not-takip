use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::clients::{arsivle, ekle, listele, Danisan, YeniDanisan};
use serde_json::{json, Value};

pub async fn liste(State(s): State<AppState>) -> Result<Json<Vec<Danisan>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste = listele(&conn, false, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(liste))
}

pub async fn olustur(
    State(s): State<AppState>,
    Json(yeni): Json<YeniDanisan>,
) -> Result<(StatusCode, Json<Danisan>), ApiHata> {
    let conn = acik_baglanti(&s)?;
    let danisan = ekle(&conn, &yeni, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok((StatusCode::CREATED, Json(danisan)))
}

/// Danışanı arşivler (yumuşak silme).
///
/// # Neden `DELETE` değil, ayrı bir `POST .../arsivle`
/// Arşivleme **fiziksel silme değildir**: kayıtlar, randevular ve notlar
/// yerinde durur, danışan yalnızca aktif listeden ve randevu açılır
/// menüsünden çıkar. `DELETE /api/danisanlar/{id}` bu sözü baştan yanlış
/// kurardı -- hem HTTP anlamı hem de ileride bu API'yi okuyan biri için.
/// Yol adı ne yaptığını söylüyor.
///
/// `clients::arsivle` Plan 2 Görev 3'te yazılmış ve test edilmişti ama
/// hiçbir çağrı yeri yoktu: bir danışan eklenebiliyor, arşivlenemiyordu --
/// `listele(conn, false, ...)` süzgeci doğru çalışıyor ama hiçbir şey
/// `'arsiv'` yazamıyordu, dolayısıyla danışan listesi ve randevu açılır
/// menüsü sınırsız büyüyordu (`appointments::seriyi_sil` ile aynı bulgu
/// sınıfı, bkz. Plan 2 dal incelemesi I4a).
pub async fn arsivle_uc(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiHata> {
    // Diğer on veri handler'ıyla AYNI ilk satır: kilitli oturumda 401 döner
    // ve işlem uygulanmaz (tasarımın en sert gizlilik vaadi).
    let conn = acik_baglanti(&s)?;
    arsivle(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
}
