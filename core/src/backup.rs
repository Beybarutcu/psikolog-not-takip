//! Yedekleme: bir yedek **iki dosyadan oluşur** ve ikisi ayrılamaz.
//!
//! `veri.db` SQLCipher ile şifrelidir; onu açan veri anahtarı yalnızca
//! `keystore.json` içinde, parola ve kurtarma koduyla sarmalanmış olarak
//! bulunur. Parola da kurtarma kodu da tek başına bir veritabanını açmaz —
//! ikisi de sadece o dosyadaki sarmalamayı çözer. Dolayısıyla `keystore.json`
//! olmadan alınan bir "yedek" hiçbir koşulda geri yüklenemez; disk bozulursa
//! veri sonsuza kadar kaybolur.
//!
//! Bu modüldeki her işlem bu yüzden çifti bir bütün olarak ele alır:
//! - `yedek_al` ikisini birlikte yazar (`yedek-<damga>.db` +
//!   `yedek-<damga>.keystore.json`),
//! - `yedekleri_listele` yalnızca iki dosyası da yerinde olan yedekleri
//!   döndürür (kullanıcıya geri yüklenemeyecek bir yedek göstermek, felaket
//!   anında yanlış güven verir),
//! - `geri_yukle` **önce** ikisinin de var ve açılabilir olduğunu doğrular,
//!   ancak ondan sonra mevcut dosyalara dokunur; ikinci yerleştirme
//!   başarısız olursa birincisini geri alır. Yarım geri yükleme (yeni
//!   veritabanı + eski anahtar dosyası) veriyi hiç geri yüklememekten daha
//!   kötüdür: her ikisi de erişilemez hâle gelir.

use crate::crypto::keyring::DataKey;
use crate::store::db::{open_encrypted, DbError};
use crate::store::keystore;
use rusqlite::backup::Backup;
use rusqlite::ffi::ErrorCode;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const SAKLANAN_YEDEK_SAYISI: usize = 7;
const ONEK: &str = "yedek-";
const UZANTI: &str = "db";
/// Yedek çiftinin anahtar dosyası: `yedek-<damga>.keystore.json`.
const KEYSTORE_UZANTI: &str = "keystore.json";

/// Bir yedek çiftinin hangi parçasının eksik olduğu.
///
/// Hassas hiçbir şey taşımaz (dosya yolu, dosya içeriği, anahtar yok), bu
/// yüzden `Debug` türetilmesi güvenlidir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EksikParca {
    Veritabani,
    Keystore,
    Ikisi,
}

impl std::fmt::Display for EksikParca {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            EksikParca::Veritabani => "kayıt dosyası (.db)",
            EksikParca::Keystore => "anahtar dosyası (.keystore.json)",
            EksikParca::Ikisi => "hem kayıt dosyası hem anahtar dosyası",
        })
    }
}

/// Yedekleme/geri yükleme hataları.
///
/// Varyantlar **bilerek ayrıdır**: "yedek eksik", "yedek bozuk" ve "anahtar
/// dosyası bozuk" birbirinden ayırt edilebilmelidir. Bu projede aynı hata
/// dört ayrı katmanda tekrarlandı — her seferinde sonuç aynıydı: doğru
/// parolaya sahip kullanıcıya sorunun kaynağı yanlış anlatılıyor, o da
/// kurtarılabilir veriyi silmeye/sıfırlamaya girişiyordu.
///
/// Hiçbir varyant ham anahtar, sarmalanmış anahtar veya dosya içeriği
/// taşımaz; `Debug`/`Display` çıktısı loga veya hata mesajına girse bile
/// hassas bir şey sızdırmaz.
#[derive(Debug, thiserror::Error)]
pub enum YedekHatasi {
    #[error("dosya hatasi: {0}")]
    Io(#[from] std::io::Error),
    #[error("yedek dosyasi okunamiyor veya bozuk")]
    BozukYedek,
    #[error("veritabani hatasi: {0}")]
    Db(#[from] DbError),
    #[error("gecersiz tarih damgasi: '{0}' (beklenen bicim: YYYY-AA-GG)")]
    GecersizTarih(String),
    /// Yedek klasöründeki çiftin bir parçası (ya da ikisi birden) yok.
    /// "Bozuk" DEĞİL: dosyalar yerinden oynatılmış/taşınmış olabilir ve
    /// büyük ihtimalle hâlâ bir yerdedir.
    #[error(
        "Bu yedek eksik: {0} bulunamadı. Bir yedek yalnızca iki dosyası \
         birlikteyken geri yüklenebilir; yedek klasörünü kontrol edin. \
         Hiçbir şey değiştirilmedi."
    )]
    YedekEksik(EksikParca),
    /// Yedekteki anahtar dosyası var ama okunamıyor/yapısal olarak geçersiz.
    /// `BozukYedek`'ten ayrı: sorun veritabanında değil, anahtar dosyasında.
    #[error("Yedekteki anahtar dosyası okunamıyor veya bozuk. Hiçbir şey değiştirilmedi.")]
    BozukKeystore,
    /// Yedeği alınacak (yani uygulamanın kendi) anahtar dosyası yok.
    /// Yedek ALINMAZ: yalnızca veritabanını kopyalamak geri yüklenemeyecek
    /// bir yedek üretir ve kullanıcıya sahte bir güvenlik hissi verir.
    #[error("Anahtar dosyası bulunamadığı için yedek alınmadı; anahtarsız yedek geri yüklenemez.")]
    KaynakKeystoreYok,
    /// Uygulamanın anahtar dosyası var ama bozuk; bu hâliyle yedeklenirse
    /// bozukluk yedeğe de kopyalanır.
    #[error("Anahtar dosyası bozuk olduğu için yedek alınmadı; bozuk anahtar yedeklenmez.")]
    KaynakKeystoreBozuk,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct YedekBilgisi {
    /// Yedeğin veritabanı dosyası. Anahtar dosyası için
    /// `keystore_yedek_yolu(&yol)`.
    pub yol: PathBuf,
    pub tarih: String,
    /// Yalnızca veritabanı dosyasının boyutu; anahtar dosyası birkaç yüz
    /// bayttır ve kullanıcıya gösterilen "yedek büyüklüğü" için anlamsızdır.
    pub boyut: u64,
    /// Çiftin anahtar dosyası yerinde mi. `yedekleri_listele` yalnızca `true`
    /// olanları döndürür; alan yine de taşınıyor çünkü `yedekleri_tara`
    /// (ve gelecekte bir "yedeklerinizde sorun var" ekranı) eksik çiftleri de
    /// görebilmeli.
    pub keystore_var: bool,
}

/// Bir yedek veritabanı yolundan çiftin anahtar dosyası yolunu üretir:
/// `.../yedek-2026-09-07.db` -> `.../yedek-2026-09-07.keystore.json`.
pub fn keystore_yedek_yolu(db_yedek_yolu: &Path) -> PathBuf {
    db_yedek_yolu.with_extension(KEYSTORE_UZANTI)
}

/// `s`'nin `YYYY-AA-GG` (ISO 8601 tarih) bicimine uyup uymadigini dogrular.
///
/// Yalnizca bicimi (rakam sayisi ve ayirac konumlari) kontrol eder; takvimsel
/// gecerliligi (ör. 2026-02-30) dogrulamaz - dosya adi siralamasi/rotasyonu
/// icin bu yeterli. Amac, kullanicinin elle koydugu (`yedek-eskiyedegim.db`)
/// veya isletim sisteminin urettigi (`yedek-2026-09-07 (2).db`) dosyalarin
/// rotasyona hic girmemesini saglamak (bkz. Bulgu 2).
fn tarih_bicimi_gecerli_mi(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..10].iter().all(u8::is_ascii_digit)
}

