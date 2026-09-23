pub mod assets;
pub mod guard;
pub mod routes;
pub mod state;

pub use state::AppState;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Request},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};

/// Sunucunun baglanacagi yerel adres. Sadece bu makineden erisim icin
/// `127.0.0.1` kullanilmali; `0.0.0.0` veya `::` (ya da bir ortam
/// degiskeninden gelen, denetlenmemis bir adres) ASLA kullanilmamali --
/// bunlar, diskte sifreli tutulan danisan seans notlarina hizmet eden
/// API'yi ayni ag/Wi-Fi uzerindeki diger cihazlara acar (saglik verisi
/// sizintisi riski).
pub const YEREL_ADRES: &str = "127.0.0.1";

/// Icerik Guvenlik Politikasi (CSP) basligi. `src-tauri/tauri.conf.json`
/// icindeki `app.security.csp` ile AYNI olmali -- Tauri'nin CSP enjeksiyonu
/// yalnizca kendi ozel protokoluyle sunulan icerige uygulaniyor; bu pencere
/// `WebviewUrl::External("http://127.0.0.1:<port>")` ile acildigi icin
/// politika sunucu tarafindan da fiilen zorlanmali.
const CSP_POLITIKASI: &str = "default-src 'self'; style-src 'self' 'unsafe-inline'";

async fn csp_basligi_ekle(istek: Request<Body>, next: Next) -> Response {
    let mut yanit = next.run(istek).await;
    yanit.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CSP_POLITIKASI),
    );
    yanit
}

/// `/api` altında hiçbir rotayla eşleşmeyen bir yol için 404 döner.
///
/// `assets::statik` (genel SPA geri dönüşü) yalnızca `/api` DIŞINDAKİ
/// bilinmeyen yollara uygulanır -- bu ayrı fallback olmasaydı `/api`
/// köküne `.fallback(assets::statik)` uygulanır ve `/api/yanlisyol` gibi bir
/// yazım hatası içeren bir `fetch` sessizce `200` + HTML dönerdi; arayüz
/// bunu hatasız "boş nesne" gibi yorumlar, hiçbir hata fırlatmazdı (bkz.
/// Plan 1'in son incelemesinden Kural 3). Plan 2 sekizden fazla yeni uç
/// nokta eklediği için bu artık gerçek bir risk.
async fn api_bulunamadi() -> (StatusCode, Json<Value>) {
    (StatusCode::NOT_FOUND, Json(json!({ "hata": "Bilinmeyen API yolu." })))
}

