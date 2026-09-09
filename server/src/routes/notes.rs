//! **Resmî** seans notu uç noktaları (`progress_notes`).
//!
//! # KRİTİK: bu modül `private_notes`'a HİÇ dokunmaz
//!
//! Özel not uç noktaları bilerek **ayrı bir modüldedir**
//! (`routes::private_notes`) ve ayrı bir yol önekinden (`.../ozel-not`)
//! gider. Gerekçe `store::notes` modül başlığındaki ayrı-tablo garantisinin
//! HTTP katmanındaki karşılığıdır: ileride bir dışa aktarım, rapor veya
//! yazdırma uç noktası eklenirse, geliştirici "danışanın notlarını veren
//! handler"ı arayıp `notes::danisan_listesi`'ni bulacak ve onu yeniden
//! kullanacaktır. O handler'ın özel nota erişimi **olmamalıdır** — burada
//! `store::notes::ozel_*` fonksiyonlarından hiçbiri `use` edilmez; bu, dosya
//! üzerinde `grep` ile doğrulanabilir bir değişmezdir ve
//! `tests/notlar_api.rs::rota_katmani_ozel_nota_yapisal_olarak_ayri_...`
//! testi bunu davranışsal değil **yapısal** olarak sabitler.
//!
//! Hiçbir rota `private_notes` tablosuna elle SQL yazmaz; özel nota erişimin
//! tek yolu `store::notes::ozel_not_getir` / `ozel_not_kaydet`'tir.
//!
//! # Kilit: ilk satır her zaman `acik_baglanti`
//!
//! Buradaki üç handler'ın da ilk satırı `guard::acik_baglanti`'dir — kilitli
//! oturumda `401` döner, gövdede hiçbir veri taşımaz ve işlem uygulanmaz.
//! Bu tasarımın en sert gizlilik vaadidir (bkz. `guard` modül başlığı).
//!
//! # Denetim kaydı: rota katmanı İKİNCİ bir satır yazmaz
//!
//! `store::notes`'un beş log çağrısı hacim kararını (`LogHacmi::OturumBasi`)
//! zaten vermiştir. Rota katmanında ek bir `audit::kaydet` çağrısı, aynı tek
//! kullanıcı eylemi için ikinci bir **silinemez** satır demek olurdu
//! (emsal: `clients::son_temasi_tazele` ve `attachments::sil`'in
//! `riza_dosya_id` temizliği de ikinci satır yazmaz). Ayrıca not içeriği,
//! şablon adı ve arama terimi hiçbir biçimde loga ya da sunucu günlüğüne
//! yazılmaz.

use crate::guard::{acik_baglanti, depo_hatasi, ApiHata, Sorgu};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::notes::{danisan_notlari, not_getir, not_kaydet, SeansNotu};
use serde::Deserialize;

/// `GET /api/danisanlar/{id}/notlar` için üst sınır.
///
/// # Neden rota katmanında
/// `store::notes::danisan_notlari`'nın `limit`'i **bilerek** doğrulanmaz:
/// depo katmanı çağıranın limitine karışmaz (bkz. o fonksiyonun belgesi).
/// Bunun somut sonucu şudur: SQLite'ta `LIMIT -1` **sınırsız** demektir, yani
/// `?limit=-1` ile gelen bir istek danışanın TÜM seans notlarının tam
/// içeriğini tek yanıtta döndürürdü. `0` ise sessizce boş liste verir ve
/// arayüz "bu danışanın notu yok" gösterir — sessiz bir yanlış. Sınırı
/// koymak bu yüzden rotanın işidir ve burada yapılır.
///
/// Değer: haftalık seansla dört yıl (~200 seans). Arayüz "son N seans"
/// gösterir; bundan fazlası zaten sayfalama gerektirir.
pub const AZAMI_NOT_LIMITI: i64 = 200;

/// `limit` verilmediğinde kullanılan değer.
pub const VARSAYILAN_NOT_LIMITI: i64 = 50;

#[derive(Deserialize)]
pub struct NotIstegi {
    pub sablon: String,
    pub icerik: String,
}

#[derive(Deserialize)]
pub struct ListeSorgusu {
    pub limit: Option<i64>,
    /// `?once=<baslangic>` — yalnızca bu andan **önce** başlamış seansların
    /// notları. Biçim doğrulanmaz ve doğrulanmamalı: değer doğrudan bir
    /// `?` parametresi olarak SQL'e gider (dizge karşılaştırması), yani
    /// anlamsız bir değer boş liste üretir, enjeksiyon üretmez. Sunucunun
    /// tarih biçimini burada ikinci kez (farklı) yorumlaması, arayüzün
    /// gönderdiği `appointments.baslangic` ile sessizce uyuşmayan bir
    /// kesme riski olurdu.
    pub once: Option<String>,
}

