//! Veri uç noktaları için ortak kilit koruması.
//!
//! `acik_baglanti` her veri uç noktasının (danışan/randevu) ilk satırında
//! çağrılır ve iki şeyi birden yapar:
//!
//! 1. Oturum kilitliyse `401` döner, **gövdede hiçbir veri taşımaz**.
//! 2. Oturum açıksa, veritabanı bağlantısını `open_existing` ile açar --
//!    `open_encrypted` DEĞİL: `open_encrypted` dosya yoksa onu yaratır, bu da
//!    `veri.db` silinmişse (kullanıcı yanlışlıkla sildi, senkronizasyon
//!    klasörü yuttu) isteğin sessizce başarılı olup boş bir veritabanı
//!    yaratmasına yol açardı -- kullanıcı hiçbir uyarı almadan "tüm
//!    danışanlarım silinmiş" izlenimine kapılırdı (bkz. Plan 1'in son
//!    incelemesinden Kural 2).
//!
//! # Oturuma dokunma (Kural 1)
//! Bu fonksiyon aynı zamanda `Oturum::dokun()`'u çağıran TEK yerdir. Bu
//! metot yazılmış ve test edilmişti ama hiçbir yerden çağrılmıyordu; bunun
//! sonucu boşta kalma kilidinin "son etkinlikten 5 dakika sonra" değil,
//! "kilit açıldıktan 5 dakika sonra" çalışmasıydı -- 50 dakikalık bir
//! seansta not yazan bir psikolog 5. dakikada kilitlenirdi. `anahtar()` ile
//! `dokun()` BİRLİKTE, tek bir kilit (`Mutex<Oturum>`) tutulurken çağrılır;
//! aksi halde iki ayrı `.lock()` arasında oturum başka bir istek tarafından
//! kilitlenebilir ve `dokun()` (kendi iç kontrolü sayesinde zaten süresi
//! dolmuş bir oturumu diriltmez, bkz. `Oturum::dokun` dokümantasyonu) yanlış
//! bir öncülle çağrılmış olur.
//!
//! # Bağlantı ömrü kararı: HER İSTEKTE TAZE BAĞLANTI KALIYOR (Plan 3 Görev 2)
//!
//! Soru şuydu: not editörü **2 saniyede bir** otomatik kaydedecek; her yazma
//! için yeni bir SQLCipher bağlantısı açmak (+ kapanışta WAL checkpoint ve
//! WAL dosyasının yıkımı) sürdürülebilir mi, yoksa bağlantı havuzuna mı
//! geçilmeli?
//!
//! **Ölçüldü, sonra karar verildi.** `tests::baglanti_omru_olcumu` art arda
//! 30 otomatik kaydı (aç + yaz + kapat) simüle eder ve aynı işi TEK bir
//! bağlantıyla tekrarlayıp iki süreyi karşılaştırır. Ölçüm makinesi:
//! Windows 11, debug profili (yani gerçek dağıtımdan yavaş), SQLCipher ham
//! hex anahtarla (KDF maliyeti YOK -- `db::anahtar_ayarla_ve_hazirla`
//! `PRAGMA key = x'<hex>'` kullanır, parola türetmez).
//!
//! Ölçülen (dört ardışık koşu, bkz. task-2-report.md'deki `--nocapture`
//! çıktısı):
//!
//! | Senaryo                                 | 30 yazma      | yazma başına |
//! |-----------------------------------------|---------------|--------------|
//! | Her yazmada TAZE bağlantı (bugünkü hâl) | 158-179 ms    | 5,3-6,0 ms   |
//! | Tek bağlantı yeniden kullanılıyor       | 17-23 ms      | 0,58-0,77 ms |
//!
//! Fark yazma başına **4,5-5,4 ms**. Bağlantı açmak gerçekten pahalı (yazma
//! süresinin ~%88'i) -- ama otomatik kayıt aralığı **2000 ms**, yani bu
//! maliyet bütçenin **%0,3'ü**. 5 ms'lik bir gecikme kullanıcı tarafından
//! algılanamaz ve otomatik kayıtlar sırayla çalıştığı için birikmez: bir
//! saatlik kesintisiz not yazımı (1800 otomatik kayıt) toplamda ~9 saniye
//! CPU/disk demektir, saatin %0,25'i.
//!
//! Karar: **değiştirilmiyor.** Gerekçe yalnızca "yeterince hızlı" değil;
//! taze bağlantı iki somut güvence taşıyor ve havuzlama ikisini de bozardı:
//!
//! 1. **`open_existing`'in dosya kontrolü her istekte yeniden çalışır.**
//!    Havuzlanmış bir bağlantı, `veri.db` silindikten sonra da (silinmiş
//!    inode üzerinden) yazmaya devam eder ve kullanıcı hiçbir uyarı almaz --
//!    Plan 1'in Kural 2'siyle doğrudan çelişir.
//! 2. **`unchecked_transaction`'ın iç içe transaction kontrolü yapmaması
//!    bugün zararsızdır** çünkü her istek kendi bağlantısını alır; iki
//!    eşzamanlı istek asla aynı bağlantı üzerinde transaction açamaz.
//!    Havuzlanmış bağlantıda bu **artık doğru değildir**: depoların "kendi
//!    transaction'ının içinden çağırma" uyarıları (bkz. `store::clients`,
//!    `store::appointments` modül başlıkları) derleyicinin yakalamadığı,
//!    gerçek bir çalışma zamanı tehlikesine dönüşür. Havuzlamaya geçilirse
//!    bu iki madde **aynı kararın parçasıdır**, ayrı ele alınamaz:
//!    `unchecked_transaction` kullanan her depo fonksiyonu ya `&mut
//!    Connection` almalı ya da transaction'ı dışarıdan almalıdır.
//!
//! Bu karar yeniden gözden geçirilmelidir eğer: otomatik kayıt aralığı 2
//! saniyenin çok altına inerse, ekli dosyalar (20 MB'a kadar BLOB) yazma
//! yoluna girip her isteğin WAL'ını büyütürse, ya da ölçüm yavaş bir diskte
//! (ağ sürücüsü, senkronizasyon klasörü) tekrarlandığında yazma başına fark
//! 100 ms'yi aşarsa.

