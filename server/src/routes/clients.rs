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
//! Yedi handler'ın da ilk satırı `guard::acik_baglanti`'dir. Rota katmanı
//! ikinci bir log satırı yazmaz: çekirdek her yol için hacim kararını zaten
//! vermiştir (`getir`, `saklama_suresi_dolanlar` ve `veri_raporu_kaydi` ->
//! `HerCagri`, `listele` -> `OturumBasi`).

use crate::guard::{acik_baglanti, depo_hatasi, ApiHata, Sorgu};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::clients::{
    arsivle, ekle, getir, guncelle, listele, saklama_suresi_dolanlar, veri_raporu_kaydi, Danisan,
    DanisanGuncelleme, YeniDanisan,
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
    Json(alan): Json<DanisanGuncelleme>,
) -> Result<Json<Danisan>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let danisan = guncelle(&conn, id, &alan, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(danisan))
}

/// Danışan veri raporunun dışa aktarıldığını denetim kaydına yazar
/// (`POST /api/danisanlar/{id}/rapor-kaydi`).
///
/// # Neden ayrı bir uç nokta var
///
/// Veri raporu (KVKK md. 11) bugün **istemcide** birleştiriliyor: arayüz
/// `GET /api/danisanlar/{id}/notlar` ile notları çekiyor, danışan kartındaki
/// kimlik ve ek listesiyle bir `.txt` üretip diske yazıyor. Sunucuya giden
/// tek istek olan not listesi ise `goruntuleme` yazıyor ve **5 dakikalık
/// pencerede birleşiyor** — seans paneli aynı danışan için açıldıysa dışa
/// aktarım denetim kaydında **hiçbir iz bırakmıyordu**. Tasarım §4 "her
/// görüntüleme, düzenleme, **dışa aktarma** ve silme loglanır" diyor;
/// emsali `attachments::icerik_getir` (tek bir ek indirmesi bile
/// `DisaAktarma` + `HerCagri`).
///
/// # Neden `POST` ve neden gövdesi boş
///
/// Yan etkisi olan (silinemez bir satır yazan) bir işlem `GET` olamaz:
/// tarayıcılar, ön yükleyiciler ve link denetleyicileri `GET`'i güvenli
/// sayar. Gövde boştur çünkü sunucunun istemciden alacağı hiçbir bilgi
/// yok — rapor içeriği (ad, not metni, dosya adları) loga **asla** girmez,
/// yalnızca "hangi danışanın dosyası, ne zaman, hangi cihazdan".
///
/// # PLAN 4 NOTU
///
/// Plan 4 dışa aktarımı sunucu tarafına taşıyacak ve parola korumalı
/// üretecek (tasarım §10). O zaman raporu üreten uç noktanın kendisi
/// loglayacak ve bu uç nokta kaldırılacak. Bugün güvence **sıradadır**:
/// arayüz burayı önce çağırır, başarısız olursa dışa aktarımı hiç yapmaz
/// (fail-closed; bkz. `DanisanKarti::raporHazirla` ve Plan 1'in
/// kurulum/kilit-açma kararı: "kaydedilemeyecek bir erişime izin verilmez").
///
/// Var olmayan kimlik `404` döner ve **log yazılmaz**.
pub async fn rapor_kaydi_uc(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    veri_raporu_kaydi(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
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
    Sorgu(q): Sorgu<SaklamaSorgusu>,
) -> Result<Json<Vec<Danisan>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste = saklama_suresi_dolanlar(&conn, &q.bugun, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(liste))
}
