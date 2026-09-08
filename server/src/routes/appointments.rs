use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use psikolog_core::store::appointments::{
    aralik_getir, cakisanlari_bul, durum_guncelle, olustur as tekil_olustur, seri_olustur, sil,
    Randevu, YeniRandevu,
};
use psikolog_core::store::audit::Cihaz;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct AralikSorgusu {
    pub baslangic: String,
    pub bitis: String,
}

#[derive(Deserialize)]
pub struct CakismaSorgusu {
    pub baslangic: String,
    pub bitis: String,
    pub haric_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct YeniRandevuIstegi {
    pub client_id: i64,
    pub baslangic: String,
    pub bitis: String,
    pub ucret: Option<i64>,
    pub tekrar_sayisi: Option<u32>,
}

#[derive(Deserialize)]
pub struct DurumIstegi {
    pub durum: String,
}

pub async fn liste(
    State(s): State<AppState>,
    Query(q): Query<AralikSorgusu>,
) -> Result<Json<Vec<Randevu>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste =
        aralik_getir(&conn, &q.baslangic, &q.bitis, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(liste))
}

pub async fn olustur(
    State(s): State<AppState>,
    Json(istek): Json<YeniRandevuIstegi>,
) -> Result<(StatusCode, Json<Vec<Randevu>>), ApiHata> {
    let conn = acik_baglanti(&s)?;
    let yeni = YeniRandevu {
        client_id: istek.client_id,
        baslangic: istek.baslangic,
        bitis: istek.bitis,
        ucret: istek.ucret,
    };

    // Tek randevu da dizi doner: istemci tarafinda tek kod yolu kalir.
    let sonuc = match istek.tekrar_sayisi {
        Some(n) if n > 1 => seri_olustur(&conn, &yeni, n, Cihaz::Masaustu),
        _ => tekil_olustur(&conn, &yeni, Cihaz::Masaustu).map(|r| vec![r]),
    }
    .map_err(depo_hatasi)?;

    Ok((StatusCode::CREATED, Json(sonuc)))
}

pub async fn durum(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    Json(istek): Json<DurumIstegi>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    durum_guncelle(&conn, id, &istek.durum, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
}

pub async fn kaldir(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    sil(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
}

pub async fn cakisma(
    State(s): State<AppState>,
    Query(q): Query<CakismaSorgusu>,
) -> Result<Json<Vec<Randevu>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste = cakisanlari_bul(&conn, &q.baslangic, &q.bitis, q.haric_id).map_err(depo_hatasi)?;
    Ok(Json(liste))
}
