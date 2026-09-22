//! Etiket uç noktaları (`store::tags`'in HTTP karşılığı, Plan 6 Görev 5).
//!
//! Bütün hacim/normalleşme/denetim kararları çekirdekte zaten verildi (bkz.
//! `store::tags` modül başlığı); burası yalnızca kapıdan geçer, gövdeyi/yol
//! parametrelerini çekirdeğe iletir ve sonucu olduğu gibi döndürür -- desen
//! `routes::danisan_seanslari`/`routes::notes` ile birebir aynı.
//!
//! # Kilit: her handler'ın ilk satırı `acik_baglanti`
//!
//! Beş handler'ın da ilk satırı `guard::acik_baglanti`'dir -- kilitli
//! oturumda `401` döner, gövdede etiket adı da dahil hiçbir veri taşımaz.
//!
//! # Denetim kaydı: rota katmanı ikinci bir satır YAZMAZ
//!
//! `store::tags`'in beş fonksiyonunun (üçü log yazan, `etiketleri_listele`
//! yazmayan) hacim kararını zaten verdi (`LogHacmi::OturumBasi`); burada
//! `audit::kaydet` çağrılmaz (bkz. `routes::notes` modül başlığındaki aynı
//! gerekçe).
//!
//! # Etiket adı URL'ye GİRMEZ
//!
//! Ekleme (`POST`) adı gövdede alır; kaldırma ve arama (`DELETE`, iki
//! `GET`) yalnızca sayısal kimlikle çalışır. Sorgu dizesi/yol parçası
//! sunucu günlüklerine ve tarayıcı geçmişine düşer -- etiket adı da not
//! içeriği kadar hassas bir sınıflandırmadır (bkz. `store::tags` modül
//! başlığı), bu yüzden `/api/ara?q=` ile aynı hatayı burada tekrarlamıyoruz.
//!
//! # 400 gövdesinde etiket adı YANKILANMAZ
//!
//! `store::tags::ad_dogrula`nın hata mesajı yalnızca UZUNLUĞU taşır, adın
//! kendisini değil; `guard::depo_hatasi` bu mesajı olduğu gibi `400`
//! gövdesine koyar, ayrıca bir şey EKLEMEZ. Yani reddedilen adın kendisi
//! hiçbir katmanda -- ne çekirdekte ne rotada -- gövdeye sızmaz.

use crate::guard::{acik_baglanti, depo_hatasi, govde_coz, ApiHata};
use crate::state::AppState;
use axum::extract::rejection::JsonRejection;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::tags::{
    etiket_ekle, etiket_kaldir, etiketleri_listele, etiketli_seanslar, seans_etiketleri, Etiket,
    EtiketliSeans,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct EtiketIstegi {
    pub ad: String,
}

/// `GET /api/etiketler` -- sözlükteki tüm etiketler, en çok kullanılandan
/// aza. Danışana bağlı veri döndürmez, bu yüzden çekirdek hiç loglamaz
/// (bkz. `store::tags::etiketleri_listele`).
pub async fn listele(State(s): State<AppState>) -> Result<Json<Vec<Etiket>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    etiketleri_listele(&conn, Cihaz::Masaustu).map(Json).map_err(depo_hatasi)
}

/// `GET /api/randevular/{id}/etiketler` -- bir seansın etiketleri.
pub async fn seans_listesi(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<Etiket>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    seans_etiketleri(&conn, id, Cihaz::Masaustu).map(Json).map_err(depo_hatasi)
}

/// `POST /api/randevular/{id}/etiketler {ad}` -- seansa etiket koyar; aynı
/// anahtarla etiket varsa onu kullanır (idempotent -- `store::tags::etiket_
/// ekle`nin dönüşü ikisinde de aynı `Etiket`tir, ayrım yapılmaz). Geçersiz
/// ad (boş/40 karakterden uzun) `400` döner -- mesaj yalnızca uzunluğu
/// söyler (bkz. modül başlığı). `201`: diğer kaynak oluşturan `POST`'larla
/// aynı sözleşme (`appointments::olustur`, `clients::olustur`).
pub async fn ekle(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    istek: Result<Json<EtiketIstegi>, JsonRejection>,
) -> Result<(StatusCode, Json<Etiket>), ApiHata> {
    let conn = acik_baglanti(&s)?;
    let istek = govde_coz(istek)?;
    let etiket = etiket_ekle(&conn, id, &istek.ad, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok((StatusCode::CREATED, Json(etiket)))
}

/// `DELETE /api/randevular/{id}/etiketler/{tag_id}` -- seanstan etiketi
/// kaldırır. Bağ yoksa (bilinmeyen `tag_id` ya da bu seansa hiç
/// bağlanmamış bir etiket) çekirdek `Bulunamadi` döner -> `404`.
pub async fn kaldir(
    State(s): State<AppState>,
    Path((id, tag_id)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiHata> {
    let conn = acik_baglanti(&s)?;
    etiket_kaldir(&conn, id, tag_id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/etiketler/{id}/seanslar` -- bir etiketi taşıyan seanslar
/// (etiket dosyası ekranı). Yol parametresi `tag_id`'dir, etiket adı
/// değil.
pub async fn seanslar(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<EtiketliSeans>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    etiketli_seanslar(&conn, id, Cihaz::Masaustu).map(Json).map_err(depo_hatasi)
}
