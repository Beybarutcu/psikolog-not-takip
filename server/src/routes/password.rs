//! Parola değiştirme uç noktası (`POST /api/parola`).
//!
//! # Neden kilit kapısının İÇİNDE
//!
//! `routes::restore` kapısızdır çünkü var oluş sebebi oturumun
//! **açılamadığı** durumdur. Burada tam tersi geçerli: parolasını
//! değiştiren kişi zaten oturumu açmış olan kişidir. Kapı, kilitli bir
//! oturumda bu uç noktanın çalışmasını engeller -- kilitli bir uygulamanın
//! önünden geçen biri, terapistin parolasını (mevcut parolayı bilmeden
//! deneyerek) tahmin etmeye bile başlayamaz.
//!
//! `acik_baglanti` ayrıca **gerekli**: denetim satırı bir veritabanı
//! yazımıdır ve `core::parola::parolayi_degistir` bağlantıyı ister.
//!
//! # Neden ayrı bir modül
//!
//! `session.rs` `VERI_DISI_ROTALAR` istisnasındadır (kapıyı kullanmaz ve
//! denetim satırını kendisi yazar). Bu handler ikisinin de tersini yapıyor:
//! kapıdan geçiyor ve denetim satırını **çekirdek** yazıyor. İkisini aynı
//! modüle koymak, yapısal testlerin ölçtüğü ayrımı bozardı
//! (`notlar_api.rs::her_veri_handleri_acik_baglantidan_gecer` ve
//! `rota_modulleri_audit_kaydet_cagirmaz`).
//!
//! # Parola gövdede, sorgu dizesinde DEĞİL
//!
//! `routes::attachments`'ın dosya adı ve `routes::restore`'un klasör yolu
//! kararlarıyla aynı sınıf, bir fazlasıyla: URL'ler tarayıcı geçmişine ve
//! genel amaçlı erişim günlüklerine düşer. Bir parola oraya asla düşmemeli.
//!
//! # Sunucu günlüğüne hiçbir şey yazılmaz
//!
//! Bu modülde `eprintln!` YOKTUR. Kardeş modüller hata ayıklama için
//! yazıyor; burada yazılabilecek her şeyin yanında istek gövdesi
//! (dolayısıyla parola) duruyor ve tek bir dikkatsiz `{istek:?}` onu
//! stderr'e dökerdi. Kullanıcının ihtiyacı olan bilgi zaten gövdedeki
//! `hata` alanında.

use crate::guard::{acik_baglanti, govde_coz, ApiHata};
use axum::extract::rejection::JsonRejection;
use crate::state::{AppState, KeystoreDurumu};
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::parola::{parolayi_degistir, ParolaHatasi};
use psikolog_core::store::audit::Cihaz;
use serde::Deserialize;
use serde_json::{json, Value};

/// İstek gövdesi.
///
/// `Debug` **türetilmiyor**: bu yapı iki parola taşıyor ve türetilmiş bir
/// `Debug`, tek bir `{istek:?}` ile ikisini birden stderr'e dökerdi. Bu kod
/// tabanında türetilmiş `Debug` dört kez sızıntı üretti
/// (`DataKey`, `Ayrinti`, `Randevu`, `Danisan`).
#[derive(Deserialize)]
pub struct ParolaIstegi {
    pub mevcut_parola: String,
    pub yeni_parola: String,
}

/// `POST /api/parola`
///
/// Başarıda `200` ve **boş** gövde. Yanıt hiçbir bilgi taşımaz: ne yeni
/// parola, ne kurtarma kodu, ne de anahtarla ilgili herhangi bir alan.
///
/// Hata kodları ayrıktır çünkü mesajlar da ayrıktır (bkz.
/// `core::parola::ParolaHatasi`): `401` yalnızca "mevcut parola yanlış"
/// içindir; kısa/aynı parola `400`; anahtar kaydı bozukluğu ve yazma
/// hataları `500`.
pub async fn degistir(
    State(s): State<AppState>,
    istek: Result<Json<ParolaIstegi>, JsonRejection>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let istek = govde_coz(istek)?;
    let ks = match s.keystore_durumu() {
        KeystoreDurumu::Var(ks) => ks,
        // Kapıdan geçmiş bir istek için "kurulum yapılmamış" fiilen
        // imkânsız (oturum açıksa keystore vardı), ama iki durum da
        // kullanıcıyı dosyayı silmeye itmeyen bir mesajla karşılanmalı.
        KeystoreDurumu::Yok | KeystoreDurumu::Bozuk => {
            return Err(parola_hatasi(ParolaHatasi::AnahtarKaydiBozuk));
        }
    };

    parolayi_degistir(
        &conn,
        &s.keystore_yolu(),
        &ks,
        &istek.mevcut_parola,
        &istek.yeni_parola,
        Cihaz::Masaustu,
    )
    .map_err(parola_hatasi)?;

    Ok(Json(json!({})))
}

/// `ParolaHatasi`'yı HTTP durumuna eşler. Gövdeye giden metin hatanın kendi
/// `Display`'idir; hiçbir varyant alan taşımadığı için parola sızamaz.
fn parola_hatasi(e: ParolaHatasi) -> ApiHata {
    let kod = match e {
        // YALNIZCA bu gerçekten "parola hatalı"dır.
        ParolaHatasi::MevcutParolaYanlis => StatusCode::UNAUTHORIZED,
        ParolaHatasi::YeniParolaKisa | ParolaHatasi::YeniParolaAyni => StatusCode::BAD_REQUEST,
        ParolaHatasi::AnahtarKaydiBozuk
        | ParolaHatasi::Yazilamadi
        | ParolaHatasi::KayitYazilamadi
        | ParolaHatasi::KayitTamamlanamadi => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (kod, Json(json!({ "hata": e.to_string() })))
}