/// `open_encrypted`/`geri_yukle` dogrulamasindan gelen bir hatayi
/// `YedekHatasi`'ye siniflandirir.
///
/// Yalnizca gercek bozulma gostergeleri `BozukYedek` olur:
/// - `DbError::WrongKey`: dosya bu anahtarla hic acilamiyor (yanlis anahtar
///   veya dosya SQLCipher formatinda degil).
/// - `DbError::Sqlite` icindeki `ErrorCode::DatabaseCorrupt`: butunluk
///   kontrolu (`PRAGMA quick_check`) sayfa duzeyinde bozulma tespit etti.
///
/// Diger her sey (`Io`, kilitli dosya, gecici `Sqlite` hatalari) `Db`
/// olarak gecer - kullaniciya "yedeginiz bozuk" denilip saglam bir yedegin
/// silinmesine yol acilmamali (bkz. Bulgu 3).
fn siniflandir_geri_yukleme_hatasi(e: DbError) -> YedekHatasi {
    match e {
        DbError::WrongKey => YedekHatasi::BozukYedek,
        DbError::Sqlite(rusqlite::Error::SqliteFailure(ref ffi_hata, _))
            if ffi_hata.code == ErrorCode::DatabaseCorrupt =>
        {
            YedekHatasi::BozukYedek
        }
        other => YedekHatasi::Db(other),
    }
}

/// Veritabanını **ve** onu açan anahtar dosyasını birlikte yedekler.
///
/// `keystore_yolu` eksik veya bozuksa yedek **hiç alınmaz**: yalnızca
/// `veri.db`'yi kopyalamak, geri yüklenmesi imkânsız bir dosya üretir ve
/// kullanıcı yedeği olduğunu sanır. Sessizce yarım bir yedek üretmektense
/// hata döndürmek doğrudur.
pub fn yedek_al(
    db_yolu: &Path,
    keystore_yolu: &Path,
    hedef_dizin: &Path,
    damga: &str,
    key: &DataKey,
) -> Result<YedekBilgisi, YedekHatasi> {
    if !tarih_bicimi_gecerli_mi(damga) {
        return Err(YedekHatasi::GecersizTarih(damga.to_string()));
    }

    // Kaynak anahtar dosyasını ÖNCE doğrula: veritabanını kopyalamaya
    // başlamadan önce çiftin ikinci parçasının sağlam olduğunu bilelim.
    if !keystore::exists(keystore_yolu) {
        return Err(YedekHatasi::KaynakKeystoreYok);
    }
    let kaynak_keystore =
        keystore::load(keystore_yolu).map_err(|_| YedekHatasi::KaynakKeystoreBozuk)?;
    if !keystore::yapisal_gecerli_mi(&kaynak_keystore) {
        return Err(YedekHatasi::KaynakKeystoreBozuk);
    }

    std::fs::create_dir_all(hedef_dizin)?;
    let hedef = hedef_dizin.join(format!("{ONEK}{damga}.{UZANTI}"));
    let hedef_keystore = keystore_yedek_yolu(&hedef);

    // Once gecici dosyaya yaz, sonra tasi: yarim kalan kopya yedek gibi
    // gorunmesin. Onceki basarisiz bir denemeden kalmis olabilecek gecici
    // dosyayi ve WAL yan dosyalarini temiz baslamak icin sil.
    let gecici = hedef.with_extension("part");
    let _ = std::fs::remove_file(&gecici);
    for ek in ["part-wal", "part-shm"] {
        let _ = std::fs::remove_file(gecici.with_extension(ek));
    }

    {
        // SQLite Online Backup API: kaynak baglanti acikken (WAL modunda,
        // surmekte olan bir oturumla, henuz checkpoint edilmemis kayitlarla
        // birlikte) bile tutarli ve eksiksiz bir kopya uretir - salt dosya
        // kopyalama WAL'daki en son islenmemis kayitlari atlar (bkz. Bulgu 1).
        //
        // Hedef baglanti da `open_encrypted` ile AYNI anahtarla aciliyor;
        // aksi halde sqlite3_backup sayfalari hedefin sifrelenmemis
        // pager'ina yazar ve yedek duz metin olarak diskte kalir - bu kabul
        // edilemez, bu yuzden hedef de mutlaka keyed olarak aciliyor.
        let kaynak = open_encrypted(db_yolu, key)?;
        let mut hedef_baglanti = open_encrypted(&gecici, key)?;
        let yedekleme = Backup::new(&kaynak, &mut hedef_baglanti).map_err(DbError::from)?;
        yedekleme
            .run_to_completion(100, Duration::from_millis(250), None)
            .map_err(DbError::from)?;
        // `hedef_baglanti` burada scope disina cikip kapanir; gecici dosyaya
        // ait tek baglanti oldugu icin SQLite kapanista otomatik checkpoint
        // yapar ve WAL'i ana dosyaya birlestirir.
    }
    // Checkpoint sonrasi bos/kalinti WAL yan dosyalari kalmis olabilir;
    // rename'den once temizle ki yedek dizininde tek basina dolasan bir
    // '.part-wal' kalmasin.
    for ek in ["part-wal", "part-shm"] {
        let _ = std::fs::remove_file(gecici.with_extension(ek));
    }

    // SIRA ONEMLI: once anahtar dosyasi, sonra veritabani. `yedekleri_listele`
    // bir yedegi ancak IKI dosyasi da yerindeyken gosterdigi icin, yedek tam
    // olarak son rename aninda "gorunur" olur. Ters sirada yazsaydik, iki
    // adim arasinda cakan bir surec anahtarsiz ama listelenebilir bir yedek
    // birakabilirdi. `keystore::save` kendi icinde atomiktir (gecici dosya +
    // rename), bu yuzden burada ayrica .part sarmalamasina gerek yok.
    keystore::save(&kaynak_keystore, &hedef_keystore)?;
    std::fs::rename(&gecici, &hedef)?;

    // Temizlik (eski yedeklerin silinmesi) basarisiz olsa bile bu yedek
    // diskte basariyla olusturuldu; temizlik hatasi yedegin basarisini
    // dusurmemeli (Bulgu 4). En kotu durumda bir eski yedek fazladan
    // diskte kalir - bu veri kaybi degil, aksine ekstra bir kopyadir.
    let _ = eskileri_temizle(hedef_dizin);

    let boyut = std::fs::metadata(&hedef)?.len();
    Ok(YedekBilgisi { yol: hedef, tarih: damga.to_string(), boyut, keystore_var: true })
}

