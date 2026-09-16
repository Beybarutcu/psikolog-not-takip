//! Ekli dosya uç noktaları — yükleme, listeleme, indirme, silme ve depolama
//! durumu.
//!
//! # İstek biçimi: HAM gövde + başlıklarda üstveri
//!
//! Yükleme (`POST /api/danisanlar/{id}/ekler`) gövdesi **dosyanın ham
//! baytlarıdır**; üstveri başlıklardan gelir:
//!
//! | Başlık         | Anlam                                                   |
//! |----------------|---------------------------------------------------------|
//! | `content-type` | MIME tipi (`store::attachments::mime_dogrula`'ya gider)  |
//! | `x-dosya-adi`  | Dosya adı, **yüzde kodlamalı UTF-8**                     |
//! | `x-ek-turu`    | `onam` / `test` / `diger` (kapalı küme)                  |
//!
//! İki alternatif elendi:
//!
//! - **`multipart/form-data`**: `axum`'un `multipart` özelliği (ve `multer`
//!   bağımlılığı) gerekirdi ve — daha önemlisi — gövde boyutu sınırını
//!   bulanıklaştırırdı. Çok parçalı gövde, dosyanın yanına sınır (boundary)
//!   dizgileri ve parça başlıkları koyar; 20 MB'lık **geçerli** bir dosya
//!   20 MB'ı aşan bir gövde üretir. Sınırı tam 20 MB yapmak geçerli dosyayı
//!   reddederdi, "biraz üstü" yapmak ise sınırı keyfî bir sayıya çevirirdi.
//!   Ham gövdede `gövde boyutu == dosya boyutu`, dolayısıyla
//!   `AZAMI_GOVDE_BOYUTU == AZAMI_DOSYA_BOYUTU` **tam** doğru sınırdır.
//! - **Sorgu dizgisinde üstveri** (`?dosya_adi=...`): dosya adı tek başına
//!   sağlık verisidir ("mahkeme-raporu.pdf", bkz. `store::attachments` modül
//!   başlığı). URL'ler tarayıcı geçmişine, adres çubuğuna ve genel amaçlı
//!   erişim günlüklerine düşer; başlıklar düşmez. Aynı veri için başlık
//!   kesinlikle daha dar bir yüzeydir.
//!
//! # Gövde boyutu sınırı
//!
//! `AZAMI_GOVDE_BOYUTU` = `store::attachments::AZAMI_DOSYA_BOYUTU` (20 MB) ve
//! bu eşitlik `sinir_cekirdek_siniriyla_ayni` testiyle sabittir. İkisinin
//! ayrışması iki yönde de gerçek bir hatadır: sınır küçükse **geçerli** bir
//! dosya `413` alır (kullanıcı 20 MB'lık taranmış onam formunu yükleyemez ve
//! `attachments::ekle`'nin açıklayıcı mesajını bile görmez); sınır büyükse
//! `DefaultBodyLimit` anlamsızlaşır — 20 MB'ı aşan gövde önce belleğe
//! tamamen alınır, sonra çekirdek tarafından reddedilir; koruma "reddet"
//! değil "önce yut, sonra reddet" olur.
//!
//! Asıl (anlamlı mesaj üreten) sınır yine `attachments::ekle`'dedir; buradaki
//! sınır onun **önünde duran**, belleğe alınacak baytı sınırlayan kaba
//! korumadır. `axum` sınırı aşan gövdeyi `413` ile reddeder.
//!
//! # KRİTİK: `EkIcerigi` asla `{:?}` ile biçimlendirilmez
//!
//! `EkIcerigi`'nin `Debug`'ı yalnızca uzunluğu basar, ama `into_inner()` ham
//! `Vec<u8>` verir ve **onun** `Debug`'ı 20 MB'lık dosyayı tek satırlık
//! ondalık bayt dizisi olarak döker (bkz. o tipin belgesindeki UYARI:
//! "koruma yalnızca KAZAYLA olan yolu kapatır"). Bu modülde `into_inner()`'ın
//! sonucu doğrudan `Body::from`'a verilir; hiçbir yerde `{:?}`, `dbg!`,
//! `tracing::debug!` ya da `format!` ile bir bayt dizisine dokunulmaz. Aynı
//! kural dosya adı için de geçerlidir: hata mesajlarına ve günlüklere girmez.
//!
//! # Denetim kaydı: rota katmanı İKİNCİ bir satır yazmaz
//!
//! `store::attachments`'ın dört log çağrısı hacim kararını zaten vermiştir
//! (`ekle`/`sil`/`icerik_getir` -> `HerCagri`, `listele` -> `OturumBasi`) ve
//! `depolama_durumu` bilerek hiç log yazmaz. Buradaki handler'lar hiçbir ek
//! `audit::kaydet` çağrısı yapmaz.
//!
//! # Kilit
//!
//! Beş handler'ın da ilk satırı `guard::acik_baglanti`'dir: kilitli oturumda
//! `401`, gövdede veri yok, işlem uygulanmaz.

