//! Geri yükleme uç noktaları — **bilerek kilit kapısının dışında**.
//!
//! # Neden `acik_baglanti` YOK (ve neden bu ayrı bir modül)
//!
//! Geri yüklemenin var oluş sebebi, oturumun **açılamadığı** durumdur.
//! Üç somut senaryo:
//!
//! 1. `veri.db` bozuk: `kilit_ac` bütünlük kontrolünü geçemiyor, oturum
//!    hiç açılmıyor (bkz. `store::db::butunluk_kontrol`).
//! 2. `keystore.json` okunamıyor: elde anahtar yok, `kilit_ac` denenemiyor
//!    bile (`KeystoreDurumu::Bozuk`).
//! 3. Bilgisayar değişti: veri dizini **boş**, kullanıcının elinde yalnızca
//!    yedek klasörü var. Bu senaryoda kullanıcının yapacağı en yıkıcı şey
//!    "yeniden kurulum"dur -- yeni kurulum yeni bir veri anahtarı üretir ve
//!    eskisinin yerine geçer; o andan sonra yedekteki kayıtlar da hiçbir
//!    parolayla açılamaz. Geri yükleme bu yüzden kurulum sihirbazının
//!    yanında, **kurulumdan önce** erişilebilir olmak zorunda.
//!
//! Üçünde de `guard::acik_baglanti` tanım gereği `401` dönerdi. Bu yüzden
//! bu iki handler `session.rs`/`setup.rs` ile aynı sınıftadır ve
//! `notlar_api.rs::VERI_DISI_ROTALAR` istisnasındadır.
//!
//! **Yedek ALMA aynı modülde değil** (`routes::backup`): o, danışan
//! verisinin tamamının kopyasını üretir ve kilitli oturumda yapılmamalıdır.
//! İkisini tek modülde toplamak, kapısız bir modülde kapı isteyen bir
//! handler bulundurmak olurdu -- yapısal testin tam olarak engellediği şey.
//!
//! # Yetki: parola/kurtarma kodu, oturum değil
//!
//! Geri yükleme kapısız ama **yetkisiz değildir**: çağıran, geri
//! yüklenecek yedeğin **kendi anahtar dosyasını** açabilen parolayı (ya da
//! kurtarma kodunu) vermek zorundadır. Anahtar oradan çıkar; açık oturumun
//! anahtarı KULLANILMAZ. Bu yalnızca bir yetki kontrolü değil, doğru olan
//! da budur: yeni bir bilgisayarda yerel anahtar başka bir anahtardır ve
//! yedeği açmaz.
//!
//! # Listeleme neden kapısız
//!
//! "Hangi yedeklerim var" sorusu tam da kilitliyken sorulur. Yanıt yalnızca
//! **dosya adı, tarih ve boyut** taşır; danışan verisi yoktur ve yedekler
//! zaten şifrelidir. Klasör yolu, `/api/durum`'un `veri_dizini` alanıyla
//! aynı gerekçeyle döndürülüyor: kullanıcıya "şu klasörü açın" diyebilmek
//! için gerekli, sunucu yalnızca `127.0.0.1`'de dinliyor ve hassas olan
//! şey klasörün adı değil içindeki anahtardır.
//!
//! # Yol gövdede, sorgu dizesinde DEĞİL
//!
//! Klasör yolu (`/Users/ayse/Dropbox/...`) kullanıcının **adını**
//! içerebilir. `routes::attachments`'ın dosya adı için verdiği kararın
//! aynısı: URL'ler tarayıcı geçmişine, adres çubuğuna ve genel amaçlı
//! erişim günlüklerine düşer; gövdeler düşmez. Bu yüzden listeleme de
//! `POST` ve yolu gövdede alıyor.