/// Yedek klasöründeki **tüm** `yedek-<tarih>.db` dosyalarını, çiftinin
/// tamam olup olmadığı bilgisiyle birlikte döndürür (en yeni başta).
///
/// `yedekleri_listele`'nin aksine eksik çiftleri de içerir; filtre tek bir
/// yerde (`yedekleri_listele`) uygulansın diye ayrı tutuluyor.
fn yedekleri_tara(hedef_dizin: &Path) -> Result<Vec<YedekBilgisi>, YedekHatasi> {
    if !hedef_dizin.exists() {
        return Ok(Vec::new());
    }
    let mut liste = Vec::new();
    for girdi in std::fs::read_dir(hedef_dizin)? {
        let girdi = girdi?;
        let yol = girdi.path();
        let Some(ad) = yol.file_name().and_then(|s| s.to_str()) else { continue };
        let Some(tarih) = ad.strip_prefix(ONEK).and_then(|s| s.strip_suffix(&format!(".{UZANTI}")))
        else {
            continue;
        };
        if !tarih_bicimi_gecerli_mi(tarih) {
            // Kullanicinin elle koydugu ya da isletim sisteminin urettigi
            // (ör. "yedek-eskiyedegim.db", "yedek-2026-09-07 (2).db") bir
            // dosya listeye alinmaz - dolayisiyla rotasyonla asla silinmez
            // (bkz. Bulgu 2).
            continue;
        }
        liste.push(YedekBilgisi {
            keystore_var: keystore_yedek_yolu(&yol).exists(),
            yol: yol.clone(),
            tarih: tarih.to_string(),
            boyut: girdi.metadata()?.len(),
        });
    }
    // Dosya adindaki tarih ISO oldugu icin metin siralamasi tarih siralamasidir.
    liste.sort_by(|a, b| b.tarih.cmp(&a.tarih));
    Ok(liste)
}

/// Geri yüklenebilir yedekleri döndürür: yalnızca **iki dosyası da** yerinde
/// olanlar (en yeni başta).
///
/// Anahtar dosyası olmayan bir yedek geri yüklenemez. Onu listede göstermek,
/// kullanıcının felaket anında -- yani düzeltme şansının kalmadığı anda --
/// var olmayan bir kurtarma seçeneğine güvenmesi demektir; bu yüzden atlanır.
pub fn yedekleri_listele(hedef_dizin: &Path) -> Result<Vec<YedekBilgisi>, YedekHatasi> {
    Ok(yedekleri_tara(hedef_dizin)?.into_iter().filter(|b| b.keystore_var).collect())
}

/// Rotasyon: en yeni `SAKLANAN_YEDEK_SAYISI` **tam** yedek dışındakileri
/// (çiftin iki dosyasını birden) siler.
///
/// Sayım `yedekleri_listele` üzerinden, yani yalnızca tam çiftler üzerinden
/// yapılır: eksik/elle konmuş dosyalar ne sayıma girer ne de silinir --
/// anlamadığımız bir dosyayı silmek, kullanıcının tek kopyasını yok etme
/// riski taşır (bkz. Bulgu 2).
fn eskileri_temizle(hedef_dizin: &Path) -> Result<(), YedekHatasi> {
    let liste = yedekleri_listele(hedef_dizin)?;
    for eski in liste.iter().skip(SAKLANAN_YEDEK_SAYISI) {
        // Once anahtar dosyasi silinir: aradaki cakmada geriye anahtarsiz
        // (yani listelenmeyen) bir .db kalir, tersi durumda ise sahipsiz bir
        // anahtar dosyasi. Ikisi de zararsiz, ama ilki bir sonraki rotasyonda
        // temizlenmeye aday olmadigi icin bilerek bu sira secildi.
        std::fs::remove_file(keystore_yedek_yolu(&eski.yol))?;
        std::fs::remove_file(&eski.yol)?;
    }
    Ok(())
}