use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::AppState;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use psikolog_core::store::attachments::{
    depolama_durumu, ekle, icerik_getir, listele, sil, DepolamaDurumu, EkBilgisi,
    AZAMI_DOSYA_BOYUTU,
};
use psikolog_core::store::audit::Cihaz;
use serde_json::{json, Value};

/// `axum::extract::DefaultBodyLimit` için üst sınır — bkz. modül başlığı.
///
/// Ham gövde kullanıldığı için `gövde boyutu == dosya boyutu`; bu yüzden
/// değer çekirdeğin dosya sınırıyla **birebir aynıdır**.
pub const AZAMI_GOVDE_BOYUTU: usize = AZAMI_DOSYA_BOYUTU;

/// Dosya adını taşıyan istek başlığı (yüzde kodlamalı UTF-8).
pub const BASLIK_DOSYA_ADI: &str = "x-dosya-adi";
/// Ek türünü taşıyan istek başlığı (`onam`/`test`/`diger`).
pub const BASLIK_EK_TURU: &str = "x-ek-turu";

/// MIME çözülemediğinde kullanılan güvenli değer.
const GUVENLI_MIME: &str = "application/octet-stream";

fn istek_hatasi(mesaj: &str) -> ApiHata {
    (StatusCode::BAD_REQUEST, Json(json!({ "hata": mesaj })))
}

/// Yüzde kodlamalı (`%C4%9F`) bir dizgiyi UTF-8 metne çözer.
///
/// HTTP başlık değerleri ASCII'dir; Türkçe dosya adları ("değerlendirme.pdf")
/// doğrudan konulamaz. Kodlama/çözme burada elle yapılır — ters yönü
/// (`rfc5987_kodla`) indirme yanıtı için zaten gerekiyordu, bu onun eşi.
///
/// `None` döner: yarım/bozuk bir `%XX` dizisi veya geçersiz UTF-8. Ham dizgi
/// hiçbir hata mesajına konmaz (dosya adı sağlık verisidir).
fn yuzde_coz(ham: &str) -> Option<String> {
    let b = ham.as_bytes();
    let mut cikti: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() {
                return None;
            }
            let ust = (b[i + 1] as char).to_digit(16)?;
            let alt = (b[i + 2] as char).to_digit(16)?;
            cikti.push((ust * 16 + alt) as u8);
            i += 3;
        } else {
            cikti.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(cikti).ok()
}

/// RFC 5987 `attr-char` kümesi: bunun dışındaki her bayt yüzde kodlanır.
fn attr_char_mi(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&b)
}

/// Dosya adını RFC 5987 (`filename*=UTF-8''...`) biçimine kodlar.
///
/// Doğrulayıcı (`store::attachments::dosya_adi_dogrula`) yol ayıracını,
/// tırnağı, denetim karakterini, çift yönlü metni ve sıfır genişlikli
/// karakterleri zaten **reddediyor**; bu kodlama o yüzden bir güvenlik yaması
/// değil, Türkçe karakterlerin (ve boşluk, `;`, `,` gibi ayıraçların)
/// tarayıcıya bozulmadan ulaşması içindir. İkisi birlikte gerekir: doğrulama
/// olmadan kodlama tehlikeli bir adı "düzgünce" iletirdi, kodlama olmadan
/// doğrulama geçerli bir adı bozardı.
fn rfc5987_kodla(ad: &str) -> String {
    let mut s = String::from("UTF-8''");
    for b in ad.as_bytes() {
        if attr_char_mi(*b) {
            s.push(*b as char);
        } else {
            s.push_str(&format!("%{b:02X}"));
        }
    }
    s
}

