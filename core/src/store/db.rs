use crate::crypto::keyring::DataKey;
use rusqlite::ffi::ErrorCode;
use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("veritabanı bu parolayla açılamıyor")]
    WrongKey,
    #[error("veritabanı hatası: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("dosya hatası: {0}")]
    Io(#[from] std::io::Error),
    /// `rusqlite::Error::SqlInputError`'in `Display`/`Debug` çıktısı,
    /// başarısız olan SQL metninin **tamamını** basar. `PRAGMA key='...'`
    /// tam da bu SQL'dir ve ham veri anahtarının hex temsilini içerir --
    /// bu yüzden bu hata `DbError::Sqlite`'a (kaynak hatayı taşıyarak)
    /// SARILMAZ; hiçbir alan taşımayan bu ayrı varyanta dönüştürülür (bkz.
    /// `siniflandir_anahtar_hatasi`, Bulgu 3).
    #[error("anahtar ayarlanamadı (girdi hatası)")]
    AnahtarGirdiHatasi,
    /// `open_existing` icin: dosya yok. `open_encrypted`'in aksine burada
    /// dosya YARATILMAZ -- cagiran taraf (bkz. `server::guard::acik_baglanti`)
    /// bunu ayirt edip kullaniciya net bir mesaj gostermeli, sessizce bos bir
    /// veritabani yaratmamali (bkz. Plan 1'in son incelemesi, Kural 2).
    #[error(
        "Veritabanı dosyası bulunamadı. Dosya silinmiş veya taşınmış olabilir; \
         lütfen en son yedekten geri yükleyin. Bu ekranda hiçbir veri değiştirilmedi."
    )]
    DosyaYok,
    /// `PRAGMA integrity_check` "ok" dönmedi: dosya açıldı, anahtar DOĞRU,
    /// ama sayfa/indeks yapısı bozuk.
    ///
    /// `WrongKey`'den **kesinlikle** ayrı: bu kod tabanında "her hata parola
    /// hatasıdır" sınıfı dört ayrı katmanda bulundu. Doğru parolasını girmiş
    /// bir kullanıcıya "parolanız hatalı" demek onu sıfırlamaya/yeniden
    /// kuruluma iter ve kurtarılabilir veriyi kalıcı olarak yok eder. Mesaj
    /// bu yüzden parolanın doğru olduğunu **açıkça** söyler ve silmemeyi
    /// öğütler.
    #[error(
        "Kayıt dosyanız açıldı ama içeriği bozuk. Parolanız doğru; sorun \
         dosyanın kendisinde. Yedekten geri yükleme gerekiyor. Bu klasördeki \
         hiçbir dosyayı silmeyin ve yeniden kurulum yapmayın."
    )]
    Bozuk,
}

/// Zaten açılmış (yeni oluşturulmuş veya var olan) bir `Connection` üzerinde
/// SQLCipher anahtarını ayarlar ve ortak PRAGMA'ları uygular. `open_encrypted`
/// ve `open_existing` arasında paylaşılan tek kod yolu -- anahtar ayarlama ve
/// hata sınıflandırma mantığının iki kopyası olursa biri güncellenip diğeri
/// unutulabilir (bkz. `store::zaman::zaman_gecerli_mi` dokümantasyonundaki
/// aynı gerekçe).
fn anahtar_ayarla_ve_hazirla(conn: Connection, key: &DataKey) -> Result<Connection, DbError> {
    // Anahtarın hex temsili ve onu saran PRAGMA değeri, ara String'ler olarak
    // bellekte kalabileceğinden Zeroizing ile sarılıyor (bkz. Görev 2'deki
    // aynı sınıftan bulgu: anahtar tutan her ara buffer sıfırlanmalı).
    let anahtar_hex: Zeroizing<String> = Zeroizing::new(hex::encode(key.as_ref()));
    let pragma_degeri: Zeroizing<String> = Zeroizing::new(format!("x'{}'", anahtar_hex.as_str()));
    let anahtar_sonucu = conn.pragma_update(None, "key", pragma_degeri.as_str());

    match anahtar_sonucu {
        Ok(_) => {}
        Err(e) => return Err(siniflandir_anahtar_hatasi(e)),
    }

    // Anahtar yanlışsa ilk gerçek okuma "file is not a database" ile patlar.
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)) {
        Ok(_) => {}
        Err(e) => return Err(siniflandir_anahtar_hatasi(e)),
    }

    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    Ok(conn)
}