fn api_router() -> Router<AppState> {
    Router::new()
        .route("/durum", get(routes::session::durum))
        .route("/kurulum", post(routes::setup::kurulum))
        .route("/kilit-ac", post(routes::session::kilit_ac))
        .route("/kilitle", post(routes::session::kilitle))
        // Parola degistirme: kilit kapisinin ICINDE (28. veri handler'i) ve
        // `POST` -- parolalar GOVDEDE gider, sorgu dizesinde degil (URL'ler
        // tarayici gecmisine ve gunluklere duser). `core::keystore::
        // change_password` Plan 1'den beri yazili ve testliydi ama hicbir
        // cagri yeri yoktu; bu, o zincirin arayuze kadar uzanan halkasi.
        .route("/parola", post(routes::password::degistir))
        .route("/danisanlar", get(routes::clients::liste).post(routes::clients::olustur))
        // Arşivleme ayrı bir yol segmentinde ve `POST`: yumuşak silmedir,
        // `DELETE` değildir (gerekçe için bkz. `routes::clients::arsivle_uc`).
        // Görev 7'nin ekleyeceği `/danisanlar/{id}` ile çakışmaz -- bu üç
        // segmentli.
        .route("/danisanlar/{id}/arsivle", post(routes::clients::arsivle_uc))
        // Danisan veri raporu (Plan 4 Gorev 6): sunucuda uretilen AES-256
        // parola korumali PDF. `POST` cunku (a) silinemez bir `disa_aktarma`
        // satiri yazar ve (b) parola GOVDEDE gider, sorgu dizesinde degil.
        // Plan 3'un ayri `rapor-kaydi` ucu kaldirildi: raporu ureten uc
        // noktanin kendisi loglar. Sira sozlesmesi icin bkz.
        // `routes::veri_raporu` modul basligi.
        .route("/danisanlar/{id}/veri-raporu", post(routes::veri_raporu::veri_raporu))
        .route(
            "/randevular",
            get(routes::appointments::liste).post(routes::appointments::olustur),
        )
        .route(
            "/randevular/{id}",
            // PATCH: yalnizca `{durum}` (Gorev 11'den beri degismeyen
            // sozlesme). PUT: alan guncelleme (danisan/saat/ucret) --
            // gerekce icin bkz. `routes::appointments::guncelle`.
            axum::routing::patch(routes::appointments::durum)
                .put(routes::appointments::guncelle)
                .delete(routes::appointments::kaldir),
        )
        // Silme ONIZLEMESI (dal incelemesi I2): bir randevu silinirse kac
        // NOTUN cascade ile gidecegini soyler, hicbir sey degistirmez.
        // Onay metni bunu soylemek zorunda; `seri/{seri_id}`'nin `adet`i ile
        // ayni sinif. Uc segmentli ve ikinci segmenti sayisal oldugu icin
        // literal `seri` yoluyla cakismaz.
        .route("/randevular/{id}/silinecekler", get(routes::appointments::silinecekler))
        // Odeme isareti (Plan 4 Gorev 1): `PATCH /randevular/{id} {durum}`
        // sozlesmesine DOKUNMAMAK icin ayri, uc segmentli yol -- gerekce icin
        // bkz. `routes::appointments::odeme`.
        .route("/randevular/{id}/odeme", axum::routing::patch(routes::appointments::odeme))
        // Seri islemleri ayri bir yol segmentinde: `/randevular/{id}` iki
        // segmentli, bu uc segmentli -- cakisma yok.
        .route(
            "/randevular/seri/{seri_id}",
            get(routes::appointments::seri_adedi)
                .delete(routes::appointments::seri_kaldir),
        )
        .route("/cakisma", get(routes::appointments::cakisma))
        // Ay sonu ozeti (Plan 4 Gorev 3): salt okur, kapinin ICINDE (31. veri
        // handler'i). `ay` sorgu dizesinde: hassas degil (bir takvim ayi).
        .route("/ay-ozeti", get(routes::ozet::ay_ozeti_uc))
        // --- Plan 3 Gorev 7: danisan dosyasi, notlar, ekler, arama --------
        //
        // Asagidaki on dort handler'in da ilk satiri `guard::acik_baglanti`:
        // kilitliyken 401, govdede veri yok, islem uygulanmaz. Toplam veri
        // handler'i sayisi 11 -> 25 (dal incelemesi C1'in ekledigi
        // `rapor-kaydi` ile 26; Plan 4 Gorev 6'da o uc kalkti, yerine
        // `veri-raporu` geldi -- toplam degismedi).
        //
        // `/danisanlar/{id}` iki segmentlidir; uc segmentli
        // `/danisanlar/{id}/arsivle`, `.../notlar` ve `.../ekler` ile
        // cakismaz.
        .route(
            "/danisanlar/{id}",
            get(routes::clients::getir_uc).patch(routes::clients::guncelle_uc),
        )
        .route("/danisanlar/{id}/notlar", get(routes::notes::danisan_listesi))
        // Danisan dosyasinin seans listesi (Plan 5 Gorev 4): notu olsun
        // olmasin TUM seanslar -- `.../notlar`'in aksine notu yazilmamis
        // randevu da doner (bkz. `store::danisan_seanslari` modul basligi).
        .route("/danisanlar/{id}/seanslar", get(routes::danisan_seanslari::liste))
        .route(
            "/danisanlar/{id}/ekler",
            get(routes::attachments::liste)
                .post(routes::attachments::yukle)
                // Ham govde kullanildigi icin `govde boyutu == dosya boyutu`:
                // sinir cekirdegin `AZAMI_DOSYA_BOYUTU`'suyla BIREBIR ayni
                // (gerekce icin bkz. `routes::attachments` modul basligi).
                // Katman rotanin tamamina uygulanir; GET'in govdesi zaten yok.
                .layer(DefaultBodyLimit::max(routes::attachments::AZAMI_GOVDE_BOYUTU)),
        )
        .route(
            "/ekler/{id}",
            get(routes::attachments::indir).delete(routes::attachments::kaldir),
        )
        .route("/depolama-durumu", get(routes::attachments::depolama))
        // Resmi not ve OZEL not ayri yol oneklerinde ve ayri rota
        // modullerinde: bir liste/disa aktarim yolu ozel not handler'ini
        // yanlislikla yeniden kullanamasin (bkz. `routes::private_notes`).
        .route(
            "/randevular/{id}/not",
            get(routes::notes::getir).put(routes::notes::kaydet),
        )
        .route(
            "/randevular/{id}/ozel-not",
            get(routes::private_notes::getir).put(routes::private_notes::kaydet),
        )
        .route("/ara", get(routes::search::ara_uc))
        .route("/saklama-suresi-dolanlar", get(routes::clients::saklama_listesi))
        // --- Etiketler (Plan 6 Gorev 5): kapinin icinde, bes veri handler'i --
        //
        // Etiket ADI URL'ye girmez: ekleme govdede (`POST`), kaldirma ve
        // arama yalnizca sayisal kimlikle (bkz. `routes::tags` modul
        // basligi).
        .route("/etiketler", get(routes::tags::listele))
        .route(
            "/randevular/{id}/etiketler",
            get(routes::tags::seans_listesi).post(routes::tags::ekle),
        )
        .route(
            "/randevular/{id}/etiketler/{tag_id}",
            axum::routing::delete(routes::tags::kaldir),
        )
        .route("/etiketler/{id}/seanslar", get(routes::tags::seanslar))
        // Denetim kaydini OKUMA ucu (Gorev 7 Plan 7, KVKK 2018/10): kapinin
        // icinde, 38. veri handler'i, salt okur. Tarih araligi + varlik
        // turu suzgeci ve sayfalama sorgu dizesinde -- gerekce icin bkz.
        // `routes::audit` modul basligi.
        .route("/denetim-kayitlari", get(routes::audit::liste))
        // --- Yedekleme ve geri yukleme (tasarim §7 ve §8) -----------------
        //
        // Yedek ALMA kapinin ICINDE (`routes::backup`, 27. veri handler'i):
        // danisan verisinin tamaminin kopyasini uretir.
        //
        // Geri yukleme ve yedek listeleme kapinin DISINDA
        // (`routes::restore`, `VERI_DISI_ROTALAR`): var olus sebepleri tam
        // da oturumun acilamadigi durumdur -- bozuk veritabani, okunamayan
        // anahtar dosyasi ya da bos bir veri dizini (yeni bilgisayar).
        // Yetki oradan gelmiyor demek degil: cagiran, geri yuklenecek
        // YEDEGIN KENDI anahtar dosyasini acabilen parolayi vermek zorunda
        // (bkz. `routes::restore` modul basligi).
        //
        // Ikisi de `POST` ve klasor yolunu GOVDEDE aliyor: yol kullanicinin
        // adini icerebilir ve URL'ler tarayici gecmisine/gunluklere duser
        // (`routes::attachments`'in dosya adi karariyla ayni sinif).
        .route("/yedek", post(routes::backup::al))
        .route("/yedekler", post(routes::restore::listele))
        .route("/geri-yukleme", post(routes::restore::uygula))
        // `.onceki` kalintisini damgali bir ada TASIYAN bakim ucu -- geri
        // yuklemenin KENDISIYLE ayni erisilebilirlikte (inceleme, ikinci
        // tur). Kapinin icinde olsaydi bir CIKMAZ uretirdi: yarim kalmis
        // bir geri almadan sonra canli cift eslesmez, oturum acilamaz ve
        // `.onceki` durdugu icin geri yukleme de 409 alir -- kullanicinin
        // tek cikisi Finder'da elle dosya tasimak olurdu; kapinin onlemek
        // istedigi sey tam olarak budur.
        //
        // Guvenlik: uc hicbir veri OKUMAZ (yanit yalnizca bir SAYI) ve
        // hicbir sey SILMEZ; yalnizca veri dizinindeki `.onceki` yan
        // dosyalarini yeniden adlandirir. Gerekce `routes::restore`
        // handler'inin uzerinde.
        .route("/onceki-dosyalari-kaldir", post(routes::restore::onceki_dosyalari_kaldir))
        .fallback(api_bulunamadi)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/api", api_router())
        // API disindaki (ve /api altinda eslesmeyen degil, hic /api ile
        // baslamayan) yollar icin arayuz sunulur (SPA geri donusu).
        .fallback(assets::statik)
        // Tum yanitlara (statik varliklar + API) CSP basligini ekleyen tek katman.
        .layer(middleware::from_fn(csp_basligi_ekle))
        .with_state(state)
}