use crate::state::AppState;
use axum::{
    extract::{FromRequestParts, Query},
    http::{request::Parts, StatusCode},
    Json,
};
use psikolog_core::store::db::{open_existing, DbError};
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::time::Instant;

pub type ApiHata = (StatusCode, Json<Value>);

/// Sorgu dizesi ayrıştırıcısı — `axum::extract::Query`'nin, hatayı **bu
/// API'nin gövde sözleşmesiyle** döndüren sarmalayıcısı.
///
/// # Neden var
/// Çıplak `Query` başarısız olduğunda `400 text/plain` ve **İngilizce axum
/// metni** döner (`Failed to deserialize query string: missing field 'q'`).
/// Bu, bu API'nin her yerde tuttuğu `{"hata": "..."}` sözleşmesini sessizce
/// bozar: arayüzün hata gösterme yolu gövdedeki `hata` alanını okur, bulamaz
/// ve kullanıcıya boş/yanlış bir mesaj gösterir. Aynı sessiz tutarsızlık
/// sınıfı için `api_bulunamadi` fallback'i zaten eklenmişti (bkz. `lib.rs`);
/// bu, o kuralın sorgu parametrelerindeki karşılığıdır.
///
/// # Kural: rota katmanında çıplak `Query` yok
/// Kural konulurken **zaten var olan ihlaller de arandı**: `/api/ara` ve
/// `/api/saklama-suresi-dolanlar` (Görev 7) ile `/api/randevular`,
/// `/api/cakisma`, `/api/randevular/seri/{id}` (Plan 2) ve
/// `/api/danisanlar/{id}/notlar` aynı hatayı veriyordu. Altısı da bu
/// sarmalayıcıya geçti; `tests/notlar_api.rs::rota_modulleri_ciplak_query_...`
/// bunu yapısal olarak sabitler.
///
/// # Neden alan adı mesaja konmuyor
/// Reddin ayrıntısı (`missing field 'q'`) axum/serde'nin iç metnidir; onu
/// gövdeye taşımak İngilizce sızıntısını kalıcılaştırırdı. Kullanıcı için
/// anlamlı olan, isteğin **hangi sınıf** hata olduğudur; alanın kendisi
/// zaten arayüzün kodunda sabittir.
pub struct Sorgu<T>(pub T);