use crate::guard::ApiHata;
use crate::routes::backup::yedek_hatasi;
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::backup::{
    ayarlari_oku, geri_yukle, keystore_yedek_yolu, yedekleri_listele, YedekHatasi, VARLIK,
};
use psikolog_core::crypto::keyring::CryptoError;
use psikolog_core::store::{
    audit::{kaydet, Cihaz, Eylem, LogHacmi},
    db::open_existing,
    keystore,
    schema::MigrateHatasi,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Arayüze giden yedek özeti — **mutlak yol taşımaz**.
///
/// `core::backup::YedekBilgisi` bilerek `Serialize` türetmiyor; bu tip onun
/// dar karşılığıdır. `dosya_adi` aynı zamanda geri yükleme isteğinin
/// tanıtıcısıdır: istemci hiçbir zaman bir yol göndermez, yalnızca bu adı
/// geri gönderir ve sunucu onu klasörle kendisi birleştirir.
#[derive(Serialize)]
pub struct YedekOzeti {
    pub dosya_adi: String,
    pub tarih: String,
    pub boyut: u64,
}

#[derive(Deserialize, Default)]
pub struct ListeIstegi {
    /// Bakılacak klasör. Verilmezse kayıtlı yedek klasörü kullanılır.
    ///
    /// Verilen klasör **ayar olarak kaydedilmez**: başka bir klasöre göz
    /// atmak, yedeklerin bundan sonra oraya alınacağı anlamına gelmemeli.
    /// Hedef klasörü değiştirmenin tek yolu `POST /api/yedek`'tir ve o
    /// değişiklikle birlikte oraya gerçekten bir yedek yazılır.
    pub dizin: Option<String>,
}

#[derive(Deserialize)]
pub struct GeriYuklemeIstegi {
    pub dizin: Option<String>,
    /// Geri yüklenecek yedeğin dosya adı (`yedek-YYYY-AA-GG.db`).
    pub dosya_adi: String,
    /// **O yedeğin alındığı tarihteki** parola.
    pub parola: Option<String>,
    /// Ya da kurtarma kodu. Kurtarma sarmalaması parola değişiminde
    /// korunduğu için (bkz. `keystore::change_password`) eski bir yedeği de
    /// açar.
    pub kurtarma_kodu: Option<String>,
}

fn istek_hatasi(kod: StatusCode, mesaj: &str) -> ApiHata {
    (kod, Json(json!({ "hata": mesaj })))
}

/// Bir `YedekHatasi`'nin içindeki göç hatasını çıkarır (varsa).
///
/// Göç hatası `GeriAlmaYarimKaldi` tarafından sarılmış olabilir; log,
/// sarmalama yüzünden kaybolmamalı.
fn goc_hatasi(e: &YedekHatasi) -> Option<&MigrateHatasi> {
    match e {
        YedekHatasi::YedekHazirlanamadi(goc) => Some(goc),
        YedekHatasi::GeriAlmaYarimKaldi(ic) => goc_hatasi(ic),
        _ => None,
    }
}

/// `YedekHatasi::YedekHazirlanamadi`'yi HTTP yanıtına çevirir (Görev 6c).
///
/// # Neden `SurumDusuk` burada AYRI
///
/// `yedek_hatasi` (bkz. `routes::backup`) `YedekHazirlanamadi`'nin TÜM
/// `MigrateHatasi` varyantlarını tek bir "veritabanı bu uygulama
/// sürümüyle hazırlanamadı" metnine düzleştirir -- bilerek: göç hatasının
/// DETAYI (SQLite dizgileri, `app_meta` içeriği) hassas bir kaynaktan
/// gelebilir ve gövdeye giremez (bkz. `backup::YedekHatasi::
/// YedekHazirlanamadi` dokümantasyonu).
///
/// Ama bu modülün kendi ilkesi "eksik ≠ bozuk ≠ yanlış anahtar" ve
/// `SurumDusuk`'un mesajı HİÇBİR hassas veri taşımaz -- yalnızca iki tam
/// sayı (şema sürümü). `SurumDusuk` ayrıca `YedekIleriSurumlu`'yla AYNI
/// sınıf bir durumdur ("yedeğinizde sorun yok, uygulamayı güncelleyin")
/// ve o varyant zaten kendi yol gösteren mesajını alıyor (bkz.
/// `backup::yerlestir` 3b) -- `SurumDusuk`'u genel "hazırlanamadı"
/// metnine gömmek aynı durumu iki farklı, tutarsız cümleyle anlatırdı.
///
/// Bu, ikinci bir savunma hattı: `backup::yerlestir`'deki `SurumDusuk`
/// kontrolü (Görev 1) normal akışta yedeği yerleştirmeden ÖNCE zaten
/// yakalar. Burası yalnızca o kontrolün atlandığı bir kenar durum için.
fn migrate_hatasina_gore_yanit(e: YedekHatasi) -> ApiHata {
    if let YedekHatasi::YedekHazirlanamadi(MigrateHatasi::SurumDusuk { veritabani, uygulama }) = &e
    {
        return istek_hatasi(
            StatusCode::CONFLICT,
            &format!(
                "Bu yedek geri yüklenemedi: veritabanı, uygulamanın desteklediğinden daha \
                 yeni bir şema sürümüyle hazırlanmış (veritabanı: sürüm {veritabani}, \
                 uygulama: sürüm {uygulama}). Yedeğinizde bir sorun YOK; onu geri \
                 yükleyebilmek için uygulamayı güncelleyin. Mevcut veritabanınız ve anahtar \
                 dosyanız yerine geri kondu; hiçbir veriniz kaybolmadı."
            ),
        );
    }
    yedek_hatasi(e)
}

/// İsteğin klasörünü çözer: verilen yol ya da kayıtlı ayar.
fn dizini_coz(s: &AppState, verilen: &Option<String>) -> Result<PathBuf, ApiHata> {
    let ham = match verilen {
        Some(y) if !y.trim().is_empty() => y.trim().to_string(),
        _ => ayarlari_oku(&s.veri_dizini).hedef_dizin.unwrap_or_default(),
    };
    if ham.trim().is_empty() {
        return Err(istek_hatasi(
            StatusCode::BAD_REQUEST,
            "Yedek klasörü belli değil. Yedeklerinizin bulunduğu klasörün yolunu yazın.",
        ));
    }
    Ok(PathBuf::from(ham))
}

/// `dosya_adi`'nın **yalnızca** `yedek-YYYY-AA-GG.db` biçiminde olduğunu
/// doğrular ve klasörle birleştirir.
///
/// # Neden ham birleştirme YETMEZ
/// İstemciden gelen bir ad `..`, `/` veya `C:\` içerebilir; `Path::join`
/// mutlak bir yol verildiğinde taban yolu **tümüyle atar**. Doğrulama
/// olmadan `{"dosya_adi": "../../keystore.json"}` gibi bir istek, geri
/// yükleme kaynağı olarak veri dizinindeki dosyaları gösterebilirdi.
/// Biçim dar tutuluyor: `yedek_al` zaten yalnızca bu adı üretir.
fn yedek_yolunu_coz(dizin: &Path, dosya_adi: &str) -> Result<PathBuf, ApiHata> {
    // `yedek-` (6) + `YYYY-AA-GG` (10) + `.db` (3) = 19.
    let gecerli = dosya_adi.len() == 19
        && dosya_adi.starts_with("yedek-")
        && dosya_adi.ends_with(".db")
        && {
            let t = &dosya_adi[6..16];
            let b = t.as_bytes();
            b[4] == b'-'
                && b[7] == b'-'
                && b[0..4].iter().all(u8::is_ascii_digit)
                && b[5..7].iter().all(u8::is_ascii_digit)
                && b[8..10].iter().all(u8::is_ascii_digit)
        };
    if !gecerli {
        // Ham ad mesaja KONMAZ (bir yol parçası olabilir; `attachments`'ın
        // dosya adı kararıyla aynı sınıf).
        return Err(istek_hatasi(
            StatusCode::BAD_REQUEST,
            "Geçersiz yedek adı. Listeden bir yedek seçin.",
        ));
    }
    Ok(dizin.join(dosya_adi))
}

/// Klasördeki geri yüklenebilir yedekleri listeler (`POST /api/yedekler`).
///
/// Yalnızca **iki dosyası da yerinde** olan yedekler döner
/// (`yedekleri_listele`): anahtarsız bir yedeği listede göstermek,
/// kullanıcının felaket anında var olmayan bir kurtarma seçeneğine
/// güvenmesi demektir.
pub async fn listele(
    State(s): State<AppState>,
    Json(istek): Json<ListeIstegi>,
) -> Result<Json<Value>, ApiHata> {
    let dizin = dizini_coz(&s, &istek.dizin)?;
    let liste = yedekleri_listele(&dizin).map_err(yedek_hatasi)?;
    let ozetler: Vec<YedekOzeti> = liste
        .into_iter()
        .map(|b| YedekOzeti {
            dosya_adi: b
                .yol
                .file_name()
                .map(|a| a.to_string_lossy().into_owned())
                .unwrap_or_default(),
            tarih: b.tarih,
            boyut: b.boyut,
        })
        .collect();
    Ok(Json(json!({
        "hedef_dizin": dizin.display().to_string(),
        "yedekler": ozetler,
    })))
}

/// Bir yedek çiftini geri yükler (`POST /api/geri-yukleme`).
///
/// Sıra `core::backup::geri_yukle`'nin sözleşmesidir: **önce tam
/// doğrulama, sonra yerleştirme.** Bu handler onun önüne bir adım daha
/// koyar -- yedeğin **kendi** anahtar dosyasını istekteki parolayla açar.
/// Bu, aynı anda üç işi birden yapar:
///
/// 1. Yetkilendirme (kapısız uç noktanın kapısı).
/// 2. Doğru anahtarı bulma: yeni bir bilgisayarda yerel anahtar başka bir
///    anahtardır; oturumun anahtarıyla denemek geçerli bir yedeği "bozuk"
///    diye reddederdi.
/// 3. Yedeğin gerçekten açılabilir olduğunu **yerleştirmeden önce**
///    kanıtlama.
///
/// # Oturum AÇILMAZ
/// Başarılı geri yükleme oturumu açmaz; kullanıcı kilit ekranına döner ve
/// o yedeğin tarihindeki parolasıyla girer. `giris` satırını yazan tek yer
/// `kilit_ac` olarak kalır.
pub async fn uygula(
    State(s): State<AppState>,
    Json(istek): Json<GeriYuklemeIstegi>,
) -> Result<Json<Value>, ApiHata> {
    let dizin = dizini_coz(&s, &istek.dizin)?;
    let yedek_yolu = yedek_yolunu_coz(&dizin, &istek.dosya_adi)?;
    let tarih = istek.dosya_adi[6..16].to_string();

    // 1) Yedeğin KENDİ anahtar dosyası. "Eksik" ile "bozuk" ayrı hatalar
    //    (bkz. `YedekHatasi` belgesi); ikisi de "parola hatalı" DEĞİL.
    let yedek_ks_yolu = keystore_yedek_yolu(&yedek_yolu);
    if !yedek_ks_yolu.exists() {
        return Err(yedek_hatasi(YedekHatasi::YedekEksik(
            psikolog_core::backup::EksikParca::Keystore,
        )));
    }
    let yedek_ks = keystore::load(&yedek_ks_yolu)
        .map_err(|_| yedek_hatasi(YedekHatasi::BozukKeystore))?;
    if !keystore::yapisal_gecerli_mi(&yedek_ks) {
        return Err(yedek_hatasi(YedekHatasi::BozukKeystore));
    }

    // 2) Parola/kurtarma kodu. `kilit_ac` ile BİREBİR aynı ayrım: yalnızca
    //    `WrongSecret` gerçekten yanlış paroladır; `Format`/`Kdf`/
    //    `Encryption` kullanıcı hatası değildir ve "parolanız yanlış"
    //    denirse kullanıcı sağlam bir yedeği silmeye/kurulum yapmaya
    //    gidebilir.
    let sonuc = match (&istek.parola, &istek.kurtarma_kodu) {
        (Some(p), _) => keystore::unlock_with_password(&yedek_ks, p),
        (_, Some(k)) => keystore::unlock_with_recovery(&yedek_ks, k),
        _ => {
            return Err(istek_hatasi(
                StatusCode::BAD_REQUEST,
                "Bu yedeğin alındığı tarihteki parolayı ya da kurtarma kodunuzu girin.",
            ))
        }
    };
    let anahtar = match sonuc {
        Ok(k) => k,
        Err(CryptoError::WrongSecret) => {
            return Err(istek_hatasi(
                StatusCode::UNAUTHORIZED,
                "Bu yedek bu parolayla açılmıyor. Yedek, ALINDIĞI TARİHTEKİ parolanızla açılır; \
                 parolanızı o tarihten sonra değiştirdiyseniz eskisini deneyin ya da kurtarma \
                 kodunuzu kullanın. Hiçbir şey değiştirilmedi.",
            ))
        }
        Err(CryptoError::Format(_) | CryptoError::Kdf(_) | CryptoError::Encryption(_)) => {
            return Err(yedek_hatasi(YedekHatasi::BozukKeystore))
        }
    };

    // 3) Asıl geri yükleme -- **şema göçü dâhil**. Doğrulama bitene kadar
    //    mevcut `veri.db` ve `keystore.json` dosyalarına dokunulmaz;
    //    yerleştirmenin herhangi bir adımı (göç de bir adım) yarıda kalırsa
    //    hepsi geri alınır.
    //
    //    # Göç neden ARTIK burada çağrılmıyor
    //    Eskiden bu satırdan sonra ayrıca `migrate` çağrılıyordu ve tam da
    //    o sıra veri kaybının sebebiydi: `geri_yukle` dönmüş, yani
    //    `veri.db.onceki` silinmiş oluyordu; göç orada patlayınca (ileri
    //    sürümlü yedek, eksi ücretli randevu taşıyan eski yedek, ...)
    //    kullanıcının o gün girdiği, henüz yedeklenmemiş notları kalıcı
    //    olarak yok oluyordu. Göç, geri alma mekanizmasıyla aynı yerde --
    //    `core::backup::yerlestir`'de -- yaşamak zorunda; buradan ikinci
    //    kez çağırmak o garantiyi VERMEZ, yalnızca tekrar eder.
    geri_yukle(&yedek_yolu, &s.db_yolu(), &s.keystore_yolu(), &anahtar).map_err(|e| {
        // Göç hatasının DETAYI yanıt gövdesine girmiyor (gerekçe:
        // `YedekHatasi::YedekHazirlanamadi`), ama sunucu loguna düşmeli.
        // Kardeş çağrı yerleri -- `session::kilit_ac` ve `setup::kurulum` --
        // aynı `MigrateHatasi`'yi logluyor; geri yükleme, göçün log
        // bırakmayan tek çağrı yeri olmamalı. Aksi hâlde `UcretKisitiIhlali`
        // gibi tam olarak ne yapılacağını söyleyen bir varyant hiçbir yerde
        // görünmezdi.
        if let Some(goc) = goc_hatasi(&e) {
            eprintln!("geri-yukleme: göç başarısız: {goc}");
        }
        // `SurumDusuk` genel metne düzleştirilmez, yol gösteren kendi
        // mesajını alır (Görev 6c, bkz. `migrate_hatasina_gore_yanit`).
        migrate_hatasina_gore_yanit(e)
    })?;

    // 4) Denetim kaydı geri yüklenen veritabanına yazılır -- başka bir yere
    //    yazılamaz da: eski veritabanı artık yerinde değil. Şema `geri_yukle`
    //    içinde güncellendiği için bağlantı doğrudan kullanılabilir.
    //
    //    Bu satırı çekirdek DEĞİL, rota yazıyor. `routes::backup`'ta tersi
    //    yapıldı (`yedek_al_ve_kaydet`) ve fark gerçek: yedek alırken elde
    //    açık bir bağlantı VAR, geri yüklerken bağlantı ancak işlem
    //    bittikten sonra kurulabilir. Bu, `session.rs`/`setup.rs`'in
    //    `giris`/`kurulum` satırlarını kendilerinin yazmasıyla aynı sınıf:
    //    satırın kaynağı burasıdır.
    let conn = open_existing(&s.db_yolu(), &anahtar).map_err(crate::guard::veritabani_hatasi)?;
    kaydet(&conn, Eylem::GeriYukleme, VARLIK, &tarih, Cihaz::Masaustu, None, LogHacmi::HerCagri)
        .map_err(|_| {
            yedek_hatasi(YedekHatasi::KayitYazilamadi(
                "Geri yükleme tamamlandı ama denetim kaydına yazılamadı.",
            ))
        })?;

    // Oturum her hâlükârda kilitlenir: elde tutulan anahtar artık BAŞKA bir
    // veritabanına aitti. Kilitlemeden bırakmak, açık bir oturumun geri
    // yüklenen dosyayı yanlış anahtarla açmaya çalışması demekti.
    s.oturum.lock().unwrap_or_else(|e| e.into_inner()).kilitle();

    Ok(Json(json!({ "tarih": tarih })))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `SurumDusuk` genel "hazırlanamadı" metnine düzleşmemeli: kendi yol
    /// gösteren cümlesini almalı (Görev 6c). Mutasyon: bu özel durumu
    /// silip doğrudan `yedek_hatasi(e)` çağırmak -- test 409 yerine 500,
    /// "güncelleyin" yerine genel "hazırlanamadı" metniyle kırmızıya döner.
    #[test]
    fn surum_dusuk_yol_gosteren_kendi_mesajini_alir() {
        let e = YedekHatasi::YedekHazirlanamadi(MigrateHatasi::SurumDusuk {
            veritabani: 9,
            uygulama: 5,
        });
        let (kod, govde) = migrate_hatasina_gore_yanit(e);
        assert_eq!(kod, StatusCode::CONFLICT);
        let mesaj = govde.0["hata"].as_str().unwrap().to_string();
        assert!(mesaj.contains("güncelleyin"), "mesaj: {mesaj}");
        assert!(mesaj.contains("sürüm 9"), "mesaj: {mesaj}");
        assert!(mesaj.contains("sürüm 5"), "mesaj: {mesaj}");
        // Genel "hazırlanamadı" düzleştirme metniyle KARIŞMAMALI -- bu ikisi
        // farklı, birbirine karıştırılmaması gereken durumlardır.
        assert!(!mesaj.contains("hazırlanamadı"), "mesaj: {mesaj}");
    }

    /// `SurumDusuk` DIŞINDAKİ varyantlar hâlâ genel `yedek_hatasi`
    /// düzleştirmesinden geçer -- bu modülün "hata gövdesi hassas veri
    /// taşımaz" kuralı yalnızca `SurumDusuk` için gevşetildi, diğerleri
    /// için değil.
    #[test]
    fn ucret_kisiti_ihlali_genel_metne_duzlesir() {
        let e = YedekHatasi::YedekHazirlanamadi(MigrateHatasi::UcretKisitiIhlali { adet: 3 });
        let (kod, govde) = migrate_hatasina_gore_yanit(e);
        assert_eq!(kod, StatusCode::CONFLICT);
        let mesaj = govde.0["hata"].as_str().unwrap().to_string();
        assert!(mesaj.contains("hazırlanamadı"), "mesaj: {mesaj}");
        assert!(!mesaj.contains("güncelleyin"), "mesaj: {mesaj}");
    }
}