/// Dosya yoksa YARATIR (kurulum akışı için -- bkz. `routes::setup::kurulum`).
pub fn open_encrypted(path: &Path, key: &DataKey) -> Result<Connection, DbError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    anahtar_ayarla_ve_hazirla(conn, key)
}

/// Dosya yoksa YARATMAZ, `DbError::DosyaYok` döner (veri uç noktaları için --
/// bkz. `server::guard::acik_baglanti`). `open_encrypted`'in aksine burada
/// `SQLITE_OPEN_CREATE` bayrağı VERİLMEZ: `veri.db` bir kullanıcı hatasıyla
/// (yanlışlıkla silme) veya senkronizasyon aracının onu yutmasıyla ortadan
/// kalkarsa, veri uç noktaları bunu sessizce "boş bir veritabanı" olarak
/// görüp kullanıcıya "tüm danışanlarınız/randevularınız silindi" izlenimi
/// vermemeli -- bunun yerine net bir hata dönüp yedekten geri yüklemeye
/// yönlendirmeli.
pub fn open_existing(path: &Path, key: &DataKey) -> Result<Connection, DbError> {
    if !path.is_file() {
        return Err(DbError::DosyaYok);
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    anahtar_ayarla_ve_hazirla(conn, key)
}

/// Açılmış bir bağlantı üzerinde `PRAGMA integrity_check` çalıştırır.
///
/// Tasarım §8: *"Veritabanı bozuk → açılışta bütünlük kontrolü; bozuksa geri
/// yükleme ekranına düşer."* Bu fonksiyon o vaadin çalıştırılabilir hâlidir;
/// tek çağrı yeri `routes::session::kilit_ac`'tır (yani gerçekten **açılış**
/// yolu).
///
/// # Neden `integrity_check`, `quick_check` değil -- ÖLÇÜLDÜ
///
/// `backup::geri_yukle` bir YEDEK dosyasını doğrularken bilerek
/// `quick_check` kullanır (hız/kapsam dengesi; bkz. oradaki gerekçe).
/// Burada denge terstir: bu, oturum başına **bir kez** çalışan giriş
/// kapısıdır ve `quick_check`'in atladığı tek şey -- indeks/tablo çapraz
/// doğrulaması -- tam olarak sessizce yanlış sonuç üreten bozulma
/// sınıfıdır: bozuk bir `idx_appointments_baslangic` ya da arama indeksi,
/// var olan bir seans notunu aramada "yok" gösterir ve kullanıcı bunu bir
/// bozulma değil, kendi hatası sanar.
///
/// **Fark ölçüldü, sonra karar verildi** (`tests::butunluk_kontrolu_maliyet_olcumu`,
/// `--nocapture`; Windows 11, debug profili -- yani gerçek dağıtımdan
/// yavaş; ~41 MB'lık veritabanı = iki adet 20 MB'lık ek, üç ardışık koşu):
///
/// | Kontrol                  | ölçülen       |
/// |--------------------------|---------------|
/// | `PRAGMA integrity_check` | 160-176 ms    |
/// | `PRAGMA quick_check`     | 161-176 ms    |
///
/// İki süre **ölçüm gürültüsünün içinde**: bu veritabanı boyutunda
/// `quick_check`'in hiçbir kazancı yok, dolayısıyla kapsamı feda etmek
/// için hiçbir sebep de yok. Kilit açma zaten Argon2id türetmesiyle
/// ~2 saniye sürüyor (bkz. `playwright.config.ts`'teki ölçüm); 0,17 sn
/// onun %8'i ve oturumda **bir kez** ödeniyor.
///
/// Bu karar yeniden gözden geçirilmelidir eğer: veritabanı, eklerin uyarı
/// eşiğine (500 MB) yaklaşırsa -- doğrusal ölçeklemeyle ~2 sn -- ya da
/// kontrol her istekte çalıştırılmak istenirse (aşağıya bakınız). Ölçüm
/// BLOB boyutunu `attachments::AZAMI_DOSYA_BOYUTU`'ndan alıyor: dosya
/// başına sınır büyürse ölçüm de kendiliğinden büyür.
///
/// # Veri uç noktalarında ÇALIŞTIRILMAZ
///
/// `guard::acik_baglanti` her istekte taze bağlantı açıyor; bütünlük
/// kontrolünü oraya koymak her randevu yüklemesinde tüm veritabanını
/// okumak olurdu.
pub fn butunluk_kontrol(conn: &Connection) -> Result<(), DbError> {
    // `integrity_check` bozukluk bulursa BİRDEN ÇOK satır döndürür; ilk
    // satır "ok" değilse dosya bozuktur. Hata metinlerinin kendisi
    // (sayfa numaraları, indeks adları) kullanıcıya GÖSTERİLMEZ ve buradan
    // dışarı taşınmaz -- `DbError::Bozuk` hiçbir alan taşımaz.
    match conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)) {
        Ok(ilk) if ilk == "ok" => Ok(()),
        Ok(_) => Err(DbError::Bozuk),
        // Bozulma sayfa okuma sırasında da yüzeye çıkabilir (SQLCipher, HMAC
        // tutmayan bir sayfayı okurken hata verir ve `integrity_check` hiç
        // satır döndüremez). `SQLITE_CORRUPT` bu yüzden `Bozuk`'a eşlenir.
        // Diğer her hata (`SQLITE_BUSY`, disk G/Ç) `Sqlite` olarak geçer --
        // geçici bir soruna "dosyanız bozuk" demek, kullanıcıyı sağlam bir
        // veritabanını silmeye itebilir (`siniflandir_anahtar_hatasi` ile
        // aynı gerekçe).
        Err(rusqlite::Error::SqliteFailure(ref ffi_hata, _))
            if ffi_hata.code == ErrorCode::DatabaseCorrupt =>
        {
            Err(DbError::Bozuk)
        }
        Err(e) => Err(DbError::Sqlite(e)),
    }
}

