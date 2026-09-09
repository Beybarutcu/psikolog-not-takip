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
//! 30 otomatik kaydı (aç + yaz + kapat) simüle eder, aynı işi TEK bir
//! bağlantıyla tekrarlayıp süreleri karşılaştırır ve — dal incelemesinden
//! beri — aynı ölçümü **20 MB'lık ekler yazma yolundayken** de yapar (bkz.
//! aşağıdaki "Koşul GERÇEKLEŞTİ" başlığı). Ölçüm makinesi:
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
//! # Koşul GERÇEKLEŞTİ: ekler yazma yoluna girdi (dal incelemesi)
//!
//! Yukarıdaki karar şartlıydı: *"yeniden gözden geçirilmelidir eğer … ekli
//! dosyalar (20 MB'a kadar BLOB) yazma yoluna girip her isteğin WAL'ını
//! büyütürse"*. Ekler Görev 5+7'de tam olarak o yola girdi
//! (`POST /api/danisanlar/{id}/ekler` → `acik_baglanti` → 20 MB'lık BLOB) ve
//! **ölçüm tekrarlanmadı**: tetikleyici bir koruma değil, bir cümleydi. Bu
//! sınıfın kendisi de düzeltildi — koşul artık
//! `tests::ekler_yazma_yolundaysa_olcum_blob_senaryosunu_da_icermeli` ile
//! **çalıştırılabilir**: ekler yazma yolundan çıkarsa da, ölçümden BLOB
//! senaryosu silinirse de test kırılır.
//!
//! **Ölçüm BLOB'lu senaryoyla tekrarlandı** (aynı makine ve profil, dört
//! ardışık koşu; `--nocapture` çıktısı için bkz. dal-incelemesi raporu):
//!
//! | Senaryo                                          | ölçülen            |
//! |--------------------------------------------------|--------------------|
//! | Küçük yazma, taze bağlantı — ekler YOKKEN         | 5,36-6,14 ms/yazma |
//! | Küçük yazma, tek bağlantı                        | 0,57-0,62 ms/yazma |
//! | 20 MB ek yazma, taze bağlantı                    | 297-362 ms/ek      |
//! | Küçük yazma, taze bağlantı — ~40 MB ek VARKEN    | 5,40-6,24 ms/yazma |
//!
//! **Karar: değişmiyor** — ve gerekçe "hâlâ geçerli" demek değil, ölçülen
//! şudur:
//!
//! 1. **Otomatik kaydın maliyeti değişmedi.** Veritabanı ~40 MB'lık iki ek
//!    aldıktan sonra da yazma başına süre aynı bandta kaldı (5,4-6,2 ms;
//!    ölçüm gürültüsünün içinde). Beklenen sonuç bu: her istek kendi
//!    bağlantısını kapatıyor, kapanışta checkpoint çalışıyor ve WAL
//!    **küçülüyor** — yani "her isteğin WAL'ı büyür" korkusu tam olarak
//!    taze bağlantı düzeninde gerçekleşmiyor. Havuzlanmış bir bağlantıda
//!    ise WAL, checkpoint'e kadar birikirdi; bu ölçüm havuzlama lehine
//!    değil, **aleyhine** bir bulgu.
//! 2. **20 MB'lık ek yazmanın kendisi pahalı (~0,3 sn)** ama bu maliyet
//!    bağlantı açmaktan gelmiyor: 5 ms'lik bağlantı bedeli o sürenin
//!    %1,5'i. Havuzlama bu işlemi ölçülebilir biçimde hızlandırmazdı.
//!    Ayrıca ek yükleme **kullanıcı tetiklemeli ve seyrek** bir işlem
//!    (dosya seç → Yükle), 2 saniyede bir çalışan bir arka plan işi değil.
//!
//! Bu karar yeniden gözden geçirilmelidir eğer: otomatik kayıt aralığı 2
//! saniyenin çok altına inerse, ham gövde (`Bytes`) alan **yeni** bir rota
//! modülü yazma yoluna girerse (yukarıdaki test bunu yakalar), ya da ölçüm
//! yavaş bir diskte (ağ sürücüsü, senkronizasyon klasörü) tekrarlandığında
//! yazma başına fark 100 ms'yi aşarsa.

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
    use psikolog_core::store::attachments::AZAMI_DOSYA_BOYUTU;
    use psikolog_core::store::audit::Cihaz;
    use psikolog_core::store::clients::YeniDanisan;
    use psikolog_core::store::{db::open_encrypted, schema::migrate};
    use std::time::Duration;

    /// Ölçümdeki ek dosyanın boyutu — sınırın (`AZAMI_DOSYA_BOYUTU`, 20 MB)
    /// hemen altı. "20 MB'a kadar BLOB" koşulunun EN KÖTÜ hâli ölçülmeli;
    /// küçük bir dosyayla yapılan ölçüm soruyu yanıtlamazdı.
    const BLOB_BOYUTU: usize = AZAMI_DOSYA_BOYUTU - 1024;

    /// Kaç ek yazılacağı. Sayı küçük, çünkü ölçülen şey "kaç ek" değil,
    /// **eklerin varlığının küçük yazmaların maliyetini değiştirip
    /// değiştirmediği**; iki ek zaten ~40 MB'lık bir veritabanı üretiyor.
    const BLOB_YAZMA: usize = 2;

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
        drop(c);

        // =============================================================
        // (3) EKLER YAZMA YOLUNDA -- kararin KOSULU gerceklesti
        // =============================================================
        //
        // Modul basligindaki karar sartliydi: *"yeniden gozden gecirilmelidir
        // eger ... ekli dosyalar (20 MB'a kadar BLOB) yazma yoluna girip her
        // istegin WAL'ini buyuturse"*. Gorev 5+7'de tam olarak o oldu ve
        // olcum tekrarlanmadi -- cunku tetikleyici bir koruma degil, bir
        // CUMLEYDI. Asagisi o cumlenin calistirilabilir hali; kardes test
        // (`ekler_yazma_yolundaysa_olcum_blob_senaryosunu_da_icermeli`) bu
        // blogun varligini kosula BAGLAR.
        let conn = acik_baglanti(&state).unwrap();
        let cid = psikolog_core::store::clients::ekle(
            &conn,
            &YeniDanisan { ad_soyad: "Olcum Danisani".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap()
        .id;
        drop(conn);

        let icerik = vec![0x41u8; BLOB_BOYUTU];
        let t2 = Instant::now();
        for i in 0..BLOB_YAZMA {
            let conn = acik_baglanti(&state).expect("oturum acik olmali");
            psikolog_core::store::attachments::ekle(
                &conn,
                cid,
                &format!("olcum-{i}.pdf"),
                "application/pdf",
                "diger",
                &icerik,
                Cihaz::Masaustu,
            )
            .unwrap();
            drop(conn);
        }
        let blob: Duration = t2.elapsed();

        // (4) ASIL SORU: ekler veritabanindayken, not editorunun 2 sn'lik
        // otomatik kaydi pahalilasti mi? (1) ile BIREBIR ayni is, yalnizca
        // veritabani artik ~40 MB.
        let t3 = Instant::now();
        for i in 0..YAZMA {
            let conn = acik_baglanti(&state).expect("oturum acik olmali");
            conn.execute(
                "INSERT INTO app_meta (anahtar, deger) VALUES (?1, 'x')
                 ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
                [format!("blob_sonrasi_{i}")],
            )
            .unwrap();
            drop(conn);
        }
        let taze_blob_sonrasi: Duration = t3.elapsed();

        // Etiket DIZGI OLARAK burada duruyor (sabite dolayli
        // gonderme degil): kardes tetikleyici test olcum govdesini bu
        // dizgiyle ariyor ve bir sabite yapilan gonderme, govdeden
        // gorunmezdi.
        println!("--- ekler yazma yolunda (20 MB BLOB) olcumu ---");
        println!(
            "{BLOB_YAZMA} x {:.1} MB ek (taze baglanti) : {:>8.2?} toplam, {:>8.3?} / ek",
            BLOB_BOYUTU as f64 / (1024.0 * 1024.0),
            blob,
            blob / BLOB_YAZMA as u32
        );
        println!(
            "ekler yazildiktan SONRA {YAZMA} kucuk yazma: {:>8.2?} toplam, {:>8.3?} / yazma",
            taze_blob_sonrasi,
            taze_blob_sonrasi / YAZMA as u32
        );
        println!(
            "otomatik kayit maliyetindeki degisim : {:>8.3?} / yazma (once {:>8.3?})",
            taze_blob_sonrasi / YAZMA as u32,
            taze / YAZMA as u32
        );

        // Olcumun gercekten 40 MB yazdigini kanitlar: BLOB'lar diskte ve
        // TAM boyutunda. Bu olmadan yukaridaki sureler bos bir donguyu
        // olcuyor olabilirdi (ayni gerekce (1) icin de yazilmisti).
        let c = open_encrypted(&state.db_yolu(), &anahtar).unwrap();
        let (adet, toplam_bayt): (i64, i64) = c
            .query_row("SELECT COUNT(*), COALESCE(SUM(boyut), 0) FROM attachments", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(adet as usize, BLOB_YAZMA, "ekler gercekten yazilmali");
        assert_eq!(
            toplam_bayt as usize,
            BLOB_BOYUTU * BLOB_YAZMA,
            "olculen sey gercekten ~40 MB'lik BLOB olmali"
        );
        let sonraki: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM app_meta WHERE anahtar LIKE 'blob_sonrasi_%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sonraki as usize, YAZMA, "BLOB sonrasi kucuk yazmalar da kalici olmali");
    }

    /// **Koşullu kararın tetikleyicisi ÇALIŞTIRILABİLİR olmalı.**
    ///
    /// # Bulgu (dal incelemesi, on üçüncü biçim)
    ///
    /// Bağlantı ömrü kararı (Görev 2) şöyle şartlandırılmıştı: *"Bu karar
    /// yeniden gözden geçirilmelidir eğer … ekli dosyalar (20 MB'a kadar
    /// BLOB) yazma yoluna girip her isteğin WAL'ını büyütürse."* Ekler Görev
    /// 5+7'de tam olarak o yola girdi. Ölçüm tekrarlanmadı, kimse fark
    /// etmedi, ledger'da iz kalmadı — çünkü tetikleyicinin kendisi bir
    /// koruma değil, bir **cümleydi**.
    ///
    /// # Kurulan yöntem
    ///
    /// Bu kod tabanı kararlarını yorumlara yazıyor ve bu genelde işe
    /// yarıyor. Ama **koşullu** bir karar yazıldığında koşulun kendisi de
    /// çalıştırılabilir olmalı. Aşağıdaki test tam olarak bunu yapar ve iki
    /// tarafı da sabitler:
    ///
    /// 1. **Koşul bugün doğru mu?** Rota katmanında ham gövde (`Bytes`)
    ///    alıp `acik_baglanti` yazma yolundan geçen bir modül var mı? Bugün
    ///    `routes/attachments.rs`. Küme `server/src/routes/` **dizininden**
    ///    okunuyor, yani yarın eklenecek bir `import.rs` de koşulu
    ///    tetikler (kardeş yapısal testlerle aynı gerekçe).
    /// 2. **Koşul doğruysa ölçüm BLOB senaryosunu içeriyor mu?**
    ///
    /// İki yön de kırılabilir: ekler yazma yolundan çıkarsa (1) kırılır ve
    /// karar metni yeniden gözden geçirilmeye zorlanır; ölçümden BLOB
    /// senaryosu silinirse (2) kırılır.
    #[test]
    fn ekler_yazma_yolundaysa_olcum_blob_senaryosunu_da_icermeli() {
        let dizin = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/routes");
        let mut ham_govde_yazanlar: Vec<String> = Vec::new();
        let mut dosya_sayisi = 0usize;
        for girdi in std::fs::read_dir(&dizin).expect("routes dizini okunamadi") {
            let yol = girdi.expect("dizin girdisi").path();
            if yol.extension().and_then(|u| u.to_str()) != Some("rs") {
                continue;
            }
            let ad = yol.file_name().unwrap().to_string_lossy().into_owned();
            if ad == "mod.rs" {
                continue;
            }
            dosya_sayisi += 1;
            let kaynak = std::fs::read_to_string(&yol).expect("rota kaynagi okunamadi");
            // Yorumlar kuralin KENDISINDEN bahsedebilir (kardes yapisal
            // testlerle ayni eleme).
            let kod: String = kaynak
                .lines()
                .filter(|l| !l.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            if kod.contains("acik_baglanti") && kod.contains("Bytes") {
                ham_govde_yazanlar.push(ad);
            }
        }
        assert!(dosya_sayisi >= 8, "rota dizini turetilememis");

        // (1) KOSUL: bugun DOGRU. Yanlisa donerse -- ekler yazma yolundan
        // cikarsa -- karar metnindeki gerekce de yeniden yazilmali; bu
        // satir o ani yakalar.
        assert_eq!(
            ham_govde_yazanlar,
            vec!["attachments.rs".to_string()],
            "ham govde (`Bytes`) yazma yoluna giren rota modulleri degisti: karar \
             metnindeki kosul ve `baglanti_omru_olcumu` birlikte gozden gecirilmeli"
        );

        // (2) YUKUMLULUK: kosul dogruysa olcum BLOB senaryosunu da olcmeli.
        //
        // BLOB senaryosunun olcum ciktisindaki etiketi.
        const BLOB_SENARYO_ETIKETI: &str = "ekler yazma yolunda (20 MB BLOB) olcumu";

        // YALNIZCA olcum fonksiyonunun govdesi taranir, dosyanin tamami
        // DEGIL: bu testin kendi iddia dizgileri (yukaridaki sabit,
        // `"attachments::ekle"`) dosyada zaten geciyor ve tam dosya
        // taramasi kendi kendini dogrulayan bir TOTOLOJI olurdu -- olcum
        // tumuyle silinse bile test gecerdi. Sinir: olcum fonksiyonunun
        // basindan BIR SONRAKI `#[test]`e kadar.
        let bu_dosya = include_str!("guard.rs");
        let olcum = bu_dosya
            .split("fn baglanti_omru_olcumu")
            .nth(1)
            .expect("`baglanti_omru_olcumu` bulunamadi -- olcum tumuyle silinmis")
            .split("#[test]")
            .next()
            .expect("bolme her zaman en az bir parca verir");
        // Sinir gercekten tuttu mu: olcum govdesi bu testin KENDISINI
        // kapsamamali, yoksa tarama yine totolojiye donerdi.
        assert!(
            !olcum.contains("fn ekler_yazma_yolundaysa"),
            "olcum govdesi ayiklanamadi (sinir kaydi); tarama totolojiye donusurdu"
        );

        assert!(
            olcum.contains(BLOB_SENARYO_ETIKETI),
            "ekler yazma yolunda ama `baglanti_omru_olcumu` BLOB senaryosunu olcmuyor"
        );
        // Etiket tek basina yeterli degil: olcum gercekten ek YAZMALI.
        assert!(
            olcum.contains("attachments::ekle") && olcum.contains("BLOB_BOYUTU"),
            "BLOB senaryosu etiketi var ama gercek bir ek yazmiyor"
        );
    }
}
