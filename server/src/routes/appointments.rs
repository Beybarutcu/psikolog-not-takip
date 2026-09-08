use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use psikolog_core::store::appointments::{
    aralik_getir, cakisanlari_bul, durum_guncelle, guncelle as depo_guncelle,
    olustur as tekil_olustur, seri_cakisanlari_bul, seri_olustur, sil, Randevu,
    RandevuGuncelleme, SeriCakismasi, YeniRandevu,
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
    /// Verilirse çakışma TÜM haftalar için aranır (bkz. `cakisma`
    /// handler'ındaki gerekçe). Yoksa tek aralık kontrol edilir.
    pub tekrar_sayisi: Option<u32>,
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

/// Mevcut bir randevunun alanlarını değiştiren istek gövdesi (bkz.
/// `guncelle` handler'ı).
#[derive(Deserialize)]
pub struct GuncellemeIstegi {
    pub client_id: i64,
    pub baslangic: String,
    pub bitis: String,
    pub ucret: Option<i64>,
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

/// Mevcut bir randevunun alanlarını günceller (`PUT /randevular/{id}`).
///
/// # Neden PATCH'e dallanmak yerine PUT
/// `/randevular/{id}` üzerinde zaten bir `PATCH` var ve gövdesi kesin olarak
/// `{durum}`. İki seçenek vardı: (a) aynı PATCH handler'ında gövdeye göre
/// dallanmak, (b) ayrı bir metot eklemek. (a) reddedildi çünkü ayrım
/// gövdenin ŞEKLİNE dayanırdı: istemcideki bir yazım hatası (`durm`,
/// `client_ıd`) isteği sessizce YANLIŞ dala düşürür ya da 400 yerine
/// anlamsız bir hata üretir -- randevu verisi için kabul edilemeyecek kadar
/// sessiz bir hata sınıfı. (b) ile iki sözleşme metot düzeyinde ayrışır:
/// mevcut `PATCH {durum}` sözleşmesi ve onun testleri bit düzeyinde
/// dokunulmadan kalır, yeni yol ayrı ve açıkça doğrulanır.
///
/// İlk satırda `acik_baglanti` -- diğer dokuz rotayla aynı kapı: kilitli
/// oturumda 401 döner ve gövdede hiçbir veri taşımaz.
pub async fn guncelle(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    Json(istek): Json<GuncellemeIstegi>,
) -> Result<Json<Randevu>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let yeni = RandevuGuncelleme {
        client_id: istek.client_id,
        baslangic: istek.baslangic,
        bitis: istek.bitis,
        ucret: istek.ucret,
    };
    let randevu = depo_guncelle(&conn, id, &yeni, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(randevu))
}

pub async fn kaldir(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    sil(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
}

/// Çakışma kontrolü. `tekrar_sayisi` verilirse serinin TÜM haftaları tek
/// istekte kontrol edilir.
///
/// # Neden `/cakisma` genişletildi, istemcide haftalara bölünmedi
/// Panel yalnızca ilk haftayı soruyordu; seri kurarken sessizce çifte
/// randevu oluşabiliyordu (bkz. dal incelemesi I2). İki seçenekten
/// "istemcide 52 ayrı istek" reddedildi (yük) ve "istemcide haftalara
/// bölüp tek aralık sormak" da reddedildi: haftayı ilerletmek duvar saati
/// aritmetiği gerektirir ve bunu JavaScript `Date` ile yapmak yaz saati
/// kayması riskini geri getirirdi. Sunucu bunu zaten kaymaya karşı yapısal
/// olarak bağışık `bir_hafta_sonra` ile yapıyor.
///
/// # Yanıt biçimi
/// Yanıt artık çıplak dizi değil, bir nesne: uyarı metninin "kaç haftada
/// çakışma var" diyebilmesi için hafta sayısı gerekiyor ve bu bilgi
/// düzleştirilmiş bir diziden güvenilir şekilde türetilemez (bir randevu
/// birden çok haftayla çakışabilir, bir haftada birden çok çakışma
/// olabilir).
///
/// `cakisanlari_bul`/`seri_cakisanlari_bul` bilinçli olarak LOG YAZMAZ
/// (Görev 5 kararı) -- bu uç nokta form doğrulaması sırasında sık çağrılır.
pub async fn cakisma(
    State(s): State<AppState>,
    Query(q): Query<CakismaSorgusu>,
) -> Result<Json<SeriCakismasi>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let sonuc = match q.tekrar_sayisi {
        Some(n) if n > 1 => {
            seri_cakisanlari_bul(&conn, &q.baslangic, &q.bitis, n, q.haric_id)
                .map_err(depo_hatasi)?
        }
        _ => {
            let liste =
                cakisanlari_bul(&conn, &q.baslangic, &q.bitis, q.haric_id).map_err(depo_hatasi)?;
            SeriCakismasi {
                cakisan_hafta_sayisi: usize::from(!liste.is_empty()),
                cakisanlar: liste,
                kontrol_edilen_hafta: 1,
            }
        }
    };
    Ok(Json(sonuc))
}