/// `?limit=` değerini `1..=AZAMI_NOT_LIMITI` aralığına kırpar.
///
/// `clamp` kullanılır, hata DEĞİL: `-1` ve `0` gibi değerler kötü niyetli
/// olmak zorunda değildir (bir arayüz hesabı sıfırlanmış olabilir) ve
/// kullanıcıya "limit geçersiz" demek yerine güvenli bir liste döndürmek
/// doğru davranıştır. Kritik olan **hangi yöne** kırpıldığıdır: alt uçtan
/// kırpma `-1`'in "sınırsız"a dönüşmesini, üst uçtan kırpma da devasa bir
/// yanıtı engeller. `store::search::ara` da aynı deseni (`clamp(1, AZAMI)`)
/// kendi içinde uygular.
fn limiti_kirp(istenen: Option<i64>) -> i64 {
    istenen.unwrap_or(VARSAYILAN_NOT_LIMITI).clamp(1, AZAMI_NOT_LIMITI)
}

/// `GET /api/randevular/{id}/not` — bir randevunun resmî seans notu.
///
/// Not yoksa **boş bir not** döner (404 değil): editör açılırken "kayıt
/// bulunamadı" göstermek anlamsızdır (bkz. `store::notes::not_getir`).
/// Var olmayan RANDEVU ise `404`'tür.
pub async fn getir(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<SeansNotu>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let not = not_getir(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(not))
}

/// `PUT /api/randevular/{id}/not` — resmî seans notunu yazar (upsert).
///
/// Geçersiz şablon `400` döner ve **mesajı hangi şablonun reddedildiğini
/// söyler** (`guard::depo_hatasi`, `GecersizVeri` -> 400 + mesaj): kullanıcı
/// neyi düzelteceğini bilmelidir. Var olmayan randevu `404`.
pub async fn kaydet(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    Json(istek): Json<NotIstegi>,
) -> Result<Json<SeansNotu>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let not = not_kaydet(&conn, id, &istek.sablon, &istek.icerik, Cihaz::Masaustu)
        .map_err(depo_hatasi)?;
    Ok(Json(not))
}

/// `GET /api/danisanlar/{id}/notlar?limit=&once=` — danışanın **resmî**
/// notları.
///
/// Özel not bu listeye giremez: `danisan_notlari` yalnızca `progress_notes`
/// tablosunu okur ve bu handler başka hiçbir kaynağa bakmaz.
///
/// `once` **opsiyoneldir ve varsayılanı yoktur**: verilmediğinde danışanın
/// tüm notları döner. Zorunlu kılınsaydı veri raporu (KVKK md. 11, "elimde
/// olan her şey") bir kesme uydurmak zorunda kalırdı. Kesmeyi geçmek
/// "önceki seans notları" panelinin işidir ve o panel gerçekten geçiyor.
pub async fn danisan_listesi(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    Sorgu(q): Sorgu<ListeSorgusu>,
) -> Result<Json<Vec<SeansNotu>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste =
        danisan_notlari(&conn, id, limiti_kirp(q.limit), q.once.as_deref(), Cihaz::Masaustu)
            .map_err(depo_hatasi)?;
    Ok(Json(liste))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limit_alt_uctan_kirpilir() {
        // `-1` SQLite'ta "sinirsiz" demektir: kirpilmazsa danisanin TUM seans
        // notlarinin tam icerigi tek yanitta doner. `0` ise sessizce bos liste.
        assert_eq!(limiti_kirp(Some(-1)), 1);
        assert_eq!(limiti_kirp(Some(0)), 1);
        assert_eq!(limiti_kirp(Some(i64::MIN)), 1);
    }

    /// Sabitin KENDISI duz sayiyla pinlenir.
    ///
    /// Bunun oncesinde her iddia sabite GORELIYDI (`AZAMI_NOT_LIMITI + 1` ->
    /// `AZAMI_NOT_LIMITI`), yani sabit degisince iddialar kendilerini
    /// ayarliyordu: `200`'u `1_000_000` yapan mutasyon hicbir testi kirmadi --
    /// oysa o deger, tek yanitta donebilecek seans notu sayisini (dolayisiyla
    /// yanit boyutunu) belirleyen bir sozlesmedir. Kod tabani kardes sabitleri
    /// zaten literal'e pinliyor (`AZAMI_GOVDE_BOYUTU == 20 * 1024 * 1024`,
    /// `AZAMI_SONUC == 50`); istisna buydu.
    #[test]
    fn limit_sabitleri_duz_sayiyla_pinlenir() {
        assert_eq!(AZAMI_NOT_LIMITI, 200, "azami not limiti sozlesmesi 200'dur");
        assert_eq!(VARSAYILAN_NOT_LIMITI, 50, "varsayilan not limiti sozlesmesi 50'dir");
    }

    #[test]
    fn limit_ust_uctan_kirpilir() {
        // Duz sayiyla: sabit degisirse bu iddia kendini AYARLAMAZ, kirilir.
        assert_eq!(limiti_kirp(Some(201)), 200);
        assert_eq!(limiti_kirp(Some(1_000_000)), 200);
        assert_eq!(limiti_kirp(Some(i64::MAX)), 200);
    }

    #[test]
    fn gecerli_limit_oldugu_gibi_gecer() {
        // ARTI YON: "her seyi 1'e kirp" mutasyonu bu testi kirar. Tek basina
        // ust/alt sinir testleri yazilsaydi, limiti hep 1 yapan bir uygulama
        // ikisini de gecerdi.
        assert_eq!(limiti_kirp(Some(3)), 3);
        assert_eq!(limiti_kirp(Some(200)), 200);
        assert_eq!(limiti_kirp(None), 50);
    }
}