/// `filename="..."` için ASCII yedeği: RFC 5987'yi anlamayan istemciler için.
///
/// ASCII olmayan ve `quoted-string` içinde sorun çıkarabilecek her karakter
/// `_` olur. `"` ve `\` doğrulayıcı tarafından zaten reddedilmiştir; yine de
/// burada elenir — bu fonksiyon başlığın kendi bütünlüğünden sorumludur ve
/// başka bir dosyadaki bir kuralın bozulmamış olmasına güvenmez.
fn ascii_yedek_ad(ad: &str) -> String {
    let temiz: String = ad
        .chars()
        .map(|c| {
            if c == ' ' || (c.is_ascii_graphic() && c != '"' && c != '\\') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if temiz.trim().is_empty() {
        "ek".to_string()
    } else {
        temiz
    }
}

/// RFC 9110 `tchar` kümesi (başlık `token`'ı).
fn tchar_mi(c: char) -> bool {
    c.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~".contains(c)
}

/// `Content-Type` başlığına konulacak güvenli değeri üretir.
///
/// `store::attachments::mime_dogrula` denetim karakterini (yani CRLF
/// enjeksiyonunu) ve biçimsizliği (`tip/alttip`) **zaten** reddediyor; ama
/// RFC 9110'un `token` kümesini zorlamıyor: `application/pdf ödev` gibi bir
/// değer depoya girebilir. Böyle bir değer `HeaderValue::from_str` tarafından
/// ya reddedilir (ASCII dışı) ya da tarayıcıya bozuk bir başlık olarak gider.
///
/// Bu yüzden başlığa konulmadan önce:
/// 1. Parametreler (`;` sonrası) **atılır**. Korunmaları `quoted-string`
///    dahil tam bir RFC 9110 parametre çözümlemesi gerektirirdi; yanıt her
///    hâlükârda `attachment` olduğu için `charset` gibi parametrelerin
///    görüntülemeye etkisi yoktur.
/// 2. Kalan değer `token "/" token` kuralına göre denetlenir.
/// 3. Uymayan her değer `application/octet-stream` olur — tarayıcının tahmin
///    yürütmesine de izin verilmez (`X-Content-Type-Options: nosniff`).
fn guvenli_content_type(mime: &str) -> String {
    let temel = mime.split(';').next().unwrap_or("").trim();
    let gecerli = match temel.split_once('/') {
        Some((tip, alttip)) => {
            !tip.is_empty()
                && !alttip.is_empty()
                && tip.chars().all(tchar_mi)
                && alttip.chars().all(tchar_mi)
        }
        None => false,
    };
    if gecerli {
        temel.to_string()
    } else {
        GUVENLI_MIME.to_string()
    }
}

/// Bir başlığın ASCII değerini okur; yoksa/okunamıyorsa `None`.
fn baslik<'a>(basliklar: &'a HeaderMap, ad: &str) -> Option<&'a str> {
    basliklar.get(ad)?.to_str().ok()
}

/// Ekleri listeler (`GET /api/danisanlar/{id}/ekler`).
///
/// Dönen `EkBilgisi`'de içerik alanı **yoktur** (yapısal koruma, bkz.
/// `store::attachments::EkBilgisi`); bu handler ayrıca hiçbir yerden içerik
/// okumaz.
pub async fn liste(
    State(s): State<AppState>,
    Path(client_id): Path<i64>,
) -> Result<Json<Vec<EkBilgisi>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste = listele(&conn, client_id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(liste))
}