impl<T, S> FromRequestParts<S> for Sorgu<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiHata;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match Query::<T>::from_request_parts(parts, state).await {
            Ok(Query(deger)) => Ok(Sorgu(deger)),
            // Reddin ic metni (`e.body_text()`) BILEREK kullanilmiyor:
            // Ingilizce ve axum surumune bagli.
            Err(_) => Err(istek_sorgusu_hatasi()),
        }
    }
}

/// `Sorgu`'nun tek red mesajı. Metin
/// `tests/notlar_api.rs::eksik_sorgu_parametresi_turkce_json_hata_dondurur`
/// tarafından HTTP seviyesinde pinlenir.
fn istek_sorgusu_hatasi() -> ApiHata {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "hata": "Sorgu parametreleri eksik veya geçersiz." })),
    )
}

/// Açık oturumun anahtarıyla veritabanı bağlantısı verir; kilitliyse `401`.
/// Başarılı her çağrı `Oturum::dokun()`'u tetikler (bkz. modül dokümantasyonu).
/// `Instant::now()` geçen ince bir sarmalayıcı -- gerçek istekler bunu kullanır.
pub fn acik_baglanti(state: &AppState) -> Result<Connection, ApiHata> {
    acik_baglanti_ile(state, Instant::now())
}

/// `acik_baglanti`'nin zamanı dışarıdan enjekte edilebilen hali. `core::session::Oturum`
/// da aynı gerekçeyle `Instant`'ı parametre alır: böylece testler gerçekten
/// beklemek zorunda kalmaz (bkz. Bulgu 2). Gerçek istekler `acik_baglanti`
/// üzerinden `Instant::now()` ile çağırır; testler bu fonksiyonu doğrudan,
/// kendi ürettikleri `Instant` değerleriyle çağırabilir.
pub fn acik_baglanti_ile(state: &AppState, now: Instant) -> Result<Connection, ApiHata> {
    let mut oturum = state.oturum.lock().unwrap_or_else(|e| e.into_inner());

    let anahtar = oturum.anahtar(now).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "hata": "Oturum kilitli. Lütfen parolanızı girin." })),
    ))?;

    // Kural 1: yalnızca burada, tam da erişimin fiilen VERİLDİĞİ an --
    // oturumu bu istek için "canlı" say ve boşta kalma sayacını sıfırla.
    oturum.dokun(now);
    drop(oturum);

    open_existing(&state.db_yolu(), &anahtar).map_err(veritabani_hatasi)
}

/// Tüm `DbError` varyantları -- `DosyaYok` dahil -- şu an aynı durum koduna
/// (`500`) eşleniyor: istemci tarafında bunları ayırt eden bir dal yok,
/// arayüz zaten gövdedeki Türkçe `hata` metnini olduğu gibi gösteriyor.
/// Önemli olan `DbError::DosyaYok`'un kendi `#[error(...)]` metninin
/// kullanıcıyı yedekten geri yüklemeye yönlendirmesi (bkz. `db.rs`) --
/// durum kodu değil, gövdedeki bu metin ayrımı taşıyor.
pub(crate) fn veritabani_hatasi(e: DbError) -> ApiHata {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
}

