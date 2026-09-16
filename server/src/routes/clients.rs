//! Danışan uç noktaları — liste, oluşturma, **danışan dosyası** (tekil
//! okuma/güncelleme), arşivleme ve saklama süresi listesi.
//!
//! # Özel not buraya HİÇ girmez
//!
//! Danışan dosyasının HTTP üzerinden okunabilen tüm parçaları buradan ve
//! `routes::notes` / `routes::attachments`'tan gelir; hiçbiri
//! `store::notes::ozel_*` çağırmaz ve hiçbiri `private_notes` tablosuna elle
//! SQL yazmaz. KVKK md. 11 kapsamındaki bir dışa aktarım eklendiğinde bu
//! kural aynen sürmelidir (bkz. `routes::private_notes` modül başlığı).
//!
//! # Kilit ve denetim kaydı
//!
//! Altı handler'ın da ilk satırı `guard::acik_baglanti`'dir. Rota katmanı
//! ikinci bir log satırı yazmaz: çekirdek her yol için hacim kararını zaten
//! vermiştir (`getir` ve `saklama_suresi_dolanlar` -> `HerCagri`, `listele`
//! -> `OturumBasi`).
//!
//! Veri raporu (KVKK md. 11) buradan değil `routes::veri_raporu`'ndan
//! üretilir; Plan 3'teki ayrı `rapor-kaydi` ucu Plan 4 Görev 6'da kaldırıldı
//! (raporu üreten uç nokta artık kendisi loglar).

use crate::guard::{acik_baglanti, depo_hatasi, govde_coz, ApiHata, Sorgu};
use axum::extract::rejection::JsonRejection;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::clients::{
    arsivle, ekle, getir, guncelle, listele, saklama_suresi_dolanlar, Danisan, DanisanGuncelleme,
    YeniDanisan,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub async fn liste(State(s): State<AppState>) -> Result<Json<Vec<Danisan>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste = listele(&conn, false, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(liste))
}

pub async fn olustur(
    State(s): State<AppState>,
    yeni: Result<Json<YeniDanisan>, JsonRejection>,
) -> Result<(StatusCode, Json<Danisan>), ApiHata> {
    let conn = acik_baglanti(&s)?;
    let yeni = govde_coz(yeni)?;
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

/// Tek bir danışanın dosyası (`GET /api/danisanlar/{id}`).
///
/// `clients::getir` yazılmış ve test edilmişti ama hiçbir çağrı yeri yoktu:
/// arayüz danışanı yalnızca listeden okuyabiliyordu, dolayısıyla rıza,
/// saklama ve risk alanları hiçbir yerden görünmüyordu. Var olmayan kimlik
/// `404` döner (`DepoHatasi::Bulunamadi`) ve **log yazılmaz**.
pub async fn getir_uc(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Danisan>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let danisan = getir(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(danisan))
}

/// Danışan dosyasını kısmi olarak günceller (`PATCH /api/danisanlar/{id}`).
///
/// # Neden PATCH
/// Gövde `DanisanGuncelleme`'dir ve **yalnızca gönderilen alanlar** yazılır;
/// gönderilmeyen alan "dokunma" demektir. Bu tam olarak `PATCH`'in
/// anlamıdır — `PUT` "kaydın tamamını bununla değiştir" derdi ve gönderilmeyen
/// her alanı sessizce `NULL`'a çekmek gerekirdi.
///
/// `riza_dosya_id` için `null` göndermek "bağı kopar" demektir; alanı hiç
/// göndermemek "dokunma" (ayrım `DanisanGuncelleme`'nin kendi
/// `deserialize_with`'i ile korunur).
///
/// `PATCH /api/randevular/{id}` sözleşmesiyle (`{durum}`) karışmaz: farklı
/// yol, farklı gövde şeması.
pub async fn guncelle_uc(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    alan: Result<Json<DanisanGuncelleme>, JsonRejection>,
) -> Result<Json<Danisan>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let alan = govde_coz(alan)?;
    let danisan = guncelle(&conn, id, &alan, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(danisan))
}

#[derive(Deserialize)]
pub struct SaklamaSorgusu {
    /// `YYYY-AA-GG` — istemcinin **yerel** takvim günü.
    pub bugun: String,
}

/// Saklama süresi dolan danışanlar (`GET /api/saklama-suresi-dolanlar?bugun=`).
///
/// **SİLME YOK**: bu uç nokta yalnızca listeler; imha kararı her zaman
/// insanındır (plan global kısıtı).
///
/// # Neden `bugun` istemciden geliyor, sunucudan değil
/// Karşılaştırma SQL'de sözlükseldir ve `saklama_bitis` **yerel duvar
/// saatinden** türetilmiş bir takvim günüdür (`son_temasi_tazele` ->
/// `yil_ekle`, girdisi randevunun `baslangic`'inin ilk 10 karakteri). Sunucu
/// tarafında `OffsetDateTime::now_utc()` kullanmak, kullanıcı UTC+3'te saat
/// 02:00'deyken **bir gün geriden** bir imha listesi üretirdi: sınırdaki bir
/// dosya listede görünmez, KVKK'nın sorduğu sorunun cevabı sessizce yanlış
/// olurdu. Bu kod tabanının duvar saati sözleşmesi (zaman dilimi yok) zaten
/// "takvimi istemci bilir" diyor.
///
/// Biçim `store::clients::saklama_suresi_dolanlar` içinde doğrulanır;
/// geçersiz değer `GecersizVeri` -> `400` olur ve mesaj biçimi söyler.
pub async fn saklama_listesi(
    State(s): State<AppState>,
    q: Result<Sorgu<SaklamaSorgusu>, ApiHata>,
) -> Result<Json<Vec<Danisan>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let Sorgu(q) = q?;
    let liste = saklama_suresi_dolanlar(&conn, &q.bugun, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(liste))
}