/// Dosya yükler (`POST /api/danisanlar/{id}/ekler`).
///
/// Üstveri başlıklardan, içerik ham gövdeden okunur (bkz. modül başlığı).
/// Eksik/bozuk başlık `400` döner ve mesajı **hangi başlığın** sorunlu
/// olduğunu söyler; içerik doğrulamalarının (`ad`, `mime`, `tur`, boyut) on
/// üç ayrı mesajı `attachments::ekle`'den gelir ve `guard::depo_hatasi`
/// tarafından `GecersizVeri -> 400` olarak, **mesaj korunarak** aktarılır.
/// Bu düzleştirilmemelidir: kullanıcı hangi alanı düzelteceğini bilmelidir.
///
/// `Bytes` en son parametredir (gövdeyi tüketir). Gövde `axum` tarafından
/// `AZAMI_GOVDE_BOYUTU` ile sınırlanır; aşan istek `413` alır.
pub async fn yukle(
    State(s): State<AppState>,
    Path(client_id): Path<i64>,
    basliklar: HeaderMap,
    govde: axum::body::Bytes,
) -> Result<(StatusCode, Json<EkBilgisi>), ApiHata> {
    let conn = acik_baglanti(&s)?;

    let mime = baslik(&basliklar, header::CONTENT_TYPE.as_str())
        .ok_or_else(|| istek_hatasi("`content-type` başlığı eksik veya okunamıyor."))?
        .to_string();

    let ham_ad = baslik(&basliklar, BASLIK_DOSYA_ADI).ok_or_else(|| {
        istek_hatasi("`x-dosya-adi` başlığı eksik veya ASCII dışı karakter içeriyor.")
    })?;
    // Ham deger hata mesajina KONMAZ: dosya adi saglik verisidir ve hata
    // metinleri ekranin disina dusebilir (bkz. `store::attachments`).
    let dosya_adi = yuzde_coz(ham_ad).ok_or_else(|| {
        istek_hatasi("`x-dosya-adi` başlığı geçerli yüzde kodlamalı UTF-8 olmalı.")
    })?;

    let tur = baslik(&basliklar, BASLIK_EK_TURU)
        .ok_or_else(|| istek_hatasi("`x-ek-turu` başlığı eksik veya okunamıyor."))?
        .to_string();

    let ek = ekle(&conn, client_id, &dosya_adi, &mime, &tur, &govde, Cihaz::Masaustu)
        .map_err(depo_hatasi)?;
    Ok((StatusCode::CREATED, Json(ek)))
}

/// Ek dosyayı indirir (`GET /api/ekler/{id}`).
///
/// Üç başlık kararı:
/// - `Content-Type`: veritabanındaki `mime`'dan gelir ama başlığa
///   konulmadan önce `guvenli_content_type`'tan geçer.
/// - `Content-Disposition`: **`attachment`**, `inline` DEĞİL. Tarayıcıda
///   gömülü açılan bir belge, aynı kaynaktaki bir sayfa gibi davranabilir;
///   danışan belgesi için bu istenmez. Dosya adı hem ASCII yedeğiyle hem
///   RFC 5987 (`filename*`) ile verilir.
/// - `X-Content-Type-Options: nosniff`: `application/octet-stream`'e
///   düşülen durumda tarayıcının içeriğe bakıp tür tahmin etmesini engeller.
///
/// Gövde ham baytlardır ve **hiçbir yerde `{:?}` ile biçimlendirilmez**
/// (bkz. modül başlığı).
///
/// # Şifresiz indirme — tasarım §10'un adlı istisnası (dal incelemesi D3)
///
/// Tasarım §10 dışa aktarılan her dosyanın şifreli olmasını ister ve çekirdek
/// bu indirmeyi `DisaAktarma` olarak loglar. Yine de baytlar **bilerek
/// şifresiz** verilir: bu, terapistin kendi yüklediği kaynak belgeyi (onam
/// formu, test sonucu) kendi makinesinde açmasıdır; danışana ya da üçüncü
/// kişiye verilecek bir rapor üretimi değildir. Belge yüklenirken zaten
/// terapistin elindeydi; şifrelemek yeni bir koruma katmaz, parolası
/// unutulabilecek ikinci bir kopya üretir. Danışana verilecek belge
/// `routes::veri_raporu`'dur ve o şifrelidir.
///
/// Karar yorumda kalmıyor: `tests/notlar_api.rs::SIFRESIZ_INDIRME_ISTISNALARI`
/// bu handler'ı adıyla taşır ve
/// `dosya_indiren_her_uc_sifreli_ya_da_adli_istisnadir`, `routes/` altında
/// `Content-Disposition` kuran her kök fonksiyonun ya `sifreli_pdf`'e
/// ulaşmasını ya da o listede olmasını ister. Bu handler adı değişir ya da
/// indirmeyi bırakırsa liste bayatlar ve test kırılır.
pub async fn indir(State(s): State<AppState>, Path(id): Path<i64>) -> Result<Response, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let (bilgi, icerik) = icerik_getir(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;

    let tur = guvenli_content_type(&bilgi.mime);
    let disposition = format!(
        "attachment; filename=\"{}\"; filename*={}",
        ascii_yedek_ad(&bilgi.dosya_adi),
        rfc5987_kodla(&bilgi.dosya_adi)
    );

    let mut yanit = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, tur)
        .header(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"))
        // `into_inner()` ham `Vec<u8>` verir; DOGRUDAN govdeye gider.
        .body(Body::from(icerik.into_inner()))
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "hata": "Dosya yanıtı oluşturulamadı." })),
            )
        })?;

    // `from_str` yalnizca gorunur ASCII kabul eder; `rfc5987_kodla` ve
    // `ascii_yedek_ad` ciktilarinin ikisi de bu kumededir. Yine de basarisizlik
    // hali sessizce yutulmaz: baslik konamazsa guvenli ve ad tasimayan bir
    // degere dusulur -- tarayici dosyayi yine de INDIRIR, gomulu ACMAZ.
    let deger = HeaderValue::from_str(&disposition)
        .unwrap_or_else(|_| HeaderValue::from_static("attachment"));
    yanit.headers_mut().insert(header::CONTENT_DISPOSITION, deger);
    Ok(yanit)
}

