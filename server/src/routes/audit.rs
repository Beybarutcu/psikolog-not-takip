//! Denetim kaydını OKUMA ucu (`GET /api/denetim-kayitlari`, Görev 7 Plan 7).
//!
//! # Sorun neydi
//!
//! `store::audit::son_kayitlar` üretimde hiçbir yerden çağrılmıyordu -- ne
//! bir HTTP rotası, ne bir Tauri komutu, ne bir ekran; bütün çağrı yerleri
//! `#[cfg(test)]`di. Modülün kendi ilkesi *"denetlenebilir olmayan bir
//! denetim kaydı, olmayan denetim kaydıyla aynı şeydir"* (bkz.
//! `store::audit` modül başlığı). KVKK Kurul Kararı 2018/10 açısından:
//! terapistten "şu tarihte bu dosyaya kim, hangi cihazdan erişti" istendiğinde
//! yanıt yalnızca şifreli veritabanını elle açarak verilebiliyordu.
//!
//! # Kapsam bilerek KÜÇÜK
//!
//! Tarih, eylem, varlık türü, varlık kimliği, cihaz ve (varsa) `ayrinti`
//! metni -- `store::audit::AuditKaydi`'nin taşıdığı her şey, fazlası yok.
//! Süzgeç yalnızca tarih aralığı ve varlık türü. Sayfalama zorunlu: 10
//! yılda ~190 bin satır beklenir (bkz. `store::audit` modül başlığı hacim
//! politikası), `son_kayitlar`'ın zaten sahip olduğu `LIMIT`
//! (`son_kayitlar_sayfali` üzerinden) her çağrıda kullanılır.
//!
//! # KRİTİK: bu ucun OKUNMASI yeni bir denetim satırı YAZMAZ
//!
//! `liste` çekirdekten yalnızca `son_kayitlar_sayfali`yi çağırır --  SAF bir
//! `SELECT` (bkz. o fonksiyonun dokümantasyonu) -- ve rota katmanı da ikinci
//! bir satır YAZMAZ (`store::audit::kaydet`'e hiçbir çağrı yok; kural
//! `tests/notlar_api.rs::rota_modulleri_audit_kaydet_cagirmaz` ile bu
//! dosyanın KAYNAĞI üzerinden yapısal olarak da zorlanıyor). Gerekçe: bu
//! ekranı Ayarlar sekmesinde açıp sayfalamak da bir "erişim"dir, ama onu
//! `Eylem::Goruntuleme` ile loglamak audit_log'un SİLİNEMEZ olma özelliğiyle
//! çakışır -- log kendini besler, terapist listeyi her açtığında/
//! sayfaladığında liste bir satır daha büyür ve büyümenin kendisi asla geri
//! alınamaz. Davranışsal kanıt (mutasyonla doğrulandı: rotaya bir `kaydet`
//! çağrısı eklemek onu kırmızıya döndürür):
//! `tests/notlar_api.rs::denetim_ucu_okuma_ikinci_bir_satir_uretmez`.
//!
//! # Hassas veri BURAYA da GİRMEZ
//!
//! `AuditKaydi` zaten yalnızca kimlik ve tür taşır -- not içeriği, dosya
//! adı, arama terimi, etiket adı `store::audit::Ayrinti`nin kapalı
//! enum'undan geçemediği için hiçbir zaman loga girmemişti (bkz.
//! `store::audit` modül başlığı "KRİTİK: Hassas içerik..."). Bu handler
//! `varlik_id`yi (ör. bir danışan kimliği) danışanın ADINA çevirmek için
//! **ek bir sorgu ATMAZ**: hem gösterimde hassas veri (danışan adı) ortaya
//! çıkarırdı hem de her satır için yeni bir `HerCagri` `goruntuleme`
//! satırı (`clients::getir`) üretirdi -- tam olarak yukarıdaki "okuma satır
//! üretmez" ilkesinin ihlali. Liste yalnızca sunucunun döndürdüğü ham
//! kimlik/tür çiftini gösterir.
//!
//! # Kilit: ilk satır her zaman `acik_baglanti`
//!
//! Tek handler'ın ilk satırı `guard::acik_baglanti`'dir -- kilitli oturumda
//! `401` döner, gövdede hiçbir denetim satırı taşımaz.