/// Bir yedek çiftini (veritabanı + anahtar dosyası) birlikte geri yükler.
///
/// Sıra kesindir: **önce tam doğrulama, sonra yerleştirme.** Doğrulama
/// bitene kadar `db_yolu` ve `keystore_yolu` hiçbir kod yolundan
/// değiştirilmez; yerleştirme sırasında ikinci adım başarısız olursa
/// birincisi geri alınır.
pub fn geri_yukle(
    yedek_yolu: &Path,
    db_yolu: &Path,
    keystore_yolu: &Path,
    key: &DataKey,
) -> Result<(), YedekHatasi> {
    let yedek_keystore_yolu = keystore_yedek_yolu(yedek_yolu);

    // 1) Varlik: "eksik" ile "bozuk" ayri hatalar. Eksik bir dosya buyuk
    //    ihtimalle tasinmis/yanlis klasordedir ve bulunabilir; kullaniciya
    //    "yedeginiz bozuk" demek onu saglam yedegi silmeye itebilir.
    match (yedek_yolu.exists(), yedek_keystore_yolu.exists()) {
        (true, true) => {}
        (false, true) => return Err(YedekHatasi::YedekEksik(EksikParca::Veritabani)),
        (true, false) => return Err(YedekHatasi::YedekEksik(EksikParca::Keystore)),
        (false, false) => return Err(YedekHatasi::YedekEksik(EksikParca::Ikisi)),
    }

    // 2) Yedekteki anahtar dosyasi gercekten acilabiliyor mu. Yalnizca
    //    JSON ayristirmasi yetmez: yarim yazilmis bir `ciphertext_hex`
    //    ayristirmadan gecer ama hicbir parolayla acilmaz.
    let yedek_keystore =
        keystore::load(&yedek_keystore_yolu).map_err(|_| YedekHatasi::BozukKeystore)?;
    if !keystore::yapisal_gecerli_mi(&yedek_keystore) {
        return Err(YedekHatasi::BozukKeystore);
    }

    // 3) Yedekteki veritabani acilabiliyor ve butunlugu saglam mi.
    let dogrulama = open_encrypted(yedek_yolu, key).map_err(siniflandir_geri_yukleme_hatasi)?;

    // `SELECT count(*) FROM sqlite_master` yalnizca sema sayfasini okur;
    // veri sayfalari bozuksa yakalamaz. `PRAGMA quick_check`, `integrity_check`
    // kadar kapsamli olmayan (cross-index dogrulamalarini atlayan) ama tum
    // veri sayfalarini tarayan daha hizli bir kontrol - bir yedek dosyasi
    // icin makul bir sure/kapsamlilik dengesi (bkz. Bulgu 5).
    let sonuc: rusqlite::Result<String> =
        dogrulama.query_row("PRAGMA quick_check", [], |r| r.get(0));
    match sonuc {
        Ok(ref s) if s == "ok" => {}
        Ok(_diger) => return Err(YedekHatasi::BozukYedek),
        Err(e) => return Err(siniflandir_geri_yukleme_hatasi(DbError::Sqlite(e))),
    }
    drop(dogrulama);

    // --- Buradan sonrasi yerlestirme; dogrulama bitti. -------------------

    // 4) Once iki dosyayi da HEDEFIN YANINA gecici adlarla kopyala. Riskli
    //    IO (disk dolu, izin hatasi, yarim okuma) burada olur ve bu noktada
    //    mevcut dosyalarin ikisi de hala tamamen yerinde. Ayni dizinde
    //    olduklari icin sonraki rename'ler ayni dosya sistemi icindedir.
    let db_gecici = db_yolu.with_extension("restore");
    let keystore_gecici = keystore_yolu.with_extension("json.restore");
    std::fs::copy(yedek_yolu, &db_gecici)?;
    if let Err(e) = std::fs::copy(&yedek_keystore_yolu, &keystore_gecici) {
        let _ = std::fs::remove_file(&db_gecici);
        return Err(e.into());
    }

    // 5) Mevcut dosyalari kenara al ve yenileri yerine koy. Her adimin
    //    hatasinda o ana kadar yapilanlar geri alinir: yarim geri yukleme
    //    (yeni db + eski keystore ya da tersi) her iki dosyayi da
    //    kullanilamaz kilar - hic geri yuklememekten kotudur.
    let db_onceki = db_yolu.with_extension("db.onceki");
    let keystore_onceki = keystore_yolu.with_extension("json.onceki");
    let db_vardi = db_yolu.exists();
    let keystore_vardi = keystore_yolu.exists();

    if db_vardi {
        // Buradaki hata durumunda hicbir sey degismedi.
        if let Err(e) = std::fs::rename(db_yolu, &db_onceki) {
            let _ = std::fs::remove_file(&db_gecici);
            let _ = std::fs::remove_file(&keystore_gecici);
            return Err(e.into());
        }
    }
    if keystore_vardi {
        if let Err(e) = std::fs::rename(keystore_yolu, &keystore_onceki) {
            if db_vardi {
                let _ = std::fs::rename(&db_onceki, db_yolu);
            }
            let _ = std::fs::remove_file(&db_gecici);
            let _ = std::fs::remove_file(&keystore_gecici);
            return Err(e.into());
        }
    }
    if let Err(e) = std::fs::rename(&db_gecici, db_yolu) {
        geri_al(db_vardi, &db_onceki, db_yolu, keystore_vardi, &keystore_onceki, keystore_yolu);
        let _ = std::fs::remove_file(&keystore_gecici);
        return Err(e.into());
    }
    if let Err(e) = std::fs::rename(&keystore_gecici, keystore_yolu) {
        // Veritabani zaten yerine kondu; onu da geri almadan cikarsak
        // kullanicida yedegin db'si + eski keystore kalirdi.
        let _ = std::fs::remove_file(db_yolu);
        geri_al(db_vardi, &db_onceki, db_yolu, keystore_vardi, &keystore_onceki, keystore_yolu);
        return Err(e.into());
    }

    // WAL dosyalari eski veritabanina aitti, birakilirsa tutarsizlik uretir.
    for ek in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(db_yolu.with_extension(ek));
    }
    // Kenara alinan onceki surumler artik gereksiz. Silinemezlerse sorun
    // degil: geri yukleme tamamlandi, bunlar yalnizca yer kaplar.
    let _ = std::fs::remove_file(&db_onceki);
    let _ = std::fs::remove_file(&keystore_onceki);
    Ok(())
}