/// Eki kalıcı olarak siler (`DELETE /api/ekler/{id}`).
///
/// `attachments::sil` sarkan `clients.riza_dosya_id`'yi aynı transaction'da
/// temizler ve bunun için **ikinci bir log satırı yazmaz** (bkz. o
/// fonksiyonun belgesi); rota katmanı da yazmaz.
pub async fn kaldir(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    sil(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
}

/// Toplam ek boyutu ve uyarı eşiği (`GET /api/depolama-durumu`).
///
/// # Neden bu uç nokta var
/// `store::attachments::depolama_durumu` yazılmış ve test edilmişti ama
/// hiçbir çağrı yeri yoktu. Bu kod tabanında aynı örüntü daha önce **dört
/// kez** oluştu (`backup`, `appointments::seriyi_sil`, `clients::arsivle` ve
/// bu). Bağlanmazsa plan global kısıtındaki 500 MB uyarı eşiği "kodda var,
/// üründe yok" olurdu: terapist veritabanı şişerken hiçbir uyarı almazdı.
///
/// **Engellemez**, yalnızca bildirir (`uyari: true` iken yükleme çalışmaya
/// devam eder). Çekirdek bilinçli olarak log yazmaz; bu handler da yazmaz.
pub async fn depolama(State(s): State<AppState>) -> Result<Json<DepolamaDurumu>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let durum = depolama_durumu(&conn).map_err(depo_hatasi)?;
    Ok(Json(durum))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sinir_cekirdek_siniriyla_ayni() {
        // Bu esitlik bozulursa iki yonde de gercek bir hata olur: kucukse
        // GECERLI bir dosya 413 alir, buyukse DefaultBodyLimit anlamsizlasir
        // (bkz. modul basligi). Iki sabit ayri dosyalarda oldugu icin
        // ayrismalari sessizdir -- bu test onu gurultulu yapar.
        assert_eq!(AZAMI_GOVDE_BOYUTU, AZAMI_DOSYA_BOYUTU);
        assert_eq!(AZAMI_GOVDE_BOYUTU, 20 * 1024 * 1024, "plan: dosya basina 20 MB");
    }

    #[test]
    fn yuzde_cozme_turkce_adi_geri_verir() {
        assert_eq!(yuzde_coz("de%C4%9Ferlendirme.pdf").unwrap(), "değerlendirme.pdf");
        // ARTI YON: kodlama tasimayan bir ad oldugu gibi gecer. Bu olmadan
        // "her seye None don" mutasyonu asagidaki eksi yon testlerini gecerdi.
        assert_eq!(yuzde_coz("onam.pdf").unwrap(), "onam.pdf");
        assert_eq!(yuzde_coz("rapor 2026.pdf").unwrap(), "rapor 2026.pdf");
    }

    #[test]
    fn bozuk_yuzde_kodlamasi_reddedilir() {
        assert!(yuzde_coz("a%").is_none(), "yarim dizi");
        assert!(yuzde_coz("a%C4").is_none(), "eksik hane");
        assert!(yuzde_coz("a%ZZ.pdf").is_none(), "onaltilik olmayan hane");
        assert!(yuzde_coz("%FF%FE").is_none(), "gecersiz UTF-8");
    }

    #[test]
    fn rfc5987_turkce_karakteri_kodlar() {
        let kodlu = rfc5987_kodla("değerlendirme.pdf");
        assert!(kodlu.starts_with("UTF-8''"));
        assert!(kodlu.contains("%C4%9F"), "g yumusak kodlanmali: {kodlu}");
        assert!(!kodlu.contains('ğ'), "ham UTF-8 basliga girmemeli: {kodlu}");
        // Ciktinin TAMAMI gorunur ASCII olmali, yoksa HeaderValue reddeder.
        assert!(kodlu.chars().all(|c| c.is_ascii_graphic()), "{kodlu}");
    }

    #[test]
    fn rfc5987_ayiraclari_da_kodlar() {
        // Bosluk, noktali virgul ve virgul `Content-Disposition` ayiraclaridir:
        // kodlanmazlarsa baslik parcalanir.
        let kodlu = rfc5987_kodla("rapor 2026;ek,son.pdf");
        assert!(kodlu.contains("%20") && kodlu.contains("%3B") && kodlu.contains("%2C"), "{kodlu}");
        // ARTI YON: guvenli karakterler kodlanmadan gecer -- "her seyi kodla"
        // mutasyonu bu satiri kirar.
        assert!(kodlu.contains("rapor") && kodlu.contains(".pdf"), "{kodlu}");
    }

    #[test]
    fn ascii_yedek_ad_tirnak_ve_ters_bolu_birakmaz() {
        assert_eq!(ascii_yedek_ad("değerlendirme.pdf"), "de_erlendirme.pdf");
        assert_eq!(ascii_yedek_ad("a\"b\\c.pdf"), "a_b_c.pdf");
        // ARTI YON: duz ASCII ad bozulmadan gecer.
        assert_eq!(ascii_yedek_ad("onam 2026.pdf"), "onam 2026.pdf");
        // Tumu ASCII disi ise bos bir `filename=""` uretilmez.
        assert_eq!(ascii_yedek_ad("çğü"), "___");
        assert_eq!(ascii_yedek_ad("   "), "ek");
    }

    #[test]
    fn guvenli_content_type_token_disini_reddeder() {
        // `mime_dogrula` bunlarin hepsini gecirir (denetim karakteri yok,
        // `tip/alttip` bicimi var) -- RFC 9110 token kumesi orada zorlanmiyor.
        assert_eq!(guvenli_content_type("application/pdf ödev"), GUVENLI_MIME);
        assert_eq!(guvenli_content_type("application/pdf\u{00A0}x"), GUVENLI_MIME);
        assert_eq!(guvenli_content_type("uydurma"), GUVENLI_MIME);
        assert_eq!(guvenli_content_type("/pdf"), GUVENLI_MIME);
        assert_eq!(guvenli_content_type("application/"), GUVENLI_MIME);
    }

    #[test]
    fn guvenli_content_type_gecerli_tipi_korur() {
        // ARTI YON: "her seyi octet-stream yap" mutasyonu burada kirilir.
        assert_eq!(guvenli_content_type("application/pdf"), "application/pdf");
        assert_eq!(guvenli_content_type("image/png"), "image/png");
        // Parametreler atilir, temel tip korunur.
        assert_eq!(guvenli_content_type("text/plain; charset=utf-8"), "text/plain");
    }
}