/// SQLite/SQLCipher hatasını sınıflandırır.
///
/// Yalnızca `SQLITE_NOTADB` (ErrorCode::NotADatabase) yanlış parolayı işaret eder:
/// SQLCipher yanlış anahtarla açılan bir dosyayı okumaya çalıştığında sayfa
/// başlıklarını çözemez ve bunu "dosya bir veritabanı değil" hatası olarak
/// bildirir. Kilitli dosya (`SQLITE_BUSY`/`SQLITE_LOCKED`), disk G/Ç hatası
/// (`SQLITE_IOERR`) veya gerçekten bozuk bir veritabanı (`SQLITE_CORRUPT`)
/// gibi diğer tüm `SqliteFailure` türleri `DbError::Sqlite` olarak geçirilir;
/// aksi halde kullanıcı doğru parolayla karşılaştığı geçici bir sorunu
/// "parolanız yanlış" sanıp kurtarılabilir veriyi sıfırlayarak imha edebilir.
fn siniflandir_anahtar_hatasi(err: rusqlite::Error) -> DbError {
    match err {
        rusqlite::Error::SqliteFailure(ref ffi_hata, _)
            if ffi_hata.code == ErrorCode::NotADatabase =>
        {
            DbError::WrongKey
        }
        // `pragma_update(None, "key", ...)` anahtarı SQL metnine gömerek
        // çalıştırır. `prepare` bu SQL'i reddederse rusqlite bunu
        // `SqlInputError { sql: <TAM SQL METNİ>, .. }` olarak bildirir; bu
        // hatanın Display'i "PRAGMA key='x<64 hex karakter>'" biçiminde ham
        // anahtarı basar. Kaynak hatayı taşımadan genel bir varyanta
        // dönüştürerek anahtarın stderr'e (bkz. `eprintln!` çağrıları) veya
        // herhangi bir loga düşmesini kökten engelliyoruz (bkz. Bulgu 3).
        rusqlite::Error::SqlInputError { .. } => DbError::AnahtarGirdiHatasi,
        other => DbError::Sqlite(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;

    #[test]
    fn ayni_anahtarla_yazilan_veri_geri_okunur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = generate_data_key();

        {
            let c = open_encrypted(&yol, &key).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse Yilmaz');")
                .unwrap();
        }

        let c = open_encrypted(&yol, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse Yilmaz");
    }

    #[test]
    fn yanlis_anahtar_wrong_key_dondurur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        {
            let c = open_encrypted(&yol, &generate_data_key()).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT);").unwrap();
        }
        let hata = open_encrypted(&yol, &generate_data_key()).unwrap_err();
        assert!(matches!(hata, DbError::WrongKey));
    }

    #[test]
    fn dosya_icinde_duz_metin_bulunmaz() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        {
            let c = open_encrypted(&yol, &generate_data_key()).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('GIZLI_DANISAN_ADI');")
                .unwrap();
        }
        let bytes = std::fs::read(&yol).unwrap();
        assert!(
            !bytes.windows(17).any(|w| w == b"GIZLI_DANISAN_ADI"),
            "veritabani dosyasinda duz metin bulundu"
        );
        assert!(&bytes[..15] != b"SQLite format 3", "dosya sifrelenmemis");
    }

    #[test]
    fn sifrelenmemis_duz_sqlite_dosyasi_wrong_key_olarak_siniflandirilir() {
        // Şifrelenmemiş ama tamamen geçerli bir SQLite dosyası: anahtarla
        // açılmaya çalışıldığında SQLCipher sayfa başlıklarını çözemez ve bu,
        // gerçek SQLCipher davranışında SQLITE_NOTADB olarak yüzeye çıkar.
        // Bu, `siniflandir_anahtar_hatasi`nin isabet etmesi gereken asıl
        // WrongKey senaryosudur.
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("duz.db");
        {
            let c = rusqlite::Connection::open(&yol).unwrap();
            c.execute_batch("CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);")
                .unwrap();
        }

        let hata = open_encrypted(&yol, &generate_data_key()).unwrap_err();
        assert!(
            matches!(hata, DbError::WrongKey),
            "beklenen WrongKey, gelen: {hata:?}"
        );
    }

    #[test]
    fn olusturulamayan_dizin_io_hatasi_dondurur() {
        // `path.parent()` bir dizin değil de var olan bir dosyaysa
        // `create_dir_all` başarısız olur; bu hatanın WrongKey'e değil
        // DbError::Io'ya gitmesi gerekir.
        let dir = tempfile::tempdir().unwrap();
        let engel = dir.path().join("bu_bir_dizin_degil");
        std::fs::write(&engel, b"ben bir dizin degilim, duz bir dosyayim").unwrap();
        let yol = engel.join("veri.db");

        let hata = open_encrypted(&yol, &generate_data_key()).unwrap_err();
        assert!(
            matches!(hata, DbError::Io(_)),
            "beklenen Io, gelen: {hata:?}"
        );
    }

    #[test]
    fn notadb_disindaki_sqlite_hatasi_wrongkey_e_donusturulmez() {
        // `siniflandir_anahtar_hatasi`nin asıl düzeltmesi: NotADatabase
        // dışındaki her SqliteFailure türü (ör. kilitli dosya, disk G/Ç,
        // bozukluk) DbError::Sqlite'a gitmeli, WrongKey'e değil. Gerçek bir
        // SQLITE_BUSY/SQLITE_IOERR durumunu dosya kilitleme ile uçtan uca
        // deterministik biçimde tetiklemek platforma/zamanlamaya bağlı ve
        // kırılgan olacağından, sınıflandırma fonksiyonu burada doğrudan
        // sahte bir DatabaseBusy hatasıyla test ediliyor (bkz. rapor: "yazılamayan
        // testler").
        let sahte_ffi_hata = rusqlite::ffi::Error {
            code: ErrorCode::DatabaseBusy,
            extended_code: 5, // SQLITE_BUSY
        };
        let hata = siniflandir_anahtar_hatasi(rusqlite::Error::SqliteFailure(sahte_ffi_hata, None));
        assert!(
            matches!(hata, DbError::Sqlite(_)),
            "beklenen Sqlite, gelen: {hata:?}"
        );
    }

    // --- `open_existing`: "yoksa oluşturma" davranışı (bkz. Plan 1'in son
    // incelemesinden Kural 2) ---

    #[test]
    fn open_existing_olmayan_dosyada_dosyayok_doner_ve_dosya_yaratilmaz() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        assert!(!yol.exists(), "test onkosulu: dosya hic olusturulmamis olmali");

        let hata = open_existing(&yol, &generate_data_key()).unwrap_err();
        assert!(matches!(hata, DbError::DosyaYok), "beklenen DosyaYok, gelen: {hata:?}");
        assert!(
            !yol.exists(),
            "open_existing dosya yoksa YARATMAMALI -- open_encrypted'den farki bu"
        );
    }

    #[test]
    fn open_existing_dosyayok_mesaji_yedege_yonlendirir() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let hata = open_existing(&yol, &generate_data_key()).unwrap_err();
        let metin = hata.to_string().to_lowercase();
        assert!(
            metin.contains("yedek"),
            "kullaniciya gorunecek mesaj yedekten geri yuklemeye yonlendirmeli: {metin}"
        );
    }

    #[test]
    fn open_existing_var_olan_dosyayi_ayni_anahtarla_acar_ve_veri_geri_okunur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = generate_data_key();

        {
            // Onceden open_encrypted ile olusturulmus (kurulum akisinin
            // yaptigi gibi) bir veritabani.
            let c = open_encrypted(&yol, &key).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse Yilmaz');")
                .unwrap();
        }

        let c = open_existing(&yol, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse Yilmaz");
    }

    #[test]
    fn open_existing_yanlis_anahtarla_wrong_key_dondurur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        {
            let c = open_encrypted(&yol, &generate_data_key()).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT);").unwrap();
        }
        let hata = open_existing(&yol, &generate_data_key()).unwrap_err();
        assert!(matches!(hata, DbError::WrongKey), "beklenen WrongKey, gelen: {hata:?}");
    }

    // --- Tasarim §8: acilista butunluk kontrolu -------------------------

    #[test]
    fn saglam_veritabani_butunluk_kontrolunden_gecer() {
        // ARTI YON: "her zaman Bozuk don" mutasyonu burada kirilir.
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = generate_data_key();
        let c = open_encrypted(&yol, &key).unwrap();
        crate::store::schema::migrate(&c).unwrap();
        butunluk_kontrol(&c).expect("saglam veritabani gecmeli");
    }

    #[test]
    fn veri_sayfasi_bozuk_veritabani_butunluk_kontrolunde_yakalanir() {
        // ASIL BULGU: bu dosya `open_existing`/`open_encrypted`'ten SORUNSUZ
        // gecer -- anahtar dogrudur ve sema sayfasi saglamdir. Yani bugune
        // kadar bu bozulma sinifi hicbir yerde tespit EDILMIYORDU.
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = generate_data_key();
        {
            let c = open_encrypted(&yol, &key).unwrap();
            crate::store::schema::migrate(&c).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT);").unwrap();
            let mut stmt = c.prepare("INSERT INTO t VALUES (?1)").unwrap();
            for i in 0..500 {
                stmt.execute([format!("satir-{i}-{}", "x".repeat(50))]).unwrap();
            }
        }

        let mut bytes = std::fs::read(&yol).unwrap();
        let uzunluk = bytes.len();
        assert!(uzunluk > 8192, "test icin en az iki sayfalik veri gerekiyor: {uzunluk}");
        // Sema (ilk sayfa) saglam kalsin, son veri sayfalari bozulsun.
        for b in bytes.iter_mut().skip(uzunluk - 200) {
            *b ^= 0xFF;
        }
        std::fs::write(&yol, &bytes).unwrap();

        // ON KOSUL -- kontrolun VAROLUS SEBEBI: acilis basarili oluyor.
        let c = open_existing(&yol, &key).expect(
            "on kosul: bozuk dosya ACILABILIYOR olmali -- butunluk kontrolu \
             tam da bu yuzden gerekli",
        );

        let hata = butunluk_kontrol(&c).unwrap_err();
        assert!(
            matches!(hata, DbError::Bozuk),
            "bozuk sayfa `Bozuk` olarak raporlanmali, gelen: {hata:?}"
        );
    }

    /// **`integrity_check` mi `quick_check` mi** -- kararın ÖLÇÜMÜ.
    ///
    /// `guard::baglanti_omru_olcumu` ile aynı yöntem ve aynı gerekçe: bu bir
    /// eşik testi DEĞİL, bir ölçümdür. Makineye ve diske bağlı bir süreyi
    /// assert etmek bu kod tabanında zaten bir kez "ortama bağlı
    /// etkisizleşen test" olarak geri tepti; bunun yerine iki seçenek aynı
    /// koşullarda ölçülür, süreler `--nocapture` ile yazdırılır ve **kararın
    /// kendisi** `butunluk_kontrol`'ün belgesinde yazılıdır.
    ///
    /// Neden BLOB'lu: bu ürünün en büyük veritabanı senaryosu ekli
    /// dosyalardır (dosya başına 20 MB, uyarı eşiği 500 MB). Küçük bir
    /// veritabanıyla yapılan ölçüm "kilit açmayı yavaşlatır mı" sorusunu
    /// yanıtlamazdı -- `guard::baglanti_omru_olcumu`'nun BLOB senaryosunu
    /// eklemesiyle aynı ders.
    ///
    /// Assertion yalnızca ölçümün gerçekten yapıldığını (BLOB'ların diske
    /// TAM boyutunda yazıldığını ve kontrolün sağlam dosyada geçtiğini)
    /// doğrular -- yoksa boş bir veritabanını ölçüyor olabilirdik.
    #[test]
    fn butunluk_kontrolu_maliyet_olcumu() {
        use std::time::Instant;
        // Sinira BAGLI: dosya basina azami boyut buyurse olcum de buyur.
        // Sabit bir `20 * 1024 * 1024` yazmak, sinir degistiginde olcumu
        // sessizce bayatlatirdi (`guard::baglanti_omru_olcumu` ile ayni
        // gerekce).
        const BLOB_BOYUTU: usize = crate::store::attachments::AZAMI_DOSYA_BOYUTU;
        const BLOB_ADEDI: usize = 2;

        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = generate_data_key();
        {
            let c = open_encrypted(&yol, &key).unwrap();
            crate::store::schema::migrate(&c).unwrap();
            c.execute_batch("CREATE TABLE ekler(icerik BLOB);").unwrap();
            let icerik = vec![0x41u8; BLOB_BOYUTU];
            let mut stmt = c.prepare("INSERT INTO ekler VALUES (?1)").unwrap();
            for _ in 0..BLOB_ADEDI {
                stmt.execute([&icerik]).unwrap();
            }
        }
        let dosya_boyutu = std::fs::metadata(&yol).unwrap().len();

        let c = open_existing(&yol, &key).unwrap();

        let t0 = Instant::now();
        butunluk_kontrol(&c).expect("saglam veritabani gecmeli");
        let tam: std::time::Duration = t0.elapsed();

        let t1 = Instant::now();
        let hizli_sonuc: String = c.query_row("PRAGMA quick_check", [], |r| r.get(0)).unwrap();
        let hizli: std::time::Duration = t1.elapsed();

        println!(
            "--- butunluk kontrolu olcumu ({BLOB_ADEDI} x {:.0} MB ek) ---",
            BLOB_BOYUTU as f64 / (1024.0 * 1024.0)
        );
        println!("veritabani boyutu           : {:.1} MB", dosya_boyutu as f64 / (1024.0 * 1024.0));
        println!("PRAGMA integrity_check      : {tam:>10.2?}");
        println!("PRAGMA quick_check          : {hizli:>10.2?}");
        println!(
            "fark (capraz dogrulamanin bedeli): {:>10.2?} -- kilit acma oturumda BIR KEZ",
            tam.saturating_sub(hizli)
        );

        // Olcumun gercekten ~40 MB'lik bir dosyayi taradigini kanitlar.
        assert!(
            dosya_boyutu as usize >= BLOB_BOYUTU * BLOB_ADEDI,
            "olculen veritabani beklenenden kucuk: {dosya_boyutu}"
        );
        assert_eq!(hizli_sonuc, "ok", "on kosul: dosya saglam olmali");
    }

    #[test]
    fn bozuk_mesaji_parolayi_suclamaz_ve_silmeyi_onermez() {
        // "Her hata parola hatasidir" sinifinin bu katmandaki karsiligi.
        // Kullanici bu metni panik anında okuyor: parolasinin DOGRU oldugunu
        // soylemeyen bir mesaj onu sifirlamaya/yeniden kuruluma iter.
        let metin = DbError::Bozuk.to_string().to_lowercase();
        assert!(metin.contains("parolanız doğru"), "mesaj parolanin dogru oldugunu soylemeli: {metin}");
        assert!(metin.contains("yedek"), "mesaj geri yuklemeye yonlendirmeli: {metin}");
        assert!(metin.contains("silmeyin"), "mesaj silmemeyi ogutlemeli: {metin}");
        assert!(
            metin.contains("yeniden kurulum yapmayın"),
            "mesaj yeniden kurulumu yasaklamali (yeni kurulum anahtari ezer): {metin}"
        );
        // `WrongKey` ile AYNI metin olmamali; ikisi ayri hatalardir.
        assert_ne!(DbError::Bozuk.to_string(), DbError::WrongKey.to_string());
    }

    #[test]
    fn sql_input_error_ham_anahtari_disari_tasimaz() {
        // Bulgu 3: `PRAGMA key='x<hex>'` calisirken `prepare` basarisiz olursa
        // rusqlite bunu `SqlInputError { sql: <TAM SQL METNI>, .. }` olarak
        // bildirir; bu hatanin hem Display'i hem Debug'i basarisiz SQL'in
        // TAMAMINI (dolayisiyla ham anahtarin hex temsilini) icerir. Yukaridaki
        // `notadb_disindaki_sqlite_hatasi_wrongkey_e_donusturulmez` testinin
        // desenini izleyerek gercek bir hata durumunu tetiklemek yerine
        // sahte bir SqlInputError insa ediyoruz.
        let sahte_hex_anahtar = "a".repeat(64);
        let hayali_sql = format!("PRAGMA key='x'{sahte_hex_anahtar}''");
        let sahte_ffi_hata = rusqlite::ffi::Error { code: ErrorCode::Unknown, extended_code: 1 };
        let sahte_hata = rusqlite::Error::SqlInputError {
            error: sahte_ffi_hata,
            msg: "near \"'\": syntax error".into(),
            sql: hayali_sql.clone(),
            offset: 0,
        };

        // On kosul: rusqlite'in kendi Display/Debug'i gercekten SQL metnini
        // (dolayisiyla sahte anahtari) basiyor mu? Bu testin anlamli olmasi
        // icin dogru olmali.
        assert!(format!("{sahte_hata}").contains(&sahte_hex_anahtar));
        assert!(format!("{sahte_hata:?}").contains(&sahte_hex_anahtar));

        let hata = siniflandir_anahtar_hatasi(sahte_hata);
        assert!(
            matches!(hata, DbError::AnahtarGirdiHatasi),
            "beklenen AnahtarGirdiHatasi, gelen: {hata:?}"
        );
        assert!(
            !format!("{hata}").contains(&sahte_hex_anahtar),
            "siniflandirilmis hatanin Display'i ham anahtari icermemeli"
        );
        assert!(
            !format!("{hata:?}").contains(&sahte_hex_anahtar),
            "siniflandirilmis hatanin Debug'i ham anahtari icermemeli"
        );
        assert!(
            !format!("{hata:?}").contains(&hayali_sql),
            "siniflandirilmis hatanin Debug'i kaynak SQL metnini icermemeli"
        );
    }
}