pub fn depo_hatasi(e: psikolog_core::store::clients::DepoHatasi) -> ApiHata {
    use psikolog_core::store::clients::DepoHatasi as D;
    match e {
        D::Bulunamadi => (StatusCode::NOT_FOUND, Json(json!({ "hata": "Kayıt bulunamadı." }))),
        D::GecersizVeri(m) => (StatusCode::BAD_REQUEST, Json(json!({ "hata": m }))),
        D::Sqlite(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use psikolog_core::crypto::keyring::{generate_data_key, KdfParams};
    use psikolog_core::store::{db::open_encrypted, schema::migrate};
    use std::time::Duration;

    /// Not editörünün 2 saniyede bir yapacağı otomatik kaydın maliyeti.
    ///
    /// Bu test bir eşik doğrulaması DEĞİL, bir ÖLÇÜMDÜR: makineye ve diske
    /// bağlı bir süreyi assert etmek bu kod tabanında zaten bir kez
    /// "ortama bağlı etkisizleşen test" olarak geri tepti. Bunun yerine iki
    /// senaryo aynı koşullarda ölçülür ve süreler `--nocapture` ile
    /// yazdırılır; **kararın kendisi** modül başlığında yorum olarak
    /// yazılıdır (bkz. "Bağlantı ömrü kararı"). Assertion yalnızca ölçümün
    /// gerçekten yapıldığını (30 yazmanın 30'unun da başarılı olduğunu)
    /// doğrular -- yoksa boş bir döngüyü ölçüyor olabilirdik.
    #[test]
    fn baglanti_omru_olcumu() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::yeni(
            dir.path().to_path_buf(),
            KdfParams { m_cost: 8, t_cost: 1, p_cost: 1 },
        );
        let anahtar = generate_data_key();
        {
            let c = open_encrypted(&state.db_yolu(), &anahtar).unwrap();
            migrate(&c).unwrap();
        }
        state
            .oturum
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .ac(anahtar.clone(), Instant::now());

        const YAZMA: usize = 30;

        // (1) Bugunku hal: her yazmada `acik_baglanti` -> taze SQLCipher
        // baglantisi, yazma, kapanista WAL checkpoint + WAL yikimi.
        let t0 = Instant::now();
        for i in 0..YAZMA {
            let conn = acik_baglanti(&state).expect("oturum acik olmali");
            conn.execute(
                "INSERT INTO app_meta (anahtar, deger) VALUES (?1, 'x')
                 ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
                [format!("taze_{i}")],
            )
            .unwrap();
            drop(conn);
        }
        let taze: Duration = t0.elapsed();

        // (2) Karsilastirma: ayni is, TEK baglanti uzerinde.
        let conn = acik_baglanti(&state).unwrap();
        let t1 = Instant::now();
        for i in 0..YAZMA {
            conn.execute(
                "INSERT INTO app_meta (anahtar, deger) VALUES (?1, 'x')
                 ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
                [format!("tekil_{i}")],
            )
            .unwrap();
        }
        let tekil: Duration = t1.elapsed();
        drop(conn);

        println!("--- baglanti omru olcumu ({YAZMA} otomatik kayit) ---");
        println!(
            "her yazmada taze baglanti : {:>8.2?} toplam, {:>8.3?} / yazma",
            taze,
            taze / YAZMA as u32
        );
        println!(
            "tek baglanti yeniden kull.: {:>8.2?} toplam, {:>8.3?} / yazma",
            tekil,
            tekil / YAZMA as u32
        );
        println!(
            "fark (baglanti acma bedeli): {:>8.3?} / yazma -- otomatik kayit araligi 2000ms",
            taze.saturating_sub(tekil) / YAZMA as u32
        );

        // Burada iki totolojik assertion vardi (`taze_yazilan == YAZMA`,
        // `tekil_yazilan == YAZMA`): sayaclar dongu icinde KOSULSUZ artiyordu,
        // dolayisiyla iddialar her zaman dogruydu ve hicbir sey korumuyordu.
        // Olcumun gercekten diske yazdigini kanitlayan is asagida yapiliyor.
        //
        // Bu bir OLCUM testidir, esik testi degil: zamana bagli bir assertion
        // (ornegin "taze < 2ms") CI'da kirilgan olurdu. Karar `guard.rs` modul
        // basligindaki tabloya dayanir.

        // WAL davranisi: son baglanti kapandiginda checkpoint calisip WAL
        // kuculur; veri kaybolmaz. Olculen senaryonun gercekten diske
        // yazdigini (bos bir donguyu olcmedigimizi) kanitlar.
        let c = open_encrypted(&state.db_yolu(), &anahtar).unwrap();
        let kalici: i64 = c
            .query_row("SELECT COUNT(*) FROM app_meta WHERE anahtar LIKE 'taze_%'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kalici as usize, YAZMA, "taze baglantiyla yazilanlar kalici olmali");
    }
}
