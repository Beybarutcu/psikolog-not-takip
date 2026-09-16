use crate::guard::{acik_baglanti, depo_hatasi, govde_coz, ApiHata, Sorgu};
use axum::extract::rejection::JsonRejection;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use psikolog_core::store::appointments::{
    aralik_getir, cakisanlari_bul, durum_guncelle, guncelle as depo_guncelle,
    odeme_guncelle, olustur as tekil_olustur, seri_cakisanlari_bul, seri_olustur, seri_sayisi,
    seri_silinecek_not_sayisi, seriyi_sil, sil, silinecek_not_sayisi, Randevu, RandevuGuncelleme,
    SeriCakismasi, YeniRandevu,
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

/// `PATCH /randevular/{id}/odeme` gövdesi. Yalnızca işaret taşır; tutar
/// randevunun kendi `ucret` alanındadır ve buradan değiştirilemez.
#[derive(Deserialize)]
pub struct OdemeIstegi {
    pub odendi: bool,
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
    q: Result<Sorgu<AralikSorgusu>, ApiHata>,
) -> Result<Json<Vec<Randevu>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let Sorgu(q) = q?;
    let liste =
        aralik_getir(&conn, &q.baslangic, &q.bitis, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(liste))
}

pub async fn olustur(
    State(s): State<AppState>,
    istek: Result<Json<YeniRandevuIstegi>, JsonRejection>,
) -> Result<(StatusCode, Json<Vec<Randevu>>), ApiHata> {
    let conn = acik_baglanti(&s)?;
    let istek = govde_coz(istek)?;
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
    istek: Result<Json<DurumIstegi>, JsonRejection>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let istek = govde_coz(istek)?;
    durum_guncelle(&conn, id, &istek.durum, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
}

/// Randevunun "ödendi" işaretini koyar/geri alır
/// (`PATCH /randevular/{id}/odeme {odendi}`) → `204`.
///
/// # Neden ayrı yol
/// `PATCH /randevular/{id}` gövdesi kesin olarak `{durum}` ve bit düzeyinde
/// kilitli bir testle korunuyor. Gövde şekline göre dallanan bir handler,
/// istemcideki bir yazım hatasını sessizce yanlış dala düşürürdü (`PUT`
/// ayrımıyla aynı gerekçe, bkz. `guncelle`). Ödeme bu yüzden kendi yolunda.
pub async fn odeme(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    istek: Result<Json<OdemeIstegi>, JsonRejection>,
) -> Result<StatusCode, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let istek = govde_coz(istek)?;
    odeme_guncelle(&conn, id, istek.odendi, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(StatusCode::NO_CONTENT)
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
    istek: Result<Json<GuncellemeIstegi>, JsonRejection>,
) -> Result<Json<Randevu>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let istek = govde_coz(istek)?;
    let yeni = RandevuGuncelleme {
        client_id: istek.client_id,
        baslangic: istek.baslangic,
        bitis: istek.bitis,
        ucret: istek.ucret,
    };
    let randevu = depo_guncelle(&conn, id, &yeni, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(randevu))
}

/// Bir randevu silinirse **kaç notun** yok olacağını söyler
/// (`GET /randevular/{id}/silinecekler`); hiçbir şey değiştirmez.
///
/// # Neden var (dal incelemesi I2)
/// `progress_notes` ve `private_notes` `ON DELETE CASCADE` taşıyor: randevu
/// silinince seans notu ve özel not da gider. Onay metni ("Bu randevu kalıcı
/// olarak silinsin mi?") notlardan hiç söz etmiyordu — terapist bir takvim
/// satırını sildiğini sanarken klinik kaydı yok ediyordu. Arayüz artık
/// onayı açmadan önce bu sayıyı soruyor; emsal, seri onayındaki adet
/// (`seri_adedi`).
///
/// `seri_adedi` ile aynı sınıf: **çekirdek log YAZMAZ** (onay kutusunu
/// hazırlayan kontrol; kullanıcı vazgeçerse silinemez loga satır düşmemeli)
/// ve rota katmanı da yazmaz.
pub async fn silinecekler(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let not_adedi = silinecek_not_sayisi(&conn, id).map_err(depo_hatasi)?;
    Ok(Json(json!({ "not_adedi": not_adedi })))
}

pub async fn kaldir(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    sil(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
}

#[derive(Deserialize)]
pub struct SeriSorgusu {
    /// Bu duvar saatinden (dahil) İTİBAREN sayılır/silinir; öncesi korunur.
    pub bu_tarihten_itibaren: String,
}

/// `DELETE /randevular/seri/{seri_id}` çağrılsa kaç randevunun silineceğini
/// söyler; hiçbir şey değiştirmez.
///
/// Silme geri alınamaz: iki adımlı onay metninin kaç kaydın gideceğini
/// söyleyebilmesi için gerekiyor ve bu sayı yalnızca sunucuda bilinir
/// (seri, ekrandaki haftanın çok ötesine uzanabilir).
///
/// # `not_adedi` de döner (dal incelemesi I2)
/// Silinen her randevunun seans notu ve özel notu `ON DELETE CASCADE` ile
/// birlikte gider; 52 haftalık bir serinin iptali gelecekteki tüm notları
/// yok eder ve onay metni bundan hiç söz etmiyordu. **Yeni bir uç nokta
/// açmak yerine bu yanıt genişletildi**: sayı zaten burada sorulan
/// "silinecekler" sorusunun parçası ve iki ayrı istek atmak, iki sayının
/// birbirinden farklı anlarda okunmasına (dolayısıyla tutarsız bir onay
/// metnine) kapı açardı.
pub async fn seri_adedi(
    State(s): State<AppState>,
    Path(seri_id): Path<String>,
    q: Result<Sorgu<SeriSorgusu>, ApiHata>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let Sorgu(q) = q?;
    let adet = seri_sayisi(&conn, &seri_id, &q.bu_tarihten_itibaren).map_err(depo_hatasi)?;
    let not_adedi =
        seri_silinecek_not_sayisi(&conn, &seri_id, &q.bu_tarihten_itibaren).map_err(depo_hatasi)?;
    Ok(Json(json!({ "adet": adet, "not_adedi": not_adedi })))
}

/// `seriyi_sil`'in rotası: bir serinin verilen tarihten İTİBAREN gelen
/// üyelerini siler, GEÇMİŞİ KORUR.
///
/// Depo fonksiyonu Görev 6'da yazılmış ve test edilmişti ama hiçbir çağrı
/// yeri yoktu: 52 haftalık bir seri iki tıkla kuruluyor, iptal etmenin tek
/// yolu 52 randevuyu tek tek silmek oluyordu (bkz. dal incelemesi I4a).
///
/// Diğer rotalarla aynı kapı: ilk satırda `acik_baglanti` -- kilitli
/// oturumda 401.
pub async fn seri_kaldir(
    State(s): State<AppState>,
    Path(seri_id): Path<String>,
    q: Result<Sorgu<SeriSorgusu>, ApiHata>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let Sorgu(q) = q?;
    let silinen = seriyi_sil(&conn, &seri_id, &q.bu_tarihten_itibaren, Cihaz::Masaustu)
        .map_err(depo_hatasi)?;
    Ok(Json(json!({ "silinen": silinen })))
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
    q: Result<Sorgu<CakismaSorgusu>, ApiHata>,
) -> Result<Json<SeriCakismasi>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let Sorgu(q) = q?;
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