use crate::guard::{acik_baglanti, depo_hatasi, ApiHata, Sorgu};
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::store::audit::{son_kayitlar_sayfali, AuditKaydi, DenetimSuzgeci};
use psikolog_core::store::zaman::tarih_gecerli_mi;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Sayfa başına satır sayısı. 190 bin satırlık bir günlükte tek seferde
/// çekmek hem sunucuyu hem tarayıcıyı gereksiz yorar -- bkz. modül başlığı.
const SAYFA_BOYUTU: i64 = 50;

#[derive(Deserialize)]
pub struct DenetimSorgusu {
    /// 0 tabanlı sayfa numarası. Yoksa/negatifse `0` sayılır.
    pub sayfa: Option<i64>,
    /// `YYYY-AA-GG`, dahil.
    pub baslangic: Option<String>,
    /// `YYYY-AA-GG`, dahil.
    pub bitis: Option<String>,
    /// Tam eşleşme (ör. `"client"`, `"progress_note"`).
    pub varlik: Option<String>,
}

#[derive(Serialize)]
pub struct DenetimSayfasi {
    pub kayitlar: Vec<AuditKaydi>,
    pub sayfa: i64,
    /// `true` ise `sayfa + 1` ile bir sonraki sayfa çekilebilir. Toplam satır
    /// sayısı (`COUNT(*)`) BİLEREK dönmüyor: 190 bin satırlık bir tabloda her
    /// sayfa geçişinde ikinci bir tam tablo taraması gerektirir ve terapist
    /// için "kaçıncı sayfadayım" bilgisi "daha var mı" bilgisinden daha az
    /// değerlidir (kapsamı küçük tutma kararıyla aynı ilke).
    pub sonraki_sayfa_var: bool,
}

fn tarih_suzgeci_hatasi(alan: &str) -> ApiHata {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "hata": format!("{alan} YYYY-AA-GG biçiminde geçerli bir tarih olmalı.") })),
    )
}

/// `GET /api/denetim-kayitlari?sayfa=&baslangic=&bitis=&varlik=`
pub async fn liste(
    State(s): State<AppState>,
    q: Result<Sorgu<DenetimSorgusu>, ApiHata>,
) -> Result<Json<DenetimSayfasi>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let Sorgu(q) = q?;

    if let Some(t) = q.baslangic.as_deref() {
        if !tarih_gecerli_mi(t) {
            return Err(tarih_suzgeci_hatasi("Başlangıç tarihi"));
        }
    }
    if let Some(t) = q.bitis.as_deref() {
        if !tarih_gecerli_mi(t) {
            return Err(tarih_suzgeci_hatasi("Bitiş tarihi"));
        }
    }

    let sayfa = q.sayfa.unwrap_or(0).max(0);
    let suzgec = DenetimSuzgeci { baslangic: q.baslangic, bitis: q.bitis, varlik: q.varlik };
    // `SAYFA_BOYUTU + 1` çekilir: (SAYFA_BOYUTU+1). satır varsa "sonraki
    // sayfa var" bilgisini `COUNT(*)` çalıştırmadan (bkz. `DenetimSayfasi`
    // dokümantasyonu) verir.
    let mut kayitlar = son_kayitlar_sayfali(&conn, &suzgec, SAYFA_BOYUTU + 1, sayfa * SAYFA_BOYUTU)
        .map_err(|e| depo_hatasi(e.into()))?;
    let sonraki_sayfa_var = kayitlar.len() as i64 > SAYFA_BOYUTU;
    kayitlar.truncate(SAYFA_BOYUTU as usize);

    Ok(Json(DenetimSayfasi { kayitlar, sayfa, sonraki_sayfa_var }))
}