/// Yerleştirme yarıda kaldığında kenara alınmış önceki sürümleri yerine
/// koyar. Kendisi hata döndürmez: çağıran zaten asıl hatayı döndürecek ve
/// geri alma başarısız olsa bile yapılabilecek başka bir şey yok.
fn geri_al(
    db_vardi: bool,
    db_onceki: &Path,
    db_yolu: &Path,
    keystore_vardi: bool,
    keystore_onceki: &Path,
    keystore_yolu: &Path,
) {
    if db_vardi {
        let _ = std::fs::rename(db_onceki, db_yolu);
    }
    if keystore_vardi {
        let _ = std::fs::rename(keystore_onceki, keystore_yolu);
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::{generate_data_key, DataKey, KdfParams};
    use crate::store::{db::open_encrypted, keystore, schema::migrate};
    use std::path::{Path, PathBuf};

    /// Test icin gercek bir kurulum uretir: diskte bir `keystore.json` ve onun
    /// sarmaladigi anahtarla acilmis bir `veri.db`. Uygulamadaki iliski
    /// birebir budur - anahtar dosyasi olmadan veritabani acilamaz.
    struct Ortam {
        _dir: tempfile::TempDir,
        kok: PathBuf,
        hedef: PathBuf,
        db: PathBuf,
        keystore_yolu: PathBuf,
        key: DataKey,
        keystore: keystore::Keystore,
    }

    fn kur(parola: &str) -> Ortam {
        let dir = tempfile::tempdir().unwrap();
        let kok = dir.path().to_path_buf();
        let kurulum = keystore::create(parola, KdfParams::test_fast()).unwrap();
        let keystore_yolu = kok.join("keystore.json");
        keystore::save(&kurulum.keystore, &keystore_yolu).unwrap();
        let key = kurulum.data_key.clone();
        let db = ornek_db(&kok, &key);
        Ortam {
            _dir: dir,
            hedef: kok.join("yedekler"),
            kok,
            db,
            keystore_yolu,
            key,
            keystore: kurulum.keystore,
        }
    }

    fn ornek_db(dir: &Path, key: &DataKey) -> PathBuf {
        let yol = dir.join("veri.db");
        let c = open_encrypted(&yol, key).unwrap();
        migrate(&c).unwrap();
        c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse');").unwrap();
        drop(c);
        yol
    }

    /// Anahtar dosyasinin icerigiyle ilgilenmeyen testler icin: gecerli bir
    /// keystore diske yazar ve yolunu doner.
    fn sahte_keystore(dir: &Path) -> PathBuf {
        let yol = dir.join("keystore.json");
        let kurulum = keystore::create("parola123", KdfParams::test_fast()).unwrap();
        keystore::save(&kurulum.keystore, &yol).unwrap();
        yol
    }

    #[test]
    fn yedek_alinir_ve_ayni_anahtarla_acilir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        let bilgi = yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();
        assert!(bilgi.yol.exists());
        assert!(bilgi.boyut > 0);

        let c = open_encrypted(&bilgi.yol, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    #[test]
    fn yediden_fazla_yedek_birikmez_en_eski_silinir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        for gun in 1..=10 {
            yedek_al(&db, &ks, &hedef, &format!("2026-09-{gun:02}"), &key).unwrap();
        }

        let liste = yedekleri_listele(&hedef).unwrap();
        assert_eq!(liste.len(), SAKLANAN_YEDEK_SAYISI);
        assert_eq!(liste[0].tarih, "2026-09-10", "en yeni basta olmali");
        assert_eq!(liste[6].tarih, "2026-09-04", "8 gun oncesi silinmis olmali");
        // Rotasyon cifti bir butun olarak silmeli; sahipsiz anahtar dosyasi
        // kalmamali.
        for gun in 1..=3 {
            let kalinti = hedef.join(format!("yedek-2026-09-{gun:02}.keystore.json"));
            assert!(!kalinti.exists(), "rotasyonda anahtar dosyasi da silinmeli: {kalinti:?}");
        }
    }

    #[test]
    fn ayni_gun_iki_kez_yedek_alinca_tek_dosya_kalir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();
        yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();
        assert_eq!(yedekleri_listele(&hedef).unwrap().len(), 1);
    }

    #[test]
    fn bozuk_yedek_geri_yuklenmez_ve_mevcut_veri_korunur() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        std::fs::write(&bilgi.yol, b"bu bir veritabani degil").unwrap();
        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::BozukYedek), "gelen: {hata:?}");

        // Mevcut veritabani bozulmamis olmali.
        let c = open_encrypted(&o.db, &o.key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    #[test]
    fn geri_yukleme_veriyi_yedekteki_haline_dondurur() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        {
            let c = open_encrypted(&o.db, &o.key).unwrap();
            c.execute("UPDATE t SET ad='Degistirildi'", []).unwrap();
        }

        geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap();

        let c = open_encrypted(&o.db, &o.key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    // --- Bulgu 1: WAL yan dosyalari yedege girmiyor ---------------------

    #[test]
    fn acik_baglanti_varken_yazilan_veri_yedege_dahil_olur() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = d.path().join("veri.db");
        let ks = sahte_keystore(d.path());

        let c = open_encrypted(&db, &key).unwrap();
        migrate(&c).unwrap();
        c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse');").unwrap();
        // BILEREK KAPATMIYORUZ: uygulama oturum boyunca baglantiyi acik
        // tutar; son yazilan kayitlar WAL dosyasinda kalabilir ve henuz
        // ana .db dosyasina checkpoint edilmemis olabilir.

        let bilgi = yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();

        let dogrulama = open_encrypted(&bilgi.yol, &key).unwrap();
        let ad: String = dogrulama.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(
            ad, "Ayse",
            "acik baglanti varken yazilan veri yedekte olmali (WAL kaybi yasanmamali)"
        );

        drop(dogrulama);
        drop(c);
    }

    #[test]
    fn yedek_dosyasinda_duz_metin_bulunmaz() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = d.path().join("veri.db");
        let ks = sahte_keystore(d.path());
        {
            let c = open_encrypted(&db, &key).unwrap();
            migrate(&c).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('GIZLI_DANISAN_ADI');")
                .unwrap();
        }

        let bilgi = yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();

        let bytes = std::fs::read(&bilgi.yol).unwrap();
        assert!(
            !bytes.windows(17).any(|w| w == b"GIZLI_DANISAN_ADI"),
            "yedek dosyasinda duz metin bulundu"
        );
        assert!(&bytes[..15] != b"SQLite format 3", "yedek sifrelenmemis");
    }

    // --- Bulgu 2: beklenmeyen dosyalar sessizce silinebiliyor -----------

    #[test]
    fn elle_konan_gecersiz_isimli_dosya_rotasyonda_silinmez() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        std::fs::create_dir_all(&hedef).unwrap();
        let elle_konan = hedef.join("yedek-eskiyedegim.db");
        std::fs::write(&elle_konan, b"kullanicinin elle koydugu eski yedek").unwrap();
        let windows_kopyasi = hedef.join("yedek-2026-09-07 (2).db");
        std::fs::write(&windows_kopyasi, b"windows kopyalama sonucu uretilen dosya").unwrap();

        for gun in 1..=10 {
            yedek_al(&db, &ks, &hedef, &format!("2026-09-{gun:02}"), &key).unwrap();
        }

        assert!(elle_konan.exists(), "kullanicinin elle koydugu yedek silinmemeli");
        assert!(windows_kopyasi.exists(), "gecersiz bicimli dosya silinmemeli");

        let liste = yedekleri_listele(&hedef).unwrap();
        assert_eq!(
            liste.len(),
            SAKLANAN_YEDEK_SAYISI,
            "gecersiz bicimli dosyalar listeye/rotasyona hic girmemeli"
        );
        assert!(liste.iter().all(|b| b.tarih != "eskiyedegim" && b.tarih != "2026-09-07 (2)"));
    }

    #[test]
    fn gecersiz_bicimli_damga_ile_yedek_alinamaz() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let ks = sahte_keystore(d.path());

        let hata = yedek_al(&db, &ks, &hedef, "eskiyedegim", &key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::GecersizTarih(_)));

        let hata2 = yedek_al(&db, &ks, &hedef, "2026-09-07 (2)", &key).unwrap_err();
        assert!(matches!(hata2, YedekHatasi::GecersizTarih(_)));
    }

    // --- Bulgu 3: her acma hatasi "bozuk yedek" olarak raporlaniyor -----

    #[test]
    fn kalici_olmayan_io_hatasi_bozukyedek_olarak_raporlanmaz() {
        let io_hata = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "erisim engellendi");
        let sonuc = siniflandir_geri_yukleme_hatasi(DbError::Io(io_hata));
        assert!(
            matches!(sonuc, YedekHatasi::Db(DbError::Io(_))),
            "beklenen Db(Io), gelen: {sonuc:?}"
        );
    }

    #[test]
    fn gecici_sqlite_hatasi_bozukyedek_olarak_raporlanmaz() {
        // Ã¶r. dosya kilitli (SQLITE_BUSY) - bu "bozuk" degil, gecici bir durum.
        let sahte_ffi_hata = rusqlite::ffi::Error { code: ErrorCode::DatabaseBusy, extended_code: 5 };
        let sonuc = siniflandir_geri_yukleme_hatasi(DbError::Sqlite(rusqlite::Error::SqliteFailure(
            sahte_ffi_hata,
            None,
        )));
        assert!(
            matches!(sonuc, YedekHatasi::Db(DbError::Sqlite(_))),
            "beklenen Db(Sqlite), gelen: {sonuc:?}"
        );
    }

    #[test]
    fn wrongkey_bozukyedek_olarak_raporlanir() {
        let sonuc = siniflandir_geri_yukleme_hatasi(DbError::WrongKey);
        assert!(matches!(sonuc, YedekHatasi::BozukYedek), "beklenen BozukYedek, gelen: {sonuc:?}");
    }

    // --- Bulgu 5: butunluk kontrolu yuzeysel -----------------------------

    #[test]
    fn veri_sayfasi_bozuk_yedek_quick_check_ile_yakalanir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = d.path().join("veri.db");
        let ks = sahte_keystore(d.path());
        {
            let c = open_encrypted(&db, &key).unwrap();
            migrate(&c).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT);").unwrap();
            let mut stmt = c.prepare("INSERT INTO t VALUES (?1)").unwrap();
            // Sema sayfasinin (page 1) disinda en az bir veri sayfasi daha
            // olusturacak kadar veri yaz; boylece bozacagimiz bayt semaya
            // degil bir veri sayfasina denk gelsin (open_encrypted sadece
            // sema sayfasini okur, bu yuzden acilis basarili olmali).
            for i in 0..500 {
                stmt.execute([format!("satir-{i}-{}", "x".repeat(50))]).unwrap();
            }
        }
        let bilgi = yedek_al(&db, &ks, &hedef, "2026-09-07", &key).unwrap();

        let mut bytes = std::fs::read(&bilgi.yol).unwrap();
        let uzunluk = bytes.len();
        assert!(uzunluk > 8192, "test icin en az iki sayfalik veri gerekiyor, uzunluk={uzunluk}");
        // Dosyanin son 200 baytini boz: sema (ilk sayfa) saglam kalsin, son
        // veri sayfalari bozulsun.
        for b in bytes.iter_mut().skip(uzunluk - 200) {
            *b ^= 0xFF;
        }
        std::fs::write(&bilgi.yol, &bytes).unwrap();

        let hata = geri_yukle(&bilgi.yol, &db, &ks, &key).unwrap_err();
        assert!(
            matches!(hata, YedekHatasi::BozukYedek),
            "beklenen BozukYedek (quick_check veri sayfasi bozuklugunu yakalamali), gelen: {hata:?}"
        );
    }

    // --- Gorev 12: yedek = veritabani + anahtar dosyasi ------------------

    #[test]
    fn yedek_hem_veritabanini_hem_keystore_u_icerir() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        assert_eq!(bilgi.yol, o.hedef.join("yedek-2026-09-07.db"));
        assert!(bilgi.yol.exists(), "yedek veritabani yazilmali");

        let yedek_ks = o.hedef.join("yedek-2026-09-07.keystore.json");
        assert_eq!(keystore_yedek_yolu(&bilgi.yol), yedek_ks);
        assert!(yedek_ks.exists(), "yedek anahtar dosyasi da yazilmali");
        assert!(bilgi.keystore_var);

        // Yedekteki anahtar dosyasi gercekten kullanilabilir olmali: ayni
        // parola onu acmali ve ayni veri anahtarini vermeli.
        let okunan = keystore::load(&yedek_ks).unwrap();
        let acilan = keystore::unlock_with_password(&okunan, "parola123").unwrap();
        assert_eq!(acilan.as_ref(), o.key.as_ref());
    }

    #[test]
    fn keystore_eksikse_geri_yukleme_reddedilir_ve_mevcut_veri_korunur() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        let db_once = std::fs::read(&o.db).unwrap();
        let ks_once = std::fs::read(&o.keystore_yolu).unwrap();

        std::fs::remove_file(keystore_yedek_yolu(&bilgi.yol)).unwrap();

        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(
            matches!(hata, YedekHatasi::YedekEksik(EksikParca::Keystore)),
            "eksik dosya 'bozuk' diye raporlanmamali; gelen: {hata:?}"
        );

        assert_eq!(std::fs::read(&o.db).unwrap(), db_once, "mevcut veritabani degismemeli");
        assert_eq!(
            std::fs::read(&o.keystore_yolu).unwrap(),
            ks_once,
            "mevcut anahtar dosyasi degismemeli"
        );
        // Yarim geri yuklemeden kalan bir kalinti da olmamali.
        assert!(!o.db.with_extension("restore").exists());
        assert!(!o.keystore_yolu.with_extension("json.restore").exists());
    }

    #[test]
    fn veritabani_eksikse_geri_yukleme_reddedilir() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        let db_once = std::fs::read(&o.db).unwrap();
        let ks_once = std::fs::read(&o.keystore_yolu).unwrap();

        std::fs::remove_file(&bilgi.yol).unwrap();

        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::YedekEksik(EksikParca::Veritabani)), "gelen: {hata:?}");

        assert_eq!(std::fs::read(&o.db).unwrap(), db_once);
        assert_eq!(std::fs::read(&o.keystore_yolu).unwrap(), ks_once);
    }

    #[test]
    fn ikisi_de_eksikse_ayri_bir_hata_doner() {
        let o = kur("parola123");
        let yok = o.hedef.join("yedek-2026-01-01.db");
        let hata = geri_yukle(&yok, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::YedekEksik(EksikParca::Ikisi)), "gelen: {hata:?}");
    }

    #[test]
    fn yedekteki_bozuk_keystore_eksikten_ayirt_edilir() {
        // "Eksik" ile "bozuk" ayni hata olmamali: birinde dosya baska bir
        // yerdedir ve bulunabilir, digerinde dosya kurtarilamaz. Ikisini
        // birlestirmek kullaniciyi yanlis yone iter.
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        std::fs::write(keystore_yedek_yolu(&bilgi.yol), b"{ bu gecerli json degil").unwrap();
        let hata = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::BozukKeystore), "gelen: {hata:?}");

        // JSON gecerli ama sarmalama yarim: `load` bunu yakalayamaz,
        // yapisal dogrulama yakalamali.
        let mut ks = keystore::load(&o.keystore_yolu).unwrap();
        ks.password.ciphertext_hex.truncate(4);
        keystore::save(&ks, &keystore_yedek_yolu(&bilgi.yol)).unwrap();
        let hata2 = geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap_err();
        assert!(matches!(hata2, YedekHatasi::BozukKeystore), "gelen: {hata2:?}");
    }

    #[test]
    fn eksik_ciftli_yedekler_listede_gorunmez() {
        let o = kur("parola123");
        for gun in 1..=3 {
            yedek_al(&o.db, &o.keystore_yolu, &o.hedef, &format!("2026-09-{gun:02}"), &o.key)
                .unwrap();
        }
        assert_eq!(yedekleri_listele(&o.hedef).unwrap().len(), 3);

        // Ortadaki yedegin anahtar dosyasini kaybet.
        std::fs::remove_file(o.hedef.join("yedek-2026-09-02.keystore.json")).unwrap();

        let liste = yedekleri_listele(&o.hedef).unwrap();
        assert_eq!(liste.len(), 2, "anahtarsiz yedek listelenmemeli");
        assert!(
            liste.iter().all(|b| b.tarih != "2026-09-02"),
            "geri yuklenemeyecek yedek kullaniciya gosterilmemeli"
        );
        assert!(liste.iter().all(|b| b.keystore_var));

        // Dosya hala diskte: listeden gizlemek, silmek demek degil.
        assert!(o.hedef.join("yedek-2026-09-02.db").exists());
        // Ham tarama onu eksik olarak gormeli.
        let tarama = yedekleri_tara(&o.hedef).unwrap();
        assert_eq!(tarama.len(), 3);
        assert!(tarama.iter().any(|b| b.tarih == "2026-09-02" && !b.keystore_var));
    }

    #[test]
    fn geri_yukleme_ikisini_birlikte_yerine_koyar() {
        // BU TESTIN VARLIK SEBEBI: dosyanin kopyalanmis olmasi degil, geri
        // yuklenen CIFTIN birlikte calistigi kanitlanmali.
        let o = kur("eski-parola");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        // Parolayi degistir: DISKTEKI anahtar dosyasi degisir.
        let yeni_keystore =
            keystore::change_password(&o.keystore, "eski-parola", "yeni-parola").unwrap();
        keystore::save(&yeni_keystore, &o.keystore_yolu).unwrap();

        // On kosul: artik eski parola diskteki dosyayi ACMIYOR.
        let diskteki = keystore::load(&o.keystore_yolu).unwrap();
        assert!(
            keystore::unlock_with_password(&diskteki, "eski-parola").is_err(),
            "on kosul: parola degisimi diskteki anahtar dosyasini gercekten degistirmis olmali"
        );
        assert!(keystore::unlock_with_password(&diskteki, "yeni-parola").is_ok());

        // Veriyi de degistir ki geri yuklemenin db'yi de tasidigini gorelim.
        {
            let c = open_encrypted(&o.db, &o.key).unwrap();
            c.execute("UPDATE t SET ad='Degistirildi'", []).unwrap();
        }

        geri_yukle(&bilgi.yol, &o.db, &o.keystore_yolu, &o.key).unwrap();

        // KANIT: ESKI parola yeniden calisiyor - demek ki keystore da geri
        // yuklendi, yalnizca db kopyalanmadi.
        let geri_yuklenen = keystore::load(&o.keystore_yolu).unwrap();
        let acilan = keystore::unlock_with_password(&geri_yuklenen, "eski-parola")
            .expect("geri yuklenen anahtar dosyasi ESKI parolayla acilmali");
        assert_eq!(acilan.as_ref(), o.key.as_ref(), "ayni veri anahtari gelmeli");

        // Ve o anahtarla geri yuklenen veritabani gercekten aciliyor.
        let c = open_encrypted(&o.db, &acilan).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse", "veritabani da yedekteki haline donmeli");

        // Cift birlikte geri geldi: parola degisikligi de geri alinmis olmali.
        assert!(keystore::unlock_with_password(&geri_yuklenen, "yeni-parola").is_err());
    }

    #[test]
    fn yedek_keystore_dosyasinda_ham_anahtar_bulunmaz() {
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        let icerik = std::fs::read(keystore_yedek_yolu(&bilgi.yol)).unwrap();
        let anahtar_hex = hex::encode(o.key.as_ref());
        let metin = String::from_utf8_lossy(&icerik);
        assert!(!metin.contains(&anahtar_hex), "yedekteki anahtar dosyasinda duz anahtar bulundu");
        assert!(
            !icerik.windows(32).any(|w| w == o.key.as_ref()),
            "yedekteki anahtar dosyasinda ham anahtar baytlari bulundu"
        );
    }

    #[test]
    fn keystore_yoksa_yedek_alinmaz() {
        // Anahtarsiz alinan bir "yedek" geri yuklenemez; sessizce yarim
        // yedek uretmektense hata dondurmek dogrudur.
        let d = tempfile::tempdir().unwrap();
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let yok = d.path().join("keystore.json");
        let hedef = d.path().join("yedekler");

        let hata = yedek_al(&db, &yok, &hedef, "2026-09-07", &key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::KaynakKeystoreYok), "gelen: {hata:?}");
        assert!(!hedef.join("yedek-2026-09-07.db").exists(), "yarim yedek birakilmamali");
    }

    #[test]
    fn bozuk_keystore_ile_yedek_alinmaz() {
        let o = kur("parola123");
        std::fs::write(&o.keystore_yolu, b"bu json degil").unwrap();

        let hata = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::KaynakKeystoreBozuk), "gelen: {hata:?}");
        assert!(!o.hedef.join("yedek-2026-09-07.db").exists());
    }

    #[test]
    fn geri_yukleme_bos_bir_kuruluma_da_yapilabilir() {
        // Disk degisti senaryosu: yedek klasoru var, uygulama veri dizini bos.
        let o = kur("parola123");
        let bilgi = yedek_al(&o.db, &o.keystore_yolu, &o.hedef, "2026-09-07", &o.key).unwrap();

        let yeni_kok = o.kok.join("yeni-bilgisayar");
        std::fs::create_dir_all(&yeni_kok).unwrap();
        let yeni_db = yeni_kok.join("veri.db");
        let yeni_ks = yeni_kok.join("keystore.json");

        geri_yukle(&bilgi.yol, &yeni_db, &yeni_ks, &o.key).unwrap();

        let okunan = keystore::load(&yeni_ks).unwrap();
        let acilan = keystore::unlock_with_password(&okunan, "parola123").unwrap();
        let c = open_encrypted(&yeni_db, &acilan).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }
}
